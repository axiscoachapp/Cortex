import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Native API comparison only; no production completion endpoint is simulated.
export async function exerciseSingleUseSetup({ auth, rest, adminJwt, version, call, sql, asyncHttp, pause, syntheticSecrets, holderSession }) {
  const checks = [];
  const invalidLink = response => {
    assert.equal(response.status, 403, 'Unexpected native invalid-link status');
    assert.equal(response.body.error_code, 'otp_expired', 'Unexpected native invalid-link error');
  };
  const password = randomBytes(24).toString('hex');
  syntheticSecrets.push(password);
  const email = 'link-lab@example.invalid';
  const created = await call(auth, '/admin/users', adminJwt, { email, email_confirm: true,
    app_metadata: { initial_password_required: true } });
  assert.equal(created.status, 200, 'Omitted-password synthetic provisioning failed');
  const id = created.body.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.ok(!('password' in created.body) && !('encrypted_password' in created.body));
  sql(`insert into password_lab.setup_state(user_id) values('${id}');
    insert into public.lab_guarded values('${id}','Synthetic link row');`);
  // Native Admin create generates an unknown random password when omitted;
  // this is not an empty-hash/passwordless account. Never read/copy the hash.
  assert.equal(sql(`select coalesce(encrypted_password,'')<>'' from auth.users where id='${id}'`), 't');
  const login = () => call(auth, '/token?grant_type=password', adminJwt, { email, password });
  const absentCredential = await login();
  assert.equal(absentCredential.status, 400);
  assert.equal(absentCredential.body.error_code, 'invalid_credentials');
  checks.push('Password omitted from Admin provision: native Auth stores its own random credential, never returned to this client; arbitrary password login denied');
  const generate = async () => {
    const result = await call(auth, '/admin/generate_link', adminJwt, { type: 'recovery', email });
    assert.equal(result.status, 200, 'Native recovery link generation failed');
    const hash = result.body.hashed_token;
    assert.equal(typeof hash, 'string'); assert.ok(hash.length > 20);
    syntheticSecrets.push(hash, result.body.action_link);
    return hash;
  };
  const verify = hash => call(auth, '/verify', adminJwt, { type: 'recovery', token_hash: hash });
  const count = async (session, table = 'lab_guarded') => {
    const result = await call(rest, '/' + table + '?select=payload', session.body.access_token);
    assert.equal(result.status, 200, 'Native Data API failed');
    assert.ok(Array.isArray(result.body)); return result.body.length;
  };
  const hash = await generate();
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${id}'`), '0');
  checks.push('generate_link returns a recovery capability without creating a session; no email delivery is possible on the owned internal network');

  // Force BOTH native requests to reach a database lock while the same token
  // is still valid. Do not rely on two Promise calls happening close together.
  const holder = holderSession();
  let output = '';
  const locked = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned link barrier not acquired')), 8000);
    holder.once('error', error => { clearTimeout(timer); reject(error); });
    holder.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('LINK_LOCKED')) { clearTimeout(timer); resolve(); }
    });
  });
  holder.stdin.write(`begin;select id from auth.users where id='${id}' for update;select 'LINK_LOCKED';\n`);
  await locked;
  const request = { url: auth + '/verify', method: 'POST', timeout: 18000,
    headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'recovery', token_hash: hash }) };
  const a = asyncHttp(request), b = asyncHttp(request);
  let waiters = 0;
  try {
    for (let attempt = 0; attempt < 18; attempt++) {
      waiters = Number(sql(`select count(*) from pg_stat_activity where usename='supabase_auth_admin' and wait_event_type='Lock'`));
      if (waiters >= 2) break;
      await pause();
    }
    assert.ok(waiters >= 2, 'Two native verify requests did not reach the held row');
  } finally { holder.stdin.end('commit;\n'); }
  const results = await Promise.all([a, b]);
  const statuses = results.map(r => r.status).sort();
  for (const result of results) if (result.status !== 200) invalidLink(result);
  const successful = results.filter(r => r.status === 200);
  assert.ok(successful.length >= 1, 'No native link verification succeeded');
  const sessionsAfterConcurrentVerify = Number(sql(`select count(*) from auth.sessions where user_id='${id}'`));
  assert.equal(sessionsAfterConcurrentVerify, successful.length);
  checks.push(`Two native verify requests observed waiting on the database: statuses ${statuses.join('/')}, ${sessionsAfterConcurrentVerify} live session(s)`);
  invalidLink(await verify(hash));
  for (const session of successful) assert.equal(await count(session), 0);
  checks.push('Sequential replay denied; every issued link session remains blocked by private pending state');

  const current = successful[0];
  assert.equal((await call(auth, '/user', current.body.access_token,
    { data: { must_change_password: false, initial_password_required: false } }, 'PUT')).status, 200);
  assert.equal(await count(current), 0);
  assert.equal(sql(`select pending from password_lab.setup_state where user_id='${id}'`), 't');
  checks.push('User-editable metadata does not clear the private pending state');

  const firstUnused = await generate(), secondUnused = await generate();
  // Native token generation may reuse a still-valid capability. Record exact
  // behavior rather than treating generation as revocation or delivery proof.
  const reusedUnconsumedToken = firstUnused === secondUnused;
  const updated = await call(auth, '/admin/users/' + id, adminJwt,
    { password, app_metadata: { setup_operation_id: 'synthetic-operation' } }, 'PUT');
  assert.equal(updated.status, 200, 'Native admin password update failed');
  const liveAfterPassword = Number(sql(`select count(*) from auth.sessions where user_id='${id}'`));
  assert.equal(liveAfterPassword, 0, 'Native admin password update retained setup sessions');
  for (const session of successful) {
    assert.equal(await count(session), 0);
    const refresh = await call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: session.body.refresh_token });
    assert.equal(refresh.status, 400, 'Unexpected revoked-refresh status');
    assert.ok(['refresh_token_not_found', 'session_not_found'].includes(refresh.body.error_code), 'Unexpected revoked-refresh error');
  }
  checks.push('Native admin password write revokes all issued setup sessions and their refresh tokens; private pending remains set');
  assert.equal(sql(`select pending from password_lab.setup_state where user_id='${id}'`), 't');
  const own = await login(); assert.equal(own.status, 200); assert.equal(await count(own), 0);
  checks.push('Personal-password login succeeds after Auth commit but data remains denied before application completion');
  const outstanding = await verify(secondUnused);
  const outstandingLinkSurvivedPasswordWrite = outstanding.status === 200;
  if (!outstandingLinkSurvivedPasswordWrite) invalidLink(outstanding);
  if (outstandingLinkSurvivedPasswordWrite) assert.equal(await count(outstanding), 0);
  checks.push(`Unused generated recovery link ${outstandingLinkSurvivedPasswordWrite ? 'SURVIVES' : 'is revoked by'} the native admin password write`);

  // Test-owner-only state change isolates the live-session guard; this is NOT
  // trusted completion, not exposed as an RPC and not evidence of atomicity.
  sql(`update password_lab.setup_state set pending=false where user_id='${id}'`);
  assert.equal(await count(own), 1);
  for (const session of successful) {
    const claims = JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url'));
    assert.ok(claims.exp > Math.floor(Date.now() / 1000) + 60, 'Old JWT expired before the live-session denial check');
    assert.equal(await count(session), 0);
  }
  const outstandingCanReadAfterFixtureCompletion = outstandingLinkSurvivedPasswordWrite && (await count(outstanding)) === 1;
  checks.push('After test-owner fixture completion a live personal session reads data; previously revoked JWTs remain denied while unexpired');
  return { syntheticOnly: true, labOnly: true, authVersion: version, checks,
    observed: { concurrentVerifyStatuses: statuses, sessionsAfterConcurrentVerify,
      reusedUnconsumedToken, outstandingLinkSurvivedPasswordWrite, outstandingCanReadAfterFixtureCompletion },
    prototypeIsProductionFix: false, completionProtocolImplemented: false,
    notCovered: ['serialized/CAS trusted completion', 'lost admin response reconciliation', 'in-flight unused link verification during rotation',
      'MFA and PKCE setup integration', 'existing accounts and privileged reset policy', 'application RLS/RPC/storage/Edge/frontend integration', 'hosted Auth version/configuration'] };
}
