import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// A bounded composition proof. All completion calls below are test-owner SQL,
// not an HTTP endpoint or a replacement for future verified server context.
export async function exerciseInitialSetupSessionFence({ auth, rest, adminJwt, version, call, sql, rawSql, syntheticSecrets }) {
  const checks = [];
  const password = randomBytes(24).toString('hex');
  syntheticSecrets.push(password);
  const email = 'setup-session-fence@example.invalid';
  const created = await call(auth, '/admin/users', adminJwt, { email, email_confirm: true });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  sql(`insert into password_lab.setup_operations(user_id) values('${id}');
    insert into public.lab_guarded values('${id}','Synthetic session fence row');
    insert into public.lab_owner_only values('${id}','Synthetic session fence control');`);
  const state = () => JSON.parse(sql(`select row_to_json(s) from password_lab.setup_operations s where user_id='${id}';`));
  const claims = session => {
    assert.equal(session.status, 200);
    const value = JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url'));
    assert.equal(value.sub, id);
    assert.match(value.session_id, /^[0-9a-f-]{36}$/);
    assert.ok(value.exp > Math.floor(Date.now() / 1000) + 60);
    return value;
  };
  const read = async (session, table = 'lab_guarded') => {
    claims(session);
    const result = await call(rest, `/${table}?select=payload`, session.body.access_token);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body));
    return result.body.length;
  };
  const refresh = session => call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: session.body.refresh_token });
  const recovery = async () => {
    const link = await call(auth, '/admin/generate_link', adminJwt, { type: 'recovery', email });
    assert.equal(link.status, 200);
    syntheticSecrets.push(link.body.hashed_token, link.body.action_link);
    return call(auth, '/verify', adminJwt, { type: 'recovery', token_hash: link.body.hashed_token });
  };
  const binding = session => JSON.parse(sql(`select row_to_json(b) from password_lab.setup_session_bindings b where session_id='${claims(session).session_id}';`));
  const initial = await recovery();
  const initialGeneration = state().credential_generation;
  assert.equal(claims(initial).cortex_setup_purpose, 'repair');
  assert.equal(binding(initial).purpose, 'repair');
  assert.equal(await read(initial), 0);
  assert.equal(await read(initial, 'lab_owner_only'), 1);
  assert.equal((await call(auth, '/user', initial.body.access_token, { data: { cortex_setup_purpose: 'password', cortex_setup_generation: initialGeneration } }, 'PUT')).status, 200);
  const initialRefresh = await refresh(initial);
  assert.equal(claims(initialRefresh).cortex_setup_purpose, 'repair');
  assert.equal(await read(initialRefresh), 0);
  checks.push('native initial OTP and refresh remain repair; editable metadata cannot grant access');

  const operation = randomUUID();
  const ticket = JSON.parse(sql(`select password_lab.begin_setup('${id}','${claims(initial).session_id}','${operation}',0);`));
  assert.equal(ticket.mutation_allowed, true);
  const changed = await call(auth, '/admin/users/' + id, adminJwt, { password,
    app_metadata: { setup_operation_id: operation, setup_reservation_revision: ticket.reservation_revision } }, 'PUT');
  assert.equal(changed.status, 200);
  const written = state();
  assert.equal(written.phase, 'password_set');
  assert.equal(written.revision, 2);
  assert.equal(written.reservation_revision, 1);
  assert.notEqual(written.credential_generation, initialGeneration);
  assert.equal(written.authorized_generation, null);
  assert.notEqual(written.password_write_xid, null);
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${id}';`), '0');
  assert.equal(sql(`select count(*) from password_lab.setup_session_bindings where user_id='${id}';`), '0');
  assert.equal(await read(initial), 0);
  checks.push('reserved native password commit advances private generation once, revokes sessions/bindings and keeps data closed');

  const personal = await call(auth, '/token?grant_type=password', adminJwt, { email, password });
  assert.equal(claims(personal).cortex_setup_purpose, 'password');
  assert.equal(claims(personal).cortex_setup_generation, written.credential_generation);
  assert.equal(binding(personal).operation_id, operation);
  assert.equal(binding(personal).reservation_revision, 1);
  assert.equal(await read(personal), 0);
  const repair = await recovery();
  const repairRefresh = await refresh(repair);
  for (const session of [repair, repairRefresh]) {
    assert.equal(claims(session).cortex_setup_purpose, 'repair');
    assert.equal(binding(session).generation, written.credential_generation);
    assert.equal(await read(session), 0);
  }
  checks.push('new personal login and post-password OTP bind to the same generation with distinct immutable purposes, still pending completion');

  const completion = (session, op = operation, revision = 2) => `select password_lab.complete_reserved_setup('${id}','${claims(session).session_id}','${op}',${revision});`;
  const refused = (source, code) => {
    const result = rawSql(source);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`ERROR: +${code}:`));
  };
  for (const role of ['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) {
    assert.equal(sql(`select has_function_privilege('${role}','password_lab.complete_reserved_setup(uuid,uuid,uuid,integer)','execute');`), 'f');
  }
  refused('set role authenticated;' + completion(personal), '42501');
  refused(completion(repair), '42501');
  refused(completion(repairRefresh), '42501');
  refused(completion(personal, randomUUID()), '40001');
  refused(completion(personal, operation, 1), '40001');
  assert.equal(state().authorized_generation, null);
  const nativeIdentity = await call(auth, '/user', personal.body.access_token);
  assert.equal(nativeIdentity.status, 200);
  assert.equal(nativeIdentity.body.id, id);
  assert.deepEqual(JSON.parse(sql(completion(personal))), { revision: 3, mutation_allowed: true });
  assert.deepEqual(JSON.parse(sql(completion(personal))), { revision: 3, mutation_allowed: false });
  assert.equal(state().authorized_generation, written.credential_generation);
  assert.equal(await read(personal), 1);
  assert.equal(await read(initial), 0);
  assert.equal(await read(repair), 0);
  assert.equal(await read(repairRefresh), 0);
  checks.push('private completion requires live password binding, operation and CAS; retry does not mutate; repair/client roles cannot conclude');

  const definition = sql("select pg_get_functiondef('password_lab.session_ready()'::regprocedure);");
  assert.equal(definition.split("b.purpose='password'").length, 2);
  try {
    sql(definition.replace("b.purpose='password'", 'true'));
    assert.equal(await read(repair), 1);
    assert.equal(await read(repairRefresh), 1);
  } finally { sql(definition); }
  assert.equal(await read(personal), 1);
  assert.equal(await read(repair), 0);
  assert.equal(await read(repairRefresh), 0);
  checks.push('DB-only purpose-removal control admits current repair and refresh; exact predicate restoration denies both again');

  const logout = await call(auth, '/logout?scope=local', personal.body.access_token, undefined, 'POST');
  assert.equal(logout.status, 204);
  assert.equal(await read(personal), 0);
  assert.equal(await read(personal, 'lab_owner_only'), 1);
  const revokedRefresh = await refresh(personal);
  assert.equal(revokedRefresh.status, 400);
  assert.ok(['refresh_token_not_found', 'session_not_found'].includes(revokedRefresh.body.error_code));
  const nextPersonal = await call(auth, '/token?grant_type=password', adminJwt, { email, password });
  assert.equal(await read(nextPersonal), 1);
  sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${claims(nextPersonal).session_id}';`);
  assert.equal(await read(nextPersonal), 0);
  refused(completion(nextPersonal), '42501');
  sql(`update auth.sessions set not_after=null where id='${claims(nextPersonal).session_id}';`);
  assert.equal(await read(nextPersonal), 1);
  checks.push('native local logout denies old unexpired JWT/refresh; new password login works; owned expiry fixture closes read and completion');
  return { syntheticOnly: true, labOnly: true, authVersion: version, checks,
    privateCompletionOnly: true, productionIntegration: false, purposeRemovalControlReadRows: 1, restoredRepairReadRows: 0,
    notCovered: ['in-flight verify/PKCE composition', 'MFA completion admission and upgrades', 'verified HTTP/Edge context boundary', 'two-connection completion races', 'crypto maintenance and existing/reset accounts', 'app integration and hosted configuration'] };
}
