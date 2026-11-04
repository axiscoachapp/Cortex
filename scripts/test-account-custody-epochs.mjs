import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { testReceptionDeletionConcurrency } from './test-reception-deletion-concurrency.mjs';
import { testReceptionConcurrency } from './test-reception-concurrency.mjs';
import { testReceptionAppointmentConcurrency } from './test-reception-appointment-concurrency.mjs';
import { testReceptionScopeLifecycle } from './test-reception-scope-lifecycle.mjs';
import { testDocumentSnippetsConcurrency } from './test-document-snippets-concurrency.mjs';
import { testFunctionBoundaryRegressions } from './test-function-boundaries.mjs';

// No hosted/existing DB target. All imported test helpers inherit this process's
// pinned, verified LOCAL Docker endpoint. Never read .env or clinical fixtures.
const upgradeMode = process.argv.includes('--upgrade');
const resourceMode = process.argv.includes('--resources') || upgradeMode;
const targeted = process.argv.includes('--targeted');
const overlayPrefix = '--migration-overlay=';
const sourceOptions = process.argv.slice(2).filter(arg => arg.startsWith('--source='));
assert.ok(sourceOptions.length <= 1 && sourceOptions.every(arg => /^--source=[0-9a-f]{40}$/.test(arg)), 'Invalid SQL source snapshot');
const overlayNames = process.argv.slice(2).filter(arg => arg.startsWith(overlayPrefix)).map(arg => arg.slice(overlayPrefix.length));
assert.ok(overlayNames.every(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)) && new Set(overlayNames).size === overlayNames.length, 'Invalid migration overlay filename');
assert.ok(process.argv.slice(2).every(arg => ['--resources', '--upgrade', '--targeted'].includes(arg) || arg.startsWith(overlayPrefix) || arg.startsWith('--source=')), 'This lab takes no external target');
assert.ok(!targeted || upgradeMode, 'Targeted CI mode requires the actual migration');
const scopedMigration = '20261104200000_reception_scoped_custody.sql';
const git = args => {
  const r = spawnSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim();
};
const sourceBaseline = git(['rev-parse', sourceOptions[0]?.slice(9) ?? 'HEAD']); assert.match(sourceBaseline, /^[0-9a-f]{40}$/);
// Ignore unfinished SQL from other agents. Only an explicitly named local
// migration may overlay immutable HEAD; no external database/path is accepted.
const sqlPaths = git(['ls-tree', '-r', '--name-only', sourceBaseline, '--', 'supabase/migrations', 'supabase/tests']).split('\n').filter(path => path.endsWith('.sql'));
const sqlSources = new Map(sqlPaths.map(path => [path, git(['show', sourceBaseline + ':' + path])]));
const migrationOverlays = overlayNames.map(name => {
  const path = 'supabase/migrations/' + name, text = readFileSync(path, 'utf8'); sqlSources.set(path, text);
  return { path, sha256: createHash('sha256').update(text).digest('hex') };
});
const source = path => { assert.ok(sqlSources.has(path), 'Missing frozen SQL source: ' + path); return sqlSources.get(path); };
const sqlSourceDigest = createHash('sha256').update([...sqlSources].sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => path + '\0' + createHash('sha256').update(text).digest('hex')).join('\n')).digest('hex');
assert.ok(!process.env.DOCKER_HOST, 'Lab refuses inherited Docker host overrides');
const raw = args => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
const required = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim(); };
const context = required(raw(['context', 'show']));
const endpoint = JSON.parse(required(raw(['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint) || /^unix:\/\/\//.test(endpoint), 'Expected local Docker pipe/socket');
process.env.DOCKER_HOST = endpoint;
for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete process.env[key];
const docker = (args, input) => spawnSync('docker', ['--host', endpoint, ...args], { input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
const label = randomUUID();
const container = 'cortex-test-' + label.slice(0, 8), network = container + '-account-epochs';
const bounds = "set statement_timeout='5s';set lock_timeout='1s';";
const result = source => docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], bounds + source);
const sql = source => required(result(source));
const children = [];
function session() {
  const child = spawn('docker', ['--host', endpoint, 'exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', status => resolve({ status, stdout: output, stderr: errors })); });
  let completed;
  done.then(value => { completed = value; }, () => {});
  done.catch(() => {}); children.push({ child, done });
  let ended = false;
  return {
    send: source => child.stdin.write(bounds + source + '\n'),
    held: async () => {
      for (let n = 0; n < 100; n++) {
        if (output.includes('EPOCH_HELD')) return;
        if (completed) throw new Error('Owned epoch holder failed: ' + completed.stderr);
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error('Owned epoch holder not ready');
    },
    end: async source => {
      if (!ended) { ended = true; child.stdin.end(source + '\n'); } let timer;
      try { return await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('Owned writer timed out')); }, 8000); })]); }
      finally { clearTimeout(timer); }
    },
  };
}
const checks = [];
const accounts = [1, 2, 3, 4].map(n => `fa100000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const patients = [1, 2].map(n => `fa200000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const clinic = 'fa300000-0000-4000-8000-000000000001';
const draft = n => `insert into public.consultation_drafts(user_id,patient_id) values('${accounts[n]}','${patients[n]}') on conflict(user_id,patient_id) do update set content='{}';`;
const busy = /ERROR:\s+40001: Custody changed concurrently; retry the transaction/;
async function compareIndependent(expectedBusy) {
  const holder = session();
  try {
    holder.send('begin;' + draft(0) + "select 'EPOCH_HELD';"); await holder.held();
    const other = result('begin;' + draft(1) + 'commit;');
    if (expectedBusy) { assert.notEqual(other.status, 0); assert.match(other.stderr, busy); }
    else required(other);
    required(await holder.end('commit;'));
  } finally { holder.end('rollback;').catch(() => {}); }
  checks.push(expectedBusy ? 'RED reproduced: independent draft writers collide on predecessor singleton' : 'GREEN: independent draft writers both commit while first remains open');
}
async function refuseOverlap(name, holderSql, writerSql) {
  const holder = session();
  try {
    holder.send('begin;' + holderSql + "select 'EPOCH_HELD';"); await holder.held();
    const other = result('begin;' + writerSql + 'commit;');
    assert.notEqual(other.status, 0); assert.match(other.stderr, busy, name);
    required(await holder.end('rollback;'));
  } finally { holder.end('rollback;').catch(() => {}); }
  checks.push(name);
}
async function changedParentRace(withRecheck) {
  // Pause the real AFTER ROW guard just after its first indirect lookup. The
  // FK KEY SHARE on template.id allows another tx to update template.user_id.
  const users = [1, 2, 3].map(n => `fa${withRecheck ? '5' : '4'}00000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  const template = `fa${withRecheck ? '5' : '4'}10000-0000-4000-8000-000000000001`;
  sql(`insert into auth.users(id,email) values ${users.map((id, n) => `('${id}','parent-race-${withRecheck}-${n}@example.invalid')`).join(',')};
    insert into public.document_templates(id,user_id,name,content) values('${template}','${users[1]}','Synthetic parent','Synthetic content');`);
  const definition = sql("select pg_get_functiondef('cortex_private.guard_custody_reference()'::regprocedure)");
  if (!withRecheck) {
    assert.ok(definition.includes('-- RECHECK START:') && definition.includes('-- RECHECK END'));
  }
  sql(`alter function cortex_private.custody_reference_accounts(jsonb,text[],text) rename to custody_reference_accounts_real;
    create function cortex_private.custody_reference_accounts(row_data jsonb,fields text[],table_name text) returns uuid[]
    language plpgsql volatile security definer set search_path='' as $$ declare ids uuid[];begin
     ids:=cortex_private.custody_reference_accounts_real(row_data,fields,table_name);
     if current_setting('cortex.test.pause_lookup',true)='on' then
      perform set_config('cortex.test.pause_lookup','off',true);perform pg_advisory_xact_lock(941733);
     end if;return ids;end $$;
    revoke all on function cortex_private.custody_reference_accounts(jsonb,text[],text) from public,anon,authenticated,service_role;`);
  // Recreate after installing the wrapper to invalidate cached helper OIDs.
  sql(withRecheck ? definition : definition.replace(/ -- RECHECK START:[\s\S]*? -- RECHECK END/, ''));
  const barrier = session(), writer = session();
  try {
    barrier.send("begin;select pg_advisory_xact_lock(941733);select 'EPOCH_HELD';"); await barrier.held();
    writer.send(`begin;set local cortex.test.pause_lookup='on';insert into public.user_settings(user_id,active_template_id) values('${users[0]}','${template}');select 'EPOCH_HELD';`);
    let waiting = false;
    for (let n = 0; n < 30; n++) {
      if (sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=941733 and not granted)") === 't') { waiting = true; break; }
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(waiting, 'First indirect lookup did not reach observed barrier');
    sql(`update public.document_templates set user_id='${users[2]}' where id='${template}';`);
    required(await barrier.end('rollback;'));
    if (!withRecheck) {
      await writer.held();
      sql(`insert into public.account_deletion_requests(user_id) values('${users[2]}');`);
      required(await writer.end('commit;'));
    } else {
      const rejected = await writer.end('commit;');
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /40001: Custody reference changed concurrently/);
      sql(`insert into public.account_deletion_requests(user_id) values('${users[2]}');`);
    }
    const unsafe = sql(`select exists(select 1 from public.account_deletion_requests where user_id='${users[2]}') and exists(select 1 from public.user_settings where user_id='${users[0]}' and active_template_id='${template}')`);
    assert.equal(unsafe, withRecheck ? 'f' : 't');
  } finally {
    await Promise.allSettled([barrier.end('rollback;'), writer.end('rollback;')]);
    sql(`drop function cortex_private.custody_reference_accounts(jsonb,text[],text);
      alter function cortex_private.custody_reference_accounts_real(jsonb,text[],text) rename to custody_reference_accounts;`);
    sql(definition);
  }
  checks.push(withRecheck ? 'GREEN: recheck rejects changed indirect owner before unfenced reference can commit'
    : 'Injected missing recheck reproduces concurrent new-owner intent plus uncommitted indirect reference');
}
async function absentParentCounterexamples() {
  const doctor = 'fa700000-0000-4000-8000-000000000001', appointment = 'fa710000-0000-4000-8000-000000000001';
  sql(`insert into auth.users(id,email) values('${doctor}','absent-appointment-owner@example.invalid');`);
  const audit = session();
  try {
    audit.send(`begin;insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values('${clinic}','${accounts[0]}','synthetic_absent_parent','${appointment}');select 'EPOCH_HELD';`);
    await audit.held();
    sql(`begin;set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${doctor}';
      insert into public.appointments(id,user_id,title,start_time,end_time) values('${appointment}','${doctor}','Synthetic future parent','2099-12-01T12:00Z','2099-12-01T12:30Z');commit;`);
    sql(`insert into public.account_deletion_requests(user_id) values('${doctor}');`);
    required(await audit.end('commit;'));
    assert.equal(sql(`select exists(select 1 from public.account_deletion_requests where user_id='${doctor}') and exists(select 1 from public.reception_audit r join public.appointments a on a.id=r.resource_id where a.id='${appointment}')`), 't');
  } finally { await audit.end('rollback;'); }
  checks.push('REJECTED account-only candidate: audit of absent appointment commits after future parent and owner deletion intent');

  const users = [1, 2].map(n => `fa800000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  const template = 'fa810000-0000-4000-8000-000000000001';
  sql(`insert into auth.users(id,email) values ${users.map((id, n) => `('${id}','null-owner-parent-${n}@example.invalid')`).join(',')};
    insert into public.document_templates(id,user_id,name,content) values('${template}',null,'Synthetic built-in parent','Synthetic');`);
  const settings = session();
  try {
    settings.send(`begin;insert into public.user_settings(user_id,active_template_id) values('${users[0]}','${template}');select 'EPOCH_HELD';`);
    await settings.held();
    sql(`update public.document_templates set user_id='${users[1]}' where id='${template}';
      insert into public.account_deletion_requests(user_id) values('${users[1]}');`);
    required(await settings.end('commit;'));
    assert.equal(sql(`select exists(select 1 from public.account_deletion_requests where user_id='${users[1]}') and exists(select 1 from public.user_settings s join public.document_templates t on t.id=s.active_template_id where s.user_id='${users[0]}' and t.user_id='${users[1]}')`), 't');
  } finally { await settings.end('rollback;'); }
  checks.push('REJECTED account-only candidate: NULL-owned template acquires new owner and deletion intent while referring settings is uncommitted');
}
let networkPlanned = false, containerPlanned = false, failure, report;
try {
  networkPlanned = true;
  required(docker(['network', 'create', '--internal', '--label', 'cortex.test.run=' + label, network]));
  containerPlanned = true;
  required(docker(['create', '--pull=never', '--label', 'cortex.test.run=' + label, '--name', container, '--network', network,
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
  required(docker(['start', container]));
  let ready = false;
  for (let n = 0; n < 60; n++) { if (docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) { ready = true; break; } await new Promise(r => setTimeout(r, 200)); }
  assert.ok(ready, 'Owned database not ready');
  sql(source('supabase/tests/bootstrap.sql'));
  const migrations = [...sqlSources.keys()].filter(path => path.startsWith('supabase/migrations/') && path !== 'supabase/migrations/' + scopedMigration).map(path => path.split('/').at(-1)).sort();
  const initialMigrations = upgradeMode ? migrations.filter(name => name < scopedMigration) : migrations;
  const postUpgradeMigrations = upgradeMode ? migrations.filter(name => name > scopedMigration) : [];
  for (const name of initialMigrations) sql(source('supabase/migrations/' + name));
  sql(`insert into auth.users(id,email) values ${accounts.map((id, n) => `('${id}','account-epoch-${n}@example.invalid')`).join(',')};
    insert into public.patients(id,user_id,name,status) values ${patients.map((id, n) => `('${id}','${accounts[n]}','Synthetic epoch patient ${n}','novo')`).join(',')};`);
  await compareIndependent(true);
  // The directory fixture intentionally inserts 2,500 rows in one statement;
  // use a separate explicit functional-test budget, not the 5s race deadline.
  let baselineDirectoryMs = null;
  if (!targeted) {
    const baselineStarted = performance.now();
    sql("set statement_timeout='25s';" + source('supabase/tests/reception-directory.test.sql'));
    baselineDirectoryMs = Math.round(performance.now() - baselineStarted);
  }
  if (upgradeMode) {
    const { exerciseCustodyUpgrade } = await import('./test-custody-upgrade.mjs');
    checks.push(...await exerciseCustodyUpgrade({ sql, result, session, required, accounts, patients,
      migration: source('supabase/migrations/' + scopedMigration) }));
    assert.equal(sql("select to_regclass('cortex_private.account_custody_epochs') is not null and to_regclass('cortex_private.custody_resource_epochs') is not null"), 't');
    for (const name of postUpgradeMigrations) sql(source('supabase/migrations/' + name));
    checks.push('dependent later migrations install only after the actual T33 upgrade, in version order');
  } else {
    sql(source('supabase/tests/prototypes/account-custody-epochs.sql'));
    if (resourceMode) sql(source('supabase/tests/prototypes/resource-custody-epochs.sql'));
  }
  assert.equal(sql(`select count(*) from cortex_private.account_custody_epochs where user_id=any(array[${accounts.map(id => `'${id}'::uuid`).join(',')}])`), '4', 'Existing account fill failed');
  await compareIndependent(false);
  await refuseOverlap('same-account writer retains NOWAIT refusal', draft(0), `select cortex_private.touch_custody_epoch(array['${accounts[0]}'::uuid]);`);
  sql(`insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic account epochs','${accounts[2]}');
    insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${accounts[0]}','doctor','active'),('${clinic}','${accounts[1]}','doctor','active');`);
  await refuseOverlap('all direct recipients are fenced', `select cortex_private.touch_custody_epoch(array['${accounts[1]}'::uuid]);`,
    `insert into public.patient_shares(patient_id,owner_user_id,recipient_user_id,clinic_id,permission) values('${patients[0]}','${accounts[0]}','${accounts[1]}','${clinic}','read');`);
  const template = 'fa600000-0000-4000-8000-000000000001';
  sql(`insert into public.document_templates(id,user_id,name,content) values('${template}','${accounts[1]}','Synthetic OLD parent','Synthetic');
    insert into public.user_settings(user_id,active_template_id) values('${accounts[0]}','${template}');`);
  await refuseOverlap('UPDATE fences OLD indirect owner when removing a reference',
    `select cortex_private.touch_custody_epoch(array['${accounts[1]}'::uuid]);`, `update public.user_settings set active_template_id=null where user_id='${accounts[0]}';`);
  const extra = [5, 6, 7].map(n => `fa100000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  sql(`insert into auth.users(id,email) values ${extra.map((id, n) => `('${id}','account-epoch-extra-${n}@example.invalid')`).join(',')};`);
  assert.equal(sql(`select count(*) from cortex_private.account_custody_epochs where user_id=any(array[${extra.map(id => `'${id}'::uuid`).join(',')}])`), '3');
  checks.push('new accounts receive their epoch without lazy writer inserts');
  sql(`insert into public.account_deletion_requests(user_id) values('${extra[0]}');delete from auth.users where id='${extra[0]}';`);
  assert.equal(sql(`select exists(select 1 from cortex_private.account_custody_epochs where user_id='${extra[0]}' and revision>0) and not exists(select 1 from public.account_deletion_requests where user_id='${extra[0]}')`), 't');
  checks.push('real Auth cascade removes intent but preserves minimal epoch tombstone');
  sql(`delete from cortex_private.account_custody_epochs where user_id='${extra[1]}';`);
  const missing = result(`select cortex_private.touch_custody_epoch(array['${extra[1]}'::uuid]);`);
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /55000: Missing account custody epoch/);
  const anonymous = result('select cortex_private.touch_custody_epoch();');
  assert.notEqual(anonymous.status, 0); assert.match(anonymous.stderr, /55000: Missing custody account/);
  checks.push('missing account epoch and missing wrapper actor fail closed with dedicated 55000');
  const independentIntent = session();
  try {
    independentIntent.send(`begin;insert into public.account_deletion_requests(user_id) values('${accounts[3]}');select 'EPOCH_HELD';`);
    await independentIntent.held();
    sql(`begin;insert into public.account_deletion_requests(user_id) values('${extra[2]}');rollback;`);
    required(await independentIntent.end('rollback;'));
  } finally { await independentIntent.end('rollback;'); }
  checks.push('two independent deletion intents proceed while the other transaction is open');
  if (resourceMode) {
    const { exerciseResourceCustody } = await import('./test-resource-custody-epochs.mjs');
    checks.push(...await exerciseResourceCustody({ sql, result, session, required, accounts, patients, clinic }));
  } else {
    await changedParentRace(false);
    await changedParentRace(true);
    await absentParentCounterexamples();
  }
  // CI runs these existing suites in test-database first; targeted mode adds
  // the new upgrade/resource proofs without repeating all historical races.
  const tests = targeted ? [] : [...sqlSources.keys()].filter(path => /^supabase\/tests\/[^/]+\.test\.sql$/.test(path)).map(path => path.split('/').at(-1)).sort();
  const sqlDurationMs = {};
  for (const name of tests) {
    const started = performance.now();
    sql("set statement_timeout='25s';" + source('supabase/tests/' + name));
    sqlDurationMs[name] = Math.round(performance.now() - started);
    process.stdout.write('Passed ' + name + '\n');
  }
  let deletion = [];
  if (!targeted) {
    testFunctionBoundaryRegressions(container, source('supabase/tests/reception-function-boundaries.test.sql'));
    await testReceptionConcurrency(container);
    await testReceptionAppointmentConcurrency(container);
    await testReceptionScopeLifecycle(container);
    await testDocumentSnippetsConcurrency(container);
    deletion = await testReceptionDeletionConcurrency(container);
  }
  report = { syntheticOnly: true, labOnly: true, prototypeIsProductionFix: false, candidateRejected: !resourceMode,
    candidate: resourceMode ? 'resource and account epochs' : 'rejected account-only epochs', checks,
    installedMigration: upgradeMode ? scopedMigration : null,
    sourceBaseline, migrationOverlays, sqlSourceDigest, initialMigrations, postUpgradeMigrations,
    migrations: migrations.length + (upgradeMode ? 1 : 0), sqlSuites: tests.length, deletionScenarios: deletion.length,
    directoryFixture: targeted ? null : { rows: 2500, baselineMs: baselineDirectoryMs, prototypeMs: sqlDurationMs['reception-directory.test.sql'],
      statementBudgetSeconds: 25, qualification: 'functional fixture only; uncontrolled local load, not a production benchmark' },
    regressions: targeted ? ['targeted upgrade and resource regressions; existing suites run by test:db first']
      : ['function boundaries', 'reception', 'appointments', 'scope lifecycle', 'document snippets', 'deletion interleavings'],
    notCovered: [...(resourceMode ? [] : ['resource fence for absent/NULL-owned parents']), ...(upgradeMode ? [] : ['production migration']), 'hosted rollout', 'load/retry metrics'],
    network: 'owned internal Docker network without published ports; endpoint pinned to local pipe/socket' };
} catch (error) { failure = error; }
finally {
  for (const { child } of children) { child.stdin.destroy(); child.kill(); }
  await Promise.allSettled(children.map(async ({ done }) => {
    let timer;
    try { await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); }
    finally { clearTimeout(timer); }
  }));
  const cleanup = [];
  for (const [kind, name, planned] of [['container', container, containerPlanned], ['network', network, networkPlanned]]) {
    if (!planned) continue;
    const format = kind === 'container' ? '{{index .Config.Labels "cortex.test.run"}}' : '{{index .Labels "cortex.test.run"}}';
    const inspected = docker([kind, 'inspect', name, '--format', format]);
    if (inspected.status !== 0 && /no such (object|container|network)/i.test(inspected.stderr)) continue;
    if (inspected.status !== 0 || inspected.stdout.trim() !== label) { cleanup.push('ownership'); continue; }
    if (docker(kind === 'container' ? ['rm', '--force', '--volumes', name] : ['network', 'rm', name]).status !== 0) cleanup.push('removal');
  }
  if (cleanup.length) { process.stderr.write('Cleanup failures: ' + cleanup.length + '\n'); failure ||= new Error('Owned cleanup incomplete'); }
}
if (failure) throw failure;
report.cleanupVerified = true;
const artifactPath = 'docs/reviews/2026-11-04/' + (upgradeMode ? 'custody-upgrade' : resourceMode ? 'resource-custody-epochs' : 'account-custody-epochs');
mkdirSync(artifactPath, { recursive: true });
writeFileSync(artifactPath + (targeted ? '/TARGETED.json' : '/RESULT.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
