import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Counterexample for the simple pending + live-session comparison fixture.
// Native Auth requests run unchanged. No completion endpoint is implemented.
export async function exerciseInitialSetupVerify({ auth, rest, adminJwt, version, call, sql, asyncHttp, pause, syntheticSecrets, holderSession }) {
  const checks = [];
  const password = randomBytes(24).toString('hex');
  syntheticSecrets.push(password);
  const email = 'setup-verify-race@example.invalid';
  const created = await call(auth, '/admin/users', adminJwt, { email, email_confirm: true });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  sql(`insert into password_lab.setup_state(user_id) values('${id}');
    insert into public.lab_guarded values('${id}','Synthetic verification row');
    insert into public.lab_owner_only values('${id}','Synthetic verification control');
    create table password_lab.verify_checkpoint(user_id uuid primary key,after_password_commit timestamptz not null);`);
  const generate = async () => {
    const response = await call(auth, '/admin/generate_link', adminJwt, { type: 'recovery', email });
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.hashed_token, 'string');
    syntheticSecrets.push(response.body.hashed_token, response.body.action_link);
    return response.body.hashed_token;
  };
  const verify = hash => call(auth, '/verify', adminJwt, { type: 'recovery', token_hash: hash });
  const count = async (session, table = 'lab_guarded') => {
    const response = await call(rest, `/${table}?select=payload`, session.body.access_token);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    return response.body.length;
  };
  const claims = session => {
    const value = JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url'));
    assert.equal(value.sub, id);
    assert.match(value.session_id, /^[0-9a-f-]{36}$/);
    assert.ok(value.exp > Math.floor(Date.now() / 1000) + 60, 'JWT must still be unexpired during denial checks');
    return value;
  };
  const initial = await verify(await generate());
  assert.equal(initial.status, 200);
  claims(initial);
  assert.equal(await count(initial, 'lab_owner_only'), 1);
  assert.equal(await count(initial), 0);
  const hash = await generate();
  // BEFORE STATEMENT stops Recover's UPDATE before its user-row lock. The
  // transaction-only second advisory key makes the concurrent Admin skip it.
  const key = 864250;
  sql(`create function password_lab.pause_recovery_statement() returns trigger language plpgsql as $$ begin
      if pg_try_advisory_xact_lock(${key + 1}) then perform pg_advisory_xact_lock(${key});end if;return null;end $$;
    create trigger lab_pause_recovery_statement before update of recovery_token on auth.users for each statement execute function password_lab.pause_recovery_statement();`);
  const gate = holderSession();
  let output = '';
  gate.stdout.on('data', data => { output = (output + data).slice(-100); });
  gate.stdin.write(`select pg_advisory_lock(${key});select 'VERIFY_HELD';\n`);
  let pending;
  let personal;
  let late;
  const waiting = () => Number(sql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid
    where l.locktype='advisory' and l.classid=0 and l.objid=${key} and not l.granted and a.usename='supabase_auth_admin';`));
  try {
    for (let n = 0; n < 30 && !output.includes('VERIFY_HELD'); n++) await pause();
    assert.ok(output.includes('VERIFY_HELD'), 'Owned recovery barrier was not acquired');
    pending = asyncHttp({ url: auth + '/verify', method: 'POST', timeout: 18000,
      headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', token_hash: hash }) });
    for (let n = 0; n < 30 && waiting() !== 1; n++) await pause();
    assert.equal(waiting(), 1, 'Native verification did not reach the observed pre-write barrier');
    checks.push('native recovery verification is observed waiting before its user-row update');
    const rotated = await call(auth, '/admin/users/' + id, adminJwt, { password }, 'PUT');
    assert.equal(rotated.status, 200);
    assert.equal(waiting(), 1, 'Verification must remain blocked after the native password commit');
    assert.equal(sql(`select count(*) from auth.sessions where user_id='${id}';`), '0');
    sql(`insert into password_lab.verify_checkpoint values('${id}',clock_timestamp());`);
    const sequential = await verify(hash);
    assert.equal(sequential.status, 403);
    assert.equal(sequential.body.error_code, 'otp_expired');
    claims(initial);
    assert.equal(await count(initial, 'lab_owner_only'), 1);
    assert.equal(await count(initial), 0);
    checks.push('native password commit revokes prior stored sessions and sequential link replay while verification remains in flight');
    personal = await call(auth, '/token?grant_type=password', adminJwt, { email, password });
    assert.equal(personal.status, 200);
    claims(personal);
    assert.equal(await count(personal), 0);
    // Owner fixture only: deliberately expose the insufficiency of this gate.
    sql(`update password_lab.setup_state set pending=false where user_id='${id}';`);
    assert.equal(await count(personal), 1);
    assert.equal(await count(initial), 0);
    checks.push('owner-only completion fixture admits personal login but rejects the revoked unexpired initial JWT');
    gate.stdin.end(`select pg_advisory_unlock(${key});\n`);
    late = await pending;
  } finally {
    if (!gate.stdin.writableEnded) gate.stdin.end(`select pg_advisory_unlock(${key});\n`);
    if (pending) await pending;
    sql('drop trigger lab_pause_recovery_statement on auth.users;drop function password_lab.pause_recovery_statement();');
  }
  assert.equal(late.status, 200, 'Expected a native late-session counterexample');
  const lateClaims = claims(late);
  const methods = lateClaims.amr.map(entry => entry.method);
  assert.ok(methods.includes('otp'));
  assert.equal(sql(`select exists(select 1 from auth.sessions s join password_lab.verify_checkpoint c on c.user_id=s.user_id
    where s.id='${lateClaims.session_id}' and s.user_id='${id}' and s.created_at>=c.after_password_commit);`), 't');
  assert.equal(await count(late, 'lab_owner_only'), 1);
  assert.equal(await count(late), 1);
  const refreshed = await call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: late.body.refresh_token });
  assert.equal(refreshed.status, 200);
  claims(refreshed);
  assert.equal(await count(refreshed), 1);
  assert.equal(await count(personal), 1);
  checks.push('late OTP session and native refresh pass the simple completed/live-session gate despite being issued from the pre-password recovery capability');
  return { syntheticOnly: true, labOnly: true, authVersion: version, checks,
    observed: { lateVerifyStatus: late.status, lateAmrMethods: methods, lateSessionCreatedAfterPasswordCommit: true,
      lateReadRows: 1, lateRefreshStatus: refreshed.status, lateRefreshReadRows: 1, revokedInitialReadRows: 0, personalReadRows: 1 },
    candidateRejected: 'private pending=false plus live session, even with session creation cutoff',
    prototypeIsProductionFix: false, completionProtocolImplemented: false,
    notCovered: ['reserved password CAS composition', 'trusted session-purpose/generation completion fence', 'PKCE exchange in flight', 'MFA and recovery policy', 'existing accounts and app integration', 'hosted configuration'] };
}
