import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// SQL ordering proof only: the Auth-created schema is real, but the writer
// below is an explicit owner fixture, not a reordered native Admin endpoint.
export async function exerciseInitialSetupOrder({ auth, rest, adminJwt, version, call, sql, rawSql, syntheticSecrets }) {
  const checks = [];
  const password = randomBytes(24).toString('hex');
  syntheticSecrets.push(password);
  const donor = await call(auth, '/admin/users', adminJwt, {
    email: 'setup-order-donor@example.invalid', password, email_confirm: true,
  });
  assert.equal(donor.status, 200);
  assert.match(donor.body.id, /^[0-9a-f-]{36}$/);
  const state = user => JSON.parse(sql(`select row_to_json(s) from password_lab.setup_operations s where user_id='${user.id}';`));
  const makeUser = async label => {
    const email = `setup-order-${label}@example.invalid`;
    const created = await call(auth, '/admin/users', adminJwt, { email, email_confirm: true });
    assert.equal(created.status, 200);
    const id = created.body.id;
    assert.match(id, /^[0-9a-f-]{36}$/);
    sql(`insert into password_lab.setup_operations(user_id) values('${id}');
      insert into public.lab_guarded values('${id}','Synthetic order row');
      insert into public.lab_owner_only values('${id}','Synthetic order control');`);
    const link = await call(auth, '/admin/generate_link', adminJwt, { type: 'recovery', email });
    assert.equal(link.status, 200);
    syntheticSecrets.push(link.body.hashed_token, link.body.action_link);
    const session = await call(auth, '/verify', adminJwt, { type: 'recovery', token_hash: link.body.hashed_token });
    assert.equal(session.status, 200);
    const claims = JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url'));
    assert.match(claims.session_id, /^[0-9a-f-]{36}$/);
    const op = randomUUID();
    const ticket = JSON.parse(sql(`select password_lab.begin_setup('${id}','${claims.session_id}','${op}',0);`));
    assert.equal(ticket.mutation_allowed, true);
    assert.equal(ticket.reservation_revision, 1);
    return { id, email, session, op };
  };
  // Copy only between synthetic rows inside this disposable DB. No hash is
  // returned to the runner or stored in the operation ledger or report.
  const writePassword = user => `update auth.users set encrypted_password=(select encrypted_password from auth.users where id='${donor.body.id}') where id='${user.id}';`;
  const writeMetadata = (user, op = user.op) => `update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('setup_operation_id','${op}','setup_reservation_revision',1) where id='${user.id}';`;
  const revoke = user => `delete from auth.sessions where user_id='${user.id}';`;
  const rows = async (table, session) => {
    const response = await call(rest, `/${table}?select=payload`, session.body.access_token);
    assert.equal(response.status, 200);
    return response.body.length;
  };
  const unchanged = async user => {
    const current = state(user);
    assert.equal(current.phase, 'applying');
    assert.equal(current.revision, 1);
    assert.equal(current.password_write_xid, null);
    assert.equal(sql(`select (raw_app_meta_data->>'setup_operation_id') is null from auth.users where id='${user.id}';`), 't');
    const login = await call(auth, '/token?grant_type=password', adminJwt, { email: user.email, password });
    assert.equal(login.status, 400);
    assert.equal(login.body.error_code, 'invalid_credentials');
    assert.equal((await call(auth, '/user', user.session.body.access_token)).status, 200);
    assert.equal(await rows('lab_owner_only', user.session), 1);
    assert.equal(await rows('lab_guarded', user.session), 0);
  };
  const fails = async (label, statements, code = '40001') => {
    const user = await makeUser(label);
    const result = rawSql(`begin;${statements(user)}commit;`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`ERROR: +${code}:`));
    await unchanged(user);
    checks.push(label);
  };

  // Negative control: immediate checking cannot accept metadata-first order.
  await fails('immediate-control-rejects-metadata-first', user =>
    `set constraints auth.lab_confirm_setup_password immediate;${writeMetadata(user)}${writePassword(user)}${revoke(user)}`);
  for (const order of ['password-first', 'metadata-first', 'combined-update']) {
    const user = await makeUser(order);
    const statements = order === 'password-first' ? writePassword(user) + writeMetadata(user)
      : order === 'metadata-first' ? writeMetadata(user) + writePassword(user)
        : `update auth.users set encrypted_password=(select encrypted_password from auth.users where id='${donor.body.id}'),raw_app_meta_data=raw_app_meta_data||jsonb_build_object('setup_operation_id','${user.op}','setup_reservation_revision',1) where id='${user.id}';`;
    const committed = JSON.parse(sql(`begin;${statements}${revoke(user)}
      set constraints auth.lab_confirm_setup_password immediate;
      select jsonb_build_object('phase',phase,'revision',revision,'reservation',reservation_revision,'sameTransaction',password_write_xid=pg_current_xact_id()) from password_lab.setup_operations where user_id='${user.id}';commit;`));
    assert.deepEqual(committed, { phase: 'password_set', revision: 2, reservation: 1, sameTransaction: true });
    assert.equal(state(user).phase, 'password_set');
    assert.equal(sql(`select count(*) from auth.sessions where user_id='${user.id}';`), '0');
    assert.equal(await rows('lab_owner_only', user.session), 1); // Signed JWT alone is still accepted by the control.
    assert.equal(await rows('lab_guarded', user.session), 0);
    const personal = await call(auth, '/token?grant_type=password', adminJwt, { email: user.email, password });
    assert.equal(personal.status, 200);
    assert.equal(await rows('lab_owner_only', personal), 1);
    assert.equal(await rows('lab_guarded', personal), 0);
    checks.push(order + '-commits-once-with-auth-login-and-data-gate-closed');
  }
  await fails('metadata-only-rolls-back-at-commit', writeMetadata);
  await fails('password-only-rolls-back-at-commit', user => writePassword(user) + revoke(user));
  await fails('wrong-operation-rolls-back-password-and-session-revocation', user => writePassword(user) + writeMetadata(user, randomUUID()) + revoke(user));
  await fails('fault-after-both-writes-rolls-back-everything', user => writeMetadata(user) + writePassword(user) + revoke(user) + 'select 1/0;', '22012');
  return { syntheticOnly: true, labOnly: true, authVersion: version, checks,
    writer: 'explicit SQL owner fixture on native Auth schema; not native Admin update order',
    prototypeIsProductionFix: false, dataAuthorizationImplemented: false,
    notCovered: ['final session-generation authorization', 'in-flight verify/recovery/PKCE', 'MFA and recovery', 'crypto maintenance', 'existing accounts and reset policy', 'app integration and hosted configuration'] };
}
