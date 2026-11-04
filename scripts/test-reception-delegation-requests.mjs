import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { testFunctionBoundaryRegressions } from './test-function-boundaries.mjs';
import { testReceptionConcurrency } from './test-reception-concurrency.mjs';
import { testReceptionAppointmentConcurrency } from './test-reception-appointment-concurrency.mjs';
import { testReceptionScopeLifecycle } from './test-reception-scope-lifecycle.mjs';
import { testReceptionStaffLifecycle } from './test-reception-staff-lifecycle.mjs';
import { testDocumentSnippetsConcurrency } from './test-document-snippets-concurrency.mjs';
import { testReceptionDeletionConcurrency } from './test-reception-deletion-concurrency.mjs';
import { testDelegationRequestConcurrency } from './test-reception-delegation-request-concurrency.mjs';

const redOnly = process.argv.includes('--red');
assert.ok(process.argv.slice(2).every(arg => arg === '--red') && process.argv.length <= 3, 'No external target accepted');
assert.ok(!process.env.DOCKER_HOST, 'Refusing inherited Docker host override');
const required = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim(); };
const raw = (program, args) => spawnSync(program, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
const git = args => required(raw('git', args));
const sourceBaseline = git(['rev-parse', 'HEAD']); assert.match(sourceBaseline, /^[0-9a-f]{40}$/);
const paths = git(['ls-tree', '-r', '--name-only', sourceBaseline, '--', 'supabase/migrations', 'supabase/tests']).split('\n')
  .filter(path => /^supabase\/(migrations\/[^/]+\.sql|tests\/[^/]+\.test\.sql)$/.test(path));
const sources = new Map(paths.map(path => [path, git(['show', sourceBaseline + ':' + path])]));
const bootstrap = git(['show', sourceBaseline + ':supabase/tests/bootstrap.sql']);
const migrationPath = 'supabase/migrations/20261104230000_reception_delegation_requests.sql';
const suitePath = 'supabase/tests/reception-delegation-requests.test.sql';
const overlays = [suitePath, ...(!redOnly ? [migrationPath] : []), 'scripts/test-reception-delegation-requests.mjs',
  'scripts/test-reception-delegation-request-concurrency.mjs'].map(path => {
  const source = readFileSync(path, 'utf8'); sources.set(path, source);
  return { path, sha256: createHash('sha256').update(source).digest('hex') };
});
const context = required(raw('docker', ['context', 'show']));
const endpoint = JSON.parse(required(raw('docker', ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint) || /^unix:\/\/\//.test(endpoint), 'Expected local Docker endpoint');
process.env.DOCKER_HOST = endpoint;
for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete process.env[key];
const docker = (args, input, timeout = 30000) => spawnSync('docker', ['--host', endpoint, ...args], { input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
const owner = randomUUID(), container = 'cortex-test-' + owner.slice(0, 8), network = container + '-request-foundation';
const bounds = "set statement_timeout='15s';set lock_timeout='3s';";
const psql = ['--host', endpoint, 'exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
const result = source => docker(psql.slice(2), bounds + source);
const sql = source => required(result(source));
const children = [], checks = [];
function session() {
  const name = 'delegation-request-' + randomUUID();
  const child = spawn('docker', psql, { windowsHide: true });
  let stdout = '', stderr = '', completed, ended = false;
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; }); child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr })); });
  done.then(r => { completed = r; }, () => {}); done.catch(() => {}); children.push({ child, done });
  child.stdin.write(bounds + `set application_name='${name}';\n`);
  return { name, send: source => child.stdin.write(source + '\n'),
    held: async () => {
      for (let n = 0; n < 100; n++) {
        if (stdout.includes('REQUEST_HELD')) return;
        if (completed) throw new Error('Request holder failed: ' + stderr);
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error('Request holder did not reach barrier');
    },
    end: async source => {
      if (!ended) { ended = true; child.stdin.end(source + '\n'); }
      let timer;
      try { return await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('Request session timeout')); }, 20000); })]); }
      finally { clearTimeout(timer); }
    },
  };
}
let networkPlanned = false, containerPlanned = false, failure, report;
try {
  networkPlanned = true; required(docker(['network', 'create', '--internal', '--label', 'cortex.test.owner=' + owner, network]));
  containerPlanned = true; required(docker(['run', '--detach', '--pull=never', '--name', container, '--network', network,
    '--label', 'cortex.test.owner=' + owner, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
  let ready = false;
  for (let n = 0; n < 60; n++) {
    // The image's temporary initialization server only listens on the Unix
    // socket; wait for its final TCP server before applying the bootstrap.
    if (docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(ready); sql(bootstrap);
  const migrations = [...sources.keys()].filter(path => path.startsWith('supabase/migrations/') && path !== migrationPath).sort();
  for (const path of migrations) sql(sources.get(path));
  const before = result(sources.get(suitePath));
  assert.notEqual(before.status, 0); assert.match(before.stderr, /42883: function cortex_private.request_reception_delegation/);
  checks.push('RED: predecessor cannot persist a private delegation request');
  process.stdout.write(checks.at(-1) + '\n');
  let suiteCount = 0, deletionScenarios = 0, requestRaces = [];
  if (!redOnly) {
    const holder = session();
    try {
      holder.send("begin;lock table public.clinic_staff_members in row exclusive mode;select 'REQUEST_HELD';"); await holder.held();
      const busy = result(sources.get(migrationPath)); assert.notEqual(busy.status, 0); assert.match(busy.stderr, /55P03:/);
      assert.equal(sql("select to_regclass('cortex_private.reception_delegation_requests') is null"), 't');
      required(await holder.end('rollback;'));
    } finally { await holder.end('rollback;'); }
    checks.push('busy installation rolls back without a request table');
    const staleInstaller = session();
    try {
      staleInstaller.send("begin isolation level repeatable read;select count(*) from auth.users;select 'REQUEST_HELD';"); await staleInstaller.held();
      const stale = await staleInstaller.end(sources.get(migrationPath));
      assert.notEqual(stale.status, 0); assert.match(stale.stderr, /25001:/);
      assert.equal(sql("select to_regclass('cortex_private.reception_delegation_requests') is null and to_regprocedure('cortex_private.request_reception_delegation(uuid,uuid,uuid,uuid)') is null"), 't');
    } finally { await staleInstaller.end('rollback;'); }
    checks.push('established RR snapshot refuses installation before schema changes');
    sql("set default_transaction_isolation='repeatable read';" + sources.get(migrationPath));
    const suites = [...sources.keys()].filter(path => path.startsWith('supabase/tests/')).sort();
    for (const path of suites) {
      const bulk = path.endsWith('/reception-directory.test.sql');
      required(docker(psql.slice(2), bounds + (bulk ? "set statement_timeout='45s';" : '') + sources.get(path), bulk ? 60000 : 30000));
      process.stdout.write('Passed ' + path.split('/').at(-1) + '\n');
    }
    suiteCount = suites.length;
    testFunctionBoundaryRegressions(container, sources.get('supabase/tests/reception-function-boundaries.test.sql'));
    await testReceptionConcurrency(container); await testReceptionAppointmentConcurrency(container);
    await testReceptionScopeLifecycle(container); await testReceptionStaffLifecycle(container); await testDocumentSnippetsConcurrency(container);
    deletionScenarios = (await testReceptionDeletionConcurrency(container)).length;
    requestRaces = await testDelegationRequestConcurrency({ sql, result, session, required });
    checks.push('private requests, cancellation, replay, lifecycle, no approval and custody SQL pass');
    checks.push('function-boundary fault injections and existing reception/appointment/lifecycle/snippet/deletion races pass');
  }
  report = { syntheticOnly: true, redOnly, sourceBaseline, overlays, migrations: migrations.length + (redOnly ? 0 : 1), sqlSuites: suiteCount,
    deletionScenarios, requestRaces, checks, publicConsentGate: false, approvalEnabled: false,
    network: 'verified local Docker; owned internal network; no published ports' };
} catch (error) { failure = error; }
finally {
  for (const { child } of children) { child.stdin.destroy(); child.kill(); }
  await Promise.allSettled(children.map(async ({ done }) => {
    let timer; try { await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); } finally { clearTimeout(timer); }
  }));
  for (const [kind, name, planned] of [['container', container, containerPlanned], ['network', network, networkPlanned]]) {
    if (!planned) continue;
    const format = kind === 'container' ? '{{index .Config.Labels "cortex.test.owner"}}' : '{{index .Labels "cortex.test.owner"}}';
    const inspected = docker([kind, 'inspect', name, '--format', format]);
    if (inspected.status !== 0 && /no such (object|container|network)/i.test(inspected.stderr)) continue;
    if (inspected.status !== 0 || inspected.stdout.trim() !== owner) { failure ||= new Error('Refusing unowned cleanup'); continue; }
    if (docker(kind === 'container' ? ['rm', '--force', '--volumes', name] : ['network', 'rm', name]).status !== 0) failure ||= new Error('Request lab cleanup failed');
  }
}
if (failure) throw failure;
report.cleanupVerified = true;
mkdirSync('docs/reviews/2026-11-04/delegation-request-foundation', { recursive: true });
writeFileSync('docs/reviews/2026-11-04/delegation-request-foundation/' + (redOnly ? 'RED' : 'verification') + '.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
