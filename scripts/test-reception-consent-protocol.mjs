import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';

// Only a new, locally owned disposable DB; never accept env, URL or DB targets.
assert.equal(process.argv.length, 2, 'Consent lab takes no arguments');
assert.ok(!process.env.DOCKER_HOST, 'Refusing inherited Docker host override');
const required = r => { assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim(); };
const raw = (program, args) => spawnSync(program, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
const git = args => required(raw('git', args));
const sourceBaseline = git(['rev-parse', 'HEAD']);
assert.match(sourceBaseline, /^[0-9a-f]{40}$/);
const baseline = path => git(['show', sourceBaseline + ':' + path]);
const migrations = git(['ls-tree', '-r', '--name-only', sourceBaseline, '--', 'supabase/migrations']).split('\n').filter(p => p.endsWith('.sql')).sort();
const sources = migrations.map(path => ({ path, sql: baseline(path) }));
const bootstrap = baseline('supabase/tests/bootstrap.sql');
const prototypePath = 'scripts/prototypes/reception-consent-protocol.sql';
const prototype = readFileSync(prototypePath, 'utf8');
const prototypeSha256 = createHash('sha256').update(prototype).digest('hex');
const harnessPath = 'scripts/test-reception-consent-protocol.mjs';
const harnessSha256 = createHash('sha256').update(readFileSync(harnessPath)).digest('hex');
const context = required(raw('docker', ['context', 'show']));
const endpoint = JSON.parse(required(raw('docker', ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint) || /^unix:\/\/\//.test(endpoint), 'Expected local Docker pipe/socket');
process.env.DOCKER_HOST = endpoint;
for (const name of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete process.env[name];
const docker = (args, input, timeout = 30000) => spawnSync('docker', ['--host', endpoint, ...args], { input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
const owner = randomUUID(), container = 'cortex-test-' + owner.slice(0, 8), network = container + '-consent';
const bounds = "set statement_timeout='15s';set lock_timeout='3s';";
const psql = ['--host', endpoint, 'exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
const result = source => docker(psql.slice(2), bounds + source);
const sql = source => required(result(source));
const claims = actor => `set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
const service = "set local role service_role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';";
const as = (actor, source) => `begin;${claims(actor)}${source};commit;`;
const checks = [], children = [];
const check = (name, fn) => { fn(); checks.push(name); process.stdout.write('Passed ' + name + '\n'); };
const refused = (source, code, message) => {
  const r = result(source); assert.notEqual(r.status, 0, 'Expected rejection');
  assert.match(r.stderr, new RegExp('ERROR:\\s+' + code + ':'));
  if (message) assert.match(r.stderr, message); return r;
};
function session() {
  const name = 'consent-' + randomUUID();
  const child = spawn('docker', psql, { windowsHide: true });
  let stdout = '', stderr = '', complete, ended = false;
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; }); child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr })); });
  done.then(r => { complete = r; }, () => {}); done.catch(() => {}); children.push({ child, done });
  child.stdin.write(bounds + `set application_name='${name}';\n`);
  return { name, send: source => child.stdin.write(source + '\n'),
    held: async () => {
      for (let n = 0; n < 100; n++) {
        if (stdout.includes('CONSENT_HELD')) return;
        if (complete) throw new Error('Consent holder failed: ' + stderr);
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error('Consent holder did not reach barrier');
    },
    end: async source => {
      if (!ended) { ended = true; child.stdin.end(source + '\n'); }
      let timer;
      try { return await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('Consent session timeout')); }, 20000); })]); }
      finally { clearTimeout(timer); }
    },
  };
}
async function blocked(holder, waiter) {
  for (let n = 0; n < 20; n++) {
    if (sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${holder.name}'
      where w.application_name='${waiter.name}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Consent request-row blocking not observed');
}
const users = Array.from({ length: 4 }, (_, n) => `de100000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`);
const [admin, doctor, other, staff] = users;
const clinic = 'de200000-0000-4000-8000-000000000001';
const request = (s = staff, d = doctor, op = randomUUID()) => JSON.parse(sql(as(admin, `select cortex_consent_lab.request('${clinic}','${s}','${d}','${op}')`)));
const mutate = (r, action, op = randomUUID(), actor = doctor) => as(actor, `select cortex_consent_lab.mutate('${r.id}',${r.revision},'${action}','${op}')`);
const state = id => sql(`select state||':'||revision from cortex_consent_lab.requests where id='${id}'`);
const access = id => sql(as(staff, `select cortex_consent_lab.can_operate('${id}')`));
const deactivate = (kind, active = false) => kind === 'staff'
  ? `${service}update public.clinic_staff_members set active=${active} where user_id='${staff}'`
  : `${service}update public.clinic_members set status='${active ? 'active' : 'inactive'}' where clinic_id='${clinic}' and user_id='${doctor}'`;
let networkPlanned = false, containerPlanned = false, failure, report;
try {
  networkPlanned = true; required(docker(['network', 'create', '--internal', '--label', 'cortex.test.owner=' + owner, network]));
  containerPlanned = true; required(docker(['run', '--detach', '--pull=never', '--name', container, '--network', network, '--label', 'cortex.test.owner=' + owner,
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
  let ready = false;
  for (let n = 0; n < 60; n++) {
    if (docker(['exec', container, 'pg_isready', '-U', 'postgres']).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(ready, 'Disposable consent DB not ready'); sql(bootstrap);
  for (const source of sources) sql(source.sql);
  sql(`insert into auth.users(id,email) values ${users.map((u, n) => `('${u}','consent-${n}@example.invalid')`).join(',')};
    insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic consent protocol','${admin}');
    insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${admin}','admin','active'),('${clinic}','${doctor}','doctor','active'),('${clinic}','${other}','doctor','active');
    insert into public.clinic_staff_members(clinic_id,user_id,name,active) values('${clinic}','${staff}','Synthetic consent reception',true);`);
  sql(as(admin, `select public.update_reception_staff('${staff}',array['${doctor}'::uuid],true)`));
  check('RED: current setter grants another doctor without physician approval', () => {
    const before = result(as(staff, `do $$ begin assert jsonb_array_length(public.clinic_access()->'doctors')=0,'Consent missing yet administrative scope is live';end $$`));
    assert.notEqual(before.status, 0); assert.match(before.stderr, /Consent missing yet administrative scope is live/);
  });
  sql(as(admin, `select public.update_reception_staff('${staff}','{}',true)`));
  // Install only the model, after RED; the app's gate/setter stays untouched.
  sql("begin;set local cortex.disposable_consent_lab='on';" + prototype + 'commit;');
  check('RED: NULL in the BEFORE DELETE trigger silently suppresses an unrelated deletion', () => {
    const definition = sql("select pg_get_functiondef('cortex_consent_lab.end_membership_requests()'::regprocedure)");
    const fault = definition.replace("if tg_op='DELETE' then return old;end if;", '');
    assert.notEqual(fault, definition, 'Missing deletion fault point');
    const unlinked = randomUUID();
    assert.equal(sql(`begin;${fault};
      insert into auth.users(id,email) values('${unlinked}','${unlinked}@example.invalid');
      insert into public.clinic_staff_members(clinic_id,user_id,name) values('${clinic}','${unlinked}','Synthetic deletion counterexample');
      delete from public.clinic_staff_members where user_id='${unlinked}';
      select exists(select 1 from public.clinic_staff_members where user_id='${unlinked}');rollback;`), 't');
    assert.equal(sql("select pg_get_functiondef('cortex_consent_lab.end_membership_requests()'::regprocedure)"), definition, 'Deletion counterexample did not roll back');
  });
  check('BEFORE DELETE does not silently suppress removal of an unrelated member', () => {
    const unlinkedStaff = randomUUID(), unlinkedDoctor = randomUUID();
    sql(`insert into auth.users(id,email) values('${unlinkedStaff}','${unlinkedStaff}@example.invalid'),('${unlinkedDoctor}','${unlinkedDoctor}@example.invalid');
      insert into public.clinic_staff_members(clinic_id,user_id,name) values('${clinic}','${unlinkedStaff}','Synthetic unrelated reception');
      insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${unlinkedDoctor}','doctor','active');
      delete from public.clinic_staff_members where user_id='${unlinkedStaff}';
      delete from public.clinic_members where clinic_id='${clinic}' and user_id='${unlinkedDoctor}';`);
    assert.equal(sql(`select not exists(select 1 from public.clinic_staff_members where user_id='${unlinkedStaff}')
      and not exists(select 1 from public.clinic_members where clinic_id='${clinic}' and user_id='${unlinkedDoctor}')`), 't');
  });
  let r = request();
  check('pending request is ineffective and model tables are private', () => {
    assert.equal(access(r.id), 'f');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      refused(`begin;set local role ${role};select * from cortex_consent_lab.requests;commit;`, '42501');
    }
  });
  check('only destination physician decides; admin, staff and another physician refused', () => {
    for (const actor of [admin, other, staff]) refused(mutate(r, 'approve', randomUUID(), actor), '42501', /Consent (unavailable|actor unavailable)/);
    assert.equal(state(r.id), 'pending:1');
  });
  check('MFA and account-deletion intent are enforced before approval', () => {
    // Each dedicated refusal aborts its fixture transaction; never erase a
    // committed monotonic deletion intent just to reset the test doctor.
    const call = `select cortex_consent_lab.mutate('${r.id}',1,'approve','${randomUUID()}');commit;`;
    refused(`begin;insert into auth.mfa_factors(id,user_id,status,factor_type) values('de300000-0000-4000-8000-000000000001','${doctor}','verified','totp');${claims(doctor)}${call}`, '42501', /segundo fator/);
    refused(`begin;insert into public.account_deletion_requests(user_id) values('${doctor}');${claims(doctor)}${call}`, '42501', /Consent actor unavailable/);
  });
  const approvalOp = randomUUID();
  check('approval and lost-response retry produce one effective model grant', () => {
    const first = JSON.parse(sql(mutate(r, 'approve', approvalOp)));
    assert.equal(first.state, 'approved'); assert.equal(access(r.id), 't');
    assert.deepEqual(JSON.parse(sql(mutate(r, 'approve', approvalOp))), first);
    assert.equal(sql(`select count(*) from cortex_consent_lab.operations where actor_id='${doctor}' and operation_id='${approvalOp}'`), '1');
    refused(mutate(r, 'deny', approvalOp), '22023', /Consent operation mismatch/); r = first;
  });
  check('withdrawal prevents stale operation from restoring a grant; new request uses new UUID', () => {
    const definition = sql("select pg_get_functiondef('cortex_consent_lab.mutate(uuid,integer,text,uuid)'::regprocedure)");
    const fault = definition.replace("r.state in ('approved','revoked')", "r.state='approved'");
    assert.notEqual(fault, definition, 'Missing physician retry fault point');
    const lostResponseOp = randomUUID();
    const repeated = `select cortex_consent_lab.mutate('${r.id}',${r.revision},'withdraw','${lostResponseOp}');`;
    refused(`begin;${fault};${claims(doctor)}${repeated}${repeated}commit;`, '42501', /Consent unavailable/);
    assert.equal(state(r.id), 'approved:2', 'Failed retry counterexample did not roll back its withdrawal');
    assert.equal(sql(`select count(*) from cortex_consent_lab.operations where operation_id='${lostResponseOp}'`), '0');
    assert.equal(sql("select pg_get_functiondef('cortex_consent_lab.mutate(uuid,integer,text,uuid)'::regprocedure)"), definition, 'Retry counterexample did not roll back its function');
    const withdrawOp = randomUUID(), withdrawn = JSON.parse(sql(mutate(r, 'withdraw', withdrawOp)));
    assert.deepEqual(JSON.parse(sql(mutate(r, 'withdraw', withdrawOp))), withdrawn, 'Physician lost-response withdrawal retry failed');
    assert.equal(sql(`select count(*) from cortex_consent_lab.operations where actor_id='${doctor}' and operation_id='${withdrawOp}'`), '1');
    refused(mutate(withdrawn, 'withdraw'), '40001', /Consent changed/);
    assert.equal(access(r.id), 'f');
    refused(mutate({ ...r, revision: 1 }, 'approve', approvalOp), '40001', /Consent changed/);
    const next = request(); assert.notEqual(next.id, r.id); r = next;
  });
  check('request retries are payload-bound and do not mutate the current pair', () => {
    const op = randomUUID(), same = request(staff, doctor, op);
    assert.equal(same.id, r.id); assert.deepEqual(request(staff, doctor, op), same);
    refused(as(admin, `select cortex_consent_lab.request('${clinic}','${staff}','${other}','${op}')`), '22023', /Consent operation mismatch/);
  });
  check('UUID identity, revision and terminal history cannot be rewritten', () => {
    refused(`update cortex_consent_lab.requests set doctor_user_id='${other}',revision=revision+1 where id='${r.id}'`, '22023', /Consent identity/);
    refused(mutate({ ...r, revision: 2 }, 'approve'), '40001', /Consent changed/);
    refused(`delete from cortex_consent_lab.requests where id='${r.id}'`, '22023', /Consent history/);
  });
  check('raw grant deletion closes the approval and cannot be reinserted', () => {
    const approved = JSON.parse(sql(mutate(r, 'approve')));
    sql(as(doctor, `reset role;delete from cortex_consent_lab.grants where request_id='${r.id}'`));
    assert.equal(state(r.id), 'revoked:3');
    refused(as(doctor, `reset role;insert into cortex_consent_lab.grants values('${r.id}')`), '42501', /Consent unavailable/);
    assert.equal(access(approved.id), 'f');
  });
  for (const kind of ['staff', 'doctor']) for (const approved of [false, true]) {
    const current = request(); if (approved) sql(mutate(current, 'approve'));
    sql('begin;' + deactivate(kind) + ';commit;'); sql('begin;' + deactivate(kind, true) + ';commit;');
    assert.equal(state(current.id), approved ? 'revoked:3' : 'cancelled:2');
    refused(mutate(current, 'approve'), '40001', /Consent changed/); assert.equal(access(current.id), 'f');
    checks.push(kind + ' lifecycle invalidates ' + (approved ? 'approved' : 'pending') + ' requests through reactivation');
  }
  for (const iso of ['read committed', 'repeatable read']) for (const kind of ['staff', 'doctor']) {
    const current = request(), holder = session(), waiter = session();
    try {
      holder.send(`begin isolation level ${iso};${deactivate(kind)};select 'CONSENT_HELD';`); await holder.held();
      const attempted = waiter.end(`begin isolation level ${iso};${claims(doctor)}select cortex_consent_lab.mutate('${current.id}',1,'approve','${randomUUID()}');commit;`);
      attempted.catch(() => {}); await blocked(holder, waiter); required(await holder.end('commit;'));
      const no = await attempted; assert.notEqual(no.status, 0); assert.match(no.stderr, /ERROR:\s+(40001|42501):/);
      assert.equal(state(current.id), 'cancelled:2'); assert.equal(access(current.id), 'f');
      checks.push(iso + ': approval truly waits for ' + kind + ' inactivation and cannot revive the request');
    } finally { await holder.end('rollback;'); await waiter.end('rollback;'); }
    sql('begin;' + deactivate(kind, true) + ';commit;');
    const next = request(), approving = session();
    try {
      approving.send(`begin isolation level ${iso};${claims(doctor)}select cortex_consent_lab.mutate('${next.id}',1,'approve','${randomUUID()}');select 'CONSENT_HELD';`); await approving.held();
      refused('begin;' + deactivate(kind) + ';commit;', '40001', /Custody changed concurrently/);
      required(await approving.end('commit;')); assert.equal(access(next.id), 't');
      sql('begin;' + deactivate(kind) + ';commit;'); assert.equal(state(next.id), 'revoked:3'); assert.equal(access(next.id), 'f');
      checks.push(iso + ': held approval refuses inverse ' + kind + ' lifecycle NOWAIT; retry revokes atomically');
    } finally { await approving.end('rollback;'); }
    sql('begin;' + deactivate(kind, true) + ';commit;');
  }
  check('model approval does not masquerade as a production gate or change legacy RPCs', () => {
    const current = request(); sql(mutate(current, 'approve'));
    assert.equal(sql(`select public.reception_actor_allowed('${clinic}','${doctor}','${staff}')`), 'f');
    sql(as(admin, `select public.update_reception_staff('${staff}',array['${other}'::uuid],true)`));
    assert.equal(sql(`select public.reception_actor_allowed('${clinic}','${other}','${staff}')`), 't', 'Legacy bypass must remain explicitly visible until the real cut');
  });
  report = { syntheticOnly: true, prototypeOnly: true, productionFix: false, sourceBaseline, migrations: sources.length,
    prototype: { path: prototypePath, sha256: prototypeSha256 }, harness: { path: harnessPath, sha256: harnessSha256 }, checks, sqlSuites: 0,
    notCovered: ['production migration and installation bridge', 'legacy writer/provisioning cut', 'full custody inventory and retention',
      'model reader is a per-command snapshot predicate, not an authorization gate for old RR transactions',
      'operational readers/writers, case release and calendar regressions', 'list DTO, UI and credential setup', 'hosted rollout'],
    network: 'verified local Docker endpoint; owned internal network; no published ports' };
} catch (error) { failure = error; }
finally {
  for (const { child } of children) { child.stdin.destroy(); child.kill(); }
  await Promise.allSettled(children.map(async ({ done }) => {
    let timer; try { await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); }
    finally { clearTimeout(timer); }
  }));
  const cleanup = [];
  for (const [kind, name, planned] of [['container', container, containerPlanned], ['network', network, networkPlanned]]) {
    if (!planned) continue;
    const format = kind === 'container' ? '{{index .Config.Labels "cortex.test.owner"}}' : '{{index .Labels "cortex.test.owner"}}';
    const inspected = docker([kind, 'inspect', name, '--format', format]);
    if (inspected.status !== 0 && /no such (object|container|network)/i.test(inspected.stderr)) continue;
    if (inspected.status !== 0 || inspected.stdout.trim() !== owner) { cleanup.push('ownership'); continue; }
    if (docker(kind === 'container' ? ['rm', '--force', '--volumes', name] : ['network', 'rm', name]).status !== 0) cleanup.push('removal');
  }
  if (cleanup.length) failure ||= new Error('Consent lab cleanup incomplete: ' + cleanup.join(','));
}
if (failure) throw failure;
report.cleanupVerified = true;
mkdirSync('docs/reviews/2026-11-04/consent-protocol', { recursive: true });
writeFileSync('docs/reviews/2026-11-04/consent-protocol/verification.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
