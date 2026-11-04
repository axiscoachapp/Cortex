import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Only called by the owning, endpoint-pinned disposable DB runner.
export async function testDelegationRequestConcurrency({ sql, result, session, required }) {
  const checks = [], admin = randomUUID(), doctor = randomUUID(), clinic = randomUUID();
  sql(`insert into auth.users(id,email) values('${admin}','${admin}@example.invalid'),('${doctor}','${doctor}@example.invalid');
    insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic request races','${admin}');
    insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${admin}','admin','active'),('${clinic}','${doctor}','doctor','active');`);
  const claims = a => `set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${a}';`;
  const staff = () => {
    const id = randomUUID();
    sql(`insert into auth.users(id,email) values('${id}','${id}@example.invalid');
      insert into public.clinic_staff_members(user_id,clinic_id,name) values('${id}','${clinic}','Synthetic request race staff');`);
    return id;
  };
  const request = (s, op = randomUUID()) => `select cortex_private.request_reception_delegation('${clinic}','${s}','${doctor}','${op}')`;
  const create = s => JSON.parse(sql(`begin;${claims(admin)}${request(s)};commit;`));
  const deactivate = (s, kind) => kind === 'staff'
    ? `update public.clinic_staff_members set active=false where user_id='${s}'`
    : `update public.clinic_members set status='inactive' where clinic_id='${clinic}' and user_id='${doctor}'`;
  const activate = (s, kind) => sql(kind === 'staff'
    ? `update public.clinic_staff_members set active=true where user_id='${s}'`
    : `update public.clinic_members set status='active' where clinic_id='${clinic}' and user_id='${doctor}'`);
  const closed = id => assert.equal(sql(`select state||':'||revision from cortex_private.reception_delegation_requests where id='${id}'`), 'cancelled:2');
  const busy = source => {
    const r = result(source); assert.notEqual(r.status, 0); assert.match(r.stderr, /40001: Custody changed concurrently/);
  };
  const observe = async (h, w) => {
    for (let n = 0; n < 25; n++) {
      if (sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${h.name}'
       where w.application_name='${w.name}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't') return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Request cancellation did not wait for lifecycle row');
  };
  for (const iso of ['read committed', 'repeatable read']) for (const kind of ['staff', 'doctor']) {
    const s = staff(), holder = session();
    try {
      holder.send(`begin isolation level ${iso};${deactivate(s, kind)};select 'REQUEST_HELD';`); await holder.held();
      busy(`begin isolation level ${iso};${claims(admin)}${request(s)};commit;`);
      required(await holder.end('commit;'));
      assert.equal(sql(`select count(*) from cortex_private.reception_delegation_requests where staff_user_id='${s}'`), '0');
      activate(s, kind); const next = create(s); assert.equal(next.state, 'pending');
      checks.push(iso + ': ' + kind + ' inactivity held first refuses a new request without a latent row');
    } finally { await holder.end('rollback;'); }
    const s2 = staff(), writer = session(), op = randomUUID();
    try {
      writer.send(`begin isolation level ${iso};${claims(admin)}${request(s2, op)};select 'REQUEST_HELD';`); await writer.held();
      busy('begin;' + deactivate(s2, kind) + ';commit;'); required(await writer.end('commit;'));
      const id = sql(`select id from cortex_private.reception_delegation_requests where staff_user_id='${s2}' and state='pending'`);
      sql(deactivate(s2, kind)); closed(id); activate(s2, kind);
      const retry = result(`begin;${claims(admin)}${request(s2, op)};commit;`);
      assert.notEqual(retry.status, 0); assert.match(retry.stderr, /40001: Delegation changed/);
      const next = create(s2); assert.notEqual(next.id, id);
      checks.push(iso + ': held request refuses inverse ' + kind + ' lifecycle; retry closes once and old operation cannot reopen it');
    } finally { await writer.end('rollback;'); }
  }
  for (const iso of ['read committed', 'repeatable read']) {
    const s = staff(), current = create(s), holder = session(), waiter = session();
    try {
      holder.send(`begin isolation level ${iso};${deactivate(s, 'staff')};select 'REQUEST_HELD';`); await holder.held();
      const attempt = waiter.end(`begin isolation level ${iso};${claims(admin)}select cortex_private.cancel_reception_delegation('${current.id}',1,'${randomUUID()}');commit;`);
      attempt.catch(() => {}); await observe(holder, waiter); required(await holder.end('commit;'));
      const r = await attempt; assert.notEqual(r.status, 0); assert.match(r.stderr, /40001:/); closed(current.id);
      checks.push(iso + ': cancellation truly waits for lifecycle and stale CAS cannot overwrite its terminal event');
    } finally { await holder.end('rollback;'); await waiter.end('rollback;'); }
    const s2 = staff(), current2 = create(s2), canceller = session();
    try {
      canceller.send(`begin isolation level ${iso};${claims(admin)}select cortex_private.cancel_reception_delegation('${current2.id}',1,'${randomUUID()}');select 'REQUEST_HELD';`); await canceller.held();
      busy('begin;' + deactivate(s2, 'staff') + ';commit;'); required(await canceller.end('commit;'));
      sql(deactivate(s2, 'staff')); closed(current2.id);
      assert.equal(sql(`select end_reason from cortex_private.reception_delegation_requests where id='${current2.id}'`), 'withdrawn');
      checks.push(iso + ': committed human cancellation remains unchanged after lifecycle retry');
    } finally { await canceller.end('rollback;'); }
  }
  for (const iso of ['read committed', 'repeatable read']) for (const removal of ['role', 'membership']) {
    const s = staff(), authority = randomUUID(), holder = session();
    sql(`insert into auth.users(id,email) values('${authority}','${authority}@example.invalid');
      insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${authority}','admin','active');`);
    try {
      const remove = removal === 'role'
        ? `update public.clinic_members set role='doctor' where clinic_id='${clinic}' and user_id='${authority}'`
        : `delete from public.clinic_members where clinic_id='${clinic}' and user_id='${authority}'`;
      holder.send(`begin isolation level ${iso};${remove};select 'REQUEST_HELD';`); await holder.held();
      const no = result(`begin isolation level ${iso};${claims(authority)}${request(s)};commit;`);
      assert.notEqual(no.status, 0); assert.match(no.stderr, /40001: Delegation authority changed concurrently/);
      required(await holder.end('commit;'));
      const denied = result(`begin;${claims(authority)}${request(s)};commit;`);
      assert.notEqual(denied.status, 0); assert.match(denied.stderr, /42501: Delegation administration unavailable/);
      assert.equal(sql(`select count(*) from cortex_private.reception_delegation_requests where staff_user_id='${s}'`), '0');
      checks.push(iso + ': administrator ' + removal + ' removal fences a concurrent request independently of inactivity');
    } finally { await holder.end('rollback;'); }
  }
  return checks;
}
