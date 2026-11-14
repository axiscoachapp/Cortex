#!/usr/bin/env node
// Loads the ANONYMISED, organised sample into a Cortex project for a demo
// account, through the Management API (no user session). One Cortex patient
// per person: in this demo a single account receives the charts of every
// legacy doctor, each note saying which doctor wrote it.
//
//   plan    what is in the project and what would be loaded (counts only)
//   wipe    permanently deletes EVERY patient of the project (take a backup first)
//   load    inserts the sample for the demo account (idempotent: ON CONFLICT DO NOTHING)
//   files   puts the sample's imported files again (object and row), as the staging has them now;
//           --rehearse runs the database half in a transaction that is rolled back
//   verify  reads the sample back as the demo account, through row level security
//   fixture writes the same rows as a JSON file for the local visual audit (no project needed)
//
// Usage: node scripts/personalmed/sample-load.mjs <plan|wipe|load|files|verify|fixture> --project <ref> [--dir <folder>] [--yes-delete-all-patients] [--rehearse]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lit, query, serviceKey } from '../supabase-rollout/lib.mjs';
import { loadOrCreateKey } from './local-key.mjs';
import { originalBody, renderDayNote, renderProfile } from './organize.mjs';
import { DOCTOR_LABEL, readAll, sampleDir } from './sample.mjs';
import { decryptBuffer } from './secure-staging.mjs';
import { uuidv5 } from './transforms.mjs';

const args = process.argv.slice(2);
const command = args[0];
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const REF = opt('--project');
if (!command || !REF) throw new Error('usage: sample-load.mjs <plan|wipe|load|verify> --project <ref>');
const DIR = sampleDir(opt('--dir'));
const key = loadOrCreateKey(DIR);
const q = (sql) => query(REF, sql);
/** Runs as the service role inside one transaction, like the product's own functions. */
const asService = (sql) => q(`begin; select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role; ${sql}; commit;`);
const json = (value) => `${lit(JSON.stringify(value))}::jsonb`;
const doctorOf = (e) => DOCTOR_LABEL[Number(String(e.sourceDoctorId ?? '').replace('user:', ''))] ?? 'Equipe';
const UNDATED = new Set(['history_no_dates', 'qp_hda_no_first_visit']);
/** What the list of files shows beside an imported file; the second is the tag of the first load. */
const FILE_TAG = 'Importado do PersonalMed';
const IMPORT_TAGS = [FILE_TAG, 'importado-personalmed'];
const today = new Date().toISOString().slice(0, 10);

/** The demo account: the first clinical account that administers a clinic. */
async function demoAccount() {
  const rows = await q(`select m.user_id from public.clinic_members m join auth.users u on u.id=m.user_id where m.role='admin' and m.status='active' order by u.created_at limit 1`);
  if (!rows.length) throw new Error('no active clinic admin account in the project');
  return rows[0].user_id;
}

/** Rows for every table, built from the anonymised staging and the organised layer. */
function build(userId) {
  const all = readAll(join(DIR, 'anonymous'), key);
  const people = [...new Set(all.map((e) => e.sample))].sort((a, b) => a - b);
  const out = { patients: [], consultations: [], appointments: [], workItems: [], files: [], skipped: { appointmentsRejected: 0, appointmentsOverlap: 0 }, ai: { days: 0, daysAsOriginal: 0, profiles: 0 } };
  const taken = []; // non-cancelled appointments already accepted, for the one-calendar overlap rule
  for (const n of people) {
    const es = all.filter((e) => e.sample === n);
    const person = es.find((e) => e.sourceEntity === 'person');
    const charts = es.filter((e) => e.sourceEntity === 'chart');
    const patientId = person.targetId;
    const label = `Paciente ${n}`;
    const orgFile = join(DIR, 'organized', `patient-${n}.enc`);
    const org = existsSync(orgFile) ? JSON.parse(decryptBuffer(readFileSync(orgFile), key).toString('utf8')) : null;
    const chart = charts[0]?.payload ?? {};
    const legacyHistory = es.filter((e) => e.sourceEntity === 'medical_history').map((e) => `### Páginas de ${doctorOf(e)}\n\n${originalBody(e.payload.text)}`).join('\n\n');
    const cids = [...new Map(es.filter((e) => e.sourceEntity === 'diagnosis_set').flatMap((e) => e.payload.diagnoses).map((d) => [d.code, d])).values()];
    const cidSection = cids.length ? `## CIDs registrados no PersonalMed (fora do capítulo Z)\n\n${cids.map((d) => `- ${d.code} ${d.description}`.trim()).join('\n')}` : '';
    const history = [legacyHistory, cidSection].filter(Boolean).join('\n\n');
    // Without the organised layer the profile keeps the converted pages as they are.
    const profile = org
      ? renderProfile(org.profile, { organizedOn: org.organizedOn, civilStatus: chart.civil_status ?? null, bloodType: chart.blood_type ?? null })
      : { diagnoses: cids, medications: [], allergies: [], medical_history: [chart.blood_type ? `Tipo sanguíneo: ${chart.blood_type} (cadastro do PersonalMed)` : null, history].filter(Boolean).join('\n\n'), social_anamnesis: chart.civil_status ? `Estado civil: ${chart.civil_status} (cadastro do PersonalMed)` : null, summaryNote: null, tasks: [] };
    if (org) out.ai.profiles += 1;
    out.patients.push({
      id: patientId, user_id: userId, name: label, date_of_birth: chart.date_of_birth ?? null, sex: chart.sex ?? null, health_insurance: chart.health_insurance ?? null,
      profession: chart.profession ?? null, status: charts.some((c) => c.payload.status === 'retorno') ? 'retorno' : 'novo',
      last_visit: charts.map((c) => c.payload.last_visit).filter(Boolean).sort().at(-1) ?? null,
      diagnoses: profile.diagnoses, medications: profile.medications, allergies: profile.allergies, medical_history: profile.medical_history, social_anamnesis: profile.social_anamnesis,
    });

    for (const e of es.filter((x) => x.sourceEntity === 'consultation')) {
      const doctor = doctorOf(e);
      const stamp = `[Importado do PersonalMed em ${today} · registro de ${doctor}]`;
      const original = originalBody(e.payload.soap_note);
      const organized = org?.days?.[e.targetId];
      const undated = e.issues.some((x) => UNDATED.has(x));
      const trusted = Boolean(organized?.check?.ok);
      // A telegraphic line gains nothing from being split in four: it keeps the original and gets the title.
      const asSoap = trusted && original.length >= 280;
      if (trusted) out.ai.days += 1;
      if (trusted && !asSoap) out.ai.daysAsOriginal += 1;
      const title = trusted && organized.note.titulo.trim() ? organized.note.titulo.trim().slice(0, 160) : undated ? 'Histórico sem datas (PersonalMed)' : e.payload.chief_complaint.replace(' (PersonalMed)', '');
      out.consultations.push({ id: e.targetId, user_id: userId, patient_id: patientId, chief_complaint: title, soap_note: renderDayNote({ stamp, note: organized?.note ?? {}, original, checked: asSoap }), created_at: e.payload.created_at });
    }

    // Two notes that are not visits: the organised summary and the converted pages and sheets of
    // the old chart. They sit just BEFORE the last record, so that the last real visit stays the
    // "last consultation" for the app and for the pre-consultation summary, and they come right
    // after it in the history (and among the recent notes the assistant reads).
    const lastRecord = es.filter((x) => x.sourceEntity === 'consultation').map((x) => x.payload.created_at).sort().at(-1) ?? `${today}T12:00:00.000Z`;
    const after = (minutes) => new Date(Date.parse(lastRecord) + minutes * 60_000).toISOString();
    if (org && history) out.consultations.push({ id: uuidv5(`pm-sample-pages|${patientId}`), user_id: userId, patient_id: patientId, chief_complaint: 'Páginas e fichas do prontuário antigo (PersonalMed)', soap_note: `[Importado do PersonalMed em ${today} · texto original das páginas sem data, das fichas e dos CIDs. Não é uma consulta.]\n\n${history}`, created_at: after(-2) });
    if (profile.summaryNote) out.consultations.push({ id: uuidv5(`pm-sample-summary|${patientId}`), user_id: userId, patient_id: patientId, chief_complaint: 'Resumo do histórico importado (PersonalMed)', soap_note: profile.summaryNote, created_at: after(-1) });
    profile.tasks.forEach((task, i) => out.workItems.push({ id: uuidv5(`pm-sample-task|${patientId}|${i}`), user_id: userId, patient_id: patientId, kind: 'task', status: 'open', title: task.title, content: task.content, details: {} }));

    const first = es.filter((x) => x.sourceEntity === 'appointment').map((x) => x.payload.start_time).sort()[0];
    for (const e of es.filter((x) => x.sourceEntity === 'appointment').sort((a, b) => (a.payload.start_time < b.payload.start_time ? -1 : 1))) {
      const p = e.payload;
      if (!p.status) { out.skipped.appointmentsRejected += 1; continue; }
      // Cortex has no "missed" state yet: a no-show is a cancelled slot that says so.
      const status = p.status === 'faltou' ? 'cancelado' : p.status;
      const start = Date.parse(p.start_time);
      const end = Date.parse(p.end_time);
      if (status !== 'cancelado') {
        // One account holds five legacy calendars: two visits at the same time cannot both be kept.
        if (taken.some((t) => t.start < end && t.end > start)) { out.skipped.appointmentsOverlap += 1; continue; }
        taken.push({ start, end });
      }
      const walkIn = /pronto atendimento/i.test(p.notes ?? '');
      const type = walkIn ? 'urgencia' : p.start_time === first ? 'novo' : 'retorno';
      const notes = [`Agenda de ${doctorOf(e)} no PersonalMed`, p.type ? `Tipo no PersonalMed: ${p.type}` : null, p.status === 'faltou' ? 'Falta registrada no PersonalMed' : null, p.notes].filter(Boolean).join(' · ');
      out.appointments.push({ id: e.targetId, user_id: userId, patient_id: patientId, title: label, start_time: p.start_time, end_time: p.end_time, type, status, notes: notes.slice(0, 2000), checked_in_at: p.checked_in_at ?? null });
    }

    for (const e of es.filter((x) => x.sourceEntity === 'legacy_alert')) {
      out.workItems.push({ id: e.targetId, user_id: userId, patient_id: patientId, kind: 'task', status: 'open', title: 'Revisar o alerta "Atenção" do PersonalMed',
        content: `${e.payload.text}\n\nAção sugerida: ${{ allergy_proposal: 'registrar como alergia, se confirmado', clinical_note: 'manter como nota clínica', administrative_note: 'passar para a recepção como nota administrativa', doctor_review: 'ler e decidir' }[e.payload.suggestedAction] ?? 'ler e decidir'}.`, details: {} });
    }
    for (const e of es.filter((x) => x.sourceEntity === 'pregnancy_item')) {
      out.workItems.push({ id: e.targetId, user_id: userId, patient_id: patientId, kind: 'pregnancy', status: 'open', title: 'Gestação em curso (PersonalMed)', content: '', details: e.payload.details, due_date: e.payload.details?.date ?? null });
    }
    for (const e of es.filter((x) => x.sourceEntity === 'file' && x.mappingStatus !== 'rejected')) {
      // An imported file is a plain attachment. `ai_summary` belongs to the product's own reading
      // of a document: anything written there makes the app ask the doctor to review an AI
      // suggestion that does not exist. What came with the image is in the chart, as a sheet.
      const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[e.payload.mime_type] ?? 'bin';
      out.files.push({ id: e.targetId, user_id: userId, patient_id: patientId, storage_path: `patients/${userId}/${patientId}/${e.targetId}.${ext}`, file_name: e.payload.file_name, mime_type: e.payload.mime_type, size_bytes: e.payload.size_bytes, tag: FILE_TAG, contentBase64: e.payload.contentBase64 });
    }
  }
  return out;
}

const chunks = (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const objectUrl = (path) => `https://${REF}.supabase.co/storage/v1/object/patient-files/${path.split('/').map(encodeURIComponent).join('/')}`;

/** The row first (Storage refuses an object without a live owner), then the bytes. */
async function putFiles(files) {
  if (!files.length) return;
  const service = await serviceKey(REF);
  for (const f of files) {
    await asService(`insert into public.patient_files (id,user_id,patient_id,storage_path,file_name,mime_type,size_bytes,tag)
      values (${lit(f.id)},${lit(f.user_id)},${lit(f.patient_id)},${lit(f.storage_path)},${lit(f.file_name)},${lit(f.mime_type)},${f.size_bytes},${lit(f.tag)}) on conflict (id) do nothing`);
    const res = await fetch(objectUrl(f.storage_path), { method: 'POST', headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': f.mime_type, 'x-upsert': 'true' }, body: Buffer.from(f.contentBase64, 'base64') });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`file upload failed (${res.status})`);
  }
}

if (command === 'plan') {
  const userId = await demoAccount();
  const rows = build(userId);
  const [now] = await q(`select (select count(*) from public.patients)::int as patients, (select count(*) from public.consultations)::int as consultations, (select count(*) from public.appointments)::int as appointments, (select count(*) from public.clinical_work_items)::int as work_items, (select count(*) from public.patient_files)::int as files, (select count(*) from storage.objects)::int as objects`);
  console.log(JSON.stringify({ projectNow: now, toLoad: { patients: rows.patients.length, consultations: rows.consultations.length, appointments: rows.appointments.length, workItems: rows.workItems.length, files: rows.files.length }, skipped: rows.skipped, ai: rows.ai, longestNote: Math.max(...rows.consultations.map((c) => c.soap_note.length)), longestHistory: Math.max(...rows.patients.map((p) => p.medical_history.length)) }));
} else if (command === 'wipe') {
  if (!args.includes('--yes-delete-all-patients')) throw new Error('refusing: pass --yes-delete-all-patients after taking a backup');
  const service = await serviceKey(REF);
  const objects = await q(`select bucket_id, name from storage.objects where bucket_id in ('audio-recordings','patient-files','prescriptions')`);
  for (const o of objects) {
    const res = await fetch(`https://${REF}.supabase.co/storage/v1/object/${o.bucket_id}/${o.name.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { Authorization: `Bearer ${service}`, apikey: service } });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`storage delete failed (${res.status}) in ${o.bucket_id}`);
  }
  const patients = await q('select id from public.patients order by created_at');
  for (const p of patients) {
    await asService(`update public.patients set deletion_requested_at=now() where id=${lit(p.id)} and deletion_requested_at is null;
      delete from public.appointments where patient_id=${lit(p.id)};
      delete from public.patients where id=${lit(p.id)}`);
  }
  await asService('delete from public.appointments where patient_id is null and clinic_id is null');
  const [left] = await q(`select (select count(*) from public.patients)::int as patients, (select count(*) from public.consultations)::int as consultations, (select count(*) from public.appointments)::int as appointments, (select count(*) from storage.objects)::int as objects`);
  console.log(JSON.stringify({ deleted: { patients: patients.length, storageObjects: objects.length }, left }));
} else if (command === 'load') {
  const userId = await demoAccount();
  const rows = build(userId);
  for (const batch of chunks(rows.patients, 5)) {
    await asService(`insert into public.patients (id,user_id,name,date_of_birth,sex,health_insurance,profession,status,last_visit,diagnoses,medications,allergies,medical_history,social_anamnesis)
      select x.id,x.user_id,x.name,x.date_of_birth,x.sex,x.health_insurance,x.profession,x.status,x.last_visit,x.diagnoses,x.medications,coalesce((select array_agg(v) from jsonb_array_elements_text(x.allergies) v),'{}'),x.medical_history,x.social_anamnesis
      from jsonb_to_recordset(${json(batch)}) as x(id uuid,user_id uuid,name text,date_of_birth date,sex text,health_insurance text,profession text,status text,last_visit date,diagnoses jsonb,medications jsonb,allergies jsonb,medical_history text,social_anamnesis text)
      on conflict (id) do nothing`);
  }
  for (const batch of chunks(rows.appointments, 60)) {
    await asService(`insert into public.appointments (id,user_id,patient_id,title,start_time,end_time,type,status,notes,checked_in_at,google_sync_status)
      select x.id,x.user_id,x.patient_id,x.title,x.start_time,x.end_time,x.type,x.status,x.notes,x.checked_in_at,'idle'
      from jsonb_to_recordset(${json(batch)}) as x(id uuid,user_id uuid,patient_id uuid,title text,start_time timestamptz,end_time timestamptz,type text,status text,notes text,checked_in_at timestamptz)
      order by x.start_time on conflict (id) do nothing`);
  }
  for (const batch of chunks(rows.consultations, 40)) {
    await asService(`insert into public.consultations (id,user_id,patient_id,chief_complaint,soap_note,created_at)
      select x.id,x.user_id,x.patient_id,x.chief_complaint,x.soap_note,x.created_at
      from jsonb_to_recordset(${json(batch)}) as x(id uuid,user_id uuid,patient_id uuid,chief_complaint text,soap_note text,created_at timestamptz)
      on conflict (id) do nothing`);
  }
  if (rows.workItems.length) {
    await asService(`insert into public.clinical_work_items (id,user_id,patient_id,kind,status,title,content,details,due_date)
      select x.id,x.user_id,x.patient_id,x.kind,x.status,x.title,x.content,coalesce(x.details,'{}'::jsonb),x.due_date
      from jsonb_to_recordset(${json(rows.workItems)}) as x(id uuid,user_id uuid,patient_id uuid,kind text,status text,title text,content text,details jsonb,due_date date)
      on conflict (id) do nothing`);
  }
  await putFiles(rows.files);
  console.log(JSON.stringify({ loaded: { patients: rows.patients.length, consultations: rows.consultations.length, appointments: rows.appointments.length, workItems: rows.workItems.length, files: rows.files.length }, skipped: rows.skipped, ai: rows.ai }));
} else if (command === 'files') {
  // Puts the sample's imported files again, as the staging has them now. Only the files this
  // tool imported for the sample's own patients are touched: stored object first, then the row
  // (the order the app itself uses), then both come back.
  const userId = await demoAccount();
  const rows = build(userId);
  const patients = rows.patients.map((p) => lit(p.id)).join(',');
  const old = await q(`select id, storage_path from public.patient_files where patient_id in (${patients}) and tag in (${IMPORT_TAGS.map(lit).join(',')})`);
  if (args.includes('--rehearse')) {
    // The database half, undone at the end: shows that the guards accept it before anything is touched.
    const fake = rows.files.map((f) => `insert into public.patient_files (id,user_id,patient_id,storage_path,file_name,mime_type,size_bytes,tag) values (${lit(f.id)},${lit(f.user_id)},${lit(f.patient_id)},${lit(f.storage_path)},${lit(f.file_name)},${lit(f.mime_type)},${f.size_bytes},${lit(f.tag)})`).join('; ');
    const [seen] = await q(`begin; select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;
      ${old.length ? `delete from public.patient_files where id in (${old.map((o) => lit(o.id)).join(',')});` : ''} ${fake};
      select count(*)::int as files, count(*) filter (where ai_summary is not null)::int as waiting_review from public.patient_files where patient_id in (${patients}); rollback;`);
    console.log(JSON.stringify({ rehearsal: 'rolled back', wouldRemove: old.length, wouldPut: rows.files.length, afterwards: seen }));
  } else {
    const service = await serviceKey(REF);
    for (const o of old) {
      const res = await fetch(objectUrl(o.storage_path), { method: 'DELETE', headers: { Authorization: `Bearer ${service}`, apikey: service } });
      await res.arrayBuffer();
      if (!res.ok && res.status !== 404 && res.status !== 400) throw new Error(`storage delete failed (${res.status})`);
    }
    if (old.length) await asService(`delete from public.patient_files where id in (${old.map((o) => lit(o.id)).join(',')})`);
    await putFiles(rows.files);
    console.log(JSON.stringify({ removed: old.length, put: rows.files.length }));
  }
} else if (command === 'verify') {
  const userId = await demoAccount();
  const rows = build(userId);
  // Read as the account itself: what row level security lets the doctor see.
  const sql = `begin; select set_config('request.jwt.claims', json_build_object('sub',${lit(userId)},'role','authenticated','aal','aal1')::text, true); set local role authenticated;
    select p.name, p.status, p.last_visit, jsonb_array_length(p.diagnoses) as diagnoses, jsonb_array_length(p.medications) as medications, coalesce(array_length(p.allergies,1),0) as allergies, length(p.medical_history) as history_chars,
      (select count(*) from public.consultations c where c.patient_id=p.id)::int as consultations,
      (select count(*) from public.consultations c where c.patient_id=p.id and c.soap_note like '%**S (Subjetivo):**%')::int as organised,
      (select count(*) from public.appointments a where a.patient_id=p.id)::int as appointments,
      (select count(*) from public.clinical_work_items w where w.patient_id=p.id)::int as work_items,
      (select count(*) from public.patient_files f where f.patient_id=p.id)::int as files,
      (select count(*) from public.patient_files f where f.patient_id=p.id and f.ai_summary is not null and f.ai_review_status='pending')::int as files_waiting_review
    from public.patients p order by p.name; rollback;`;
  const seen = await q(sql);
  console.log(JSON.stringify({ expected: { patients: rows.patients.length, consultations: rows.consultations.length, appointments: rows.appointments.length, workItems: rows.workItems.length, files: rows.files.length }, seenByTheAccount: seen }));
} else if (command === 'fixture') {
  // The same rows, as a file for the local visual audit (scripts/app-audit-browser.mjs with
  // AUDIT_FIXTURE). Anonymised but still clinical: written beside the sample, deleted after use.
  const rows = build('00000000-0000-4000-8000-000000000000');
  const stamp = new Date().toISOString();
  const tables = {
    patients: rows.patients.map((p) => ({ age: null, cpf: null, phone: null, email: null, clinical_notes: null, ai_insights: {}, revision: 0, created_at: stamp, updated_at: stamp, ...p })),
    // Newest first, as the app asks the server (the local harness does not sort).
    consultations: [...rows.consultations].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((c) => ({ appointment_id: null, transcription: null, revision: 0, history_proposals: {}, profile_proposals: {}, pre_briefing: null, recording_consent: null, whatsapp_message: null, ...c })),
    appointments: rows.appointments.map((a) => ({ created_at: stamp, revision: 1, reminder_sent: false, clinic_id: null, contact_id: null, google_sync_status: 'idle', ...a })),
    clinical_work_items: rows.workItems.map((w) => ({ revision: 0, created_at: stamp, updated_at: stamp, due_date: null, ...w })),
    patient_files: rows.files.map(({ contentBase64, ...f }) => ({ created_at: stamp, ai_summary: null, ai_profile_proposal: null, ai_review_status: 'pending', ...f })),
  };
  const file = join(DIR, 'fixture.json');
  writeFileSync(file, JSON.stringify({ tables }));
  console.log(JSON.stringify({ fixture: file, rows: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) }));
} else throw new Error(`unknown command: ${command}`);
