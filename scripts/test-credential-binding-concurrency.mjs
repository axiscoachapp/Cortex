import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export async function exerciseBindingConcurrency({ auth, adminJwt, call, sql, asyncHttp, pause, syntheticSecrets, holderSession, newUser, login, count, epoch }) {
  const checks = [];
  const barrier = async (key, onlyFirst = false) => {
    sql(`create function password_lab.pause_password_statement() returns trigger language plpgsql security definer set search_path='' as $$ begin
      ${onlyFirst ? `if pg_try_advisory_xact_lock(${key + 1}) then` : ''}
      perform pg_advisory_xact_lock(${key});${onlyFirst ? 'end if;' : ''}return null;end $$;
      create trigger lab_pause_password_statement before update of encrypted_password on auth.users
       for each statement execute function password_lab.pause_password_statement();`);
    const holder = holderSession(); let output = '';
    holder.stdout.on('data', data => { output = (output + data).slice(-100); });
    holder.stdin.write(`select pg_advisory_lock(${key});select 'PASSWORD_HELD';\n`);
    for (let n = 0; n < 30 && !output.includes('PASSWORD_HELD'); n++) await pause();
    assert.ok(output.includes('PASSWORD_HELD'), 'Password statement barrier missing');
    return {
      wait: async number => {
        for (let n = 0; n < 30; n++) {
          if (Number(sql(`select count(*) from pg_locks where locktype='advisory' and objid=${key} and not granted`)) === number) return;
          await pause();
        }
        throw new Error('Native password statement did not reach observed barrier');
      },
      release: () => holder.stdin.end(`select pg_advisory_unlock(${key});\n`),
      drop: () => sql('drop trigger lab_pause_password_statement on auth.users;drop function password_lab.pause_password_statement();'),
    };
  };
  const passwordRequest = (session, password) => asyncHttp({ url: auth + '/user', method: 'PUT', timeout: 18000,
    headers: { Authorization: 'Bearer ' + session.body.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const password = () => { const value = randomBytes(18).toString('hex'); syntheticSecrets.push(value); return value; };

  const simultaneous = await newUser('binding-two-passwords');
  const a = await login(simultaneous), b = await login(simultaneous); assert.equal(a.status, 200); assert.equal(b.status, 200);
  const originalEpoch = epoch(simultaneous.id), firstPassword = password(), secondPassword = password();
  const both = await barrier(736316);
  const first = passwordRequest(a, firstPassword), second = passwordRequest(b, secondPassword);
  await both.wait(2); both.release();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter(result => result.status === 200).length, 1, 'Concurrent password updates both succeeded or both failed');
  assert.ok(results.find(result => result.status !== 200).status >= 400);
  assert.notEqual(epoch(simultaneous.id), originalEpoch);
  assert.equal(sql(`select count(*) from auth.audit_log_entries where payload->>'action'='user_updated_password' and payload->>'actor_id'='${simultaneous.id}'`), '1');
  both.drop();
  const winner = results[0].status === 200 ? firstPassword : secondPassword;
  const loser = results[0].status === 200 ? secondPassword : firstPassword;
  const winnerLogin = await login(simultaneous, winner); assert.equal(winnerLogin.status, 200); assert.equal(await count(winnerLogin), 1);
  assert.equal((await login(simultaneous, loser)).status, 400);
  checks.push('two native password updates held after credential checks produce one committed rotation and one rollback; only winning password signs in');

  const reencryption = await newUser('binding-reencrypt-race');
  const owner = await login(reencryption); assert.equal(owner.status, 200);
  // Fixture only: replace the representation of the same synthetic initial
  // password before starting the native re-encryption request. No hash is copied.
  sql(`create extension if not exists pgcrypto;
    update auth.users set encrypted_password=public.crypt('${reencryption.password}',public.gen_salt('bf',10)) where id='${reencryption.id}';`);
  const initialEpoch = epoch(reencryption.id), chosen = password();
  const one = await barrier(736318, true);
  const stale = asyncHttp({ url: auth + '/token?grant_type=password', method: 'POST', timeout: 18000,
    headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: reencryption.email, password: reencryption.password }) });
  await one.wait(1);
  assert.equal((await call(auth, '/user', owner.body.access_token, { password: chosen }, 'PUT')).status, 200);
  const committedEpoch = epoch(reencryption.id); assert.notEqual(committedEpoch, initialEpoch);
  one.release();
  assert.ok((await stale).status >= 400, 'Late re-encryption of old password was accepted');
  assert.equal(epoch(reencryption.id), committedEpoch);
  one.drop();
  assert.equal((await login(reencryption)).status, 400, 'Initial password was restored by late re-encryption');
  const correct = await login(reencryption, chosen); assert.equal(correct.status, 200); assert.equal(await count(correct), 1);
  checks.push('native old-password re-encryption paused before its write cannot restore the initial password after a committed rotation');

  const refreshing = await newUser('binding-refresh-race');
  const initial = await login(refreshing); assert.equal(initial.status, 200);
  const currentPassword = password();
  assert.equal((await call(auth, '/user', initial.body.access_token, { password: currentPassword }, 'PUT')).status, 200);
  const writer = await login(refreshing, currentPassword), reader = await login(refreshing, currentPassword);
  assert.equal(writer.status, 200); assert.equal(reader.status, 200);
  sql(`alter function password_lab.bind_access_token(jsonb) rename to bind_access_token_real;
    create function password_lab.bind_access_token(event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin
    if event->>'user_id'='${refreshing.id}' and event->>'authentication_method'='token_refresh' then
      perform pg_advisory_xact_lock(736320);end if;return password_lab.bind_access_token_real(event);end $$;
    revoke all on function password_lab.bind_access_token(jsonb) from public,anon,authenticated,service_role;
    grant execute on function password_lab.bind_access_token(jsonb) to supabase_auth_admin;`);
  const holder = holderSession(); let held = '';
  holder.stdout.on('data', data => { held = (held + data).slice(-100); });
  holder.stdin.write("select pg_advisory_lock(736320);select 'REFRESH_HELD';\n");
  for (let n = 0; n < 30 && !held.includes('REFRESH_HELD'); n++) await pause();
  assert.ok(held.includes('REFRESH_HELD'));
  const refreshRequest = asyncHttp({ url: auth + '/token?grant_type=refresh_token', method: 'POST', timeout: 18000,
    headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: reader.body.refresh_token }) });
  let refreshWaiting = false;
  for (let n = 0; n < 30; n++) {
    if (sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=736320 and not granted)") === 't') { refreshWaiting = true; break; }
    await pause();
  }
  assert.ok(refreshWaiting, 'Native refresh did not reach hook while holding session');
  const nextPassword = password();
  const rotating = passwordRequest(writer, nextPassword);
  let completedRotation;
  rotating.then(response => { completedRotation = { status: response.status, code: response.body?.error_code ?? null }; }, () => {});
  let blockedWriter = false;
  for (let n = 0; n < 30; n++) {
    if (sql(`select exists(select 1 from pg_stat_activity a where pg_blocking_pids(a.pid) &&
      array(select pid from pg_locks where locktype='advisory' and objid=736320 and not granted))`) === 't') { blockedWriter = true; break; }
    if (completedRotation) break;
    await pause();
  }
  if (!blockedWriter) {
    const diagnostic = JSON.parse(sql(`select coalesce(json_agg(json_build_object('pid',pid,'state',state,'wait',wait_event,
      'blockedBy',pg_blocking_pids(pid),'stage',case when query ilike '%bind_access_token%' then 'hook'
      when query ~* 'delete.*(sessions|refresh_tokens)' then 'revoke' when query ~* 'update.*users' then 'user_update' else 'other' end)), '[]')
      from pg_stat_activity where usename='supabase_auth_admin' and state<>'idle'`));
    holder.stdin.end('select pg_advisory_unlock(736320);\n');
    await Promise.all([refreshRequest, rotating]);
    assert.fail('Native refresh contention barrier missing: ' + JSON.stringify({ completedRotation, diagnostic }));
  }
  holder.stdin.end('select pg_advisory_unlock(736320);\n');
  let timer;
  const resultsAfterRelease = await Promise.race([Promise.all([refreshRequest, rotating]), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Hook waited instead of failing before the 15s deadlock detector')), 5000);
  })]).finally(() => clearTimeout(timer));
  assert.ok(resultsAfterRelease[0].status === 200 || resultsAfterRelease[0].status >= 400,
    'Unexpected refresh transport status: ' + resultsAfterRelease[0].status);
  assert.equal(resultsAfterRelease[1].status, 200);
  if (resultsAfterRelease[0].status === 200) assert.equal(await count(resultsAfterRelease[0]), 0);
  assert.equal(await count(reader), 0);
  sql('drop function password_lab.bind_access_token(jsonb);alter function password_lab.bind_access_token_real(jsonb) rename to bind_access_token;');
  const recovered = await login(refreshing, nextPassword); assert.equal(recovered.status, 200); assert.equal(await count(recovered), 1);
  checks.push('observed refresh/password contention finishes before deadlock detection; any refreshed token is revoked by the committed rotation and new login recovers');
  return checks;
}
