import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Invoked only by the endpoint-pinned runner owning the synthetic database.
export async function testDelegationDecisionConcurrency({ sql, result, session, required, scopeObservationDelayMs = 0, scopeLockTimeoutMs = 12000, onlyScopeObservation = false }) {
  assert.ok(Number.isInteger(scopeObservationDelayMs) && scopeObservationDelayMs >= 0 && scopeObservationDelayMs <= 5000);
  assert.ok(Number.isInteger(scopeLockTimeoutMs) && scopeLockTimeoutMs >= 1000 && scopeLockTimeoutMs <= 15000);
  const checks = [], admin = randomUUID(), doctor = randomUUID(), clinic = randomUUID();
  const claims = actor => `set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
  sql(`insert into auth.users(id,email) values('${admin}','${admin}@example.invalid'),('${doctor}','${doctor}@example.invalid');
   insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic decision races','${admin}');
   insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${admin}','admin','active'),('${clinic}','${doctor}','doctor','active');`);
  function fixture() {
    const staff = randomUUID();
    sql(`insert into auth.users(id,email) values('${staff}','${staff}@example.invalid');
     insert into public.clinic_staff_members(user_id,clinic_id,name) values('${staff}','${clinic}','Synthetic decision race staff');`);
    const request = JSON.parse(sql(`begin;${claims(admin)}select cortex_private.request_reception_delegation('${clinic}','${staff}','${doctor}','${randomUUID()}');commit;`));
    return { staff, id: request.id };
  }
  const decide = (f, decision = 'approve', operation = randomUUID()) => `select cortex_private.decide_reception_delegation('${f.id}',1,'${decision}','${operation}')`;
  const revoke = f => `select cortex_private.revoke_reception_delegation('${f.id}',2,'${randomUUID()}')`;
  const approve = f => sql(`begin;${claims(doctor)}${decide(f)};commit;`);
  const inactive = (f, kind) => kind === 'staff'
    ? `update public.clinic_staff_members set active=false where user_id='${f.staff}'`
    : `update public.clinic_members set status='inactive' where clinic_id='${clinic}' and user_id='${doctor}'`;
  const activate = (f, kind) => sql(kind === 'staff'
    ? `update public.clinic_staff_members set active=true where user_id='${f.staff}'`
    : `update public.clinic_members set status='active' where clinic_id='${clinic}' and user_id='${doctor}'`);
  const removed = f => {
    assert.equal(sql(`select count(*) from public.staff_doctor_scopes where delegation_request_id='${f.id}'`), '0');
    assert.equal(sql(`select state from cortex_private.reception_delegation_requests where id='${f.id}'`), 'revoked');
  };
  const snapshotConflict = /40001: could not serialize access due to concurrent update/;
  const changed = /40001: Delegation changed/;
  const custodyBusy = /40001: Custody changed concurrently; retry the transaction/;
  function conflicted(r, expected) { assert.notEqual(r.status, 0); assert.match(r.stderr, expected); }
  function passed(label) { checks.push(label); process.stdout.write('Passed decision race: ' + label + '\n'); }
  async function ready(waiter, timeout = 12000) {
    waiter.send(`set statement_timeout='15s';set lock_timeout='${timeout}ms';select 'REQUEST_HELD';`);
    await waiter.held();
  }
  async function observe(holder, waiter, pending) {
    let outcome;
    pending?.then(r => { outcome = r; }, () => {});
    for (let n = 0; n < 30; n++) {
      if (sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${holder.name}'
       where w.application_name='${waiter.name}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)))`) === 't') return;
      if (outcome) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const error = new Error('Decision race did not reach actual blocking edge');
    error.sqlstates = [...(outcome?.stderr ?? '').matchAll(/ERROR:\s+([0-9A-Z]{5}):/g)].map(m => m[1]);
    error.waiterStatus = outcome?.status ?? null;
    throw error;
  }
  for (const iso of ['read committed', 'repeatable read']) {
    if (!onlyScopeObservation) {
    for (const kind of ['staff', 'doctor']) {
      const f = fixture(), holder = session(), waiter = session();
      try {
        holder.send(`begin isolation level ${iso};${inactive(f, kind)};select 'REQUEST_HELD';`); await holder.held();
        if (kind === 'doctor') {
          conflicted(result(`begin isolation level ${iso};${claims(doctor)}${decide(f)};commit;`), /40001: Delegation authority changed concurrently; retry the transaction/);
          required(await holder.end('commit;'));
        } else {
          await ready(waiter);
          const pending = waiter.end(`begin isolation level ${iso};${claims(doctor)}${decide(f)};commit;`); pending.catch(() => {});
          await observe(holder, waiter, pending); required(await holder.end('commit;'));
          const r = await pending;
          if (iso === 'read committed') {
            assert.notEqual(r.status, 0); assert.match(r.stderr, /42501: Delegation member unavailable/);
          } else conflicted(r, snapshotConflict);
        }
        assert.equal(sql(`select state from cortex_private.reception_delegation_requests where id='${f.id}'`), 'cancelled');
        assert.equal(sql(`select count(*) from public.staff_doctor_scopes where delegation_request_id='${f.id}'`), '0');
        activate(f, kind);
        conflicted(result(`begin;${claims(doctor)}${decide(f)};commit;`), changed);
        passed(`${iso}: ${kind} inactivity held first prevents approval and rejoin cannot restore request`);
      } finally { await holder.end('rollback;'); await waiter.end('rollback;'); }

      const g = fixture(), grantor = session(), leaver = session();
      try {
        grantor.send(`begin isolation level ${iso};${claims(doctor)}${decide(g)};select 'REQUEST_HELD';`); await grantor.held();
        if (kind === 'staff') {
          conflicted(result(`begin isolation level ${iso};${inactive(g, kind)};commit;`), custodyBusy);
          required(await grantor.end('commit;')); sql(inactive(g, kind));
        } else {
          await ready(leaver);
          const pending = leaver.end(`begin isolation level ${iso};${inactive(g, kind)};commit;`); pending.catch(() => {});
          await observe(grantor, leaver, pending); required(await grantor.end('commit;'));
          const r = await pending;
          if (r.status !== 0) { assert.equal(iso, 'repeatable read'); conflicted(r, snapshotConflict); sql(inactive(g, kind)); }
        }
        removed(g); activate(g, kind); removed(g);
        passed(`${iso}: approval held first serializes ${kind} lifecycle and ends effective grant once`);
      } finally { await grantor.end('rollback;'); await leaver.end('rollback;'); }
    }
    // Two conflicting physician decisions contend on the actual request row.
    const f = fixture(), winner = session(), loser = session();
    try {
      winner.send(`begin isolation level ${iso};${claims(doctor)}${decide(f)};select 'REQUEST_HELD';`); await winner.held();
      await ready(loser);
      const pending = loser.end(`begin isolation level ${iso};${claims(doctor)}${decide(f, 'deny')};commit;`); pending.catch(() => {});
      await observe(winner, loser, pending); required(await winner.end('commit;')); conflicted(await pending, iso === 'read committed' ? changed : snapshotConflict);
      assert.equal(sql(`select count(*) from public.staff_doctor_scopes where delegation_request_id='${f.id}'`), '1');
      passed(`${iso}: two decisions yield one approval, no contradictory terminal decision`);
    } finally { await winner.end('rollback;'); await loser.end('rollback;'); }
    }
    // Lock scope BEFORE request: an inverse request -> epoch -> scope writer
    // must not deadlock. Its NOWAIT account fence aborts the deletion.
    const g = fixture(); approve(g);
    const scopeHolder = session(), requestWriter = session();
    try {
      scopeHolder.send(`begin isolation level ${iso};select 1 from public.staff_doctor_scopes where delegation_request_id='${g.id}' for update;select 'REQUEST_HELD';`); await scopeHolder.held();
      await ready(requestWriter, scopeLockTimeoutMs);
      const pending = requestWriter.end(`begin isolation level ${iso};${claims(doctor)}${revoke(g)};commit;`); pending.catch(() => {});
      if (scopeObservationDelayMs) await new Promise(resolve => setTimeout(resolve, scopeObservationDelayMs));
      await observe(scopeHolder, requestWriter, pending);
      const deletion = await scopeHolder.end(`delete from public.staff_doctor_scopes where delegation_request_id='${g.id}';commit;`);
      conflicted(deletion, custodyBusy); required(await pending); removed(g);
      passed(`${iso}: scope-row-first DELETE versus request-first revocation refuses inverse account lock without deadlock`);
    } finally {
      await scopeHolder.end('rollback;'); await requestWriter.end('rollback;');
      if (onlyScopeObservation && sql(`select state from cortex_private.reception_delegation_requests where id='${g.id}'`) === 'approved') {
        sql(`begin;${claims(doctor)}${revoke(g)};commit;`);
        removed(g);
      }
    }
    if (onlyScopeObservation) continue;
    // A stale snapshot cannot insert a legacy NULL grant after denial.
    const h = fixture(), stale = session();
    try {
      stale.send(`begin isolation level ${iso};select count(*) from cortex_private.reception_delegation_requests;select 'REQUEST_HELD';`); await stale.held();
      sql(`begin;${claims(doctor)}${decide(h, 'deny')};commit;`);
      const r = await stale.end(`insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('${clinic}','${h.staff}','${doctor}');commit;`);
      if (iso === 'read committed') { assert.notEqual(r.status, 0); assert.match(r.stderr, /42501: Delegation physician approval required/); }
      else conflicted(r, snapshotConflict);
      assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${h.staff}'`), '0');
      passed(`${iso}: snapshot cannot bypass physician denial through legacy NULL grant`);
    } finally { await stale.end('rollback;'); }
  }
  assert.equal(checks.length, onlyScopeObservation ? 2 : 14);
  return checks;
}
