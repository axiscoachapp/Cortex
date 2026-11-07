// Encrypted backup and row fingerprint of a Supabase project, before a rollout.
//
//   node scripts/supabase-rollout/backup.mjs --project <ref> --label <name>        backup + fingerprint-before.json
//   node scripts/supabase-rollout/backup.mjs --project <ref> --label <name> --fingerprint after
//                                                                                   only fingerprint-after.json
//   node scripts/supabase-rollout/backup.mjs --project <ref> --label <name> --compare
//                                                                                   compares before and after
//
// Scope: every row of the public and cortex_private tables, migration history, function
// definitions, policies, triggers, grants, columns, Storage buckets and object metadata, cron jobs.
// Format: iv(12) | tag(16) | ciphertext, AES-256-GCM; the key is wrapped with Windows DPAPI
// (CurrentUser) and stored beside it. Output: %LOCALAPPDATA%\CortexBackups\<ref>-<label>.
// The backup holds patient data: it stays on this computer, outside the repository.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arg, backupDir, lit, project, query } from './lib.mjs';

// process.exit() right after fetch can crash Node on Windows (libuv assertion); set the code instead.
async function main() {
  const ref = project();
  const DIR = backupDir(ref, arg('label'));
  const q = (sql) => query(ref, sql);

  const tables = await q(`select n.nspname as s, c.relname as t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','cortex_private') and c.relkind in ('r','p') order by 1,2`);

  async function fingerprint() {
    const out = {};
    for (const { s, t } of tables) {
      const cols = (await q(`select attname from pg_attribute where attrelid=${lit(`"${s}"."${t}"`)}::regclass and attnum>0 and not attisdropped order by attnum`)).map((r) => r.attname);
      const list = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
      const [r] = await q(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') as h from (select ${list} from "${s}"."${t}") x`);
      out[`${s}.${t}`] = { cols, n: r.n, h: r.h };
    }
    return out;
  }

  if (process.argv.includes('--compare')) {
    const b = JSON.parse(readFileSync(join(DIR, 'fingerprint-before.json'), 'utf8'));
    const a = JSON.parse(readFileSync(join(DIR, 'fingerprint-after.json'), 'utf8'));
    const diff = [];
    for (const [t, v] of Object.entries(b)) {
      const x = a[t];
      if (!x) diff.push(`${t}: missing after`);
      else if (JSON.stringify(x.cols) !== JSON.stringify(v.cols)) {
        // New columns at the end keep the old data comparable only through a new fingerprint; report them.
        diff.push(`${t}: columns ${v.cols.length} -> ${x.cols.length}`);
      } else if (x.n !== v.n || x.h !== v.h) diff.push(`${t}: rows ${v.n} -> ${x.n}, content ${x.h === v.h ? 'same' : 'changed'}`);
    }
    console.log(`pre-existing tables: ${Object.keys(b).length}, identical: ${Object.keys(b).length - diff.length}, new tables: ${Object.keys(a).filter((t) => !b[t]).length}`);
    for (const d of diff) console.log(`  DIFFERENT ${d}`);
    return diff.length ? 1 : 0;
  }

  const which = arg('fingerprint', '');
  if (which) {
    mkdirSync(DIR, { recursive: true });
    const fp = await fingerprint();
    writeFileSync(join(DIR, `fingerprint-${which}.json`), JSON.stringify(fp, null, 1));
    console.log(`fingerprint-${which}: ${Object.keys(fp).length} tables`);
    return 0;
  }

  mkdirSync(DIR, { recursive: true });
  const data = {};
  const rows = {};
  for (const { s, t } of tables) {
    const [{ n }] = await q(`select count(*)::int as n from "${s}"."${t}"`);
    const all = [];
    for (let off = 0; off < n; off += 5000) {
      const [page] = await q(`select coalesce(json_agg(x),'[]'::json) as j from (select * from "${s}"."${t}" order by ctid limit 5000 offset ${off}) x`);
      all.push(...page.j);
    }
    if (all.length !== n) throw new Error(`${s}.${t}: read ${all.length} of ${n} rows`);
    data[`${s}.${t}`] = all;
    rows[`${s}.${t}`] = n;
  }
  const schema = {
    migrations: await q(`select version, name, statements from supabase_migrations.schema_migrations order by version`),
    functions: await q(`select n.nspname as schema, p.proname as name, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','cortex_private') and p.prokind in ('f','p') order by 1,2`),
    policies: await q(`select * from pg_policies where schemaname in ('public','cortex_private','storage') order by schemaname, tablename, policyname`),
    triggers: await q(`select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement
      from information_schema.triggers where event_object_schema in ('public','cortex_private','storage') order by 1,2,3,5`),
    grants: await q(`select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema in ('public','cortex_private') order by 1,2,3,4`),
    columns: await q(`select table_schema, table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema in ('public','cortex_private') order by 1,2,ordinal_position`),
    storage: {
      buckets: await q(`select * from storage.buckets order by id`),
      objects: await q(`select id, bucket_id, name, owner, metadata, created_at, updated_at from storage.objects order by bucket_id, name`),
    },
    cron: await q(`select jobname, schedule, command, active from cron.job order by jobname`).catch(() => []),
  };
  const plain = Buffer.from(JSON.stringify({ takenAt: new Date().toISOString(), project: ref, rows, data, schema }));
  const sha = createHash('sha256').update(plain).digest('hex');
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  writeFileSync(join(DIR, 'backup.json.aesgcm'), Buffer.concat([iv, c.getAuthTag(), ct]));
  const dpapi = (verb, b64) => execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::${verb}([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`], { encoding: 'utf8' }).trim();
  const wrapped = dpapi('Protect', key.toString('base64'));
  writeFileSync(join(DIR, 'key.dpapi.b64'), wrapped);

  // Verify before anything else happens: unwrap, decrypt, compare SHA-256.
  const blob = readFileSync(join(DIR, 'backup.json.aesgcm'));
  const d = createDecipheriv('aes-256-gcm', Buffer.from(dpapi('Unprotect', wrapped), 'base64'), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  const ok = createHash('sha256').update(Buffer.concat([d.update(blob.subarray(28)), d.final()])).digest('hex') === sha;
  writeFileSync(join(DIR, 'manifest.json'), JSON.stringify({ takenAt: new Date().toISOString(), project: ref, sha256: sha, bytes: plain.length, rows,
    migrations: schema.migrations.length, functions: schema.functions.length, policies: schema.policies.length, storageObjects: schema.storage.objects.length,
    format: 'iv(12) | tag(16) | ciphertext, AES-256-GCM; key wrapped with Windows DPAPI CurrentUser' }, null, 1));
  console.log(`backup: ${DIR}\n  ${plain.length} bytes, ${Object.keys(rows).length} tables, ${schema.migrations.length} migrations, verified: ${ok}`);
  if (!ok) return 1;
  writeFileSync(join(DIR, 'fingerprint-before.json'), JSON.stringify(await fingerprint(), null, 1));
  console.log('  fingerprint-before.json written');
  return 0;
}
process.exitCode = await main();
