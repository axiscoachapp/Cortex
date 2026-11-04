import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const redOnly = process.argv.includes('--red');
const focused = process.argv.includes('--focused');
assert.ok(process.argv.slice(2).every(arg => ['--red', '--focused'].includes(arg)) && process.argv.length <= 3, 'No external target accepted');
assert.ok(!process.env.DOCKER_HOST, 'Refusing inherited Docker host override');
const required = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim(); };
const raw = (program, args) => spawnSync(program, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
const git = args => required(raw('git', args));
const sourceBaseline = git(['rev-parse', 'HEAD']); assert.match(sourceBaseline, /^[0-9a-f]{40}$/);
const paths = git(['ls-tree', '-r', '--name-only', sourceBaseline, '--', 'supabase/migrations', 'supabase/tests']).split('\n')
  .filter(path => /^supabase\/(migrations\/[^/]+\.sql|tests\/[^/]+\.test\.sql)$/.test(path));
const sources = new Map(paths.map(path => [path, git(['show', sourceBaseline + ':' + path])]));
const bootstrap = git(['show', sourceBaseline + ':supabase/tests/bootstrap.sql']);
const migrationPath = 'supabase/migrations/20261104250000_reception_legacy_array_guard.sql';
const suitePath = 'supabase/tests/reception-legacy-array-guard.test.sql';
const overlays = [suitePath, ...(!redOnly ? [migrationPath] : []), 'scripts/test-reception-legacy-array-guard.mjs',
  'scripts/test-reception-delegation-request-concurrency.mjs', 'scripts/test-reception-delegation-decision-concurrency.mjs', 'scripts/test-reception-legacy-array-concurrency.mjs'].map(path => {
  const source = readFileSync(path, 'utf8'); sources.set(path, source);
  return { path, sha256: createHash('sha256').update(source).digest('hex') };
});
// Execute exactly the helper snapshots attested below, never live imports.
// These modules import only node: builtins; their standalone CLI guards do not
// run when imported from our private temporary module directory.
const helperPaths = ['test-function-boundaries', 'test-reception-concurrency', 'test-reception-appointment-concurrency',
  'test-reception-scope-lifecycle', 'test-reception-staff-lifecycle', 'test-document-snippets-concurrency',
  'test-reception-deletion-concurrency', 'test-reception-delegation-request-concurrency',
  'test-reception-delegation-decision-concurrency', 'test-reception-legacy-array-concurrency'].map(name => 'scripts/' + name + '.mjs');
const helperSources = helperPaths.map(path => {
  const overlay = sources.has(path), source = overlay ? sources.get(path) : git(['show', sourceBaseline + ':' + path]);
  sources.set(path, source);
  return { path, source: overlay ? 'overlay' : 'HEAD', sha256: createHash('sha256').update(source).digest('hex') };
});
const context = required(raw('docker', ['context', 'show']));
const endpoint = JSON.parse(required(raw('docker', ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint) || /^unix:\/\/\//.test(endpoint), 'Expected local Docker endpoint');
process.env.DOCKER_HOST = endpoint;
for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete process.env[key];
const docker = (args, input, timeout = 30000) => spawnSync('docker', ['--host', endpoint, ...args], { input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
const owner = randomUUID(), container = 'cortex-test-' + owner.slice(0, 8), network = container + '-legacy-array-guard';
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

let networkPlanned = false, containerPlanned = false, failure, report, moduleDirectory;
const moduleFiles = [];
try {
  moduleDirectory = mkdtempSync(join(tmpdir(), 'cortex-delegation-'));
  const modules = [];
  for (const path of helperPaths) {
    const local = join(moduleDirectory, path.split('/').at(-1));
    moduleFiles.push(local); writeFileSync(local, sources.get(path));
    modules.push(await import(pathToFileURL(local).href));
  }
  const { testFunctionBoundaryRegressions, testReceptionConcurrency, testReceptionAppointmentConcurrency,
    testReceptionScopeLifecycle, testReceptionStaffLifecycle, testDocumentSnippetsConcurrency,
    testReceptionDeletionConcurrency, testDelegationRequestConcurrency, testDelegationDecisionConcurrency, testLegacyArrayConcurrency } = Object.assign({}, ...modules);
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
  assert.notEqual(before.status, 0); assert.match(before.stderr, /P0001: Legacy array removed physician approval/);
  checks.push('RED: stale legacy array removes physician-approved consent');
  process.stdout.write(checks.at(-1) + '\n');
  let suiteCount = 0, deletionScenarios = 0, requestRaces = [], decisionRaces = [], arrayRaces = [];
  if (!redOnly) {
    const priorDefinition = sql("select md5(pg_get_functiondef('public.set_reception_scopes(uuid,uuid,uuid[],boolean)'::regprocedure))");
    const holder = session();
    try {
      holder.send("begin;lock table public.clinic_staff_members in row exclusive mode;select 'REQUEST_HELD';"); await holder.held();
      const busy = result(sources.get(migrationPath)); assert.notEqual(busy.status, 0); assert.match(busy.stderr, /55P03:/);
      assert.equal(sql("select md5(pg_get_functiondef('public.set_reception_scopes(uuid,uuid,uuid[],boolean)'::regprocedure))"), priorDefinition);
      required(await holder.end('rollback;'));
    } finally { await holder.end('rollback;'); }
    checks.push('busy installation preserves the exact predecessor function');
    const staleInstaller = session();
    try {
      staleInstaller.send("begin isolation level repeatable read;select count(*) from auth.users;select 'REQUEST_HELD';"); await staleInstaller.held();
      const stale = await staleInstaller.end(sources.get(migrationPath));
      assert.notEqual(stale.status, 0); assert.match(stale.stderr, /25001:/);
      assert.equal(sql("select md5(pg_get_functiondef('public.set_reception_scopes(uuid,uuid,uuid[],boolean)'::regprocedure))"), priorDefinition);
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
    if (!focused) {
      testFunctionBoundaryRegressions(container, sources.get('supabase/tests/reception-function-boundaries.test.sql'));
      await testReceptionConcurrency(container); await testReceptionAppointmentConcurrency(container);
      await testReceptionScopeLifecycle(container); await testReceptionStaffLifecycle(container); await testDocumentSnippetsConcurrency(container);
      deletionScenarios = (await testReceptionDeletionConcurrency(container)).length;
    }
    requestRaces = await testDelegationRequestConcurrency({ sql, result, session, required });
    decisionRaces = await testDelegationDecisionConcurrency({ sql, result, session, required });
    arrayRaces = await testLegacyArrayConcurrency({ sql, result, session, required });
    checks.push('stale array conflict, exact consent preservation, deactivation and privacy SQL pass');
    if (!focused) checks.push('function-boundary fault injections and existing reception/appointment/lifecycle/snippet/deletion races pass');
  }
  const omittedRegressions = redOnly || focused ? ['function-boundary fault injections', 'reception concurrency',
    'appointment concurrency', 'doctor scope lifecycle concurrency', 'staff lifecycle concurrency',
    'document snippet concurrency', 'deletion concurrency'] : [];
  report = { syntheticOnly: true, redOnly, focused, sourceBaseline, overlays, helperSources, omittedRegressions,
    notCovered: ['hosted rollout', 'new authenticated consent API/UI', 'general legacy grant cutover', ...(redOnly ? ['GREEN SQL and consent concurrency'] : [])],
    migrations: migrations.length + (redOnly ? 0 : 1), sqlSuites: suiteCount,
    deletionScenarios, requestRaces, decisionRaces, arrayRaces, checks, publicConsentGate: false, globalLegacyCutover: false,
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
  // Remove only our individually recorded files; no recursive path deletion.
  for (const local of moduleFiles) {
    try { unlinkSync(local); } catch (error) { if (error.code !== 'ENOENT') failure ||= error; }
  }
  if (moduleDirectory) { try { rmdirSync(moduleDirectory); } catch (error) { failure ||= error; } }
}
if (failure) throw failure;
report.cleanupVerified = true;
mkdirSync('docs/reviews/2026-11-04/legacy-array-guard', { recursive: true });
writeFileSync('docs/reviews/2026-11-04/legacy-array-guard/' + (redOnly ? 'RED' : focused ? 'focused' : 'verification') + '.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
