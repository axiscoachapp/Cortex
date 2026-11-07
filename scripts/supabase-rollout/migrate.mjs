// Applies the repository's pending migrations to a Supabase project as one bundle: each file
// followed by its supabase_migrations.schema_migrations row, all in one transaction.
//
//   node scripts/supabase-rollout/migrate.mjs --project <ref> --label <name> --mode dryrun
//   node scripts/supabase-rollout/migrate.mjs --project <ref> --label <name> --mode negative
//   node scripts/supabase-rollout/migrate.mjs --project <ref> --label <name> --mode apply
//
// dryrun:   runs everything, then a check block that always raises, so nothing is kept. Prints the
//           history count and row counts of the main tables as seen inside the transaction.
// negative: same, with a check that must fail (proves a failed check is reported, not swallowed).
// apply:    the same bundle with commit.
// Refuses to run with remote-only versions or a pending file older than the remote head.
// The bundles are written beside the backup (%LOCALAPPDATA%\CortexBackups\<ref>-<label>).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, arg, backupDir, lit, project, query } from './lib.mjs';

// process.exit() right after fetch can crash Node on Windows (libuv assertion); set the code instead.
async function main() {
  const ref = project();
  const mode = arg('mode');
  const OUT = backupDir(ref, arg('label'));
  mkdirSync(OUT, { recursive: true });
  const MIG = join(REPO, 'supabase/migrations');
  const q = (sql) => query(ref, sql);

  const remote = new Set((await q('select version from supabase_migrations.schema_migrations')).map((r) => r.version));
  const files = readdirSync(MIG).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const local = new Set(files.map((f) => f.slice(0, 14)));
  const remoteOnly = [...remote].filter((v) => !local.has(v));
  const pending = files.filter((f) => !remote.has(f.slice(0, 14)));
  const head = [...remote].sort().at(-1) ?? '';
  if (remoteOnly.length) throw new Error(`Remote-only versions, resolve first: ${remoteOnly.join(', ')}`);
  if (pending.some((f) => f.slice(0, 14) < head)) throw new Error(`A pending file is older than the remote head ${head}`);
  console.log(`remote ${remote.size}, pending ${pending.length}${pending.length ? `: ${pending.join(' ')}` : ''}`);
  if (!pending.length) return 0;

  let body = "set local lock_timeout = '15s';\nset local statement_timeout = '900s';\n";
  for (const f of pending) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) throw new Error(`${f} has its own transaction control; the bundle needs to own the transaction`);
    const version = f.slice(0, 14);
    const name = f.slice(15).replace(/\.sql$/, '');
    body += `-- ${f}\n${sql}\n;\ninsert into supabase_migrations.schema_migrations(version, name, statements) values (${lit(version)}, ${lit(name)}, array[${lit(sql)}]);\n`;
  }
  const expected = remote.size + pending.length;
  const MAIN = ['patients', 'consultations', 'appointments', 'clinics', 'clinic_members'];
  const check = (want) => `do $chk$ declare r text; begin
    r := format('history=%s ${MAIN.map((t) => `${t}=%s`).join(' ')}', (select count(*) from supabase_migrations.schema_migrations),
      ${MAIN.map((t) => `(select count(*) from public.${t})`).join(', ')});
    if (select count(*) from supabase_migrations.schema_migrations) <> ${want} then raise exception 'CHECK_FAILED %', r; end if;
    raise exception 'DRYRUN_OK %', r;
  end $chk$;\n`;

  if (mode === 'dryrun' || mode === 'negative') {
    const sql = `begin;\n${body}${check(mode === 'negative' ? expected + 1 : expected)}rollback;\n`;
    writeFileSync(join(OUT, `${mode}-bundle.sql`), sql);
    let message = '';
    try { await q(sql); } catch (e) { message = String(e.body ?? e.message); }
    const m = /(DRYRUN_OK|CHECK_FAILED)[^"\\]*/.exec(message);
    const [{ n }] = await q('select count(*)::int as n from supabase_migrations.schema_migrations');
    console.log(`${mode}: ${m ? m[0] : `unexpected result: ${message.slice(0, 1500) || 'no exception'}`}`);
    console.log(`remote history after ${mode}: ${n} (must still be ${remote.size})`);
    const good = n === remote.size && m && (mode === 'dryrun' ? m[1] === 'DRYRUN_OK' : m[1] === 'CHECK_FAILED');
    return good ? 0 : 1;
  }
  if (mode !== 'apply') throw new Error('--mode must be dryrun, negative or apply');
  const sql = `begin;\n${body}commit;\n`;
  writeFileSync(join(OUT, 'apply-bundle.sql'), sql);
  console.log(`bundle sha256 ${createHash('sha256').update(sql).digest('hex')}`);
  const t0 = Date.now();
  await q(sql);
  const [after] = await q('select count(*)::int as n, max(version) as last from supabase_migrations.schema_migrations');
  console.log(`applied in ${((Date.now() - t0) / 1000).toFixed(1)} s; history ${after.n} (expected ${expected}), last ${after.last}`);
  return after.n === expected ? 0 : 1;
  return 0;
}
process.exitCode = await main();
