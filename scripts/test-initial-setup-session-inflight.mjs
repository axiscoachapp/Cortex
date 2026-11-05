import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// Extends the frozen basic composition. The observer pauses a specific failed
// invariant at commit; an arbitrary native 500 is not accepted as evidence.
export async function exerciseInitialSetupSessionInflight(context) {
  const { auth, rest, adminJwt, call, sql, asyncHttp, pause, syntheticSecrets, holderSession, exerciseBase } = context;
  const base = await exerciseBase(context);
  const checks = [...base.checks];
  const password = randomBytes(24).toString('hex'), losingPassword = randomBytes(24).toString('hex');
  syntheticSecrets.push(password, losingPassword);
  const email = 'setup-composed-inflight@example.invalid';
  const created = await call(auth, '/admin/users', adminJwt, { email, email_confirm: true });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  sql(`insert into password_lab.setup_operations(user_id) values('${id}');
    insert into public.lab_guarded values('${id}','Synthetic composed inflight row');
    insert into public.lab_owner_only values('${id}','Synthetic composed inflight control');`);
  const state = () => JSON.parse(sql(`select row_to_json(s) from password_lab.setup_operations s where user_id='${id}';`));
  const claims = session => {
    assert.equal(session.status, 200);
    const value = JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url'));
    assert.equal(value.sub, id);
    assert.match(value.session_id, /^[0-9a-f-]{36}$/);
    assert.ok(value.exp > Math.floor(Date.now() / 1000) + 60);
    return value;
  };
  const read = async session => {
    claims(session);
    const result = await call(rest, '/lab_guarded?select=payload', session.body.access_token);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body));
    return result.body.length;
  };
  const generate = async () => {
    const link = await call(auth, '/admin/generate_link', adminJwt, { type: 'recovery', email });
    assert.equal(link.status, 200);
    syntheticSecrets.push(link.body.hashed_token, link.body.action_link);
    return link.body.hashed_token;
  };
  const verify = hash => call(auth, '/verify', adminJwt, { type: 'recovery', token_hash: hash });
  const initial = await verify(await generate());
  assert.equal(claims(initial).cortex_setup_purpose, 'repair');
  const operation = randomUUID();
  const ticket = JSON.parse(sql(`select password_lab.begin_setup('${id}','${claims(initial).session_id}','${operation}',0);`));
  assert.equal(ticket.mutation_allowed, true);
  const hash = await generate();
  const verifyKey = 864270, rejectKey = 864280;
  sql(`create function password_lab.pause_composed_recovery() returns trigger language plpgsql as $$ begin
    if pg_try_advisory_xact_lock(${verifyKey + 1}) then perform pg_advisory_xact_lock(${verifyKey});end if;return null;end $$;
    create trigger lab_pause_composed_recovery before update of recovery_token on auth.users for each statement execute function password_lab.pause_composed_recovery();
    create function password_lab.observe_stale_setup_metadata() returns trigger language plpgsql security definer set search_path='' as $$
    declare state password_lab.setup_operations;begin
      if new.id='${id}' then
        select * into state from password_lab.setup_operations where user_id=new.id;
        if state.phase='password_set' and state.password_write_xid is distinct from pg_current_xact_id()
          and (new.raw_app_meta_data->>'setup_operation_id' is distinct from state.operation_id::text
            or new.raw_app_meta_data->>'setup_reservation_revision' is distinct from state.reservation_revision::text) then
          perform pg_advisory_xact_lock(${rejectKey});
        end if;
      end if;return null;end $$;
    create constraint trigger aa_lab_observe_stale_setup_metadata after update on auth.users deferrable initially deferred for each row
      when(new.raw_app_meta_data->'setup_operation_id' is distinct from old.raw_app_meta_data->'setup_operation_id'
       or new.raw_app_meta_data->'setup_reservation_revision' is distinct from old.raw_app_meta_data->'setup_reservation_revision')
      execute function password_lab.observe_stale_setup_metadata();`);
  const gates = [];
  const hold = async (key, marker) => {
    const gate = holderSession(); gates.push({ gate, key });
    let output = '';
    gate.stdout.on('data', data => { output = (output + data).slice(-100); });
    gate.stdin.write(`select pg_advisory_lock(${key});select '${marker}';\n`);
    for (let n = 0; n < 30 && !output.includes(marker); n++) await pause();
    assert.ok(output.includes(marker), 'Owned composed barrier was not acquired');
    return gate;
  };
  const waiting = key => Number(sql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.locktype='advisory'
    and l.classid=0 and l.objid=${key} and not l.granted and a.usename='supabase_auth_admin';`));
  let pending, late, personal, authorized;
  try {
    const gate = await hold(verifyKey, 'COMPOSED_VERIFY_HELD');
    const rejectionGate = await hold(rejectKey, 'COMPOSED_REJECT_HELD');
    pending = asyncHttp({ url: auth + '/verify', method: 'POST', timeout: 18000,
      headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', token_hash: hash }) });
    for (let n = 0; n < 30 && waiting(verifyKey) !== 1; n++) await pause();
    assert.equal(waiting(verifyKey), 1);
    const written = await call(auth, '/admin/users/' + id, adminJwt, { password,
      app_metadata: { setup_operation_id: operation, setup_reservation_revision: ticket.reservation_revision } }, 'PUT');
    assert.equal(written.status, 200);
    assert.equal(waiting(verifyKey), 1);
    assert.equal(sql(`select count(*) from auth.sessions where user_id='${id}';`), '0');
    const sequential = await verify(hash);
    assert.equal(sequential.status, 403);
    assert.equal(sequential.body.error_code, 'otp_expired');
    personal = await call(auth, '/token?grant_type=password', adminJwt, { email, password });
    assert.equal(await read(personal), 0);
    const complete = JSON.parse(sql(`select password_lab.complete_reserved_setup('${id}','${claims(personal).session_id}','${operation}',2);`));
    assert.deepEqual(complete, { revision: 3, mutation_allowed: true });
    assert.equal(await read(personal), 1);
    assert.equal(await read(initial), 0);
    authorized = state();
    assert.equal(authorized.authorized_generation, authorized.credential_generation);
    checks.push('observed in-flight verify stays paused through reserved password commit and private personal-session completion');
    gate.stdin.end(`select pg_advisory_unlock(${verifyKey});\n`);
    for (let n = 0; n < 30 && waiting(rejectKey) !== 1; n++) await pause();
    assert.equal(waiting(rejectKey), 1, 'Expected stale metadata and non-password transaction at the observed deferred guard');
    rejectionGate.stdin.end(`select pg_advisory_unlock(${rejectKey});\n`);
    late = await pending;
  } finally {
    for (const { gate, key } of gates) if (!gate.stdin.writableEnded) gate.stdin.end(`select pg_advisory_unlock(${key});\n`);
    try { if (pending) await pending; }
    finally { sql(`drop trigger aa_lab_observe_stale_setup_metadata on auth.users;drop function password_lab.observe_stale_setup_metadata();
      drop trigger lab_pause_composed_recovery on auth.users;drop function password_lab.pause_composed_recovery();`); }
  }
  assert.equal(late.status, 500);
  assert.equal(late.body.error_code, 'unexpected_failure');
  assert.deepEqual(state(), authorized);
  assert.equal(sql(`select raw_app_meta_data->>'setup_operation_id'='${operation}' and raw_app_meta_data->>'setup_reservation_revision'='1' from auth.users where id='${id}';`), 't');
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${id}';`), '1');
  assert.equal(sql(`select count(*) from password_lab.setup_session_bindings where user_id='${id}';`), '1');
  assert.equal(await read(personal), 1);
  checks.push('specific stale-marker/XID guard is observed; delayed native verify rolls back without a session, binding or authority change');
  const freshRepair = await verify(await generate());
  assert.equal(claims(freshRepair).cortex_setup_purpose, 'repair');
  assert.equal(await read(freshRepair), 0);
  const repairedRefresh = await call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: freshRepair.body.refresh_token });
  assert.equal(claims(repairedRefresh).cortex_setup_purpose, 'repair');
  assert.equal(await read(repairedRefresh), 0);
  assert.equal(await read(personal), 1);
  checks.push('a fresh native recovery remains usable as repair with denied data and denied refresh data after the delayed rollback');
  const wrongWorker = await call(auth, '/admin/users/' + id, adminJwt, { password: losingPassword,
    app_metadata: { setup_operation_id: randomUUID(), setup_reservation_revision: 1 } }, 'PUT');
  assert.equal(wrongWorker.status, 500);
  const wrongLogin = await call(auth, '/token?grant_type=password', adminJwt, { email, password: losingPassword });
  assert.equal(wrongLogin.status, 400);
  assert.equal(wrongLogin.body.error_code, 'invalid_credentials');
  const winner = await call(auth, '/token?grant_type=password', adminJwt, { email, password });
  assert.equal(await read(winner), 1);
  assert.deepEqual(state(), authorized);
  assert.equal(await read(personal), 1);
  checks.push('old/wrong-operation worker cannot overwrite the reserved password or reset completed generation; winning login still reads');
  return { ...base, checks, inFlightComposition: true, lateVerifyStatus: late.status,
    deferredStaleMarkerGuardObserved: true, latePersistedSessionCount: 0, freshRepairReadRows: 0,
    freshRepairRefreshReadRows: 0, personalReadRows: 1,
    notCovered: base.notCovered.filter(item => item !== 'in-flight verify/PKCE composition').concat(['PKCE exchange in flight', 'other in-flight native paths and metadata variants']) };
}
