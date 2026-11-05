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
  /** The context the Edge would have verified for the doctor's Cortex session (never a body). */
  const auth = (f) => `jsonb_build_object('sessionId','${f.cortexSession}','aal','aal2','exp',floor(extract(epoch from clock_timestamp()+interval '1 hour'))::bigint)`;
  /** A doctor with CPF, a patient, a generated prescription and an active session. */
  function fixture({ minutes = 60, consultationOfOtherPatient = false } = {}) {
    n++;
    const id = (prefix) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const f = { user: id('e1700000'), patient: id('e1710000'), rx: id('e1720000'), session: id('e1730000'), op: id('e1740000'),
      other: id('e1760000'), consultation: id('e1770000'), cortexSession: id('e1790000'), factor: id('e1780000') };
    // Schema-valid legacy shape: the prescription's consultation belongs to
    // another patient of the same doctor (not corrected here by inference).
    const other = consultationOfOtherPatient
      ? `insert into public.patients(id,user_id,name,age,last_visit,status) values('${f.other}','${f.user}','Paciente sintética ${n}B',31,current_date,'novo');
         insert into public.consultations(id,user_id,patient_id,soap_note) values('${f.consultation}','${f.user}','${f.other}','Consulta sintética');`
      : '';
    sql(`insert into auth.users(id,email) values('${f.user}','race-${n}@example.invalid');
     insert into public.user_settings(user_id,prescriber_cpf) values('${f.user}','52998224725');
     insert into auth.mfa_factors(id,user_id,status,factor_type) values('${f.factor}','${f.user}','verified','totp');
     insert into auth.sessions(id,user_id,factor_id,aal) values('${f.cortexSession}','${f.user}','${f.factor}','aal2');
     insert into public.patients(id,user_id,name,age,last_visit,status) values('${f.patient}','${f.user}','Paciente sintética ${n}',30,current_date,'novo');
     ${other}
     insert into public.prescriptions(id,user_id,patient_id,consultation_id,storage_path,secret_code,expires_at,issuance_snapshot)
      values('${f.rx}','${f.user}','${f.patient}',${consultationOfOtherPatient ? `'${f.consultation}'` : 'null'},'rx/${f.user}/${f.rx}.pdf','synthetic',now()+interval '30 days',
       jsonb_build_object('prescriber','{}'::jsonb,'patient','{}'::jsonb,'pdf_sha256',${A64},'template_version','test','issued_at',now()));
     begin;${service}select public.signature_activate_session('${f.user}','vidaas','${f.session}',now()+interval '${minutes} minutes',repeat('c',64),${SEALED},${auth(f)});commit;`);
    return f;
  }
  const call = (f, expr) => sql(`begin;${service}select ${expr};commit;`);
  const reserve = (f, op = f.op) => `public.signature_reserve('${f.user}','${op}','${f.rx}',${A64},${auth(f)})`;
  // Productive steps carry the verified context; closing steps go to signature_close.
  const advance = (f, to, data = PREP, op = f.op) => ['ambiguous', 'failed', 'cancelled'].includes(to)
    ? `public.signature_close('${f.user}','${op}','${to}',${data})`
    : `public.signature_advance('${f.user}','${op}','${to}',${to === 'psc_requested' && data === PREP ? `${PREP}||jsonb_build_object('attempt',0)` : data},${auth(f)})`;
  const complete = (f) => `public.signature_complete('${f.user}','${f.op}','01','CN=AC Sintetica',${auth(f)})`;
  const toStored = (f) => {
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    call(f, advance(f, 'psc_requested'));
    // The signed object exists before its answer is stored (the commit point checks it).
    sql(`insert into storage.objects(bucket_id,name) values('prescriptions','rx/${f.user}/${f.rx}/signed-${f.op}.pdf')`);
    call(f, advance(f, 'stored', `jsonb_build_object('stagedPath','rx/${f.user}/${f.rx}/signed-${f.op}.pdf','signedSha256',repeat('f',64),'attempt',1)`));
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
    s.send(`begin;${service}select ${complete(f)};`);
    for (let i = 0; i < 400 && !s.closed(); i++) {
      if (sql(`select coalesce(wait_event_type,'') from pg_stat_activity where pid=${pid}`) === 'Lock') return { s, waited: true };
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(s.closed(), 'completion neither refused nor waited');
    return { s, waited: false };
  };
  /**
   * Runs `text` on an open connection and watches it until it finishes
   * (psql exits on error, or prints CALL_DONE): any lock wait seen at any
   * point is reported (Codex 05/11 03:24, R1/R4: a refusal must come from
   * NOWAIT or from not waiting at all, never from lock_timeout).
   */
  const watchCall = async (text) => {
    const s = session(container);
    s.send(`select 'PID='||pg_backend_pid();`);
    await s.wait('PID=');
    const pid = backendPid(s);
    s.send(`${text}\n\\echo CALL_DONE`);
    for (let i = 0; i < 400 && !s.closed() && !s.output().includes('CALL_DONE'); i++) {
      if (sql(`select coalesce(wait_event_type,'') from pg_stat_activity where pid=${pid}`) === 'Lock') return { s, waited: true };
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(s.closed() || s.output().includes('CALL_DONE'), 'call neither finished nor waited');
    return { s, waited: false };
  };
  /** Disposable database only: runs fn with one function rewritten, then restores it exactly. */
  const withMutated = async (signature, site, replacement, fn) => {
    const original = sql(`select pg_get_functiondef('${signature}'::regprocedure)`);
    assert.equal(original.split(site).length, 2, `control: site not found in ${signature}`);
    sql(original.replace(site, replacement) + ';');
    try {
      await fn();
    } finally {
      sql(original + ';');
    }
    assert.equal(sql(`select pg_get_functiondef('${signature}'::regprocedure)`), original, `control: ${signature} not restored`);
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
    call(f, `${complete(f)}`);
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
    const original = sql(`select pg_get_functiondef('public.signature_complete(uuid,uuid,text,text,jsonb)'::regprocedure)`);
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
    assert.equal(sql(`select pg_get_functiondef('public.signature_complete(uuid,uuid,text,text,jsonb)'::regprocedure)`), original, 'control: signature_complete not restored');
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
      const signed1 = await signer.finish(`${service}select ${complete(f)};commit;`);
      const updated = await updater.finish('');
      const all = signed1.stderr + updated.stderr;
      assert.doesNotMatch(all, /40P01|deadlock/i, all);
      assert.notEqual(signed1.status, 0, 'The signature waited on a tuple while holding 123');
      assert.match(signed1.stderr, /40001/, signed1.stderr);
      assert.equal(updated.status, 0, updated.stderr);
      assert.equal(state(f), 'stored');
      // The same completion afterwards succeeds.
      call(f, `${complete(f)}`);
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
    const signer = await startBlocked(`begin;${service}select ${complete(f)}->>'state';commit;`, 'signature behind the clinical update');
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
    sql(`begin;${service}select public.signature_begin_authorization('${f.user}','vidaas',repeat('${n % 10}',64),${SEALED},${auth(f)});commit;`);
    const reader = session(container);
    reader.send(`begin isolation level repeatable read;select count(*) from public.account_deletion_requests;\n\\echo SNAPSHOT`);
    await reader.wait('SNAPSHOT');
    sql(`begin;set local request.jwt.claim.role='service_role';insert into public.account_deletion_requests(user_id) values('${f.user}');commit;`);
    const expr = label === 'token'
      ? `public.signature_session_token('${f.user}','${f.session}',1,${auth(f)})`
      : `public.signature_consume_authorization('${f.user}','vidaas',repeat('${n % 10}',64),${auth(f)})`;
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
    const completer = await startBlocked(`begin;${service}select ${complete(f)}->>'state';commit;`, 'completion behind the revocation');
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
    completer.send(`begin;${service}select ${complete(f)}->>'state';\n\\echo COMPLETED`);
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
      const completer = await startBlocked(`begin;${service}select ${complete(f)}->>'state';commit;`, `${label}: completion`);
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
    const r = await reader.finish(`${service}select public.signature_session_token('${f.user}','${f.session}',1,${auth(f)});commit;`);
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
  // Codex 04/11 20:55: a candidate upload and the end of its operation, in both
  // orders. The Storage guard takes the doctor's 123 and reads the state under
  // it, so an object is either committed before the end (and then scheduled
  // for cleanup and discovered) or refused after it.
  await check('candidate upload against the end of its operation', async () => {
    const f = fixture();
    call(f, reserve(f));
    call(f, advance(f, 'prepared'));
    call(f, advance(f, 'psc_requested'));
    const path = `rx/${f.user}/${f.rx}/signed-${f.op}.pdf`;
    const upload = session(container);
    upload.send(`begin;set local role service_role;insert into storage.objects(bucket_id,name) values('prescriptions','${path}');\n\\echo UPLOADED`);
    await upload.wait('UPLOADED');
    // The end waits for the upload to commit (123), then schedules the cleanup.
    const ending = await startBlocked(`begin;${service}select ${advance(f, 'failed', `jsonb_build_object('code','invalid_signature','attempt',1)`)};commit;`, 'end of the operation');
    const uploaded = await upload.finish('commit;');
    const ended = await ending.finish('');
    assert.equal(uploaded.status, 0, uploaded.stderr);
    assert.equal(ended.status, 0, ended.stderr);
    assert.equal(sql(`select state||':'||cleanup_pending from cortex_private.signature_operations where operation_id='${f.op}'`), 'failed:true');
    const work = sql(`begin;${service}select public.signature_pending_work(500)::text;commit;`);
    assert.ok(work.includes(f.op) && work.includes('remove_candidate'), 'Committed candidate of an ended operation not discovered');
    // Inverse order: the operation already ended, the upload is refused.
    const g = fixture();
    call(g, reserve(g));
    call(g, advance(g, 'prepared'));
    call(g, advance(g, 'psc_requested'));
    call(g, advance(g, 'failed', `jsonb_build_object('code','psc_rejected','attempt',1)`));
    const late = docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
      `${bounds}begin;set local role service_role;insert into storage.objects(bucket_id,name) values('prescriptions','rx/${g.user}/${g.rx}/signed-${g.op}.pdf');commit;`);
    assert.notEqual(late.status, 0, 'Candidate accepted after its operation ended');
    assert.match(late.stderr, /live owned parent|42501/, late.stderr);
    assert.equal(Number(sql(`select count(*) from storage.objects where name='rx/${g.user}/${g.rx}/signed-${g.op}.pdf'`)), 0);
    results.candidateUploadVsEnd = 'upload first: end waited, cleanup scheduled and discovered; end first: upload refused';
  });
  // Cortex session fence (ASSINATURA_HANDLERS.md v3.1 §3 and §8) against the
  // commit point: logout, factor removal and not_after, in both orders and in
  // RC/RR. Contention is a 40001 without effect; a confirmed end is returned.
  const psql = (text) => docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], `${bounds}${text}`);
  const outcome = (f) => `(select coalesce(r->>'error_code',r->>'state') from (select ${complete(f)} r) x)`;
  for (const isolation of ['read committed', 'repeatable read']) {
    await check(`logout against the commit point (${isolation})`, async () => {
      // Logout committed first: the commit point ends the operation and returns it.
      {
        const f = fixture();
        toStored(f);
        sql(`delete from auth.sessions where id='${f.cortexSession}'`);
        const r = psql(`begin isolation level ${isolation};${service}select ${outcome(f)};commit;`);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), 'auth_session_ended');
        assert.equal(state(f), 'cancelled');
        assert.equal(signed(f), 'generated');
      }
      // Logout in progress (session row held): refused at once without effect;
      // after the logout commits, the operation is ended.
      {
        const f = fixture();
        toStored(f);
        const logout = session(container);
        logout.send(`begin;delete from auth.sessions where id='${f.cortexSession}';\n\\echo LOGGING_OUT`);
        await logout.wait('LOGGING_OUT');
        const watched = await watchCall(`begin isolation level ${isolation};${service}select ${complete(f)};commit;`);
        const busy = await watched.s.finish('');
        assert.equal(watched.waited, false, 'Commit point waited on the session held by the logout');
        assert.notEqual(busy.status, 0, 'Completed while the logout held the session');
        assert.match(busy.stderr, /40001/, busy.stderr);
        assert.equal(state(f), 'stored', 'Contention changed the operation');
        const done = await logout.finish('commit;');
        assert.equal(done.status, 0, done.stderr);
        assert.equal(sql(`begin;${service}select ${outcome(f)};commit;`), 'auth_session_ended');
      }
      // Commit point first (holding the session row): the logout waits, the
      // signature is published, then the logout commits.
      {
        const f = fixture();
        toStored(f);
        const signer = session(container);
        signer.send(`begin isolation level ${isolation};${service}select ${outcome(f)};\n\\echo SIGNED`);
        await signer.wait('SIGNED');
        const logout = await startBlocked(`begin;delete from auth.sessions where id='${f.cortexSession}';commit;`, 'logout behind the commit point');
        const rs = await signer.finish('commit;');
        const rl = await logout.finish('');
        assert.equal(rs.status, 0, rs.stderr);
        assert.match(rs.stdout, /completed/, rs.stdout);
        assert.equal(rl.status, 0, rl.stderr);
        assert.equal(signed(f), 'signed');
      }
      // RR snapshot older than the logout: 40001, no effect.
      if (isolation === 'repeatable read') {
        const f = fixture();
        toStored(f);
        const reader = session(container);
        reader.send(`begin isolation level repeatable read;select count(*) from auth.sessions;\n\\echo SNAPSHOT`);
        await reader.wait('SNAPSHOT');
        sql(`delete from auth.sessions where id='${f.cortexSession}'`);
        const r = await reader.finish(`${service}select ${complete(f)};commit;`);
        assert.notEqual(r.status, 0, 'Old RR snapshot completed after the logout');
        assert.match(r.stderr, /40001/, r.stderr);
        assert.equal(state(f), 'stored');
      }
      results[`logoutVsCommit_${isolation.replace(' ', '_')}`] = 'logout first: ended and returned; in progress: 40001 then ended; commit first: published, logout waited';
    });
  }

  await check('factor removed against the commit point', async () => {
    {
      const f = fixture();
      toStored(f);
      const removal = session(container);
      removal.send(`begin;delete from auth.mfa_factors where id='${f.factor}';\n\\echo REMOVING`);
      await removal.wait('REMOVING');
      const watched = await watchCall(`begin;${service}select ${complete(f)};commit;`);
      const busy = await watched.s.finish('');
      assert.equal(watched.waited, false, 'Commit point waited on the factor being removed');
      assert.notEqual(busy.status, 0, 'Completed while the factor was being removed');
      assert.match(busy.stderr, /40001/, busy.stderr);
      await removal.finish('commit;');
      assert.equal(sql(`begin;${service}select ${outcome(f)};commit;`), 'auth_session_ended');
      assert.equal(signed(f), 'generated');
    }
    {
      const f = fixture();
      toStored(f);
      const signer = session(container);
      signer.send(`begin;${service}select ${outcome(f)};\n\\echo SIGNED`);
      await signer.wait('SIGNED');
      const removal = await startBlocked(`begin;delete from auth.mfa_factors where id='${f.factor}';commit;`, 'factor removal behind the commit point');
      const rs = await signer.finish('commit;');
      await removal.finish('');
      assert.match(rs.stdout, /completed/, rs.stdout);
      assert.equal(signed(f), 'signed');
    }
    results.factorVsCommit = 'removal in progress: 40001 then ended; commit first: published, removal waited';
  });

  // not_after passes while the commit point waits on 123 (JWT and intent
  // still valid): the clock is read after the last lock, so it is refused.
  await check('not_after passing during the wait for the commit point', async () => {
    for (const [label, seconds, expect] of [['not_after-expires', 2, 'auth_session_ended'], ['not_after-control', 120, 'completed']]) {
      const f = fixture();
      toStored(f);
      sql(`update auth.sessions set not_after=now()+interval '${seconds} seconds' where id='${f.cortexSession}'`);
      const holder = session(container);
      holder.send(`begin;select pg_advisory_xact_lock(hashtextextended('${f.user}',123));\n\\echo HOLDS_123`);
      await holder.wait('HOLDS_123');
      const completer = await startBlocked(`begin;${service}select ${outcome(f)};commit;`, `${label}: commit point behind 123`);
      if (expect !== 'completed') {
        for (let i = 0; i < 100 && sql(`select clock_timestamp()>not_after from auth.sessions where id='${f.cortexSession}'`) !== 't'; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      await holder.finish('commit;');
      const r = await completer.finish('');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(expect), `${label}: ${r.stdout}`);
      results[label] = expect;
    }
  });

  // Control (disposable database only): without the session check the
  // logout-first case must be seen publishing.
  if (!beforeFix) {
    const f = fixture();
    toStored(f);
    const original = sql(`select pg_get_functiondef('public.signature_complete(uuid,uuid,text,text,jsonb)'::regprocedure)`);
    const site = 'if not cortex_private.signature_session_live(deadline) then';
    assert.equal(original.split(site).length, 2, 'control: session check not found in signature_complete');
    sql(original.replace(site, 'if false then') + ';');
    try {
      sql(`delete from auth.sessions where id='${f.cortexSession}'`);
      assert.equal(sql(`begin;${service}select ${outcome(f)};commit;`), 'completed', 'control: completion without the session check was not seen publishing');
    } finally {
      sql(original + ';');
    }
    assert.equal(sql(`select pg_get_functiondef('public.signature_complete(uuid,uuid,text,text,jsonb)'::regprocedure)`), original, 'control: signature_complete not restored');
    results.sessionFenceControl = 'publication detected without the session check';
  }
  // Codex 05/11 03:24. R1: nothing after the session fence may wait. R5: a
  // malformed context is refused before any lock. R4: the controls below
  // remove only one NOWAIT and must be seen waiting.
  const holdingExpiredState = async (f) => {
    sql(`insert into cortex_private.signature_oauth_states(state_hash,user_id,psc,verifier,created_at,expires_at)
      values(repeat('9',64),'${f.user}','vidaas',${SEALED},now()-interval '20 minutes',now()-interval '15 minutes')`);
    const holder = session(container);
    holder.send(`begin;${service}select public.signature_expire_sessions();\n\\echo PURGING`);
    await holder.wait('PURGING');
    return holder;
  };
  const beginWatched = (f, hash) => watchCall(`begin;${service}select public.signature_begin_authorization('${f.user}','vidaas',repeat('${hash}',64),${SEALED},${auth(f)}) is not null;commit;`);
  await check('authorization never waits on expired states purged elsewhere (R1)', async () => {
    const f = fixture();
    const holder = await holdingExpiredState(f);
    const watched = await beginWatched(f, '8');
    await holder.finish('commit;');
    const r = await watched.s.finish('');
    assert.equal(watched.waited, false, 'begin_authorization waited after the session fence');
    assert.equal(r.status, 0, r.stderr);
    results.authorizationBesidePurge = 'no wait after the fence';
  });
  await check('session activation never waits on the session it replaces (R1)', async () => {
    const f = fixture();
    const holder = session(container);
    holder.send(`begin;select 1 from cortex_private.signature_sessions where user_id='${f.user}' and status='active' for update;\n\\echo HELD`);
    await holder.wait('HELD');
    const watched = await watchCall(`begin;${service}select public.signature_activate_session('${f.user}','vidaas','${f.session.slice(0, -1)}a',now()+interval '1 hour',repeat('c',64),${SEALED},${auth(f)});commit;`);
    const r = await watched.s.finish('');
    await holder.finish('commit;');
    assert.equal(watched.waited, false, 'activate_session waited on the replaced session');
    assert.notEqual(r.status, 0, 'Activated while the replaced session was held');
    assert.match(r.stderr, /40001/, r.stderr);
    results.activationBesideHeldSession = '40001 at once';
  });
  await check('malformed context refused before the barrier (R5)', async () => {
    const f = fixture();
    const holder = session(container);
    holder.send(`begin;select pg_advisory_xact_lock(hashtextextended('signature:${f.user}',125));\n\\echo HOLDS_125`);
    await holder.wait('HOLDS_125');
    const watched = await watchCall(`begin;${service}select public.signature_reserve('${f.user}','${f.op}','${f.rx}',${A64},'{"aal":"aal1"}'::jsonb);commit;`);
    const r = await watched.s.finish('');
    await holder.finish('commit;');
    assert.equal(watched.waited, false, 'Malformed context waited on the barrier');
    assert.match(r.stderr, /22023/, r.stderr);
    results.malformedContextBeforeBarrier = '22023 without waiting';
  });
  if (!beforeFix) {
    // R1 control: the purge put back after the fence must be seen waiting.
    await withMutated('public.signature_begin_authorization(uuid,text,text,jsonb,jsonb)', ' created:=clock_timestamp();\n insert into',
      ' created:=clock_timestamp();\n delete from cortex_private.signature_oauth_states where user_id=p_user and expires_at<=created;\n insert into', async () => {
        const f = fixture();
        const holder = await holdingExpiredState(f);
        const watched = await beginWatched(f, '7');
        await holder.finish('commit;');
        await watched.s.finish('');
        assert.equal(watched.waited, true, 'control: a purge after the fence was not seen waiting');
      });
    // R4 controls: only the NOWAIT of auth.sessions, then only that of auth.mfa_factors.
    await withMutated('cortex_private.signature_session_fence(uuid,jsonb)', "where id=(p_auth->>'sessionId')::uuid and user_id=p_user for share nowait",
      "where id=(p_auth->>'sessionId')::uuid and user_id=p_user for share", async () => {
        const f = fixture();
        toStored(f);
        const logout = session(container);
        logout.send(`begin;delete from auth.sessions where id='${f.cortexSession}';\n\\echo LOGGING_OUT`);
        await logout.wait('LOGGING_OUT');
        const watched = await watchCall(`begin;${service}select ${complete(f)};commit;`);
        await logout.finish('commit;');
        await watched.s.finish('');
        assert.equal(watched.waited, true, 'control: the session lock without NOWAIT was not seen waiting');
      });
    await withMutated('cortex_private.signature_session_fence(uuid,jsonb)', 'where id=v_session.factor_id and user_id=p_user for share nowait',
      'where id=v_session.factor_id and user_id=p_user for share', async () => {
        const f = fixture();
        toStored(f);
        const removal = session(container);
        removal.send(`begin;delete from auth.mfa_factors where id='${f.factor}';\n\\echo REMOVING`);
        await removal.wait('REMOVING');
        const watched = await watchCall(`begin;${service}select ${complete(f)};commit;`);
        await removal.finish('commit;');
        await watched.s.finish('');
        assert.equal(watched.waited, true, 'control: the factor lock without NOWAIT was not seen waiting');
      });
    results.authNowaitControls = 'purge after the fence, session and factor locks without NOWAIT: all seen waiting';
  }
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
