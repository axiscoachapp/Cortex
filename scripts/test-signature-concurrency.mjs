import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// D17 signature races with real connections (migration 20261105100000; Codex
// review of 04/11 14:15). Owns a disposable database; synthetic data only.
//   node scripts/test-signature-concurrency.mjs              -> expects the fixes
//   node scripts/test-signature-concurrency.mjs --before-fix -> RED report against 6636629
const docker = (args, input) =>
  spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
const required = (result) => {
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
};
const bounds = "set statement_timeout='15s';set lock_timeout='10s';";
const service = "set local role service_role;set local request.jwt.claim.role='service_role';";
const SEALED = `'{"v":1,"keyId":"k1","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}'::jsonb`;
const PREP = `jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1')`;
const A64 = "repeat('a',64)";

function session(container) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
  let output = '';
  let errors = '';
  const listeners = new Set();
  child.stdout.on('data', (chunk) => { output += chunk; for (const notify of listeners) notify(); });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.stdin.on('error', () => {});
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('close', (status) => resolveDone({ status, stdout: output, stderr: errors }));
  });
  const send = (sql) => child.stdin.write(sql + '\n');
  send(bounds);
  return {
    send,
    output: () => output,
    wait: (marker) => new Promise((resolveMarker, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); child.kill(); reject(new Error('Timed out before ' + marker + ': ' + errors)); }, 20000);
      const check = () => { if (output.includes(marker)) { clearTimeout(timer); listeners.delete(check); resolveMarker(); } };
      listeners.add(check);
      check();
    }),
    finish: (sql) => { send(sql); child.stdin.end(); return done; },
  };
}

export async function testSignatureConcurrency(container, { beforeFix = false } = {}) {
  // --before-fix: run every case against the previous migration and report
  // which ones fail (RED), instead of stopping at the first assertion.
  const red = [];
  const check = async (label, fn) => {
    try { await fn(); } catch (error) {
      if (!beforeFix) throw error;
      red.push(`${label}: ${String(error.message).split(/\r?\n/)[0]}`);
    }
  };
  const sql = (source) => required(docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], bounds + source));
  const results = {};
  let n = 0;
  /** A doctor with CPF, a patient, a generated prescription and an active session. */
  function fixture({ minutes = 60 } = {}) {
    n++;
    const id = (prefix) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const f = { user: id('e1700000'), patient: id('e1710000'), rx: id('e1720000'), session: id('e1730000'), op: id('e1740000') };
    sql(`insert into auth.users(id,email) values('${f.user}','race-${n}@example.invalid');
     insert into public.user_settings(user_id,prescriber_cpf) values('${f.user}','52998224725');
     insert into public.patients(id,user_id,name,age,last_visit,status) values('${f.patient}','${f.user}','Paciente sintética ${n}',30,current_date,'novo');
     insert into public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,issuance_snapshot)
      values('${f.rx}','${f.user}','${f.patient}','rx/${f.user}/${f.rx}.pdf','synthetic',now()+interval '30 days',
       jsonb_build_object('prescriber','{}'::jsonb,'patient','{}'::jsonb,'pdf_sha256',${A64},'template_version','test','issued_at',now()));
     begin;${service}select public.signature_activate_session('${f.user}','vidaas','${f.session}',now()+interval '${minutes} minutes',repeat('c',64),${SEALED});commit;`);
    return f;
  }
  const call = (f, expr) => sql(`begin;${service}select ${expr};commit;`);
  const reserve = (f, op = f.op) => `public.signature_reserve('${f.user}','${op}','${f.rx}',${A64})`;
  const advance = (f, to, data = PREP, op = f.op) => `public.signature_advance('${f.user}','${op}','${to}',${data})`;
  const toStored = (f) => {
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    call(f, advance(f, 'psc_requested'));
    call(f, advance(f, 'stored', `jsonb_build_object('stagedPath','rx/${f.user}/${f.rx}/signed-${f.op}.pdf','signedSha256',repeat('f',64))`));
  };
  const state = (f) => sql(`select state from cortex_private.signature_operations where operation_id='${f.op}'`);
  const signed = (f) => sql(`select status from public.prescriptions where id='${f.rx}'`);
  const audits = (f) => Number(sql(`select count(*) from cortex_private.prescription_signatures where prescription_id='${f.rx}'`));
  const backendPid = (s) => Number(/PID=(\d+)/.exec(s.output())?.[1]);

  // 1. P1: two overlapping permissions for the same prepared operation.
  await check('overlapping permission (P1)', async () => {
  {
    const f = fixture();
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    const a = session(container);
    a.send(`begin;${service}select ${advance(f, 'psc_requested')} is not null;\n\\echo A_HELD\nselect pg_sleep(1);commit;`);
    await a.wait('A_HELD');
    const b = session(container);
    const rb = await b.finish(`begin;${service}select ${advance(f, 'psc_requested')};commit;`);
    const ra = await a.finish('');
    assert.equal(ra.status, 0, ra.stderr);
    assert.notEqual(rb.status, 0, 'Second permission granted for an attempt in flight');
    assert.match(rb.stderr, /P4093/, rb.stderr);
    const attempts = Number(sql(`select psc_attempts from cortex_private.signature_operations where operation_id='${f.op}'`));
    assert.equal(attempts, 1, 'More than one PSC permission recorded');
    // Lost answer to the permission: the same call again is still refused.
    const again = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], `begin;${service}select ${advance(f, 'psc_requested')};commit;`);
    assert.notEqual(again.status, 0, 'Repeated permission after a lost answer');
    results.overlappingPermission = { second: 'P4093', attempts };
  }
  });

  // 2. P2: completion waits on the prescription row past the session expiry.
  await check('session expiry while waiting (P2)', async () => {
  for (const [label, seconds, hold, expect] of [['expires-while-waiting', 2, 4, 'cancelled_by_revocation'], ['control-before-expiry', 120, 3, 'completed']]) {
    const f = fixture({ minutes: 5 });
    toStored(f);
    // The session ends while completion is held behind another transaction.
    sql(`update cortex_private.signature_sessions set expires_at=now()+interval '${seconds} seconds' where id='${f.session}'`);
    const holder = session(container);
    holder.send(`begin;select 1 from public.prescriptions where id='${f.rx}' for update;\n\\echo ROW_HELD\nselect pg_sleep(${hold});commit;`);
    await holder.wait('ROW_HELD');
    const completer = session(container);
    completer.send(`select 'PID='||pg_backend_pid();`);
    await completer.wait('PID=');
    const pid = backendPid(completer);
    completer.send(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')->>'state';commit;`);
    let observed = false;
    for (let i = 0; i < 40 && !observed; i++) {
      observed = sql(`select coalesce(wait_event_type,'') from pg_stat_activity where pid=${pid}`) === 'Lock';
      if (!observed) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(observed, `${label}: completion did not wait on the prescription row`);
    const done = await completer.finish('');
    await holder.finish('');
    assert.equal(done.status, 0, done.stderr);
    assert.equal(state(f), expect, `${label}: wrong outcome`);
    assert.equal(signed(f), expect === 'completed' ? 'signed' : 'generated', `${label}: prescription status`);
    assert.equal(audits(f), expect === 'completed' ? 1 : 0, `${label}: audit rows`);
    results[label] = { waitedOnRow: observed, state: expect };
  }
  });

  // 3. P1: patient deletion intent vs. reservation and an existing operation.
  await check('patient intent, old RR snapshot (P3)', async () => {
  {
    // RR snapshot older than the committed intent: refused at the barrier.
    const f = fixture();
    const writer = session(container);
    writer.send(`begin isolation level repeatable read;select count(*) from public.patients;\n\\echo SNAPSHOT`);
    await writer.wait('SNAPSHOT');
    sql(`begin;set local request.jwt.claim.role='service_role';update public.patients set deletion_requested_at=now() where id='${f.patient}';commit;`);
    const r = await writer.finish(`${service}select ${reserve(f)};commit;`);
    assert.notEqual(r.status, 0, 'RR reservation after the patient deletion intent');
    assert.match(r.stderr, /40001|42501/, r.stderr);
    assert.equal(Number(sql(`select count(*) from cortex_private.signature_operations where prescription_id='${f.rx}'`)), 0);
    results.patientIntentRR = /40001/.test(r.stderr) ? '40001' : '42501';
  }
  });
  await check('patient intent in progress (P3)', async () => {
  {
    // Intent in progress (uncommitted) while an existing operation asks for the PSC: never waits, never passes.
    const f = fixture();
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    const deleter = session(container);
    deleter.send(`begin;set local request.jwt.claim.role='service_role';update public.patients set deletion_requested_at=now() where id='${f.patient}';\n\\echo INTENT_HELD\nselect pg_sleep(1);commit;`);
    await deleter.wait('INTENT_HELD');
    const writer = session(container);
    const r = await writer.finish(`begin;${service}select ${advance(f, 'psc_requested')};commit;`);
    await deleter.finish('');
    assert.notEqual(r.status, 0, 'PSC permission while the patient deletion intent was in progress');
    assert.match(r.stderr, /40001|55000|42501/, r.stderr);
    assert.equal(state(f), 'prepared', 'Operation advanced beside the intent');
    // After the intent committed (RC): refused too.
    const after = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], `begin;${service}select ${advance(f, 'psc_requested')};commit;`);
    assert.notEqual(after.status, 0, 'PSC permission after the patient deletion intent');
    results.patientIntentInProgress = (/ERROR:\s+(\w+):/.exec(r.stderr) || [])[1];
  }
  });

  // 4. P2: an RR snapshot older than the account deletion intent reads neither secret.
  await check('account intent, old RR snapshot (P4)', async () => {
  for (const label of ['token', 'verifier']) {
    const f = fixture();
    sql(`begin;${service}select public.signature_begin_authorization('${f.user}','vidaas',repeat('${n % 10}',64),${SEALED});commit;`);
    const reader = session(container);
    reader.send(`begin isolation level repeatable read;select count(*) from public.account_deletion_requests;\n\\echo SNAPSHOT`);
    await reader.wait('SNAPSHOT');
    sql(`begin;set local request.jwt.claim.role='service_role';insert into public.account_deletion_requests(user_id) values('${f.user}');commit;`);
    const expr = label === 'token'
      ? `public.signature_session_token('${f.user}','${f.session}',1)`
      : `public.signature_consume_authorization('${f.user}','vidaas',repeat('${n % 10}',64))`;
    const r = await reader.finish(`${service}select ${expr};commit;`);
    assert.notEqual(r.status, 0, `Stale snapshot read the ${label} after the account deletion intent`);
    assert.match(r.stderr, /40001|42501/, r.stderr);
    results[`accountIntentRR_${label}`] = (/ERROR:\s+(\w+):/.exec(r.stderr) || [])[1];
  }
  });

  // 5. Revocation vs. completion, both orders.
  await check('revocation first', async () => {
  {
    const f = fixture();
    toStored(f);
    const revoker = session(container);
    revoker.send(`begin;${service}select public.signature_revoke_session('${f.user}');\n\\echo REVOKED\nselect pg_sleep(0.7);commit;`);
    await revoker.wait('REVOKED');
    const completer = session(container);
    const r = await completer.finish(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')->>'state';commit;`);
    await revoker.finish('');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(state(f), 'cancelled_by_revocation', 'Completion won over a revocation that serialized first');
    assert.equal(signed(f), 'generated');
    assert.equal(audits(f), 0);
  }
  });
  await check('completion first', async () => {
  {
    const f = fixture();
    toStored(f);
    const completer = session(container);
    completer.send(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')->>'state';\n\\echo COMPLETED\nselect pg_sleep(0.7);commit;`);
    await completer.wait('COMPLETED');
    const revoker = session(container);
    const r = await revoker.finish(`begin;${service}select public.signature_revoke_session('${f.user}');commit;`);
    await completer.finish('');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(state(f), 'completed', 'A later revocation undid a completed signature');
    assert.equal(signed(f), 'signed');
    assert.equal(audits(f), 1);
    results.revocationBothOrders = 'revocation-first cancels; completion-first stays signed';
  }
  });

  // 6. Two reservations of one document with different operation ids: exactly one.
  await check('double reservation', async () => {
  {
    const f = fixture();
    const other = f.op.replace(/^e174/, 'e175');
    const a = session(container);
    a.send(`begin;${service}select ${reserve(f)} is not null;\n\\echo A_RESERVED\nselect pg_sleep(0.7);commit;`);
    await a.wait('A_RESERVED');
    const b = session(container);
    const rb = await b.finish(`begin;${service}select ${reserve(f, other)};commit;`);
    await a.finish('');
    assert.notEqual(rb.status, 0, 'Two open operations for one document');
    assert.equal(Number(sql(`select count(*) from cortex_private.signature_operations where prescription_id='${f.rx}'`)), 1);
    results.doubleReservation = (/ERROR:\s+(\w+):/.exec(rb.stderr) || [])[1];
  }
  });
  if (beforeFix) process.stdout.write(`RED cases (${red.length}):\n${red.map((r) => '  - ' + r).join('\n')}\n`);
  else process.stdout.write(`Signature races: ${JSON.stringify(results)}\n`);
}

async function standalone({ beforeFix = false } = {}) {
  const container = `cortex-signature-race-${randomUUID().slice(0, 8)}`;
  try {
    required(docker(['run', '--detach', '--rm', '--name', container, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      ready = docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0;
      if (!ready) await new Promise((wait) => setTimeout(wait, 500));
    }
    assert.ok(ready, 'Disposable PostgreSQL did not become ready');
    const apply = (source) => required(docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '--quiet'], source));
    apply(readFileSync(resolve('supabase/tests/bootstrap.sql'), 'utf8'));
    for (const name of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
      // RED: the D17 migration as first sent for review (6636629), from git.
      const source = beforeFix && name === '20261105100000_digital_signature.sql'
        ? required(spawnSync('git', ['show', '6636629:supabase/migrations/' + name], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
        : readFileSync(resolve('supabase/migrations', name), 'utf8');
      apply(source);
    }
    await testSignatureConcurrency(container, { beforeFix });
  } finally {
    docker(['stop', container]);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.ok(process.argv.slice(2).every((arg) => arg === '--before-fix'), 'Unknown option');
  await standalone({ beforeFix: process.argv.includes('--before-fix') });
}
