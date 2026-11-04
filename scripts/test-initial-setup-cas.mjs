import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// Reservation/password-write proof only. No endpoint or data authorization.
export async function exerciseInitialSetupCas({ auth, rest, adminJwt, version, call, sql, asyncHttp, pause, syntheticSecrets, holderSession }) {
  const checks = [];
  const secret = () => { const value = randomBytes(24).toString('hex'); syntheticSecrets.push(value); return value; };
  const sid = session => {
    const value = JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url')).session_id;
    assert.match(value, /^[0-9a-f-]{36}$/); return value;
  };
  const state = user => JSON.parse(sql(`select row_to_json(s) from password_lab.setup_operations s where user_id='${user.id}'`));
  const begin = (user, session, op, revision) => ({ op, ...JSON.parse(sql(`set lock_timeout='0';set statement_timeout='2s';
    select password_lab.begin_setup('${user.id}','${sid(session)}','${op}',${revision});`)) });
  const metadata = ticket => ({ setup_operation_id: ticket.op, setup_reservation_revision: ticket.reservation_revision });
  const login = (user, password) => call(auth, '/token?grant_type=password', adminJwt, { email: user.email, password });
  const invalidPassword = async (user, password) => {
    const response = await login(user, password); assert.equal(response.status, 400); assert.equal(response.body.error_code, 'invalid_credentials');
  };
  const mutate = (user, ticket, password) => call(auth, '/admin/users/' + user.id, adminJwt, { password, app_metadata: metadata(ticket) }, 'PUT');
  const rollback = response => assert.equal(response.status, 500, 'Expected native DB rollback, not success or transport failure');
  const newUser = async label => {
    const email = 'setup-cas-' + label + '@example.invalid';
    const created = await call(auth, '/admin/users', adminJwt, { email, email_confirm: true, app_metadata: { initial_password_required: true } });
    assert.equal(created.status, 200); const id = created.body.id; assert.match(id, /^[0-9a-f-]{36}$/);
    sql(`insert into password_lab.setup_operations(user_id) values('${id}');
      insert into public.lab_guarded values('${id}','Synthetic setup row');insert into public.lab_owner_only values('${id}','Synthetic control');`);
    const link = await call(auth, '/admin/generate_link', adminJwt, { type: 'recovery', email });
    assert.equal(link.status, 200); syntheticSecrets.push(link.body.hashed_token, link.body.action_link);
    const session = await call(auth, '/verify', adminJwt, { type: 'recovery', token_hash: link.body.hashed_token });
    assert.equal(session.status, 200); return { id, email, session };
  };
  const readCount = async (table, session) => {
    const response = await call(rest, '/' + table + '?select=payload', session.body.access_token);
    assert.equal(response.status, 200); return response.body.length;
  };
  const user = await newUser('proof'), other = await newUser('other');
  assert.equal(await readCount('lab_owner_only', user.session), 1); assert.equal(await readCount('lab_guarded', user.session), 0);
  const unreserved = secret(); rollback(await call(auth, '/user', user.session.body.access_token, { password: unreserved }, 'PUT'));
  await invalidPassword(user, unreserved); assert.equal(state(user).phase, 'pending');
  assert.equal((await call(auth, '/user', user.session.body.access_token, { data: { must_change_password: false } }, 'PUT')).status, 200);
  assert.equal(state(user).phase, 'pending');
  assert.throws(() => begin(user, other.session, randomUUID(), 0), /42501: Setup requires an owned live session/);
  checks.push('unreserved native password writes and editable metadata do not confirm setup; an unrelated session cannot reserve it');

  const op = randomUUID(), ticket = begin(user, user.session, op, 0);
  assert.equal(ticket.mutation_allowed, true); assert.equal(ticket.reservation_revision, 1);
  assert.equal(begin(user, user.session, op, 0).mutation_allowed, false);
  assert.throws(() => begin(user, user.session, randomUUID(), 0), /40001: Setup revision changed/);
  rollback(await call(auth, '/admin/users/' + user.id, adminJwt, { app_metadata: metadata(ticket) }, 'PUT'));
  assert.equal(state(user).phase, 'applying'); assert.equal(state(user).password_write_xid, null);
  assert.equal(sql(`select (raw_app_meta_data->>'setup_operation_id') is null from auth.users where id='${user.id}'`), 't');
  const wrong = secret(); rollback(await mutate(user, { ...ticket, reservation_revision: 99 }, wrong));
  await invalidPassword(user, wrong); assert.equal(state(user).password_write_xid, null);
  assert.equal((await call(auth, '/user', user.session.body.access_token)).status, 200);
  checks.push('CAS retry cannot mutate twice; metadata-only and wrong reservation revision roll back without password, marker or session loss');

  sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sid(other.session)}';`);
  assert.throws(() => begin(other, other.session, randomUUID(), 0), /42501: Setup requires an owned live session/);
  sql(`update auth.sessions set not_after=null where id='${sid(other.session)}';`);
  const otherOp = randomUUID(), holder = holderSession(); let output = '';
  holder.stdout.on('data', data => { output = (output + data).slice(-500); });
  holder.stdin.write(`begin;select password_lab.begin_setup('${other.id}','${sid(other.session)}','${otherOp}',0);select 'RESERVATION_HELD';\n`);
  for (let n = 0; n < 30 && !output.includes('RESERVATION_HELD'); n++) await pause();
  assert.ok(output.includes('RESERVATION_HELD'), 'Reservation holder was not observed');
  try { assert.throws(() => begin(other, other.session, randomUUID(), 0), /40001: Setup changed concurrently/); }
  finally { holder.stdin.end('commit;\n'); }
  for (let n = 0; n < 30 && state(other).phase !== 'applying'; n++) await pause();
  assert.equal(state(other).phase, 'applying');
  checks.push('expired native session is refused and two observed reservations cannot claim the same state concurrently');

  const oldTicket = { op: otherOp, reservation_revision: 1 };
  begin(other, other.session, randomUUID(), 1);
  const reused = begin(other, other.session, otherOp, 2);
  assert.equal(reused.reservation_revision, 3);
  const stalePassword = secret(), reusedPassword = secret();
  rollback(await mutate(other, oldTicket, stalePassword)); await invalidPassword(other, stalePassword);
  assert.equal(state(other).phase, 'applying'); assert.equal(state(other).password_write_xid, null);
  assert.equal((await mutate(other, reused, reusedPassword)).status, 200);
  assert.equal((await login(other, reusedPassword)).status, 200);
  checks.push('A-to-B-to-A operation ID reuse cannot revive the old reservation revision or its password write');

  const weak = await mutate(user, ticket, 'short'); assert.equal(weak.status, 422); assert.equal(weak.body.error_code, 'weak_password');
  const failedPassword = secret();
  sql(`create function password_lab.fail_setup_metadata() returns trigger language plpgsql security definer set search_path='' as $$ begin
    if new.id='${user.id}' and new.raw_app_meta_data->>'setup_operation_id'='${op}' then
      if exists(select 1 from password_lab.setup_operations where user_id=new.id and password_write_xid=pg_current_xact_id()) then
        perform pg_advisory_xact_lock(864190);
      end if;
      raise exception 'Synthetic metadata fault';
    end if;return new;end $$;
    create trigger lab_fail_setup_metadata after update of raw_app_meta_data on auth.users for each row execute function password_lab.fail_setup_metadata();`);
  const faultGate = holderSession(); let faultOutput = '';
  faultGate.stdout.on('data', data => { faultOutput = (faultOutput + data).slice(-100); });
  faultGate.stdin.write("select pg_advisory_lock(864190);select 'FAULT_HELD';\n");
  for (let n = 0; n < 30 && !faultOutput.includes('FAULT_HELD'); n++) await pause();
  assert.ok(faultOutput.includes('FAULT_HELD'));
  const faultRequest = asyncHttp({ url: auth + '/admin/users/' + user.id, method: 'PUT', timeout: 18000,
    headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: failedPassword, app_metadata: metadata(ticket) }) });
  try {
    let written = false;
    for (let n = 0; n < 30; n++) {
      if (sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=864190 and not granted)") === 't') { written = true; break; }
      await pause();
    }
    assert.ok(written, 'Failure hook did not observe password write XID before the injected error');
    faultGate.stdin.end('select pg_advisory_unlock(864190);\n');
    rollback(await faultRequest);
  } finally {
    if (!faultGate.stdin.writableEnded) faultGate.stdin.end('select pg_advisory_unlock(864190);\n');
    await faultRequest;
    sql('drop trigger lab_fail_setup_metadata on auth.users;drop function password_lab.fail_setup_metadata();');
  }
  await invalidPassword(user, failedPassword); assert.equal(state(user).phase, 'applying'); assert.equal(state(user).password_write_xid, null);
  assert.equal((await call(auth, '/user', user.session.body.access_token)).status, 200);
  checks.push('weak password and failure after native password write roll back password, caller revocation and private confirmation');

  const chosen = secret();
  const lost = await asyncHttp({ url: auth + '/admin/users/' + user.id, method: 'PUT',
    headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: chosen, app_metadata: metadata(ticket) }) }, `
      import {readFileSync} from 'node:fs';const q=JSON.parse(readFileSync(0,'utf8'));
      const r=await fetch(q.url,{method:q.method,headers:q.headers,body:q.body});await r.arrayBuffer();
      console.log(JSON.stringify({status:0,nativeStatus:r.status,body:null}));
    `);
  assert.equal(lost.status, 0); assert.equal(lost.nativeStatus, 200); assert.equal(state(user).phase, 'password_set');
  const personal = await login(user, chosen); assert.equal(personal.status, 200);
  assert.throws(() => begin(user, user.session, op, 1), /42501: Setup requires an owned live session/);
  assert.equal(begin(user, personal, randomUUID(), 0).mutation_allowed, false);
  const replay = secret(); rollback(await mutate(user, ticket, replay)); await invalidPassword(user, replay);
  assert.equal((await login(user, chosen)).status, 200); assert.equal((await call(auth, '/user', personal.body.access_token)).status, 200);
  assert.equal(await readCount('lab_guarded', personal), 0); assert.equal(await readCount('lab_guarded', user.session), 0);
  checks.push('discarded response leaves durable password_set; fresh password login reconciles while old session and duplicate mutation are refused, without data authorization');
  const { exerciseSetupCasConcurrency } = await import('./test-setup-cas-concurrency.mjs');
  checks.push(...await exerciseSetupCasConcurrency({ auth, adminJwt, sql, asyncHttp, pause, syntheticSecrets, holderSession,
    newUser, begin, metadata, mutate, secret, rollback, state, login, invalidPassword }));
  return { syntheticOnly: true, labOnly: true, authVersion: version, checks, prototypeIsProductionFix: false,
    dataAuthorizationImplemented: false,
    notCovered: ['final setup authorization and session-generation fence', 'reversed metadata/password SQL ordering', 'late recovery/PKCE verification and exchange', 'MFA and forgotten-password recovery',
      'crypto maintenance between mutation and completion', 'existing accounts and privileged reset policy', 'app RLS/RPC/storage/Edge/frontend integration', 'hosted configuration/version'] };
}
