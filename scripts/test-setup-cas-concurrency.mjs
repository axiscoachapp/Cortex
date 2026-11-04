import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Native Admin requests are stopped before the password UPDATE statement;
// the second request must commit while the first is still in flight.
export async function exerciseSetupCasConcurrency({ auth, adminJwt, sql, asyncHttp, pause, holderSession,
  newUser, begin, metadata, mutate, secret, rollback, state, login, invalidPassword }) {
  const checks = [];
  for (const [label, supersede, key] of [['duplicate', false, 864210], ['superseded', true, 864230]]) {
    const user = await newUser(label), first = begin(user, user.session, randomUUID(), 0);
    sql(`create function password_lab.pause_setup_statement() returns trigger language plpgsql as $$ begin
      if pg_try_advisory_xact_lock(${key + 1}) then perform pg_advisory_xact_lock(${key});end if;return null;end $$;
      create trigger lab_pause_setup_statement before update of encrypted_password on auth.users for each statement execute function password_lab.pause_setup_statement();`);
    const gate = holderSession(); let output = '';
    gate.stdout.on('data', data => { output = (output + data).slice(-100); });
    gate.stdin.write(`select pg_advisory_lock(${key});select 'SETUP_HELD';\n`);
    for (let n = 0; n < 30 && !output.includes('SETUP_HELD'); n++) await pause();
    assert.ok(output.includes('SETUP_HELD'));
    const losingPassword = secret(), winningPassword = secret();
    const pending = asyncHttp({ url: auth + '/admin/users/' + user.id, method: 'PUT', timeout: 18000,
      headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: losingPassword, app_metadata: metadata(first) }) });
    let observed = false;
    try {
      for (let n = 0; n < 30; n++) {
        if (sql(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${key} and not granted)`) === 't') { observed = true; break; }
        await pause();
      }
      assert.ok(observed, 'Native password request did not reach the observed statement barrier');
      const winner = supersede ? begin(user, user.session, randomUUID(), first.revision) : first;
      assert.equal((await mutate(user, winner, winningPassword)).status, 200);
      gate.stdin.end(`select pg_advisory_unlock(${key});\n`);
      rollback(await pending);
      assert.equal(state(user).operation_id, winner.op); assert.equal(state(user).reservation_revision, winner.reservation_revision);
      assert.equal(state(user).phase, 'password_set');
    } finally {
      if (!gate.stdin.writableEnded) gate.stdin.end(`select pg_advisory_unlock(${key});\n`);
      await pending;
      sql('drop trigger lab_pause_setup_statement on auth.users;drop function password_lab.pause_setup_statement();');
    }
    await invalidPassword(user, losingPassword); assert.equal((await login(user, winningPassword)).status, 200);
    checks.push(supersede ? 'superseded in-flight native worker cannot overwrite the later reserved password'
      : 'two concurrent native writes for one operation commit only the winner and roll back the delayed duplicate');
  }
  return checks;
}
