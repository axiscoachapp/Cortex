import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// An inherited RR snapshot must fail before installing any object. The caller
// then applies the real migration freshly, even with a session default of RR.
export async function testStaffLifecycleStaleInstallation(container, migration, sql) {
  assert.match(container, /^cortex-test-[a-z0-9-]+$/);
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
  let output = '', errors = '', completed;
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; }); child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', status => resolve({ status, errors })); });
  done.then(value => { completed = value; }, () => {}); done.catch(() => {});
  try {
    child.stdin.write("set statement_timeout='10s';begin isolation level repeatable read;select active from public.clinic_staff_members where user_id='d7100000-0000-4000-8000-000000000004';select 'STAFF_INSTALL_SNAPSHOT';\n");
    for (let n = 0; n < 100 && !output.includes('STAFF_INSTALL_SNAPSHOT'); n++) {
      if (completed) throw new Error('Stale installer ended before snapshot: ' + errors);
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(output.includes('t\nSTAFF_INSTALL_SNAPSHOT'), 'Old active membership was not observed');
    sql("update public.clinic_staff_members set active=false where user_id='d7100000-0000-4000-8000-000000000004';");
    child.stdin.end(migration + '\n');
    let timer;
    const refused = await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Stale installer timeout')), 15000); })]).finally(() => clearTimeout(timer));
    assert.notEqual(refused.status, 0); assert.match(refused.errors, /ERROR:\s+25001:/, 'Expected isolation refusal before DDL');
    assert.equal(sql("select to_regprocedure('cortex_private.revoke_inactive_staff_scopes()') is null and to_regprocedure('cortex_private.guard_active_scope_staff()') is null"), 't', 'Stale installer left functions behind');
    assert.equal(sql("select count(*) from pg_trigger where tgname in ('reception_staff_scopes_revoke','reception_scope_active_staff')"), '0', 'Stale installer left triggers behind');
    assert.equal(sql("select count(*) from public.staff_doctor_scopes where staff_user_id='d7100000-0000-4000-8000-000000000004'"), '1', 'Stale refusal partially changed data');
  } finally { child.stdin.destroy(); child.kill(); await done.catch(() => {}); }
}

// Caller owns the disposable database and pins the local Docker endpoint.
export async function testReceptionStaffLifecycle(container) {
  assert.match(container, /^cortex-test-[a-z0-9-]+$/);
  const bounds = "set statement_timeout='5s';set lock_timeout='1s';";
  const sql = source => {
    const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
      { input: bounds + source, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout.trim();
  };
  const claims = actor => `set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
  const service = "set local role service_role;set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';";
  const session = () => {
    const name = 'staff-lifecycle-' + randomUUID();
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
    let output = '', errors = '';
    const listeners = new Set();
    child.stdout.on('data', data => { output += data; for (const check of listeners) check(); });
    child.stderr.on('data', data => { errors += data; }); child.stdin.on('error', () => {});
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', status => resolve({ status, output, errors })); });
    done.catch(() => {});
    const send = source => child.stdin.write(source + '\n');
    send(bounds + `set application_name='${name}';`);
    return { name, send,
      wait: marker => new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); listeners.delete(check); };
        const check = () => { if (output.includes(marker)) { cleanup(); resolve(); } };
        const timer = setTimeout(() => { cleanup(); child.kill(); reject(new Error('Missing staff lifecycle barrier: ' + marker)); }, 10000);
        listeners.add(check); check();
        done.then(() => { if (!output.includes(marker)) { cleanup(); reject(new Error('Staff session ended before barrier: ' + errors)); } }, reject);
      }),
      finish: async source => {
        child.stdin.end(source + '\n'); let timer;
        try { return await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('Staff session timeout')); }, 15000); })]); }
        finally { clearTimeout(timer); }
      },
      close: () => { child.stdin.end(); child.kill(); },
    };
  };
  const observeBlocked = async (holder, waiter) => {
    for (let n = 0; n < 40; n++) {
      if (sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${holder.name}'
        where w.application_name='${waiter.name}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't') return;
      await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('Staff lifecycle row blocking was not observed');
  };
  const admin = 'd5100000-0000-4000-8000-000000000001';
  sql(`insert into auth.users(id,email) values('${admin}','staff-race-admin@example.invalid');`);
  const clinic = sql(`begin;${claims(admin)}select public.create_clinic('Synthetic staff lifecycle races');commit;`);
  const authenticatedCut = sql("select to_regprocedure('cortex_private.guard_authenticated_legacy_scope()') is not null") === 't';
  const seedExistingLegacy = staff => sql(`begin;${service}
    select public.set_reception_scopes('${clinic}','${staff}',array['${admin}'::uuid],true);commit;`);
  const newStaff = () => {
    const staff = randomUUID();
    sql(`insert into auth.users(id,email) values('${staff}','${staff}@example.invalid');
      begin;${service}select public.provision_clinic_receptionist('${admin}','${staff}','Synthetic staff race','{}');commit;`);
    return staff;
  };
  const deactivate = staff => `${service}update public.clinic_staff_members set active=false where user_id='${staff}'`;
  const regrant = staff => `select public.update_reception_staff('${staff}',array['${admin}'::uuid],true)`;
  const purgeAndCheck = staff => {
    sql(`begin;${deactivate(staff)};update public.clinic_staff_members set active=true where user_id='${staff}';commit;`);
    assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${staff}'`), '0', 'Flag reactivation restored a raced scope');
    if (authenticatedCut) seedExistingLegacy(staff);
    sql(`begin;${claims(admin)}${regrant(staff)};commit;`);
    assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${staff}'`), '1', 'Trusted grant/save-existing control failed');
    sql(`begin;${deactivate(staff)};commit;`);
  };
  const outcomes = [];
  for (const writer of ['raw', 'rpc']) for (const isolation of ['read committed', 'repeatable read'])
    for (const order of ['grant-held', 'deactivate-held', 'grant-committed', 'deactivate-committed']) {
      const staff = newStaff();
      if (authenticatedCut && writer === 'rpc') seedExistingLegacy(staff);
      const grant = writer === 'raw' ? `${service}insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('${clinic}','${staff}','${admin}')` : regrant(staff);
      const grantFirst = order.startsWith('grant'), held = order.endsWith('held');
      const firstSql = grantFirst ? grant : deactivate(staff), secondSql = grantFirst ? deactivate(staff) : grant;
      const second = session(); let first;
      try {
        second.send(`begin isolation level ${isolation};${claims(admin)}select count(*) from public.patients;\n\\echo STAFF_SNAPSHOT`);
        await second.wait('STAFF_SNAPSHOT');
        if (held) {
          first = session(); first.send(`begin;${claims(admin)}${firstSql};\n\\echo STAFF_HELD`); await first.wait('STAFF_HELD');
        } else sql(`begin;${claims(admin)}${firstSql};commit;`);
        const blocked = held && writer === 'rpc';
        if (blocked) second.send("set local statement_timeout='12s';set local lock_timeout='8s';");
        const pending = second.finish(secondSql + ';commit;');
        pending.catch(() => {}); // Observe rejection immediately while inspecting locks.
        let loser;
        if (blocked) { await observeBlocked(first, second); assert.equal((await first.finish('commit;')).status, 0); loser = await pending; }
        else { loser = await pending; if (first) assert.equal((await first.finish('commit;')).status, 0); }
        const expected = isolation === 'repeatable read' || (held && writer === 'raw') ? '40001'
          : !grantFirst && (writer === 'raw' || authenticatedCut) ? '42501' : null;
        if (expected) { assert.notEqual(loser.status, 0, 'Unsafe staff race committed'); assert.match(loser.errors, new RegExp(`ERROR:\\s+${expected}:`)); }
        else assert.equal(loser.status, 0, loser.errors);
        assert.notEqual(sql(`select s.active,count(d.*) from public.clinic_staff_members s left join public.staff_doctor_scopes d on d.staff_user_id=s.user_id where s.user_id='${staff}' group by s.active`), 'f|1', 'Inactive raced account retained scope');
        purgeAndCheck(staff);
        outcomes.push({ writer, rpcMode: authenticatedCut && writer === 'rpc' ? 'save-existing-server-fixture' : null, isolation, order, refused: expected, blocked });
      } finally { first?.close(); second.close(); }
    }
  for (const isolation of ['read committed', 'repeatable read']) for (const order of ['writer-held', 'deactivate-held']) {
    const staff = newStaff();
    if (authenticatedCut) seedExistingLegacy(staff);
    sql(`begin;${claims(admin)}${regrant(staff)};commit;`);
    const contact = sql(`begin;${claims(staff)}select public.reception_create_contact('${clinic}','Synthetic staff authorization','41999990000',gen_random_uuid());commit;`);
    const caseId = sql(`begin;${claims(staff)}select public.reception_create_case('${contact}','${admin}','Synthetic revocation race','scheduling',gen_random_uuid());commit;`);
    sql(`begin;${claims(staff)}select public.reception_update_case('${caseId}',1,'claim','{}');commit;`);
    const draft = `select public.reception_save_draft('${caseId}','Synthetic held draft',0)`;
    const writerFirst = order === 'writer-held', first = session(), second = session();
    try {
      second.send(`begin isolation level ${isolation};${claims(writerFirst ? admin : staff)}select count(*) from public.patients;\n\\echo STAFF_SNAPSHOT`);
      await second.wait('STAFF_SNAPSHOT');
      first.send(`begin;${claims(writerFirst ? staff : admin)}${writerFirst ? draft : deactivate(staff)};\n\\echo STAFF_HELD`);
      await first.wait('STAFF_HELD');
      second.send("set local statement_timeout='12s';set local lock_timeout='8s';");
      const pending = second.finish((writerFirst ? deactivate(staff) : draft) + ';commit;');
      pending.catch(() => {});
      await observeBlocked(first, second); assert.equal((await first.finish('commit;')).status, 0);
      const loser = await pending;
      const expected = isolation === 'repeatable read' ? '40001' : writerFirst ? null : '42501';
      if (expected) { assert.notEqual(loser.status, 0); assert.match(loser.errors, new RegExp(`ERROR:\\s+${expected}:`)); }
      else assert.equal(loser.status, 0, loser.errors);
      assert.equal(sql(`select count(*) from public.reception_case_drafts where case_id='${caseId}'`), writerFirst ? '1' : '0', 'Unauthorized draft committed after deactivation');
      purgeAndCheck(staff);
      assert.equal(sql(`select assigned_to is null from public.reception_cases where id='${caseId}'`), 't', 'Revocation left an inaccessible assignment');
      outcomes.push({ isolation, order, refused: expected, blocked: true });
    } finally { first.close(); second.close(); }
  }
  assert.equal(outcomes.length, 20);
  process.stdout.write('Passed staff lifecycle: 16 grant/save-existing vs inactivity races, 4 observed authorization waits, no latent reactivation\n');
  return outcomes;
}
