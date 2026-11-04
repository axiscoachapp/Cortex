import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { testReceptionConcurrency } from './test-reception-concurrency.mjs';
import { testReceptionAppointmentConcurrency } from './test-reception-appointment-concurrency.mjs';
import { testReceptionScopeLifecycle } from './test-reception-scope-lifecycle.mjs';
import { testDocumentSnippetsConcurrency } from './test-document-snippets-concurrency.mjs';
import { testFunctionBoundaryRegressions } from './test-function-boundaries.mjs';

// Only a freshly owned, isolated local database. Never accept a target/env file.
assert.equal(process.argv.length, 2, 'This regression takes no external target');
assert.ok(!process.env.DOCKER_HOST, 'Refusing inherited Docker host override');
const raw = args => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
const required = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim(); };
const context = required(raw(['context', 'show']));
const endpoint = JSON.parse(required(raw(['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint) || /^unix:\/\/\//.test(endpoint), 'Expected a local Docker pipe/socket');
process.env.DOCKER_HOST = endpoint;
for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete process.env[key];
const docker = (args, input) => spawnSync('docker', ['--host', endpoint, ...args], { input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
const owner = randomUUID(), container = 'cortex-test-' + owner.slice(0, 8), network = container + '-clinic-boundary';
const migration = '20261104210000_reception_clinic_calendar.sql';
const result = source => docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], "set statement_timeout='10s';set lock_timeout='2s';" + source);
const sql = source => required(result(source));
let networkPlanned = false, containerPlanned = false, report;
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
  sql(readFileSync('supabase/tests/bootstrap.sql', 'utf8'));
  const migrations = readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();
  assert.ok(migrations.includes(migration), 'Missing reserved migration');
  for (const name of migrations.filter(n => n !== migration)) sql(readFileSync('supabase/migrations/' + name, 'utf8'));
  const test = readFileSync('supabase/tests/reception-clinic-boundary.test.sql', 'utf8');
  const before = result(test);
  assert.notEqual(before.status, 0, 'Expected predecessor disclosure was not reproduced');
  assert.match(before.stderr, /ERROR: {2}Reception read unassigned appointment/);
  sql(readFileSync('supabase/migrations/' + migration, 'utf8'));
  sql(test);
  const suites = readdirSync('supabase/tests').filter(n => n.endsWith('.test.sql')).sort();
  for (const name of suites) sql(readFileSync('supabase/tests/' + name, 'utf8'));
  testFunctionBoundaryRegressions(container);
  await testReceptionConcurrency(container);
  await testReceptionAppointmentConcurrency(container);
  await testReceptionScopeLifecycle(container);
  await testDocumentSnippetsConcurrency(container);
  report = { syntheticOnly: true, migration, migrations: migrations.length, sqlSuites: suites.length,
    checks: ['RED: predecessor discloses an unassigned appointment despite clinic-only reception scope',
      'GREEN: explicit clinic calendar readable and mutable; unassigned rows hidden from scoped and aggregate queries',
      'all five mutations refuse unassigned/foreign/missing IDs without side effects or origin disclosure',
      'contact/patient link and old/new administrative audit do not infer appointment clinic',
      'owner keeps own unassigned agenda and maintenance; raw clinical reception reads remain denied',
      'hidden slots still reject overlapping human bookings; DTO, clinic blocks, scopes, MFA and CAS regressions preserved',
      'all SQL suites, function boundary fault injection, reception/appointment/scope/snippet concurrency pass'],
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
const artifacts = 'docs/reviews/2026-11-04/clinic-calendar-boundary';
mkdirSync(artifacts, { recursive: true });
writeFileSync(artifacts + '/verification.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
