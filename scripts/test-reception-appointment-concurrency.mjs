import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const migration = '20261104006000_reception_appointment_changes.sql';
const bounds = "set statement_timeout='8s';set lock_timeout='6s';set deadlock_timeout='100ms';";
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 30000 });
const required = result => { assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout.trim(); };
const claims = actor => `set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
const query = (container, source) => required(docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], bounds + source));

function session(container) {
  const applicationName = `appointment-race-${randomUUID()}`;
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { windowsHide: true });
  let output = '', errors = '';
  const listeners = new Set();
  child.stdout.on('data', data => { output += data; for (const notify of listeners) notify(); });
  child.stderr.on('data', data => { errors += data; });
  child.stdin.on('error', () => {});
  const done = new Promise((resolveDone, reject) => { child.once('error', reject); child.once('close', status => resolveDone({ status, output, errors })); });
  const send = sql => child.stdin.write(sql + '\n');
  send(bounds + `set application_name='${applicationName}';`);
  return {
    applicationName, send,
    wait: marker => new Promise((resolveMarker, reject) => {
      const cleanup = () => { clearTimeout(timer); listeners.delete(check); };
      const check = () => { if (output.includes(marker)) { cleanup(); resolveMarker(); } };
      const timer = setTimeout(() => { cleanup(); child.kill(); reject(new Error('Timed out before ' + marker)); }, 12000);
      listeners.add(check); check();
      done.then(() => { if (!output.includes(marker)) { cleanup(); reject(new Error('Session ended before ' + marker + ': ' + errors)); } }, reject);
    }),
    finish: async sql => {
      send(sql); child.stdin.end();
      let timer;
      try { return await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('Session did not finish')); }, 12000); })]); }
      finally { clearTimeout(timer); }
    },
    close: () => { child.stdin.end(); child.kill(); },
  };
}

async function waitBlocked(container, holder, waiter) {
  for (let attempt = 0; attempt < 35; attempt++) {
    const blocked = query(container, `select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${holder.applicationName}' where w.application_name='${waiter.applicationName}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`);
    if (blocked === 't') return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error('Expected row/gate wait was not observed');
}

export async function testReceptionAppointmentConcurrency(container) {
  assert.match(container, /^cortex-(test|appointment-race)-[a-z0-9-]+$/);
  const sql = source => query(container, source);
  const doctor = 'b7100000-0000-4000-8000-000000000001', staff = 'b7100000-0000-4000-8000-000000000002', patient = 'b7500000-0000-4000-8000-000000000001';
  sql(`insert into auth.users(id,email) values('${doctor}','appointment-race-doctor@example.invalid'),('${staff}','appointment-race-reception@example.invalid');
    insert into public.patients(id,user_id,name,status) values('${patient}','${doctor}','Pessoa sintética concorrência','novo');`);
  const clinic = sql(`begin;${claims(doctor)}select public.create_clinic('Synthetic appointment concurrency');commit;`);
  sql(`begin;set local role service_role;set local request.jwt.claim.role='service_role';select public.provision_clinic_receptionist('${doctor}','${staff}','Synthetic appointment reception',array['${doctor}'::uuid]);commit;`);
  const contact = sql(`begin;${claims(staff)}select public.reception_create_contact('${clinic}','Contato sintético concorrência','41999990000',gen_random_uuid());commit;`);
  sql(`begin;${claims(staff)}select public.reception_link_patient('${contact}','${doctor}','${patient}','self');commit;`);
  // This instrument exists only in this disposable test database. Pause after
  // PostgreSQL takes the row lock and before guard_clinical_write takes the
  // owner's advisory lock; no production trigger or function is replaced.
  sql(`create schema cortex_test;
    create function cortex_test.pause_appointment_writer() returns trigger language plpgsql security definer set search_path='' as $$
    begin if current_setting('cortex_test.pause',true)='yes' then perform pg_catalog.pg_advisory_xact_lock(73421,1);end if;return new;end $$;
    revoke all on function cortex_test.pause_appointment_writer() from public,anon,authenticated,service_role;
    create trigger ab_test_appointment_gate before update on public.appointments for each row execute function cortex_test.pause_appointment_writer();`);
  const outcomes = [];
  try {
    let day = 11;
    for (const isolation of ['read committed', 'repeatable read']) for (const order of ['doctor-first', 'reception-first', 'two-reception']) {
      const date = `2099-12-${day++}`;
      const payload = JSON.stringify({ doctorId: doctor, contactId: contact, patientId: patient, startTime: `${date}T12:00Z`, endTime: `${date}T12:30Z`, type: 'retorno' });
      const appointment = sql(`begin;${claims(staff)}select public.reception_book_appointment('${clinic}','${payload}',gen_random_uuid());commit;`);
      const auditBefore = Number(sql(`select count(*) from public.reception_audit where resource_id='${appointment}' and action='appointment_updated';`));
      const directUpdate = `with changed as (update public.appointments set start_time='${date}T15:00Z',end_time='${date}T15:30Z',title='Edição médica sintética' where id='${appointment}' and user_id='${doctor}' and revision=1 returning id) select 'DOCTOR_UPDATED|'||count(*) from changed`;
      const change = `select public.reception_change_appointment('${clinic}','${appointment}',1,'reschedule','${date}T16:00Z','${date}T16:30Z')`;
      const first = session(container), second = session(container);
      let gate, calendarHeldBeforeRow = null, winner, loser;
      try {
        if (order === 'doctor-first') {
          gate = session(container);
          gate.send('begin;select pg_advisory_xact_lock(73421,1);\n\\echo GATE');
          await gate.wait('GATE');
          first.send(`begin;${claims(doctor)}set local cortex_test.pause='yes';`);
          const winnerPending = first.finish(`${directUpdate};commit;`);
          await waitBlocked(container, gate, first);
          second.send(`begin isolation level ${isolation};${claims(staff)}select count(*) from public.patients;`);
          const loserPending = second.finish(`${change};commit;`);
          await waitBlocked(container, first, second);
          calendarHeldBeforeRow = sql(`select pg_try_advisory_xact_lock(hashtextextended('${doctor}',123));`) !== 't';
          const released = await gate.finish('commit;');
          assert.equal(released.status, 0, released.errors);
          [winner, loser] = await Promise.all([winnerPending, loserPending]);
        } else {
          second.send(`begin isolation level ${isolation};${claims(order === 'reception-first' ? doctor : staff)}select count(*) from public.patients;\n\\echo SNAPSHOT`);
          await second.wait('SNAPSHOT');
          first.send(`begin;${claims(staff)}${change};\n\\echo CHANGED`);
          await first.wait('CHANGED');
          const loserPending = second.finish(`${order === 'reception-first' ? directUpdate : change};commit;`);
          await waitBlocked(container, first, second);
          winner = await first.finish('commit;');
          loser = await loserPending;
        }
        const winnerCode = winner.errors.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null;
        const loserCode = loser.errors.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null;
        process.stdout.write(JSON.stringify({ isolation, order, winnerCode, loserCode, calendarHeldBeforeRow }) + '\n');
        assert.notEqual(winnerCode, '40P01', 'Doctor/RPC lock order deadlocked');
        assert.notEqual(loserCode, '40P01', 'Doctor/RPC lock order deadlocked');
        assert.equal(winner.status, 0, winner.errors);
        if (order === 'reception-first' && isolation === 'read committed') {
          assert.equal(loser.status, 0, loser.errors);
          assert.match(loser.output, /DOCTOR_UPDATED\|0/);
        } else {
          assert.notEqual(loser.status, 0, 'Both stale edits committed');
          assert.equal(loserCode, '40001', loser.errors);
        }
        if (order === 'doctor-first') {
          assert.equal(calendarHeldBeforeRow, false, 'RPC held calendar before row lock');
          assert.match(winner.output, /DOCTOR_UPDATED\|1/);
        }
        const expectedHour = order === 'doctor-first' ? '15' : '16';
        const expectedActor = order === 'doctor-first' ? doctor : staff;
        assert.equal(sql(`select revision||'|'||to_char(start_time at time zone 'UTC','HH24:MI')||'|'||updated_by||'|'||patient_id||'|'||contact_id from public.appointments where id='${appointment}';`), `2|${expectedHour}:00|${expectedActor}|${patient}|${contact}`);
        assert.equal(Number(sql(`select count(*) from public.reception_audit where resource_id='${appointment}' and action='appointment_updated';`)), auditBefore + 1, 'Stale edit added duplicate history');
        outcomes.push({ isolation, order, winnerCode, loserCode, calendarHeldBeforeRow });
      } finally { gate?.close(); first.close(); second.close(); }
    }
    assert.equal(outcomes.length, 6);
    for (const isolation of ['read committed', 'repeatable read']) for (const completion of ['manual', 'metadata']) {
      const date = `2099-12-${day++}`;
      const payload = JSON.stringify({ doctorId: doctor, contactId: contact, patientId: patient, startTime: `${date}T12:00Z`, endTime: `${date}T12:30Z`, type: 'retorno' });
      const appointment = sql(`begin;${claims(staff)}select public.reception_book_appointment('${clinic}','${payload}',gen_random_uuid());commit;`);
      const source = randomUUID();
      if (completion === 'manual') {
        sql(`begin;${claims(doctor)}insert into public.clinical_work_items(id,user_id,patient_id,kind,title,content,details,status) values('${source}','${doctor}','${patient}','draft','Consulta sintética','SYNTHETIC REVIEWED NOTE','{"appointmentId":"${appointment}"}','draft');commit;`);
      } else {
        sql(`begin;${claims(doctor)}insert into public.consultations(id,user_id,patient_id,appointment_id,soap_note) values('${source}','${doctor}','${patient}','${appointment}','SYNTHETIC APPROVED NOTE');commit;`);
      }
      const gate = session(container), clinical = session(container), reception = session(container);
      try {
        gate.send(`begin;select id from public.patients where id='${patient}' for update;\n\\echo PATIENT`);
        await gate.wait('PATIENT');
        clinical.send(`begin isolation level ${isolation};${completion === 'manual' ? claims(doctor) : "set local role service_role;set local request.jwt.claim.role='service_role';"}`);
        const completionSql = completion === 'manual' ? `select public.finalize_manual_encounter('${source}',0)` : `select public.complete_consultation_metadata('${doctor}','${patient}','${source}')`;
        const completed = clinical.finish(`${completionSql};commit;`);
        await waitBlocked(container, gate, clinical);
        let refused;
        reception.send(`begin isolation level ${isolation};${claims(staff)}`);
        const receptionPending = reception.finish(`select public.reception_change_appointment('${clinic}','${appointment}',1,'reschedule','${date}T16:00Z','${date}T16:30Z');commit;`).then(result => { refused = result; return result; });
        let waitedForAccount = false;
        for (let attempt = 0; attempt < 35; attempt++) {
          if (refused) break;
          waitedForAccount = sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${clinical.applicationName}' where w.application_name='${reception.applicationName}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't';
          if (waitedForAccount) break;
          await new Promise(resolveWait => setTimeout(resolveWait, 25));
        }
        assert.ok(refused || waitedForAccount, 'RPC neither refused nor reached the observed owner lock');
        const released = await gate.finish('commit;');
        assert.equal(released.status, 0, released.errors);
        const [clinicalResult, receptionResult] = await Promise.all([completed, receptionPending]);
        const clinicalCode = clinicalResult.errors.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null;
        const receptionCode = receptionResult.errors.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null;
        const outcome = { isolation, completion, clinicalCode, receptionCode, waitedForAccount };
        process.stdout.write(JSON.stringify(outcome) + '\n');
        assert.notEqual(clinicalCode, '40P01', 'Clinical completion/RPC deadlock');
        assert.notEqual(receptionCode, '40P01', 'Clinical completion/RPC deadlock');
        assert.equal(clinicalResult.status, 0, clinicalResult.errors);
        assert.equal(receptionCode, '40001', receptionResult.errors);
        assert.match(receptionResult.errors, /Agenda em alteração/);
        assert.equal(waitedForAccount, false, 'RPC waited while holding appointment row');
        assert.equal(sql(`select revision||'|'||status||'|'||to_char(start_time at time zone 'UTC','HH24:MI')||'|'||patient_id||'|'||contact_id from public.appointments where id='${appointment}';`), `2|realizado|12:00|${patient}|${contact}`);
        assert.equal(sql(`select count(*) from public.consultations where appointment_id='${appointment}' and user_id='${doctor}' and patient_id='${patient}';`), '1', 'Clinical completion duplicated or lost encounter');
        assert.equal(sql(`select count(*) from public.reception_audit where resource_id='${appointment}' and action='appointment_updated';`), '1', 'Refused reschedule added history');
        outcomes.push(outcome);
      } finally { gate.close(); clinical.close(); reception.close(); }
    }
    assert.equal(outcomes.length, 10);
    process.stdout.write('Passed appointment concurrency: six observed row races and four clinical completion races; CAS, author, beneficiary and single audit\n');
  } finally {
    sql('drop trigger ab_test_appointment_gate on public.appointments;drop schema cortex_test cascade;');
  }
}

export async function runReceptionAppointmentRegression({ beforeChanges = false, blockingPrototype = false } = {}) {
  const container = `cortex-appointment-race-${randomUUID().slice(0, 8)}`;
  try {
    required(docker(['run', '--detach', '--rm', '--name', container, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (docker(['exec', container, 'pg_isready', '-U', 'postgres']).status === 0) { ready = true; break; }
      await new Promise(resolveWait => setTimeout(resolveWait, 500));
    }
    assert.ok(ready, 'Disposable PostgreSQL did not start');
    query(container, readFileSync('supabase/tests/bootstrap.sql', 'utf8'));
    for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && !(beforeChanges && name === migration)).sort()) query(container, readFileSync(resolve('supabase/migrations', name), 'utf8'));
    if (blockingPrototype) {
      // Diagnostic only: demonstrate why reversing the row/account lock order
      // without a nonblocking acquisition is unsafe for clinical completion.
      query(container, `do $prototype$ declare original text;changed text;begin
        select pg_get_functiondef('public.reception_change_appointment(uuid,uuid,integer,text,timestamptz,timestamptz)'::regprocedure) into original;
        changed:=replace(original,$guard$ if not pg_try_advisory_xact_lock(hashtextextended(a.user_id::text,123)) then
  raise exception 'Agenda em alteração. Atualize antes de confirmar novamente.' using errcode='40001';
 end if;$guard$,'');
        if changed=original then raise exception 'Prototype guard point missing';end if;
        execute changed;
      end $prototype$;`);
    }
    await testReceptionAppointmentConcurrency(container);
  } finally { required(docker(['stop', container])); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.ok(process.argv.slice(2).every(arg => ['--before-appointment-changes', '--blocking-calendar-prototype'].includes(arg)), 'Unknown diagnostic option');
  assert.ok(!(process.argv.includes('--before-appointment-changes') && process.argv.includes('--blocking-calendar-prototype')), 'Choose one diagnostic mode');
  await runReceptionAppointmentRegression({ beforeChanges: process.argv.includes('--before-appointment-changes'), blockingPrototype: process.argv.includes('--blocking-calendar-prototype') });
}
