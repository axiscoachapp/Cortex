import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { exerciseBindingConcurrency } from './test-credential-binding-concurrency.mjs';

// Scenarios only; the parent harness owns all containers, isolation and cleanup.
export async function exerciseCredentialBinding({ auth, rest, adminJwt, version, call, sql, asyncHttp, restartAuth, pause, syntheticSecrets, holderSession }) {
  const checks = [];
  const newUser = async label => {
    const password = randomBytes(18).toString('hex'); syntheticSecrets.push(password);
    const email = label + '@example.invalid';
    const result = await call(auth, '/admin/users', adminJwt, { email, password, email_confirm: true,
      app_metadata: { initial_password_required: true, credential_epoch: randomUUID() } });
    assert.equal(result.status, 200, 'Synthetic account creation failed');
    const id = result.body.id; assert.match(id, /^[0-9a-f-]{36}$/);
    sql(`insert into public.lab_guarded values('${id}','Synthetic protected row');`);
    return { id, email, password };
  };
  const login = (user, password = user.password) => call(auth, '/token?grant_type=password', adminJwt, { email: user.email, password });
  const refresh = session => call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: session.body.refresh_token });
  const claim = session => JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url').toString());
  const count = async session => {
    const response = await call(rest, '/lab_guarded?select=payload', session.body.access_token);
    assert.equal(response.status, 200, 'Guarded Data API read failed'); return response.body.length;
  };
  const pending = id => sql(`select raw_app_meta_data->>'initial_password_required' from auth.users where id='${id}'`);
  const epoch = id => sql(`select raw_app_meta_data->>'credential_epoch' from auth.users where id='${id}'`);
  const user = await newUser('binding');
  const a = await login(user), b = await login(user); assert.equal(a.status, 200, 'Initial login: ' + a.body?.error_code); assert.equal(b.status, 200, 'Second login: ' + b.body?.error_code);
  const initialEpoch = epoch(user.id);
  assert.equal(claim(a).cortex_credential_epoch, initialEpoch);
  assert.equal(await count(a), 0); assert.equal(await count(b), 0);
  assert.equal((await call(auth, '/user', a.body.access_token, { data: { must_change_password: false, credential_epoch: randomUUID() } }, 'PUT')).status, 200);
  assert.equal(pending(user.id), 'true'); assert.equal(epoch(user.id), initialEpoch);
  const refreshedPending = await refresh(a); assert.equal(refreshedPending.status, 200); assert.equal(await count(refreshedPending), 0);
  checks.push('pending accounts and editable metadata cannot authorize a session; initial hook snapshots trusted epoch');

  const personal = randomBytes(18).toString('hex'); syntheticSecrets.push(personal);
  assert.equal((await call(auth, '/user', refreshedPending.body.access_token, { password: user.password }, 'PUT')).status, 422);
  assert.equal((await call(auth, '/user', refreshedPending.body.access_token, { password: personal }, 'PUT')).status, 200);
  const rotatedEpoch = epoch(user.id); assert.notEqual(rotatedEpoch, initialEpoch); assert.equal(pending(user.id), 'false');
  assert.equal(await count(a), 0); assert.equal(await count(b), 0);
  assert.ok((await refresh(refreshedPending)).status >= 400);
  assert.ok((await call(auth, '/user', a.body.access_token)).status >= 400);
  assert.ok((await refresh(b)).status >= 400);
  const fresh = await login(user, personal); assert.equal(fresh.status, 200);
  assert.equal(claim(fresh).cortex_credential_epoch, rotatedEpoch); assert.equal(await count(fresh), 1);
  checks.push('native password event advances canonical epoch and revokes every session; old JWT, refresh and Auth user operations are denied until new login');
  sql(`update auth.users set raw_app_meta_data=jsonb_build_object('credential_epoch','${initialEpoch}','initial_password_required',true) where id='${user.id}';`);
  assert.equal(epoch(user.id), rotatedEpoch); assert.equal(pending(user.id), 'false');
  checks.push('a stale native metadata snapshot cannot roll back canonical generation or pending state');

  // Confirm that re-encryption has no password-change event and no epoch effect.
  const encryptionUser = await newUser('binding-reencrypt');
  const beforeEncryption = epoch(encryptionUser.id);
  const encryptionKey = randomBytes(32).toString('base64url'); syntheticSecrets.push(encryptionKey);
  const encryptionEnv = { GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT: 'true', GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPTION_KEY_ID: 'labkey',
    GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPTION_KEY: encryptionKey, GOTRUE_SECURITY_DB_ENCRYPTION_DECRYPTION_KEYS: 'labkey:' + encryptionKey };
  await restartAuth(encryptionEnv);
  const encryptionLogin = await login(encryptionUser); assert.equal(encryptionLogin.status, 200);
  assert.equal(sql(`select encrypted_password not like '$2%' from auth.users where id='${encryptionUser.id}'`), 't');
  assert.equal(epoch(encryptionUser.id), beforeEncryption); assert.equal(pending(encryptionUser.id), 'true');
  const encryptionRefresh = await refresh(encryptionLogin); assert.equal(encryptionRefresh.status, 200); assert.equal(await count(encryptionRefresh), 0);
  checks.push('native hash re-encryption does not rotate credential epoch or clear pending state');

  // Native HTTP login is held after password validation and before token issue.
  const race = await newUser('binding-race');
  const raceA = await login(race); assert.equal(raceA.status, 200);
  const raceInitialEpoch = epoch(race.id);
  sql(`create function password_lab.pause_binding_login() returns trigger language plpgsql security definer set search_path='' as $$ begin
    if new.payload->>'action'='login' and new.payload->>'actor_id'='${race.id}' then perform pg_advisory_xact_lock(736315);end if;return new;end $$;
    create trigger lab_pause_binding_login before insert on auth.audit_log_entries for each row execute function password_lab.pause_binding_login();`);
  const holder = holderSession(); let heldOutput = '';
  holder.stdout.on('data', data => { heldOutput = (heldOutput + data).slice(-100); });
  holder.stdin.write("select pg_advisory_lock(736315);select 'BINDING_HELD';\n");
  for (let n = 0; n < 30 && !heldOutput.includes('BINDING_HELD'); n++) await pause();
  assert.ok(heldOutput.includes('BINDING_HELD'));
  const inFlight = asyncHttp({ url: auth + '/token?grant_type=password', method: 'POST', timeout: 18000,
    headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: race.email, password: race.password }) });
  let observed = false;
  for (let n = 0; n < 30; n++) { if (sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=736315 and not granted)") === 't') { observed = true; break; } await pause(); }
  assert.ok(observed, 'Native in-flight login barrier missing');
  const racePersonal = randomBytes(18).toString('hex'); syntheticSecrets.push(racePersonal);
  assert.equal((await call(auth, '/user', raceA.body.access_token, { password: racePersonal }, 'PUT')).status, 200);
  assert.notEqual(epoch(race.id), raceInitialEpoch);
  holder.stdin.end('select pg_advisory_unlock(736315);\n');
  const raceB = await inFlight; assert.ok(raceB.status >= 400, 'In-flight stale credential obtained a token');
  sql('drop trigger lab_pause_binding_login on auth.audit_log_entries;drop function password_lab.pause_binding_login();');
  const raceNew = await login(race, racePersonal); assert.equal(raceNew.status, 200); assert.equal(await count(raceNew), 1);
  checks.push('in-flight initial-password login is refused at native token issuance; only a new credential login reads data');
  checks.push(...await exerciseBindingConcurrency({ auth, adminJwt, call, sql, asyncHttp, pause, syntheticSecrets, holderSession, newUser, login, count, epoch }));

  // A real Auth TOTP challenge upgrades assurance but must not upgrade credentials.
  const factorUser = await login(race, racePersonal); assert.equal(factorUser.status, 200);
  const factor = await call(auth, '/factors', factorUser.body.access_token, { factor_type: 'totp', friendly_name: 'Synthetic factor' });
  assert.equal(factor.status, 200, 'Native TOTP enrollment failed');
  syntheticSecrets.push(factor.body.totp.secret);
  const totp = secret => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
    for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5, '0');
    const key = Buffer.from(bits.match(/.{8}/g).map(part => parseInt(part, 2)));
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const digest = createHmac('sha1', key).update(counter).digest(), offset = digest[19] & 15;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
  };
  const verifyFactor = async session => {
    const challenge = await call(auth, '/factors/' + factor.body.id + '/challenge', session.body.access_token, {});
    assert.equal(challenge.status, 200);
    return call(auth, '/factors/' + factor.body.id + '/verify', session.body.access_token,
      { challenge_id: challenge.body.id, code: totp(factor.body.totp.secret) });
  };
  const firstAal2 = await verifyFactor(factorUser); assert.equal(firstAal2.status, 200); assert.equal(await count(firstAal2), 1);
  const newAal1 = await login(race, racePersonal); assert.equal(newAal1.status, 200); assert.equal(await count(newAal1), 0);
  const newAal2 = await verifyFactor(newAal1); assert.equal(newAal2.status, 200); assert.equal(await count(newAal2), 1);
  checks.push('native TOTP preserves credential binding; new password plus AAL2 is required when an enrolled factor exists');

  const recovery = await newUser('binding-recovery');
  const link = await call(auth, '/admin/generate_link', adminJwt, { type: 'recovery', email: recovery.email });
  assert.equal(link.status, 200); syntheticSecrets.push(link.body.hashed_token);
  const recovered = await call(auth, '/verify', adminJwt, { type: 'recovery', token_hash: link.body.hashed_token });
  assert.equal(recovered.status, 200, 'Native recovery verification failed'); assert.equal(await count(recovered), 0);
  const recoveryPersonal = randomBytes(18).toString('hex'); syntheticSecrets.push(recoveryPersonal);
  assert.equal((await call(auth, '/user', recovered.body.access_token, { password: recoveryPersonal }, 'PUT')).status, 200);
  const recoveryLogin = await login(recovery, recoveryPersonal); assert.equal(recoveryLogin.status, 200); assert.equal(await count(recoveryLogin), 1);
  checks.push('native recovery verification permits password repair while pending without granting chart access or sending email');

  const lost = await newUser('binding-lost-response');
  const lostSession = await login(lost); assert.equal(lostSession.status, 200);
  const beforeLost = epoch(lost.id), afterLostPassword = randomBytes(18).toString('hex'); syntheticSecrets.push(afterLostPassword);
  const discarded = await asyncHttp({ url: auth + '/user', method: 'PUT',
    headers: { Authorization: 'Bearer ' + lostSession.body.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: afterLostPassword }) }, `
    import {readFileSync} from 'node:fs';const q=JSON.parse(readFileSync(0,'utf8'));
    const response=await fetch(q.url,{method:q.method,headers:q.headers,body:q.body});await response.arrayBuffer();
    console.log(JSON.stringify({status:0,body:null}));
  `);
  assert.equal(discarded.status, 0); assert.notEqual(epoch(lost.id), beforeLost); assert.equal(pending(lost.id), 'false');
  assert.ok((await refresh(lostSession)).status >= 400);
  const afterLostLogin = await login(lost, afterLostPassword); assert.equal(afterLostLogin.status, 200); assert.equal(await count(afterLostLogin), 1);
  assert.equal((await login(lost)).status, 400);
  checks.push('discarding the client response after native password commit leaves consistent state; new password login recovers without repeating password mutation');

  await restartAuth({ ...encryptionEnv, GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: 'false' });
  const missingHook = await login(lost, afterLostPassword); assert.equal(missingHook.status, 200); assert.equal(await count(missingHook), 0);
  await restartAuth(encryptionEnv);
  const restoredHook = await login(lost, afterLostPassword); assert.equal(restoredHook.status, 200); assert.equal(await count(restoredHook), 1);
  checks.push('disabling the native token hook cannot authorize new sessions; reenabling it restores normal login without a fallback grant');

  return { syntheticOnly: true, labOnly: true, authVersion: version, candidateProtocol: 'immutable per-session credential epoch via native access-token hook and transactional password audit',
    checks, prototypeIsProductionFix: false,
    notCovered: ['application RPC/RLS/storage/Edge integration', 'legacy/backfill', 'audit configuration/version drift', 'PKCE recovery authenticated before rotation', 'privileged reset', 'transparent encryption migration of completed accounts'] };
}
