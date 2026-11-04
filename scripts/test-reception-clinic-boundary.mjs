import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { testReceptionConcurrency } from './test-reception-concurrency.mjs';
import { testReceptionAppointmentConcurrency } from './test-reception-appointment-concurrency.mjs';
import { testReceptionScopeLifecycle } from './test-reception-scope-lifecycle.mjs';
import { testDocumentSnippetsConcurrency } from './test-document-snippets-concurrency.mjs';
import { testFunctionBoundaryRegressions } from './test-function-boundaries.mjs';
import { testReceptionStaffLifecycle, testStaffLifecycleStaleInstallation } from './test-reception-staff-lifecycle.mjs';

// Only a freshly owned, isolated local database. Never accept a target/env file.
const staffMode = process.argv.includes('--staff-lifecycle');
assert.ok(process.argv.slice(2).every(arg => arg === '--staff-lifecycle') && process.argv.length <= 3, 'This regression takes no external target');
assert.ok(!process.env.DOCKER_HOST, 'Refusing inherited Docker host override');
const raw = args => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
const required = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim(); };
// Freeze SQL from a single committed revision plus explicit owned overlays.
// Another agent may be adding tests/migrations while this isolated lab runs.
const git = args => required(spawnSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 }));
const sourceBaseline = git(['rev-parse', 'HEAD']);
assert.match(sourceBaseline, /^[0-9a-f]{40}$/);
const bootstrapSource = git(['show', sourceBaseline + ':supabase/tests/bootstrap.sql']);
const sourcePaths = git(['ls-tree', '-r', '--name-only', sourceBaseline, '--', 'supabase/migrations', 'supabase/tests']).split('\n')
  .filter(path => /^supabase\/(migrations\/[^/]+\.sql|tests\/[^/]+\.test\.sql)$/.test(path));
const sources = new Map(sourcePaths.map(path => [path, git(['show', sourceBaseline + ':' + path])]));
const ownedPaths = ['supabase/migrations/20261104210000_reception_clinic_calendar.sql', 'supabase/tests/reception-clinic-boundary.test.sql',
  'supabase/migrations/20261104220000_reception_staff_scope_lifecycle.sql', 'supabase/tests/reception-staff-lifecycle.test.sql'];
const localSqlOverlays = ownedPaths.map(path => {
  const source = readFileSync(path, 'utf8'); sources.set(path, source);
  return { path, sha256: createHash('sha256').update(source).digest('hex') };
});
const context = required(raw(['context', 'show']));
const endpoint = JSON.parse(required(raw(['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint) || /^unix:\/\/\//.test(endpoint), 'Expected a local Docker pipe/socket');
process.env.DOCKER_HOST = endpoint;
for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete process.env[key];
const docker = (args, input, timeout = 30000) => spawnSync('docker', ['--host', endpoint, ...args], { input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
const owner = randomUUID(), container = 'cortex-test-' + owner.slice(0, 8), network = container + '-clinic-boundary';
const migration = staffMode ? '20261104220000_reception_staff_scope_lifecycle.sql' : '20261104210000_reception_clinic_calendar.sql';
const result = (source, bulk = false) => docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
  `set statement_timeout='${bulk ? 45 : 10}s';set lock_timeout='2s';` + source, bulk ? 60000 : 30000);
const sql = source => required(result(source));
let networkPlanned = false, containerPlanned = false, report;
const bulkFixtureTimings = {};
const runSuite = (name, phase) => {
  const started = Date.now();
  try { required(result(sources.get('supabase/tests/' + name), name === 'reception-directory.test.sql')); }
  catch (cause) { throw new Error('SQL suite failed: ' + name + ' (' + phase + ')', { cause }); }
  if (name === 'reception-directory.test.sql') bulkFixtureTimings[phase] = Date.now() - started;
};
try {
  networkPlanned = true;
  required(docker(['network', 'create', '--internal', '--label', 'cortex.test.owner=' + owner, network]));
  containerPlanned = true;
  required(docker(['run', '--detach', '--pull=never', '--name', container, '--network', network, '--label', 'cortex.test.owner=' + owner,
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
  let ready = false;
  for (let n = 0; n < 60; n++) {
    if (docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) { ready = true; break; }
    await new Promise(r => setTimeout(r, 300));
  }
  assert.ok(ready, 'Disposable database not ready');
  sql(bootstrapSource);
  const migrations = [...sources.keys()].filter(path => path.startsWith('supabase/migrations/')).map(path => path.split('/').at(-1)).sort();
  assert.ok(migrations.includes(migration), 'Missing reserved migration');
  for (const name of migrations.filter(n => n !== migration)) sql(sources.get('supabase/migrations/' + name));
  const test = sources.get('supabase/tests/' + (staffMode ? 'reception-staff-lifecycle.test.sql' : 'reception-clinic-boundary.test.sql'));
  const before = result(test);
  assert.notEqual(before.status, 0, 'Expected predecessor disclosure was not reproduced');
  assert.match(before.stderr, staffMode ? /ERROR: {2}Inactive staff retained delegation/ : /ERROR: {2}Reception read unassigned appointment/);
  // This existing suite writes 2,500 synthetic rows in one statement. Measure
  // the predecessor too; keep request/race lock budgets unchanged.
  if (staffMode) runSuite('reception-directory.test.sql', 'beforeMigrationMs');
  if (staffMode) sql(`insert into auth.users(id,email) values
    ('d7100000-0000-4000-8000-000000000001','old-staff-admin@example.invalid'),
    ('d7100000-0000-4000-8000-000000000002','old-staff-inactive@example.invalid'),
    ('d7100000-0000-4000-8000-000000000003','old-staff-active@example.invalid'),
    ('d7100000-0000-4000-8000-000000000004','old-staff-stale@example.invalid');
    insert into public.clinics(id,name,created_by) values('d7200000-0000-4000-8000-000000000001','Synthetic inactive staff cleanup','d7100000-0000-4000-8000-000000000001');
    insert into public.clinic_members(clinic_id,user_id,role,status) values('d7200000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000001','admin','active');
    insert into public.clinic_staff_members(clinic_id,user_id,name,active) values
    ('d7200000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000002','Synthetic old inactive',false),
    ('d7200000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000003','Synthetic old active',true),
    ('d7200000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000004','Synthetic stale installer',true);
    insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
    ('d7200000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000002','d7100000-0000-4000-8000-000000000001'),
    ('d7200000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000003','d7100000-0000-4000-8000-000000000001'),
    ('d7200000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000004','d7100000-0000-4000-8000-000000000001');`);
  const migrationSource = sources.get('supabase/migrations/' + migration);
  if (staffMode) await testStaffLifecycleStaleInstallation(container, migrationSource, sql);
  sql((staffMode ? "set default_transaction_isolation='repeatable read';" : '') + migrationSource);
  if (staffMode) {
    assert.equal(sql("select count(*) from public.staff_doctor_scopes where staff_user_id='d7100000-0000-4000-8000-000000000002'"), '0', 'Cleanup retained inactive staff scope');
    assert.equal(sql("select count(*) from public.staff_doctor_scopes where staff_user_id='d7100000-0000-4000-8000-000000000003'"), '1', 'Cleanup removed active staff scope');
    assert.equal(sql("select count(*) from public.staff_doctor_scopes where staff_user_id='d7100000-0000-4000-8000-000000000004'"), '0', 'Fresh installation skipped stale-snapshot account');
    assert.equal(sql("select count(*) from public.reception_audit where resource_id='d7100000-0000-4000-8000-000000000002' and action='staff_scopes_revoked' and actor_user_id is null and details='{}'::jsonb||jsonb_build_object('count',1)"), '1', 'Cleanup audit missing');
  }
  sql(test);
  const suites = [...sources.keys()].filter(path => path.startsWith('supabase/tests/')).map(path => path.split('/').at(-1)).sort();
  for (const name of suites) runSuite(name, 'afterMigrationMs');
  assert.ok(sources.has('supabase/tests/reception-function-boundaries.test.sql'), 'Missing frozen function contract');
  testFunctionBoundaryRegressions(container, sources.get('supabase/tests/reception-function-boundaries.test.sql'));
  await testReceptionConcurrency(container);
  await testReceptionAppointmentConcurrency(container);
  await testReceptionScopeLifecycle(container);
  const staffRaces = await testReceptionStaffLifecycle(container);
  await testDocumentSnippetsConcurrency(container);
  report = { syntheticOnly: true, sourceBaseline, localSqlOverlays, bulkFixtureTimings, migration, migrations: migrations.length, sqlSuites: suites.length,
    checks: staffMode ? ['RED: direct inactivity leaves delegations on the predecessor',
      'GREEN: inactivity removes all scopes; flag-only reactivation cannot restore them',
      'privileged INSERT and UPDATE cannot delegate to inactive reception accounts',
      'migration cleanup removes objectively inactive grants with minimum audit and preserves active historical grants',
      'inherited RR snapshot is refused before DDL/data; fresh installation with default RR selects RC and cleans committed inactive grants',
      'history, private charts, beneficiary and appointment identity are preserved; open assignments released once',
      'fresh explicit grant restores operational access; historical active grants are not inferred as consent',
      'all SQL, function-boundary and reception/appointment/doctor/staff/snippet concurrency regressions pass']
      : ['RED: predecessor discloses an unassigned appointment despite clinic-only reception scope',
      'GREEN: explicit clinic calendar readable and mutable; unassigned rows hidden from scoped and aggregate queries',
      'all five mutations refuse unassigned/foreign/missing IDs without side effects or origin disclosure',
      'contact/patient link and old/new administrative audit do not infer appointment clinic',
      'owner keeps own unassigned agenda and maintenance; raw clinical reception reads remain denied',
      'hidden slots still reject overlapping human bookings; DTO, clinic blocks, scopes, MFA and CAS regressions preserved',
      'all SQL suites, function boundary fault injection, reception/appointment/scope/snippet concurrency pass'],
    staffRaces: staffRaces.length, ...(staffMode ? { staffRaceResults: staffRaces } : {}),
    network: 'verified local Docker, owned internal network without published ports' };
} finally {
  const remove = (kind, name) => {
    const template = kind === 'container' ? '{{index .Config.Labels "cortex.test.owner"}}' : '{{index .Labels "cortex.test.owner"}}';
    const inspected = docker([kind, 'inspect', name, '--format', template]);
    if (inspected.status !== 0 && /no such (object|container|network)/i.test(inspected.stderr)) return;
    assert.equal(required(inspected), owner, 'Refusing cleanup of an unowned resource');
    required(docker(kind === 'container' ? ['rm', '--force', '--volumes', name] : ['network', 'rm', name]));
  };
  try { if (containerPlanned) remove('container', container); }
  finally { if (networkPlanned) remove('network', network); }
}
report.cleanupVerified = true;
const artifacts = 'docs/reviews/2026-11-04/' + (staffMode ? 'staff-scope-lifecycle' : 'clinic-calendar-boundary');
mkdirSync(artifacts, { recursive: true });
writeFileSync(artifacts + '/verification.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
