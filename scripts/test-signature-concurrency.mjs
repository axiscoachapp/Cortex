import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// D17 signature races with real connections (migration 20261105100000; Codex
// review of 04/11 14:15). Owns a disposable database; synthetic data only.
//   node scripts/test-signature-concurrency.mjs              -> expects the fixes
//   node scripts/test-signature-concurrency.mjs --before-fix -> RED report against BEFORE_COMMIT (default 38274c8)
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
  let closed = false;
  const listeners = new Set();
  child.stdout.on('data', (chunk) => { output += chunk; for (const notify of listeners) notify(); });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.stdin.on('error', () => {});
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('close', (status) => { closed = true; resolveDone({ status, stdout: output, stderr: errors }); });
  });
  const send = (sql) => child.stdin.write(sql + '\n');
  send(bounds);
  return {
    send,
    output: () => output,
    closed: () => closed,
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
  function fixture({ minutes = 60, consultationOfOtherPatient = false } = {}) {
    n++;
    const id = (prefix) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const f = { user: id('e1700000'), patient: id('e1710000'), rx: id('e1720000'), session: id('e1730000'), op: id('e1740000'),
      other: id('e1760000'), consultation: id('e1770000') };
    // Schema-valid legacy shape: the prescription's consultation belongs to
    // another patient of the same doctor (not corrected here by inference).
    const other = consultationOfOtherPatient
      ? `insert into public.patients(id,user_id,name,age,last_visit,status) values('${f.other}','${f.user}','Paciente sintética ${n}B',31,current_date,'novo');
         insert into public.consultations(id,user_id,patient_id,soap_note) values('${f.consultation}','${f.user}','${f.other}','Consulta sintética');`
      : '';
    sql(`insert into auth.users(id,email) values('${f.user}','race-${n}@example.invalid');
     insert into public.user_settings(user_id,prescriber_cpf) values('${f.user}','52998224725');
     insert into public.patients(id,user_id,name,age,last_visit,status) values('${f.patient}','${f.user}','Paciente sintética ${n}',30,current_date,'novo');
     ${other}
     insert into public.prescriptions(id,user_id,patient_id,consultation_id,storage_path,secret_code,expires_at,issuance_snapshot)
      values('${f.rx}','${f.user}','${f.patient}',${consultationOfOtherPatient ? `'${f.consultation}'` : 'null'},'rx/${f.user}/${f.rx}.pdf','synthetic',now()+interval '30 days',
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
  // Holders never release by the clock (Codex 04/11 17:48): the concurrent side
  // is first seen waiting on a lock, then the holder commits explicitly.
  const lockWaitOf = async (pid) => {
    for (let i = 0; i < 100; i++) {
      if (sql(`select coalesce(wait_event_type,'') from pg_stat_activity where pid=${pid}`) === 'Lock') return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  /** Runs `text` in a new connection and returns once it is seen waiting on a lock. */
  const startBlocked = async (text, label) => {
    const s = session(container);
    s.send(`select 'PID='||pg_backend_pid();`);
    await s.wait('PID=');
    const pid = backendPid(s);
    s.send(text);
    assert.ok(await lockWaitOf(pid), `${label}: did not wait on the lock`);
    return s;
  };
  /**
   * Codex 04/11 19:10: a refusal must come from NOWAIT, not from lock_timeout
   * (both are 55P03, both become 40001). The completion runs on a connection
   * that is already open and is watched until psql exits: being seen waiting
   * on a lock at any point is the regression.
   */
  const watchCompletion = async (f) => {
    const s = session(container);
    s.send(`select 'PID='||pg_backend_pid();`);
    await s.wait('PID=');
    const pid = backendPid(s);
    s.send(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica');`);
    for (let i = 0; i < 400 && !s.closed(); i++) {
      if (sql(`select coalesce(wait_event_type,'') from pg_stat_activity where pid=${pid}`) === 'Lock') return { s, waited: true };
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(s.closed(), 'completion neither refused nor waited');
    return { s, waited: false };
  };

  // 1. P1: two overlapping permissions for the same prepared operation.
  await check('overlapping permission (P1)', async () => {
  {
    const f = fixture();
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    const a = session(container);
    a.send(`begin;${service}select ${advance(f, 'psc_requested')} is not null;\n\\echo A_HELD`);
    await a.wait('A_HELD');
    // B waits on the doctor's lock that A holds; A commits only after that.
    const b = await startBlocked(`begin;${service}select ${advance(f, 'psc_requested')};commit;`, 'second permission');
    const ra = await a.finish('commit;');
    const rb = await b.finish('');
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

  // 2. P2: the prescription row is busy (another transaction holds it) while
  //    the session runs out. Completion never waits on the row: it refuses at
  //    once with 40001, publishes nothing, and a later retry sees the clock.
  await check('busy prescription row around the expiry (P2)', async () => {
  for (const [label, seconds, expect] of [['row-busy-then-expired', 2, 'cancelled_by_revocation'], ['row-busy-then-control', 120, 'completed']]) {
    const f = fixture({ minutes: 5 });
    toStored(f);
    sql(`update cortex_private.signature_sessions set expires_at=now()+interval '${seconds} seconds' where id='${f.session}'`);
    const holder = session(container);
    holder.send(`begin;select 1 from public.prescriptions where id='${f.rx}' for update;\n\\echo ROW_HELD`);
    await holder.wait('ROW_HELD');
    const watched = await watchCompletion(f);
    const released = await holder.finish('commit;');
    const busy = await watched.s.finish('commit;');
    assert.equal(released.status, 0, released.stderr);
    assert.equal(watched.waited, false, `${label}: completion waited on the busy row instead of refusing at once`);
    assert.notEqual(busy.status, 0, `${label}: completed while the row was held elsewhere`);
    assert.match(busy.stderr, /40001/, busy.stderr);
    assert.doesNotMatch(busy.stderr, /40P01/, busy.stderr);
    assert.equal(state(f), 'stored', `${label}: refused attempt changed the operation`);
    assert.equal(signed(f), 'generated');
    // Retry after the row is free: the clock decides.
    if (expect !== 'completed') await new Promise((r) => setTimeout(r, seconds * 1000 + 200));
    call(f, `public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')`);
    assert.equal(state(f), expect, `${label}: wrong outcome on retry`);
    assert.equal(signed(f), expect === 'completed' ? 'signed' : 'generated', `${label}: prescription status`);
    assert.equal(audits(f), expect === 'completed' ? 1 : 0, `${label}: audit rows`);
    results[label] = { firstAttempt: '40001', waitedOnRow: false, retry: expect };
  }
  // Control (disposable database only): without NOWAIT on the prescription
  // row the same observation must see the completion waiting.
  if (!beforeFix) {
    const f = fixture({ minutes: 5 });
    toStored(f);
    const original = sql(`select pg_get_functiondef('public.signature_complete(uuid,uuid,text,text)'::regprocedure)`);
    const site = 'from public.prescriptions where id=o.prescription_id for update nowait';
    assert.equal(original.split(site).length, 2, 'control: NOWAIT site not found in signature_complete');
    sql(original.replace(site, 'from public.prescriptions where id=o.prescription_id for update') + ';');
    try {
      const holder = session(container);
      holder.send(`begin;select 1 from public.prescriptions where id='${f.rx}' for update;\n\\echo ROW_HELD`);
      await holder.wait('ROW_HELD');
      const watched = await watchCompletion(f);
      await holder.finish('commit;');
      await watched.s.finish('commit;');
      assert.equal(watched.waited, true, 'control: a completion without NOWAIT was not seen waiting');
    } finally {
      sql(original + ';');
    }
    assert.equal(sql(`select pg_get_functiondef('public.signature_complete(uuid,uuid,text,text)'::regprocedure)`), original, 'control: signature_complete not restored');
    results.rowBusyControl = 'wait detected without NOWAIT';
  }
  });

  // 2b. Codex 15:59: a signature holding 123 against an ordinary clinical
  //     UPDATE of the same prescription, which locks its tuple first and then
  //     waits on 123 in guard_clinical_write. No deadlock in either order.
  for (const isolation of ['read committed', 'repeatable read']) {
    await check(`clinical update vs. signature holding 123 (${isolation})`, async () => {
      const f = fixture();
      toStored(f);
      const signer = session(container);
      signer.send(`begin isolation level ${isolation};select pg_advisory_xact_lock(hashtextextended('signature:${f.user}',125));select pg_advisory_xact_lock(hashtextextended('${f.user}',123));\n\\echo SIGNER_HOLDS_123`);
      await signer.wait('SIGNER_HOLDS_123');
      const updater = session(container);
      updater.send(`select 'PID='||pg_backend_pid();`);
      await updater.wait('PID=');
      const pid = backendPid(updater);
      updater.send(`begin;set local request.jwt.claim.role='service_role';update public.prescriptions set expires_at=expires_at where id='${f.rx}';commit;\n\\echo UPDATED`);
      let observed = false;
      for (let i = 0; i < 40 && !observed; i++) {
        observed = sql(`select coalesce(wait_event_type,'') from pg_stat_activity where pid=${pid}`) === 'Lock';
        if (!observed) await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(observed, 'The clinical update did not wait on 123');
      // Now the signature asks for the tuple the updater already holds.
      const signed1 = await signer.finish(`${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica');commit;`);
      const updated = await updater.finish('');
      const all = signed1.stderr + updated.stderr;
      assert.doesNotMatch(all, /40P01|deadlock/i, all);
      assert.notEqual(signed1.status, 0, 'The signature waited on a tuple while holding 123');
      assert.match(signed1.stderr, /40001/, signed1.stderr);
      assert.equal(updated.status, 0, updated.stderr);
      assert.equal(state(f), 'stored');
      // The same completion afterwards succeeds.
      call(f, `public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')`);
      assert.equal(state(f), 'completed');
      results[`clinicalUpdateFirst_${isolation.replace(' ', '_')}`] = 'signature 40001 at once, update committed, no deadlock';
    });
  }
  await check('signature waits on 123 behind a clinical update, then completes', async () => {
    const f = fixture();
    toStored(f);
    const updater = session(container);
    updater.send(`begin;set local request.jwt.claim.role='service_role';update public.prescriptions set expires_at=expires_at where id='${f.rx}';\n\\echo UPDATER_HOLDS`);
    await updater.wait('UPDATER_HOLDS');
    const signer = await startBlocked(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')->>'state';commit;`, 'signature behind the clinical update');
    const up = await updater.finish('commit;');
    const done = await signer.finish('');
    assert.doesNotMatch(done.stderr + up.stderr, /40P01|deadlock/i);
    assert.equal(done.status, 0, done.stderr);
    assert.equal(state(f), 'completed');
    results.signatureAfterClinicalUpdate = 'waited on 123, completed, no deadlock';
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
    // Intent in progress (uncommitted) while an existing operation asks for the PSC: waits only on the
    // clinical lock (key 123, taken before any epoch or row, like every clinical writer), then refuses.
    const f = fixture();
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    const deleter = session(container);
    deleter.send(`begin;set local request.jwt.claim.role='service_role';update public.patients set deletion_requested_at=now() where id='${f.patient}';\n\\echo INTENT_HELD`);
    await deleter.wait('INTENT_HELD');
    const writer = await startBlocked(`begin;${service}select ${advance(f, 'psc_requested')};commit;`, 'PSC permission beside the intent');
    const committed = await deleter.finish('commit;');
    assert.equal(committed.status, 0, committed.stderr);
    const r = await writer.finish('');
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
    revoker.send(`begin;${service}select public.signature_revoke_session('${f.user}');\n\\echo REVOKED`);
    await revoker.wait('REVOKED');
    const completer = await startBlocked(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')->>'state';commit;`, 'completion behind the revocation');
    await revoker.finish('commit;');
    const r = await completer.finish('');
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
    completer.send(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')->>'state';\n\\echo COMPLETED`);
    await completer.wait('COMPLETED');
    const revoker = await startBlocked(`begin;${service}select public.signature_revoke_session('${f.user}');commit;`, 'revocation behind the completion');
    await completer.finish('commit;');
    const r = await revoker.finish('');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(state(f), 'completed', 'A later revocation undid a completed signature');
    assert.equal(signed(f), 'signed');
    assert.equal(audits(f), 1);
    results.revocationBothOrders = 'revocation-first cancels; completion-first stays signed';
  }
  });

  // 7. Residual (Codex 15:26) 1: completion behind the legacy per-account
  //    clinical lock (key 123 of guard_clinical_write) until after the expiry.
  for (const [label, seconds, expect] of [['legacy-lock-expiry', 2, 'cancelled_by_revocation'], ['legacy-lock-control', 120, 'completed']]) {
    await check(`clinical lock held past expiry: ${label}`, async () => {
      const f = fixture({ minutes: 5 });
      toStored(f);
      sql(`update cortex_private.signature_sessions set expires_at=now()+interval '${seconds} seconds' where id='${f.session}'`);
      const holder = session(container);
      holder.send(`begin;select pg_advisory_xact_lock(hashtextextended('${f.user}',123));\n\\echo LEGACY_HELD`);
      await holder.wait('LEGACY_HELD');
      const completer = await startBlocked(`begin;${service}select public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica')->>'state';commit;`, `${label}: completion`);
      const observed = true;
      // Expiry case: keep the lock until the session's deadline has passed, by the database clock.
      if (expect !== 'completed') {
        for (let i = 0; i < 100 && sql(`select now()>expires_at from cortex_private.signature_sessions where id='${f.session}'`) !== 't'; i++)
          await new Promise((r) => setTimeout(r, 100));
      }
      await holder.finish('commit;');
      const done = await completer.finish('');
      assert.equal(done.status, 0, done.stderr);
      assert.equal(state(f), expect, `${label}: wrong outcome`);
      assert.equal(signed(f), expect === 'completed' ? 'signed' : 'generated', `${label}: prescription status`);
      assert.equal(audits(f), expect === 'completed' ? 1 : 0, `${label}: audit rows`);
      results[label] = { waitedOnLegacyLock: observed, state: expect };
    });
  }

  // 8. Residual 2: the patient of the prescription's consultation (B) is
  //    being deleted; the prescription's own patient (A) is not.
  const intentOn = (patient) => `begin;set local request.jwt.claim.role='service_role';update public.patients set deletion_requested_at=now() where id='${patient}';commit;`;
  await check('consultation patient intent, committed (RC)', async () => {
    const f = fixture({ consultationOfOtherPatient: true });
    sql(intentOn(f.other));
    const r = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], `begin;${service}select ${reserve(f)};commit;`);
    assert.notEqual(r.status, 0, 'Reserved while the consultation patient is being deleted');
    assert.match(r.stderr, /42501|Documento indispon/, r.stderr);
    assert.equal(Number(sql(`select count(*) from cortex_private.signature_operations where prescription_id='${f.rx}'`)), 0);
    results.consultationPatientRC = 'refused';
  });
  await check('consultation patient intent, existing operation before the PSC', async () => {
    const f = fixture({ consultationOfOtherPatient: true });
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    sql(intentOn(f.other));
    const r = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], `begin;${service}select ${advance(f, 'psc_requested')};commit;`);
    assert.notEqual(r.status, 0, 'Consultation patient being deleted reached the PSC');
    assert.equal(state(f), 'prepared');
    results.consultationPatientExistingOp = 'refused';
  });
  await check('consultation patient intent, old RR snapshot', async () => {
    const f = fixture({ consultationOfOtherPatient: true });
    const writer = session(container);
    writer.send(`begin isolation level repeatable read;select count(*) from public.patients;\n\\echo SNAPSHOT`);
    await writer.wait('SNAPSHOT');
    sql(intentOn(f.other));
    const r = await writer.finish(`${service}select ${reserve(f)};commit;`);
    assert.notEqual(r.status, 0, 'RR reservation after the consultation patient intent');
    assert.match(r.stderr, /40001|42501/, r.stderr);
    results.consultationPatientRR = (/ERROR:\s+(\w+):/.exec(r.stderr) || [])[1];
  });
  await check('consultation patient intent in progress', async () => {
    const f = fixture({ consultationOfOtherPatient: true });
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    const deleter = session(container);
    deleter.send(`begin;set local request.jwt.claim.role='service_role';update public.patients set deletion_requested_at=now() where id='${f.other}';\n\\echo INTENT_HELD`);
    await deleter.wait('INTENT_HELD');
    const writer = await startBlocked(`begin;${service}select ${advance(f, 'psc_requested')};commit;`, 'PSC permission beside the consultation patient intent');
    const committed = await deleter.finish('commit;');
    assert.equal(committed.status, 0, committed.stderr);
    const r = await writer.finish('');
    assert.notEqual(r.status, 0, 'PSC permission while the consultation patient intent was in progress');
    assert.match(r.stderr, /40001|55000|42501/, r.stderr);
    assert.equal(state(f), 'prepared');
    results.consultationPatientInProgress = (/ERROR:\s+(\w+):/.exec(r.stderr) || [])[1];
  });

  // 9. Codex 16:46: implicit FK lock on the account. A real account DELETE locks
  //    the auth.users tuple, then waits on 123 in guard_parent_deletion; a
  //    signature holding 123 must never wait on that tuple (its INSERTs take an
  //    implicit KEY SHARE through the user FK).
  for (const isolation of ['read committed', 'repeatable read']) {
    await check(`account delete vs. signature holding 123 (${isolation})`, async () => {
      const f = fixture();
      const signer = session(container);
      signer.send(`begin isolation level ${isolation};select pg_advisory_xact_lock(hashtextextended('signature:${f.user}',125));select pg_advisory_xact_lock(hashtextextended('${f.user}',123));\n\\echo SIGNER_HOLDS_123`);
      await signer.wait('SIGNER_HOLDS_123');
      const deleter = session(container);
      deleter.send(`select 'PID='||pg_backend_pid();`);
      await deleter.wait('PID=');
      const pid = backendPid(deleter);
      deleter.send(`begin;set local request.jwt.claim.role='service_role';delete from auth.users where id='${f.user}';commit;`);
      let observed = false;
      for (let i = 0; i < 40 && !observed; i++) {
        observed = sql(`select coalesce(wait_event_type,'') from pg_stat_activity where pid=${pid}`) === 'Lock';
        if (!observed) await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(observed, 'The account delete did not wait on 123');
      const signed1 = await signer.finish(`${service}select ${reserve(f)};commit;`);
      const deleted = await deleter.finish('');
      const all = signed1.stderr + deleted.stderr;
      assert.doesNotMatch(all, /40P01|deadlock/i, all);
      assert.notEqual(signed1.status, 0, 'The signature reserved while the account was being deleted');
      assert.match(signed1.stderr, /40001/, signed1.stderr);
      assert.equal(deleted.status, 0, deleted.stderr);
      assert.equal(Number(sql(`select count(*) from auth.users where id='${f.user}'`)), 0, 'Account not deleted');
      results[`accountDeleteFirst_${isolation.replace(' ', '_')}`] = 'signature 40001 at once, delete committed, no deadlock';
    });
  }
  await check('signature waits on 123 behind an account delete, then refuses', async () => {
    const f = fixture();
    const deleter = session(container);
    deleter.send(`begin;set local request.jwt.claim.role='service_role';delete from auth.users where id='${f.user}';\n\\echo DELETED_HELD`);
    await deleter.wait('DELETED_HELD');
    const signer = await startBlocked(`begin;${service}select ${reserve(f)};commit;`, 'signature behind the account delete');
    const del = await deleter.finish('commit;');
    const done = await signer.finish('');
    assert.doesNotMatch(done.stderr + del.stderr, /40P01|deadlock/i);
    assert.equal(del.status, 0, del.stderr);
    assert.notEqual(done.status, 0, 'Reserved for a deleted account');
    assert.match(done.stderr, /42501|40001/, done.stderr);
    results.signatureAfterAccountDelete = 'waited on 123, refused, no deadlock';
  });

  // 10. Codex 16:46: the reception classification (auth.users account_type)
  //     changed after an older RR snapshot: neither the token nor a reservation.
  await check('account classified as reception after an old RR snapshot', async () => {
    const f = fixture();
    const reader = session(container);
    reader.send(`begin isolation level repeatable read;select count(*) from auth.users;\n\\echo SNAPSHOT`);
    await reader.wait('SNAPSHOT');
    sql(`update auth.users set raw_app_meta_data=raw_app_meta_data||'{"account_type":"reception"}'::jsonb where id='${f.user}'`);
    const r = await reader.finish(`${service}select public.signature_session_token('${f.user}','${f.session}',1);commit;`);
    assert.notEqual(r.status, 0, 'Stale snapshot read the token of an account reclassified as reception');
    assert.match(r.stderr, /40001|42501/, r.stderr);
    // And after the change committed (RC): refused as reception.
    const after = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], `begin;${service}select ${reserve(f)};commit;`);
    assert.notEqual(after.status, 0, 'Reserved for an account reclassified as reception');
    results.receptionReclassifiedRR = (/ERROR:\s+(\w+):/.exec(r.stderr) || [])[1] ?? 'refused';
  });

  // 6. Two reservations of one document with different operation ids: exactly one.
  await check('double reservation', async () => {
  {
    const f = fixture();
    const other = f.op.replace(/^e174/, 'e175');
    const a = session(container);
    a.send(`begin;${service}select ${reserve(f)} is not null;\n\\echo A_RESERVED`);
    await a.wait('A_RESERVED');
    const b = await startBlocked(`begin;${service}select ${reserve(f, other)};commit;`, 'second reservation');
    const ra = await a.finish('commit;');
    assert.equal(ra.status, 0, ra.stderr);
    const rb = await b.finish('');
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
      // RED: an earlier D17 migration from git (BEFORE_COMMIT; default 38274c8).
      const source = beforeFix && name === '20261105100000_digital_signature.sql'
        ? required(spawnSync('git', ['show', `${process.env.BEFORE_COMMIT || '38274c8'}:supabase/migrations/` + name], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
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
