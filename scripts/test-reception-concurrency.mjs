import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Called only by test-database.mjs after it builds a disposable synthetic database.
export async function testReceptionConcurrency(container) {
  const sync = (source) => {
    const result = spawnSync(
      'docker',
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
      { input: source, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const admin = 'd1000000-0000-4000-8000-000000000001';
  const staffA = 'd1000000-0000-4000-8000-000000000002';
  const staffB = 'd1000000-0000-4000-8000-000000000003';
  const claims = (actor) =>
    `set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
  sync(
    `insert into auth.users(id,email) values('${admin}','race-admin@example.invalid'),('${staffA}','race-a@example.invalid'),('${staffB}','race-b@example.invalid');`,
  );
  const clinic = sync(`begin;${claims(admin)}select public.create_clinic('Synthetic concurrency');commit;`);
  sync(`begin;set local role service_role;set local request.jwt.claim.role='service_role';
    select public.provision_clinic_receptionist('${admin}','${staffA}','Race A',array['${admin}'::uuid]);
    select public.provision_clinic_receptionist('${admin}','${staffB}','Race B',array['${admin}'::uuid]);commit;`);
  const contact = sync(
    `begin;${claims(staffA)}select public.reception_create_contact('${clinic}','Synthetic family','41999990000',gen_random_uuid());commit;`,
  );
  const receptionCase = sync(
    `begin;${claims(staffA)}select public.reception_create_case('${contact}','${admin}','Concurrent claim','scheduling',gen_random_uuid());commit;`,
  );
  function session() {
    const child = spawn(
      'docker',
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
      { windowsHide: true },
    );
    let output = '';
    let errors = '';
    let readers = [];
    child.stdout.on('data', (data) => {
      output += data;
      for (const reader of readers) if (output.includes(reader.marker)) reader.resolve();
    });
    child.stderr.on('data', (data) => {
      errors += data;
    });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        for (const reader of readers)
          reader.reject(new Error('Session closed before ' + reader.marker + ': ' + errors));
        resolve({ code, output, errors });
      });
    });
    return {
      send: (sql) => child.stdin.write(sql + '\n'),
      end: () => child.stdin.end(),
      done,
      marker: (marker) =>
        new Promise((resolve, reject) => {
          if (output.includes(marker)) resolve();
          else readers.push({ marker, resolve, reject });
        }),
    };
  }
  async function contest(
    firstSql,
    secondSql,
    expectedCode,
    repeatable = false,
    firstActor = staffA,
    secondActor = staffB,
  ) {
    const second = session();
    second.send(
      `begin ${repeatable ? 'isolation level repeatable read' : ''};${claims(secondActor)}select count(*) from public.patients;\n\\echo SNAPSHOT`,
    );
    await second.marker('SNAPSHOT');
    const first = session();
    first.send(`begin;${claims(firstActor)}${firstSql};\n\\echo HELD\nselect pg_sleep(1);commit;`);
    first.end();
    await first.marker('HELD');
    second.send(`${secondSql};commit;`);
    second.end();
    const [a, b] = await Promise.all([first.done, second.done]);
    assert.equal(a.code, 0, a.errors);
    if (expectedCode === null) assert.equal(b.code, 0, b.errors);
    else {
      assert.notEqual(b.code, 0, 'Both competing transactions committed');
      assert.ok((Array.isArray(expectedCode)?expectedCode:[expectedCode]).some(code=>b.errors.includes(code)), b.errors);
    }
  }
  await contest(
    `select public.reception_update_case('${receptionCase}',1,'claim','{}')`,
    `select public.reception_update_case('${receptionCase}',1,'claim','{}')`,
    '40001',
  );
  assert.equal(sync(`select assigned_to from public.reception_cases where id='${receptionCase}'`), staffA);
  const payload = (start) =>
    JSON.stringify({
      doctorId: admin,
      contactId: contact,
      patientId: null,
      beneficiaryName: 'Synthetic first patient',
      dateOfBirth: null,
      relationship: 'guardian',
      startTime: `2099-11-03T${start}:00Z`,
      endTime: `2099-11-03T${start.slice(0, 2)}:30:00Z`,
      type: 'novo',
    });
  const booking = (start) =>
    `select public.reception_book_appointment('${clinic}','${payload(start)}',gen_random_uuid())`;
  // The custody barrier may reject the preliminary request before the slot lock.
  await contest(booking('12:00'), booking('12:00'), ['23P01','40001']);
  sync(`begin;${claims(staffB)}do $$ begin begin
    perform public.reception_book_appointment('${clinic}','${payload('12:00')}',gen_random_uuid());
    raise exception 'Occupied slot accepted on retry';
    exception when sqlstate '23P01' then null;end;end $$;commit;`);
  assert.equal(sync(`select count(*) from public.appointments where clinic_id='${clinic}'`), '1');
  assert.equal(
    sync(`select count(*) from public.patients where user_id='${admin}'`),
    '1',
    'Failed concurrent booking left a patient stub',
  );
  // A stale REPEATABLE READ snapshot must abort, rather than miss a committed slot.
  await contest(booking('13:00'), booking('13:00'), '40001', true);
  assert.equal(sync(`select count(*) from public.appointments where clinic_id='${clinic}'`), '2');
  assert.equal(sync(`select count(*) from public.patients where user_id='${admin}'`), '2');
  const confirmationPatient = 'd2000000-0000-4000-8000-000000000009';
  sync(`insert into public.patients(id,user_id,name,status) values('${confirmationPatient}','${admin}','Synthetic link race','novo');`);
  const confirmation = (relation) => `select public.reception_link_patient('${contact}','${admin}','${confirmationPatient}','${relation}')`;
  await contest(confirmation('guardian'), confirmation('family'), '22023');
  await contest(confirmation('guardian'), confirmation('guardian'), null);
  assert.equal(sync(`select relationship||'|'||confirmed_by from public.patient_contact_links where contact_id='${contact}' and patient_id='${confirmationPatient}'`), 'guardian|' + staffA);
  assert.equal(sync(`select count(*) from public.reception_audit where resource_id='${contact}' and action='beneficiary_confirmed' and details->>'patientId'='${confirmationPatient}'`), '1');
  const correction = (revision, relation) => `select public.reception_update_link_relationship('${contact}','${confirmationPatient}',${revision},'${relation}')`;
  await contest(correction(1, 'family'), confirmation('guardian'), '22023', false, admin, staffB);
  await contest(correction(2, 'other'), correction(2, 'self'), '40001', false, admin, admin);
  assert.equal(sync(`select relationship||'|'||revision||'|'||confirmed_by from public.patient_contact_links where contact_id='${contact}' and patient_id='${confirmationPatient}'`), 'other|3|' + staffA);
  assert.equal(sync(`select count(*) from public.reception_audit where resource_id='${contact}' and action='beneficiary_relationship_corrected' and details->>'patientId'='${confirmationPatient}'`), '2');
  const doctor = 'd1000000-0000-4000-8000-000000000004';
  sync(`insert into auth.users(id,email) values('${doctor}','race-doctor@example.invalid');
   begin;${claims(admin)}select public.invite_clinic_doctor('${clinic}','race-doctor@example.invalid');commit;
   begin;${claims(doctor)}select public.respond_clinic_invitation('${clinic}',true);commit;
   begin;${claims(admin)}select public.update_reception_staff('${staffA}',array['${admin}'::uuid,'${doctor}'::uuid],true);commit;`);
  await contest(
    `select public.reception_update_case('${receptionCase}',2,'route','{"doctorId":"${doctor}"}')`,
    `select public.update_reception_staff('${staffA}',array['${admin}'::uuid],true)`,
    null,
    false,
    staffA,
    admin,
  );
  assert.equal(
    sync(`select assigned_to is null from public.reception_cases where id='${receptionCase}'`),
    't',
    'Concurrent routing retained a revoked assignee',
  );
  const draftCase = sync(
    `begin;${claims(staffA)}select public.reception_create_case('${contact}','${admin}','Concurrent draft routing','scheduling',gen_random_uuid());commit;`,
  );
  await contest(
    `select public.reception_update_case('${draftCase}',1,'route','{"doctorId":"${doctor}"}')`,
    `select public.reception_save_draft('${draftCase}','Stale scoped write',0)`,
    '42501',
    false,
    admin,
    staffA,
  );
  assert.equal(
    sync(`select count(*) from public.reception_case_drafts where case_id='${draftCase}'`),
    '0',
    'Routed case accepted a draft under an old scope',
  );
  await contest(
    `select public.reception_update_contact('${contact}',1,'Concurrent correction winner','41999990000')`,
    `select public.reception_update_contact('${contact}',1,'Stale correction loser','41999990000')`,
    '40001',
    false,
    admin,
    admin,
  );
  assert.equal(
    sync(`select name from public.clinic_contacts where id='${contact}'`),
    'Concurrent correction winner',
    'Contact correction was overwritten',
  );
  process.stdout.write(
    'Passed reception concurrency: claim, booking, repeatable-read booking, no orphan stubs, link confirmation/correction, route/revoke, route/draft, contact correction\n',
  );
}
