// Runs SQL test files against a Supabase project without leaving anything behind: one outer
// transaction that is always rolled back, with the files' own begin/commit/rollback turned into
// savepoints. Used instead of a local Postgres (no Docker on this machine).
//
//   node scripts/supabase-rollout/sqltest.mjs --project <ref> [--with-pending] supabase/tests/a.test.sql ...
//
// --with-pending: first runs, inside the same transaction, the repository migrations the project
// does not have yet, so a new migration and its tests are proven together before anything is applied.
// The test files assume a database with every migration and the Supabase roles; the bootstrap file
// used with plain Postgres is not needed here. psql meta-commands are not supported.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, project, query } from './lib.mjs';

async function main() {
  const ref = project();
  const withPending = process.argv.includes('--with-pending');
  const files = process.argv.slice(2).filter((a) => a.endsWith('.sql'));
  if (!files.length) throw new Error('Give at least one .sql test file');
  const q = (sql) => query(ref, sql);

  let pending = '';
  if (withPending) {
    const MIG = join(REPO, 'supabase/migrations');
    const remote = new Set((await q('select version from supabase_migrations.schema_migrations')).map((r) => r.version));
    const todo = readdirSync(MIG).filter((f) => /^\d{14}_.+\.sql$/.test(f) && !remote.has(f.slice(0, 14))).sort();
    console.log(`pending migrations included: ${todo.length ? todo.join(' ') : 'none'}`);
    pending = todo.map((f) => `-- ${f}\n${readFileSync(join(MIG, f), 'utf8')}\n;\n`).join('');
  }

  let failed = 0;
  for (const file of files) {
    let n = 0;
    const open = [];
    // The file's own transaction control becomes savepoints inside the outer transaction.
    const body = readFileSync(join(REPO, file), 'utf8').split('\n').map((line) => {
      const t = line.trim().toLowerCase();
      if (t === 'begin;') { open.push(`t${++n}`); return `savepoint ${open.at(-1)};`; }
      if (t === 'rollback;') { const s = open.pop(); return s ? `rollback to savepoint ${s}; release savepoint ${s};` : '-- rollback outside a transaction ignored'; }
      if (t === 'commit;') { const s = open.pop(); return s ? `release savepoint ${s};` : '-- commit outside a transaction ignored'; }
      return line;
    }).join('\n');
    const sql = `begin;\nset local lock_timeout = '10s';\nset local statement_timeout = '180s';\n${pending}reset role;\n${body}\n;\nreset role;\ndo $done$ begin raise exception 'SQLTEST_REACHED_END'; end $done$;\nrollback;\n`;
    let message = '';
    try { await q(sql); } catch (e) { message = String(e.body ?? e.message); }
    if (message.includes('SQLTEST_REACHED_END')) console.log(`PASS ${file}`);
    else { failed++; console.log(`FAIL ${file}\n  ${message.replace(/\\n/g, '\n  ').slice(0, 1500) || 'no result'}`); }
  }
  return failed ? 1 : 0;
}
process.exitCode = await main();
