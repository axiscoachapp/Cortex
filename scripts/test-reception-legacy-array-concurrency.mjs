import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Only the owning endpoint-pinned disposable runner supplies these callbacks.
export async function testLegacyArrayConcurrency({ sql, result, session, required }) {
  const admin = randomUUID(), manager = randomUUID(), doctor = randomUUID(), clinic = randomUUID(), checks = [];
  sql(`insert into auth.users(id,email) values('${admin}','${admin}@example.invalid'),('${manager}','${manager}@example.invalid'),('${doctor}','${doctor}@example.invalid');
   insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic legacy array races','${admin}');
   insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${admin}','admin','active'),('${clinic}','${manager}','admin','active'),('${clinic}','${doctor}','doctor','active');`);
  const claims = actor => `set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
  function fixture() {
    const staff = randomUUID();
    sql(`insert into auth.users(id,email) values('${staff}','${staff}@example.invalid');
     insert into public.clinic_staff_members(user_id,clinic_id,name) values('${staff}','${clinic}','Synthetic array race staff');
     insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('${clinic}','${staff}','${doctor}');`);
    const request = JSON.parse(sql(`begin;${claims(admin)}select cortex_private.request_reception_delegation('${clinic}','${staff}','${doctor}','${randomUUID()}');commit;`));
    return { staff, id: request.id, operation: randomUUID() };
  }
  const decide = f => `select cortex_private.decide_reception_delegation('${f.id}',1,'approve','${f.operation}')`;
  const save = (f, active = true) => `select public.update_reception_staff('${f.staff}','{}',${active})`;
  const saved = (f, iso = 'read committed', active = true) => `begin isolation level ${iso};${claims(manager)}set local role authenticated;${save(f, active)};commit;`;
  const approve = f => sql(`begin;${claims(doctor)}${decide(f)};commit;`);
  const conflict = (r, expected) => { assert.notEqual(r.status, 0); assert.match(r.stderr, expected); };
  const busy = /40001: Custody changed concurrently; retry the transaction/;
  const staleArray = /40001: Approved delegation requires explicit withdrawal/;
  const snapshot = /40001: could not serialize access due to concurrent update/;
  const approved = f => {
    assert.equal(sql(`select state||':'||revision from cortex_private.reception_delegation_requests where id='${f.id}'`), 'approved:2');
    assert.equal(sql(`select delegation_request_id from public.staff_doctor_scopes where clinic_id='${clinic}' and staff_user_id='${f.staff}' and doctor_user_id='${doctor}'`), f.id);
  };
  const ended = f => {
    assert.equal(sql(`select state||':'||revision from cortex_private.reception_delegation_requests where id='${f.id}'`), 'revoked:3');
    assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${f.staff}'`), '0');
  };
  const passed = label => { checks.push(label); process.stdout.write('Passed array race: ' + label + '\n'); };
  async function observe(holder, waiter) {
    for (let n = 0; n < 30; n++) {
      if (sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${holder.name}'
       where w.application_name='${waiter.name}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)))`) === 't') return;
      await new Promise(done => setTimeout(done, 30));
    }
    throw new Error('Array lifecycle race did not reach actual row blocking');
  }
  for (const iso of ['read committed', 'repeatable read']) {
    const f = fixture(), holder = session();
    try {
      holder.send(`begin isolation level ${iso};${claims(doctor)}${decide(f)};select 'REQUEST_HELD';`); await holder.held();
      conflict(result(saved(f, iso)), busy); required(await holder.end('commit;')); approved(f);
      conflict(result(saved(f)), staleArray); approved(f);
      passed(`${iso}: held NULL-to-bound approval refuses inverse array and stale retry preserves exact approval`);
    } finally { await holder.end('rollback;'); }

    const g = fixture(), array = session();
    try {
      array.send(`begin isolation level ${iso};${claims(manager)}set local role authenticated;${save(g)};select 'REQUEST_HELD';`); await array.held();
      conflict(result(`begin isolation level ${iso};${claims(doctor)}${decide(g)};commit;`), busy);
      required(await array.end('commit;'));
      assert.equal(sql(`select state||':'||revision from cortex_private.reception_delegation_requests where id='${g.id}'`), 'pending:1');
      assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${g.staff}'`), '0');
      approve(g); approved(g); conflict(result(saved(g)), staleArray); approved(g);
      passed(`${iso}: array held first removes only unreviewed legacy grant; failed approval retries once and cannot then be removed by that array`);
    } finally { await array.end('rollback;'); }

    const h = fixture(), grantor = session();
    try {
      grantor.send(`begin isolation level ${iso};${claims(doctor)}${decide(h)};select 'REQUEST_HELD';`); await grantor.held();
      conflict(result(saved(h, iso, false)), busy); required(await grantor.end('commit;')); approved(h);
      required(result(saved(h, 'read committed', false))); ended(h);
      passed(`${iso}: approval versus explicit deactivation retains NOWAIT refusal; authorized retry ends consent`);
    } finally { await grantor.end('rollback;'); }

    const k = fixture(); approve(k);
    const deactivator = session(), saver = session();
    try {
      deactivator.send(`begin isolation level ${iso};${claims(admin)}set local role authenticated;${save(k, false)};select 'REQUEST_HELD';`); await deactivator.held();
      const pending = saver.end(`begin isolation level ${iso};${claims(manager)}set local role authenticated;${save(k)};commit;`); pending.catch(() => {});
      await observe(deactivator, saver); required(await deactivator.end('commit;'));
      const r = await pending;
      if (iso === 'read committed') required(r);
      else conflict(r, snapshot);
      ended(k);
      // The transitional API may reactivate the flag with an empty array, but
      // this is not consent and must never restore the closed scope/request.
      required(result(saved(k))); ended(k);
      passed(`${iso}: different-manager active array truly waits for deactivation; flag reactivation cannot revive approval`);
    } finally { await deactivator.end('rollback;'); await saver.end('rollback;'); }
  }
  // A different manager is essential: approval touches the request creator's
  // account too. This transaction must fail on the staff fence, not that actor.
  const f = fixture(), old = session();
  try {
    old.send(`begin isolation level repeatable read;select count(*) from public.staff_doctor_scopes where staff_user_id='${f.staff}';select 'REQUEST_HELD';`); await old.held();
    approve(f);
    const r = await old.end(`${claims(manager)}set local role authenticated;${save(f)};commit;`);
    conflict(r, snapshot); assert.match(r.stderr, /touch_custody_epoch/); approved(f);
    passed('repeatable read: a pre-approval snapshot from a different manager cannot remove newly bound consent');
  } finally { await old.end('rollback;'); }
  return checks;
}
