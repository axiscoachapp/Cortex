import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const migration = '20261104004000_reception_scope_lifecycle.sql';
const bounds = "set statement_timeout='5s';set lock_timeout='1s';";
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 30000 });
const required = result => { assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout.trim(); };
const claims = actor => `set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
const query = (container, source) => required(docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], bounds + source));

function session(container) {
  const applicationName = `scope-lifecycle-${randomUUID()}`;
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
  let output = '', errors = '';
  const listeners = new Set();
  child.stdout.on('data', data => { output += data; for (const notify of listeners) notify(); });
  child.stderr.on('data', data => { errors += data; });
  child.stdin.on('error', () => {});
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('close', status => resolveDone({ status, output, errors }));
  });
  const send = sql => child.stdin.write(sql + '\n');
  send(bounds + `set application_name='${applicationName}';`);
  return {
    applicationName,
    send,
    wait: marker => new Promise((resolveMarker, reject) => {
      const cleanup = () => { clearTimeout(timer); listeners.delete(check); };
      const check = () => { if (output.includes(marker)) { cleanup(); resolveMarker(); } };
      const timer = setTimeout(() => { cleanup(); child.kill(); reject(new Error('Timed out before ' + marker)); }, 10000);
      listeners.add(check); check();
      done.then(() => { if (!output.includes(marker)) { cleanup(); reject(new Error('Session ended before ' + marker + ': ' + errors)); } }, reject);
    }),
    finish: async sql => {
      send(sql); child.stdin.end();
      let timer;
      try { return await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('Session did not finish')); }, 10000); })]); }
      finally { clearTimeout(timer); }
    },
    close: () => { child.stdin.end(); child.kill(); },
  };
}

async function waitBlocked(container, holder, waiter) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const blocked = query(container, `select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${holder.applicationName}' where w.application_name='${waiter.applicationName}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`);
    if (blocked === 't') return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error('Expected membership/FK blocking order was not observed');
}

// The caller owns a disposable database; this function never connects to Supabase.
export async function testReceptionScopeLifecycle(container) {
  assert.match(container, /^cortex-(test|scope-race)-[a-z0-9-]+$/);
  const sql = source => query(container, source);
  const admin = 'bd100000-0000-4000-8000-000000000001', staff = 'bd100000-0000-4000-8000-000000000002';
  sql(`insert into auth.users(id,email) values('${admin}','scope-race-admin@example.invalid'),('${staff}','scope-race-staff@example.invalid');`);
  const clinic = sql(`begin;${claims(admin)}select public.create_clinic('Synthetic scope lifecycle races');commit;`);
  sql(`begin;set local role service_role;set local request.jwt.claim.role='service_role';select public.provision_clinic_receptionist('${admin}','${staff}','Synthetic scope race',array['${admin}'::uuid]);commit;`);
  const authenticatedCut = sql("select to_regprocedure('cortex_private.guard_authenticated_legacy_scope()') is not null") === 't';
  const seedExistingLegacy = doctor => sql(`begin;set local request.jwt.claim.role='service_role';
    select public.set_reception_scopes('${clinic}','${staff}',array['${admin}'::uuid,'${doctor}'::uuid],true);commit;`);
  const outcomes = [];
  for (const writer of ['raw', 'rpc']) for (const isolation of ['read committed', 'repeatable read']) {
    for (const order of ['grant-held', 'leave-held', 'grant-committed', 'leave-committed', ...(writer === 'raw' ? ['grant-held-rpc', 'leave-held-rpc'] : [])]) {
      const doctor = randomUUID();
      sql(`insert into auth.users(id,email) values('${doctor}','${doctor}@example.invalid');insert into public.clinic_members(clinic_id,user_id,status) values('${clinic}','${doctor}','active');`);
      // After the cut the public array saves existing scopes, never creates
      // them. Seed a trusted pre-existing legacy row to retain these races.
      if (authenticatedCut && writer === 'rpc') seedExistingLegacy(doctor);
      const grant = writer === 'raw'
        ? `set local role service_role;set local request.jwt.claim.role='service_role';insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('${clinic}','${staff}','${doctor}')`
        : `select public.update_reception_staff('${staff}',array['${admin}'::uuid,'${doctor}'::uuid],true)`;
      const blockedRpc = order.endsWith('-rpc');
      const leave = blockedRpc ? `select public.leave_clinic('${clinic}')`
        : `set local role service_role;set local request.jwt.claim.role='service_role';update public.clinic_members set status='inactive' where clinic_id='${clinic}' and user_id='${doctor}'`;
      const leaveRpc = `select public.leave_clinic('${clinic}')`;
      const grantFirst = order.startsWith('grant');
      const firstActor = grantFirst ? admin : doctor, secondActor = grantFirst ? doctor : admin;
      const firstSql = grantFirst ? grant : leave, secondSql = grantFirst ? leave : grant;
      const second = session(container);
      let first;
      try {
        second.send(`begin isolation level ${isolation};${claims(secondActor)}select count(*) from public.patients;\n\\echo SNAPSHOT`);
        await second.wait('SNAPSHOT');
        const held = order.includes('held');
        if (held) {
          first = session(container);
          first.send(`begin;${claims(firstActor)}${firstSql};\n\\echo HELD`);
          await first.wait('HELD');
        } else sql(`begin;${claims(firstActor)}${firstSql};commit;`);
        if (blockedRpc) second.send("set local lock_timeout='5s';");
        const loserPending = second.finish(`${secondSql};commit;`);
        let loser;
        if (blockedRpc) {
          await waitBlocked(container, first, second);
          const winner = await first.finish('commit;');
          assert.equal(winner.status, 0, winner.errors);
          loser = await loserPending;
        } else {
          loser = await loserPending;
          if (held) {
            const winner = await first.finish('commit;');
            assert.equal(winner.status, 0, winner.errors);
          }
        }
        const expected = isolation === 'repeatable read' || (held && !blockedRpc) ? '40001' : grantFirst ? null : '42501';
        if (expected) {
          assert.notEqual(loser.status, 0, `${writer}/${isolation}/${order}: unsafe competing transaction committed`);
          assert.match(loser.errors, new RegExp(`ERROR:\\s+${expected}:`));
        } else assert.equal(loser.status, 0, loser.errors);
        const state = sql(`select m.status,count(s.*) from public.clinic_members m left join public.staff_doctor_scopes s on s.clinic_id=m.clinic_id and s.doctor_user_id=m.user_id where m.clinic_id='${clinic}' and m.user_id='${doctor}' group by m.status;`);
        assert.notEqual(state, 'inactive|1', 'Inactive doctor retained a latent scope');
        if (state.startsWith('active|')) sql(`begin;${claims(doctor)}${leaveRpc};commit;`);
        sql(`begin;${claims(admin)}select public.invite_clinic_doctor('${clinic}','${doctor}@example.invalid');commit;begin;${claims(doctor)}select public.respond_clinic_invitation('${clinic}',true);commit;`);
        assert.equal(sql(`select count(*) from public.staff_doctor_scopes where clinic_id='${clinic}' and doctor_user_id='${doctor}';`), '0', 'Rejoin restored a raced delegation');
        if (authenticatedCut && writer === 'rpc') seedExistingLegacy(doctor);
        sql(`begin;${claims(admin)}${grant};commit;`);
        assert.equal(sql(`select count(*) from public.staff_doctor_scopes where clinic_id='${clinic}' and doctor_user_id='${doctor}';`), '1', 'Post-rejoin trusted grant/save-existing control failed');
        sql(`begin;${claims(doctor)}${leaveRpc};commit;`);
        const outcome = { writer, rpcMode: authenticatedCut && writer === 'rpc' ? 'save-existing-server-fixture' : null, isolation, order, refused: expected, blockedRpc, staleScopesAfterRejoin: 0 };
        outcomes.push(outcome); process.stdout.write(JSON.stringify(outcome) + '\n');
      } finally { first?.close(); second.close(); }
    }
  }
  assert.equal(outcomes.length, 20);
  process.stdout.write('Passed reception scope lifecycle: 16 epoch races, 4 observed RPC/FK waits, rejoin, trusted grant/save-existing controls\n');
}

// Standalone regression also proves migration cleanup against predecessor data.
export async function runReceptionScopeLifecycleRegression({ beforeRevocation = false } = {}) {
  const container = `cortex-scope-race-${randomUUID().slice(0, 8)}`;
  const sql = source => query(container, source);
  const oldAdmin = 'be100000-0000-4000-8000-000000000001', oldStaff = 'be100000-0000-4000-8000-000000000002', oldDoctor = 'be100000-0000-4000-8000-000000000003', oldClinic = 'be200000-0000-4000-8000-000000000001';
  try {
    required(docker(['run', '--detach', '--rm', '--name', container, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (docker(['exec', container, 'pg_isready', '-U', 'postgres']).status === 0) { ready = true; break; }
      await new Promise(resolveWait => setTimeout(resolveWait, 500));
    }
    assert.ok(ready, 'Disposable PostgreSQL not ready');
    sql(readFileSync(resolve('supabase/tests/bootstrap.sql'), 'utf8'));
    for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
      if (name === migration && beforeRevocation) continue;
      if (name === migration) {
        sql(`insert into auth.users(id,email) values('${oldAdmin}','old-scope-admin@example.invalid'),('${oldStaff}','old-scope-staff@example.invalid'),('${oldDoctor}','old-scope-doctor@example.invalid');
          insert into public.clinics(id,name,created_by) values('${oldClinic}','Synthetic migration cleanup','${oldAdmin}');
          insert into public.clinic_members(clinic_id,user_id,role,status) values('${oldClinic}','${oldAdmin}','admin','active'),('${oldClinic}','${oldDoctor}','doctor','inactive');
          insert into public.clinic_staff_members(user_id,clinic_id,name) values('${oldStaff}','${oldClinic}','Synthetic old scope');
          insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('${oldClinic}','${oldStaff}','${oldAdmin}'),('${oldClinic}','${oldStaff}','${oldDoctor}');`);
      }
      sql(readFileSync(resolve('supabase/migrations', name), 'utf8'));
      if (name === migration) {
        assert.equal(sql(`select count(*) from public.staff_doctor_scopes where clinic_id='${oldClinic}' and doctor_user_id='${oldDoctor}';`), '0', 'Migration retained inactive legacy scope');
        assert.equal(sql(`select count(*) from public.staff_doctor_scopes where clinic_id='${oldClinic}' and doctor_user_id='${oldAdmin}';`), '1', 'Cleanup revoked active scope');
        assert.equal(sql(`select count(*) from public.reception_audit where clinic_id='${oldClinic}' and resource_id='${oldDoctor}' and action='doctor_scopes_revoked' and actor_user_id is null and details='{"count":1}'::jsonb;`), '1', 'Cleanup audit missing');
        process.stdout.write('Passed migration cleanup: inactive scope removed, active scope preserved, minimum audit\n');
      }
    }
    await testReceptionScopeLifecycle(container);
  } finally { required(docker(['stop', container])); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runReceptionScopeLifecycleRegression({ beforeRevocation: process.argv.includes('--before-scope-revocation') });
}
