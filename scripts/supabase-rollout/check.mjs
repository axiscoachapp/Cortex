// Read-only drift report between this repository and a Supabase project:
// - migrations pending, remote-only or out of order;
// - Edge Functions not deployed, or with commits (function folder or _shared) after the deploy;
// - secrets read by the functions and missing in the project.
// Exit code 1 when migrations or functions are behind (secrets are informative: some come from
// outside accounts and are expected to be missing until those exist).
//
//   node scripts/supabase-rollout/check.mjs --project <ref>
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, listFunctions, listSecretNames, project, query } from './lib.mjs';

// process.exit() right after fetch can crash Node on Windows (libuv assertion); set the code instead.
async function main() {
  const ref = project();
  const MIG = join(REPO, 'supabase/migrations');
  const FN = join(REPO, 'supabase/functions');
  // Secrets that only exist once an outside account is set up; reported, but not a failure.
  // Optional ones (with a default in code) are listed in the same group.
  const EXTERNAL = /^(WHATSAPP_APP_SECRET|WHATSAPP_GRAPH_VERSION|SIGNATURE_|GOOGLE_|RESEND_|GEMINI_|OPENAI_|AI_)/;
  // Set by the platform in every project.
  const PLATFORM = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'SUPABASE_JWKS', 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS']);

  let behind = false;

  // ---------------------------------------------------------------- migrations
  const remote = (await query(ref, 'select version from supabase_migrations.schema_migrations order by version')).map((r) => r.version);
  const files = readdirSync(MIG).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const local = files.map((f) => f.slice(0, 14));
  const remoteSet = new Set(remote);
  const pending = files.filter((f) => !remoteSet.has(f.slice(0, 14)));
  const remoteOnly = remote.filter((v) => !local.includes(v));
  const head = remote.at(-1) ?? '';
  const older = pending.filter((f) => f.slice(0, 14) < head);
  console.log(`Migrations: ${remote.length} applied, ${files.length} in the repository.`);
  if (pending.length) { behind = true; console.log(`  PENDING (${pending.length}):`); for (const f of pending) console.log(`    ${f}`); }
  if (remoteOnly.length) { behind = true; console.log(`  REMOTE ONLY (not in the repository): ${remoteOnly.join(', ')}`); }
  if (older.length) { behind = true; console.log(`  OUT OF ORDER (older than the remote head ${head}): ${older.join(', ')}`); }
  if (!pending.length && !remoteOnly.length) console.log('  up to date');

  // ---------------------------------------------------------------- functions
  const deployed = new Map((await listFunctions(ref)).map((f) => [f.slug, f]));
  const localFns = readdirSync(FN, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(FN, d.name, 'index.ts'))).map((d) => d.name).sort();
  const lastCommit = (paths) => {
    const out = execFileSync('git', ['-C', REPO, 'log', '-1', '--format=%ct', '--', ...paths], { encoding: 'utf8' }).trim();
    return out ? Number(out) * 1000 : 0;
  };
  const sharedAt = lastCommit(['supabase/functions/_shared']);
  const missingFns = localFns.filter((f) => !deployed.has(f));
  const stale = localFns.filter((f) => deployed.has(f) && Math.max(lastCommit([`supabase/functions/${f}`]), sharedAt) > Number(deployed.get(f).updated_at));
  const remoteOnlyFns = [...deployed.keys()].filter((f) => !localFns.includes(f));
  console.log(`Functions: ${deployed.size} deployed, ${localFns.length} in the repository.`);
  if (missingFns.length) { behind = true; console.log(`  NOT DEPLOYED: ${missingFns.join(', ')}`); }
  if (stale.length) { behind = true; console.log(`  COMMITS AFTER THE DEPLOY (function or _shared): ${stale.join(', ')}`); }
  if (remoteOnlyFns.length) console.log(`  deployed but not in the repository: ${remoteOnlyFns.join(', ')}`);
  if (!missingFns.length && !stale.length) console.log('  up to date');
  const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', 'supabase/'], { encoding: 'utf8' }).trim();
  if (dirty) console.log('  note: supabase/ has uncommitted changes; deploy from a clean tree.');

  // ---------------------------------------------------------------- secrets
  const set = new Set(await listSecretNames(ref));
  // Secrets each function reads: its own files plus the _shared files it imports, transitively.
  // Deno.env.get('X') and the env('X') helper some modules receive.
  const ENV = /(?:Deno\.env\.get|\benv)\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g;
  const IMPORT = /from\s+['"](?:\.\.\/_shared\/|\.\/)([A-Za-z0-9_.-]+\.ts)['"]/g;
  const sharedFiles = new Map(readdirSync(join(FN, '_shared')).filter((e) => e.endsWith('.ts') && !e.endsWith('.test.ts'))
    .map((e) => [e, readFileSync(join(FN, '_shared', e), 'utf8')]));
  const needs = new Map();
  for (const f of localFns) {
    const texts = readdirSync(join(FN, f)).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts')).map((x) => readFileSync(join(FN, f, x), 'utf8'));
    const seen = new Set();
    const queue = texts.flatMap((t) => [...t.matchAll(IMPORT)].map((m) => m[1]));
    while (queue.length) {
      const e = queue.pop();
      if (seen.has(e) || !sharedFiles.has(e)) continue;
      seen.add(e);
      queue.push(...[...sharedFiles.get(e).matchAll(IMPORT)].map((m) => m[1]));
    }
    for (const t of [...texts, ...[...seen].map((e) => sharedFiles.get(e))])
      for (const m of t.matchAll(ENV)) { if (!needs.has(m[1])) needs.set(m[1], new Set()); needs.get(m[1]).add(f); }
  }
  const missing = [...needs.keys()].filter((k) => !set.has(k) && !PLATFORM.has(k)).sort();
  const ours = missing.filter((k) => !EXTERNAL.test(k));
  const external = missing.filter((k) => EXTERNAL.test(k));
  console.log(`Secrets: ${set.size} set in the project.`);
  if (ours.length) { console.log('  MISSING (can be generated for this environment):'); for (const k of ours) console.log(`    ${k}  <- ${[...needs.get(k)].join(', ')}`); }
  if (external.length) { console.log('  missing, optional or from outside accounts (expected until set up):'); for (const k of external) console.log(`    ${k}  <- ${[...needs.get(k)].join(', ')}`); }
  if (!missing.length) console.log('  all present');

  console.log(behind ? '\nRESULT: the project is behind the repository.' : '\nRESULT: migrations and functions match the repository.');
  return behind ? 1 : 0;
}
process.exitCode = await main();
