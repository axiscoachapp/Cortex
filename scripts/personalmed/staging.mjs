// PersonalMed 2005 -> Cortex: build staging envelopes (contract of
// docs/migration/personalmed/CODEX_IMPLEMENTATION.md §3) from legacy rows that
// the readers already decoded. Pure functions plus a small batch writer.
//
// Real batches hold patient data: write them only outside the repository,
// in an encrypted folder. The repository holds only the synthetic batch.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRANSFORM_VERSION,
  alertCategories,
  alertSuggestedAction,
  cleanName,
  fold,
  envelope,
  findCpf,
  findOverlaps,
  hasHouseNumber,
  legacyDate,
  mapAppointmentStatus,
  mapSex,
  mergeFieldsOf,
  normalizeCep,
  normalizeCity,
  normalizeEmail,
  normalizePhone,
  normalizeUf,
  parseTemplateItems,
  registrationPhones,
  SHARED_LOGINS,
  sourceRecordId,
  splitHistory,
  templateKind,
  wallClockToUtc,
} from './transforms.mjs';

const text = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

const CIVIL_STATUS = { C: 'Casado(a)', S: 'Solteiro(a)', D: 'Divorciado(a)', V: 'Viúvo(a)', O: 'Outro' };
/** Clini_01.CivilStatus: C, S, D, V and O are the usual codes; any other code is kept out and flagged. */
export function mapCivilStatus(raw) {
  const code = text(raw).toUpperCase();
  if (!code) return { label: null, issues: [] };
  return CIVIL_STATUS[code] ? { label: CIVIL_STATUS[code], issues: [] } : { label: null, issues: ['civil_status_unknown_code'] };
}
/** Only the eight ABO/Rh types; anything else is not a blood type. */
export function mapBloodType(raw) {
  const v = text(raw).toUpperCase().replace(/\s+/g, '');
  return /^(A|B|AB|O)[+-]$/.test(v) ? v : null;
}

/**
 * One legacy person (Clini_01 row) -> `person` (staging only, legal identity),
 * one `chart` per doctor (patients), one `contact` candidate (clinic_contacts)
 * and one `self` link per chart, proven by the legacy key (same PCod).
 *
 * @param ctx { sourceInstance, batchId, exportDate }
 * @param p   Clini_01 row with ISO dates
 * @param charts [{ user, firstVisit, lastVisit, hasConsultations }]
 * @param plans  [{ carrier, card, isPrivate }] from Clini_05 + Carrier
 * @param flags  { active, futureAppointment }: the whole universe stays in
 *               staging; the first reception cohort is chosen later (D12).
 */
export function buildPerson(ctx, p, charts, plans = [], flags = {}) {
  const cohort = { active: Boolean(flags.active), futureAppointment: Boolean(flags.futureAppointment) };
  const base = { sourceInstance: ctx.sourceInstance, batchId: ctx.batchId };
  const name = cleanName(p.Name);
  const birth = legacyDate(p.BirthDate, { max: ctx.exportDate });
  const sex = resolveSex(mapSex(p.Sex), charts, { womanOnlyRecords: Boolean(flags.womanOnlyRecords), urologyUsers: ctx.urologyUsers ?? null });
  const cpf = findCpf({ fax: p.FAX, rg: p.ID, email: p.EMail, phone: p.Phone });
  const email = normalizeEmail(p.EMail);
  const cep = normalizeCep(p.Zip);
  const city = normalizeCity(p.City);
  const uf = normalizeUf(p.State, { cepUf: cep.uf, city: p.City });
  const phones = registrationPhones({ phone: p.Phone, cellular: p.Cellular, dddCellular: p.DDDCellular, fax: p.FAX }, { cep: p.Zip, city: p.City });
  const plan = plans.find((x) => !x.isPrivate) ?? plans[0] ?? null;
  const accommodation = email.accommodation?.category ?? null;
  const healthInsurance = plan ? `${plan.carrier}${accommodation && accommodation !== 'outro' ? ` (${accommodation})` : ''}`.slice(0, 120) : null;
  const bestPhone = phones.find((x) => x.normalized) ?? null;
  const phoneIssues = phones.flatMap((x) => x.issues);
  const street = text(p.Address);
  const civil = mapCivilStatus(p.CivilStatus);
  const bloodType = mapBloodType(p.BloodType);
  const registrationNote = text(p.ObservationText) || null;
  const addressIssues = [...cep.issues, ...uf.issues, ...city.issues, ...(street ? (hasHouseNumber(street) ? [] : ['address_without_number']) : ['address_missing'])];

  const person = envelope({
    ...base,
    sourceEntity: 'person',
    key: { pcod: p.PCod },
    targetTable: 'staging_only',
    payload: {
      name: name.name,
      dateOfBirth: birth.date,
      sex: sex.sex,
      cpf: cpf.value,
      cpfSource: cpf.source,
      motherName: text(p.Mother) || null,
      birthplace: text(p.HomeBorn) || null,
      address: { street: street || null, district: text(p.District) || null, city: city.city, uf: uf.uf, cep: cep.cep },
      phones: phones.map(({ raw, normalized, kind }) => ({ raw, normalized, kind })),
      email: email.email,
      healthPlan: plan ? { carrier: plan.carrier, card: plan.card || null, accommodation: email.accommodation } : null,
      civilStatus: civil.label,
      bloodType,
      registrationNote,
      cohort,
    },
    issues: [...name.issues, ...birth.issues, ...sex.issues, ...cpf.issues, ...email.issues, ...addressIssues, ...phoneIssues, ...civil.issues],
  });

  const contact = envelope({
    ...base,
    sourceEntity: 'contact',
    key: { pcod: p.PCod },
    targetTable: 'clinic_contacts',
    payload: { name: name.name, phone: bestPhone?.raw ?? phones[0]?.raw ?? '', phone_normalized: bestPhone?.normalized ?? null, origin: 'personalmed_registration', cohort },
    issues: phoneIssues,
    status: name.name ? undefined : 'rejected',
  });

  const out = [person, contact];
  for (const c of charts) {
    const chart = envelope({
      ...base,
      sourceEntity: 'chart',
      key: { pcod: p.PCod, user: c.user },
      doctor: c.user,
      targetTable: 'patients',
      payload: {
        ownerLegacyDoctor: c.user,
        name: name.name,
        date_of_birth: birth.date,
        sex: sex.sex,
        cpf: cpf.value,
        phone: bestPhone?.normalized ?? null,
        email: email.email,
        health_insurance: healthInsurance,
        profession: text(p.Occupation) || null,
        // No column for these in `patients`: the loader writes them as the first
        // lines of social_anamnesis and medical_history.
        civil_status: civil.label,
        blood_type: bloodType,
        status: c.hasConsultations ? 'retorno' : 'novo',
        last_visit: legacyDate(c.lastVisit, { max: ctx.exportDate }).date,
      },
      issues: [...name.issues, ...cpf.issues.filter((i) => i !== 'cpf_missing'), 'doctor_map_pending'],
      status: name.name ? undefined : 'rejected',
    });
    const link = envelope({
      ...base,
      sourceEntity: 'contact_chart_link',
      key: { pcod: p.PCod, user: c.user },
      doctor: c.user,
      targetTable: 'patient_contact_links',
      payload: { contactTargetId: contact.targetId, patientTargetId: chart.targetId, relationship: 'self', evidence: 'same_legacy_pcod' },
    });
    out.push(chart, link);
  }
  return out;
}

/**
 * Agenda rows (Age04 joined with age03) -> `appointment`, `schedule_block`
 * and, for pre-registered future appointments, a provisional `contact`.
 *
 * rows: [{ user, date, startMinutes, duration, slotType, estado, pcod, preCadastro: { name, phone } | null, typeLabel }]
 * chartIds: Map(`${pcod}|${user}`) -> chart targetId
 */
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function buildAgenda(ctx, rows, chartIds) {
  const base = { sourceInstance: ctx.sourceInstance, batchId: ctx.batchId };
  const out = [];
  const appointments = [];
  for (const r of rows) {
    // The walk-in queue (Age09) has its own key: it can share a time with a booked slot.
    const key = r.walkIn != null ? { walkin: r.walkIn } : { user: r.user, date: r.date, start: r.startMinutes };
    const start = wallClockToUtc(r.date, r.startMinutes);
    const end = wallClockToUtc(r.date, r.startMinutes + (r.duration > 0 ? r.duration : 15));
    // B (long block) and P (short block: never booked, 15 min at 7-8h and 17h;
    // D9) are not appointments.
    if (r.slotType === 'B' || r.slotType === 'P') {
      if (r.date <= ctx.exportDate) continue; // past blocks are not imported
      // Legacy blocks have no author: origin stays apart from the future executor.
      out.push(
        envelope({
          ...base,
          sourceEntity: 'schedule_block',
          key,
          doctor: r.user,
          targetTable: 'reception_schedule_blocks',
          payload: { ownerLegacyDoctor: r.user, start_time: start, end_time: end, legacyAuthor: null, executor: null, legacyType: r.slotType },
          issues: ['block_executor_contract_pending'],
          status: 'requires_review',
        }),
      );
      continue;
    }
    // A past row with neither patient nor pre-registered name is an empty slot
    // (889 in the 24/08/2026 export), not a booking.
    if (r.pcod == null && !r.preCadastro?.name && r.date <= ctx.exportDate) {
      // Straight to the output: an empty slot must not take part in the overlap check.
      out.push(
        envelope({
          ...base,
          sourceEntity: 'appointment',
          key,
          doctor: r.user,
          targetTable: 'appointments',
          payload: { ownerLegacyDoctor: r.user, start_time: start, end_time: end, status: null },
          issues: ['appointment_empty_slot'],
          status: 'rejected',
        }),
      );
      continue;
    }
    const mapped = mapAppointmentStatus(r.estado, r.date, { exportDate: ctx.exportDate });
    const patientTargetId = r.pcod != null ? (chartIds.get(`${r.pcod}|${r.user}`) ?? null) : null;
    const issues = [...mapped.issues];
    let contactTargetId = null;
    if (r.pcod == null && r.preCadastro?.name) {
      if (r.date > ctx.exportDate && mapped.status !== 'cancelado') {
        const cn = cleanName(r.preCadastro.name);
        const phone = normalizePhone(r.preCadastro.phone ?? '', {}) ?? { raw: '', normalized: null, issues: [] };
        const contact = envelope({
          ...base,
          sourceEntity: 'contact',
          key: { precadastro: `${r.user}:${r.date}:${r.startMinutes}` },
          targetTable: 'clinic_contacts',
          payload: { name: cn.name, phone: phone.raw, phone_normalized: phone.normalized, origin: 'personalmed_precadastro' },
          issues: [...cn.issues, ...phone.issues, 'precadastro_unconfirmed'],
          status: 'requires_review',
        });
        out.push(contact);
        contactTargetId = contact.targetId;
      }
      issues.push('appointment_without_patient');
    } else if (r.pcod != null && !patientTargetId) issues.push('appointment_chart_missing');
    const a = envelope({
      ...base,
      sourceEntity: 'appointment',
      key,
      doctor: r.user,
      targetTable: 'appointments',
      payload: {
        ownerLegacyDoctor: r.user,
        patientTargetId,
        // The person, by the legacy key: an appointment with a doctor who has no chart
        // of the patient still belongs to the single registration (D14, D20).
        personRef: r.pcod != null ? sourceRecordId({ pcod: r.pcod }) : null,
        contactTargetId,
        start_time: start,
        end_time: end,
        // appointments.title is NOT NULL: the pre-registered name when there is no
        // patient; otherwise null and the loader uses the patient's name.
        title: r.pcod == null ? (cleanName(r.preCadastro?.name).name ?? 'Pré-cadastro (PersonalMed)') : null,
        status: mapped.status,
        type: r.typeLabel ?? null,
        notes: [mapped.note, r.walkIn != null ? 'Pronto atendimento (fila do PersonalMed)' : null, r.carrier ? `Convênio no agendamento: ${r.carrier}` : null, r.careStartMinutes != null ? `Início do atendimento: ${clock(r.careStartMinutes)}` : null].filter(Boolean).join(' · ') || null,
        // Arrival time typed by the reception, on the day of the visit.
        checked_in_at: r.arrivalMinutes != null ? wallClockToUtc(r.date, r.arrivalMinutes) : null,
        google_sync_status: 'idle',
      },
      issues,
      status: mapped.status == null ? 'rejected' : contactTargetId ? 'requires_review' : undefined,
    });
    appointments.push(a);
  }
  // Cortex refuses overlapping non-cancelled appointments of the same doctor.
  const overlapping = findOverlaps(appointments.map((a) => ({ id: a.targetId, doctor: a.payload.ownerLegacyDoctor, start: a.payload.start_time, end: a.payload.end_time, status: a.payload.status })));
  for (const a of appointments) {
    if (overlapping.has(a.targetId)) {
      a.issues = [...new Set([...a.issues, 'appointment_overlap'])].sort();
      a.mappingStatus = 'rejected';
    }
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clinical content per chart

const SECTION = (title, body) => (body && body.trim() ? `### ${title}\n\n${body.trim()}` : null);
const DOC_TYPE = { 1: 'Receita', 2: 'Texto', 3: 'Solicitação de exames' };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null);

/** Vital signs as text; values outside plausible ranges keep their original form. */
export function vitalsText(v) {
  const out = [];
  const w = num(v.weight);
  if (w != null) out.push(w >= 25 && w <= 250 ? `Peso: ${w} kg` : `Peso (valor original): ${w}`);
  const h = num(v.height);
  if (h != null) out.push(h >= 100 && h <= 220 ? `Altura: ${h} cm` : h >= 1 && h <= 2.2 ? `Altura: ${h} m` : `Altura (valor original): ${h}`);
  const p = text(v.pressure);
  if (p) {
    const m = p.match(/^(\d{1,3})\s*[/x]\s*(\d{1,3})$/);
    out.push(m && +m[1] >= 60 && +m[1] <= 260 && +m[2] >= 30 && +m[2] <= 160 && +m[1] > +m[2] ? `PA: ${m[1]}/${m[2]} mmHg` : `PA (valor original): ${p}`);
  }
  const fc = num(v.fc);
  if (fc != null) out.push(fc >= 30 && fc <= 220 ? `FC: ${fc} bpm` : `FC (valor original): ${fc}`);
  const t = num(v.temperature);
  if (t != null && t >= 34 && t <= 42) out.push(`Temperatura: ${t} °C`);
  return out.join(' · ');
}

function prenatalText(p) {
  const out = [];
  if (num(p.ig) != null) out.push(`IG: ${p.ig} semanas`);
  if (num(p.weight) != null) out.push(`Peso: ${p.weight} kg`);
  if (text(p.pressure)) out.push(`PA: ${text(p.pressure)}`);
  if (num(p.au) != null) out.push(`AU: ${p.au} cm`);
  if (text(p.bcf)) out.push(`BCF: ${text(p.bcf)} bpm`);
  if (num(p.mf) != null) out.push(`MF: ${p.mf}`);
  // Edema is a code: 1 on 99% of the visits (inferred: no edema), 2 and 3 on the rest
  // (inferred: + and ++). 0 is "not filled". To be confirmed with the clinic.
  if (p.edema === 1) out.push('Edema: ausente');
  else if (p.edema === 2 || p.edema === 3) out.push(`Edema: ${'+'.repeat(p.edema - 1)}`);
  if (text(p.touch)) out.push(`Toque: ${text(p.touch)}`);
  return out.join(' · ');
}

/**
 * One chart's clinical history -> consultations (one per day), medical
 * history, non-Z diagnoses and open pregnancies.
 *
 * input: {
 *   encounters: Map(day -> { evolutions: [{text, weight, height, fc, pressure, temperature}],
 *     documents: [{type, text}], cids: [{code, description}], prenatal: [{ig, weight, pressure, au, bcf, mf, edema}],
 *     appointmentKey: {user, date, start} | null, appointmentStart: iso | null }),
 *   history: { entries, issues } from splitHistory, or null,
 *   pages: [{ title, text, kind: 'qp_hda' | 'history' }],
 *   pregnancies: [{ number, dum, dpp, dppSource }],
 *   firstVisit, lastVisit
 * }
 */
export function buildChartClinical(ctx, chart, input) {
  const base = { sourceInstance: ctx.sourceInstance, batchId: ctx.batchId };
  const { pcod, user, patientTargetId } = chart;
  const stamp = `[Importado do PersonalMed em ${ctx.importDate}]`;
  const out = [];
  const dated = new Map(); // day -> { text, outOfOrder }
  let undated = null;
  for (const e of input.history?.entries ?? []) {
    if (!e.date) undated = undated ? `${undated}\n\n${e.text}` : e.text;
    else {
      const prev = dated.get(e.date);
      dated.set(e.date, { text: prev ? `${prev.text}\n\n${e.text}` : e.text, outOfOrder: Boolean(prev?.outOfOrder || e.outOfOrder) });
    }
  }
  // D6 A (user, 05/11/2026): the QP/HDA page goes by date, like the running
  // history. A page with two or more dated entries is split and each entry
  // joins the consultation of its day; an undated page is the first-visit
  // note and joins the consultation of the first visit (a new one when that
  // day has none). Text before the first date stays in the first entry.
  const firstDay = legacyDate(input.firstVisit, { max: ctx.exportDate }).date;
  const qp = new Map(); // day -> { text, outOfOrder, firstVisitNote }
  let qpNoDay = null;
  const addQp = (day, body, flags = {}) => {
    const prev = qp.get(day);
    qp.set(day, { text: prev ? `${prev.text}\n\n${body}` : body, outOfOrder: Boolean(prev?.outOfOrder || flags.outOfOrder), firstVisitNote: Boolean(prev?.firstVisitNote || flags.firstVisitNote) });
  };
  for (const page of input.pages ?? []) {
    if (page.kind !== 'qp_hda' || !text(page.text)) continue;
    const entries = splitHistory(text(page.text), { exportDate: ctx.exportDate }).entries.filter((e) => e.date);
    if (entries.length >= 2) for (const e of entries) addQp(e.date, e.text, { outOfOrder: e.outOfOrder });
    else if (firstDay) addQp(firstDay, text(page.text), { firstVisitNote: true });
    else qpNoDay = qpNoDay ? `${qpNoDay}\n\n${text(page.text)}` : text(page.text);
  }
  const days = [...new Set([...(input.encounters?.keys() ?? []), ...dated.keys(), ...qp.keys()])].sort();
  for (const day of days) {
    const enc = input.encounters?.get(day);
    const sections = [
      SECTION('QP/HDA', qp.get(day)?.text),
      SECTION('Evolução', (enc?.evolutions ?? []).map((v) => v.text).filter(Boolean).join('\n\n')),
      SECTION('Sinais vitais', (enc?.evolutions ?? []).map(vitalsText).filter(Boolean).join('\n')),
      SECTION('Pré-natal', (enc?.prenatal ?? []).map(prenatalText).filter(Boolean).join('\n')),
      SECTION('CID registrado', [...new Map((enc?.cids ?? []).map((c) => [c.code, c])).values()].map((c) => `${c.code} ${c.description ?? ''}`.trim()).join('\n')),
      SECTION('Documentos emitidos', (enc?.documents ?? []).map((d) => `**${DOC_TYPE[d.type] ?? 'Documento'}**\n\n${d.text}`).join('\n\n---\n\n')),
      SECTION('Histórico corrido', dated.get(day)?.text),
    ].filter(Boolean);
    const chiefComplaint = enc ? 'Consulta (PersonalMed)'
      : dated.has(day) ? 'Anotação do histórico (PersonalMed)'
      : qp.get(day)?.firstVisitNote ? 'Primeira consulta: QP/HDA (PersonalMed)'
      : 'Anotação QP/HDA (PersonalMed)';
    out.push(
      envelope({
        ...base,
        sourceEntity: 'consultation',
        key: { pcod, user, day },
        doctor: user,
        targetTable: 'consultations',
        payload: {
          patientTargetId,
          ownerLegacyDoctor: user,
          created_at: enc?.appointmentStart ?? wallClockToUtc(day, 12 * 60),
          chief_complaint: chiefComplaint,
          soap_note: [stamp, ...sections].join('\n\n'),
          // Same doctor, patient and day is a CANDIDATE, not proof of which
          // appointment produced this consultation (no relational key in the
          // legacy). The loader must not create an appointment link from it
          // without a source key or a recorded human confirmation (contract
          // T34 §3, Codex 04/11 10:15).
          appointmentCandidate: enc?.appointmentKey
            ? { sourceRecordId: `user:${enc.appointmentKey.user}|date:${enc.appointmentKey.date}|start:${enc.appointmentKey.start}`, rule: 'same_doctor_patient_day', proof: 'candidate_only' }
            : null,
        },
        // Only the day whose typed date broke the chronological order needs review.
        issues: [...(dated.get(day)?.outOfOrder ? ['history_date_out_of_order'] : []), ...(qp.get(day)?.outOfOrder ? ['qp_hda_date_out_of_order'] : [])],
      }),
    );
  }
  // Undated text is kept on the day of the last visit, at 00:00: the visit of that day stays the
  // most recent record, so the app and the pre-consultation summary read it as the last consultation.
  const anchor = legacyDate(input.lastVisit, { max: ctx.exportDate }).date ?? legacyDate(input.firstVisit, { max: ctx.exportDate }).date ?? ctx.exportDate;
  if (undated) {
    out.push(
      envelope({
        ...base,
        sourceEntity: 'consultation',
        key: { pcod, user, day: 'historico' },
        doctor: user,
        targetTable: 'consultations',
        payload: { patientTargetId, ownerLegacyDoctor: user, created_at: wallClockToUtc(anchor, 0), chief_complaint: 'Histórico PersonalMed (texto corrido)', soap_note: `${stamp}\n\n${undated}`, appointmentSourceRecordId: null },
        issues: ['history_no_dates'],
      }),
    );
  }
  // An undated QP/HDA page of a chart without a valid first visit: kept at the anchor.
  if (qpNoDay) {
    out.push(
      envelope({
        ...base,
        sourceEntity: 'consultation',
        key: { pcod, user, page: 'qp-hda' },
        doctor: user,
        targetTable: 'consultations',
        payload: { patientTargetId, ownerLegacyDoctor: user, created_at: wallClockToUtc(anchor, 0), chief_complaint: 'Primeira consulta: QP/HDA (PersonalMed)', soap_note: `${stamp}\n\n### QP/HDA\n\n${qpNoDay}`, appointmentSourceRecordId: null },
        issues: ['qp_hda_no_first_visit'],
      }),
    );
  }
  const historySections = [
    ...(input.pages ?? []).filter((pg) => pg.kind === 'history' && text(pg.text)).map((pg) => `## ${pg.title}\n\n${text(pg.text)}`),
    obstetricHistory(input.pregnancies ?? [], ctx.exportDate),
    ...(input.sheets ?? []).map(sheetSection),
  ].filter(Boolean);
  if (historySections.length) {
    out.push(envelope({ ...base, sourceEntity: 'medical_history', key: { pcod, user }, doctor: user, targetTable: 'patients.medical_history', payload: { patientTargetId, text: `${stamp}\n\n${historySections.join('\n\n')}` } }));
  }
  const diagnoses = [...new Map([...(input.encounters?.values() ?? [])].flatMap((e) => e.cids ?? []).filter((c) => c.code && !/^z/i.test(c.code)).map((c) => [c.code.toUpperCase(), { code: c.code.toUpperCase(), description: text(c.description) }])).values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  if (diagnoses.length) out.push(envelope({ ...base, sourceEntity: 'diagnosis_set', key: { pcod, user }, doctor: user, targetTable: 'patients.diagnoses', payload: { patientTargetId, diagnoses } }));
  const horizon = new Date(Date.parse(ctx.exportDate) + 300 * 864e5).toISOString().slice(0, 10);
  for (const g of input.pregnancies ?? []) {
    const dpp = legacyDate(g.dpp).date;
    if (!dpp || dpp < ctx.exportDate || dpp > horizon) continue;
    out.push(
      envelope({
        ...base,
        sourceEntity: 'pregnancy_item',
        key: { pcod, user, gestation: g.number },
        doctor: user,
        targetTable: 'clinical_work_items',
        payload: { patientTargetId, kind: 'pregnancy', status: 'open', details: { date: dpp, source: g.dppSource === 'USG' ? 'USG' : 'DUM' } },
      }),
    );
  }
  // Clinical rows whose chart header does not exist (legacy orphans) cannot be loaded.
  if (!patientTargetId) {
    for (const e of out) {
      e.issues = [...new Set([...e.issues, 'chart_missing'])].sort();
      e.mappingStatus = 'rejected';
    }
  }
  return out;
}

const br = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/**
 * Every pregnancy recorded for the chart (Co49_1), as text for the medical
 * history. The child's name is a third party's data and is not carried.
 */
export function obstetricHistory(pregnancies, exportDate) {
  const lines = [];
  for (const g of [...pregnancies].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
    const dum = legacyDate(g.dum).date;
    const dpp = legacyDate(g.dpp).date;
    const dppEcho = legacyDate(g.dppEcho).date;
    const birth = legacyDate(g.parturition, { max: exportDate }).date;
    const parts = [
      dum ? `DUM ${br(dum)}` : null,
      dpp ? `DPP ${br(dpp)}${g.dppSource === 'USG' ? ' (pela USG)' : ' (pela DUM)'}` : null,
      dppEcho && dppEcho !== dpp ? `DPP pela USG ${br(dppEcho)}` : null,
      num(g.igFirst) != null ? `IG na abertura: ${g.igFirst} semanas` : null,
      num(g.weight) != null ? `peso inicial ${g.weight} kg` : null,
      num(g.height) != null ? `altura ${g.height}` : null,
      mapBloodType(g.bloodType) ? `tipo sanguíneo ${mapBloodType(g.bloodType)}` : null,
      birth ? `parto em ${br(birth)}` : null,
      text(g.deliveryType) ? `tipo de parto: ${text(g.deliveryType)}` : null,
      text(g.childSex) ? `sexo do recém-nascido: ${text(g.childSex)}` : null,
      dpp && dpp >= exportDate ? 'em curso na data da exportação' : null,
    ].filter(Boolean);
    if (!parts.length && !text(g.notes)) continue;
    lines.push(`- Gestação ${g.number ?? '?'}: ${parts.join(' · ')}${text(g.notes) ? `\n  Observações: ${text(g.notes)}` : ''}`);
  }
  return lines.length ? `## Histórico obstétrico (fichas de gestação)\n\n${lines.join('\n')}` : null;
}

/** A specialty sheet of the legacy chart, as the extractor read it: { title, date, lines }. */
function sheetSection(sheet) {
  const lines = (sheet.lines ?? []).map((l) => text(l)).filter(Boolean);
  if (!lines.length) return null;
  const date = legacyDate(sheet.date).date;
  return `## ${sheet.title}${date ? ` (${br(date)})` : ''}\n\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/**
 * Field name of a legacy sheet as a readable label ("IdadeMenopausa" ->
 * "Idade menopausa"). The legacy screens' own labels are not in the export.
 */
export function sheetLabel(field) {
  const words = String(field).replace(/_/g, ' ').replace(/([a-zà-ú])([A-ZÀ-Ú0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Lines of one sheet row: only fields that hold something. A true flag is
 * "sim"; false, zero, empty and the Delphi zero date say nothing and are left out.
 * values: [[fieldName, value]] with dates already as ISO strings.
 */
export function sheetLines(values) {
  const out = [];
  for (const [field, value] of values) {
    if (value == null || value === false || value === 0 || value === '') continue;
    if (value === true) out.push(`${sheetLabel(field)}: sim`);
    else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (legacyDate(value).date) out.push(`${sheetLabel(field)}: ${br(value)}`);
    } else if (text(value)) out.push(`${sheetLabel(field)}: ${text(value)}`);
  }
  return out;
}

/**
 * Images kept inside the legacy chart -> `file` envelopes (patient_files).
 * The bytes travel in the encrypted staging as base64; BMP is converted to PNG
 * by the extractor before it gets here.
 *
 * images: [{ source: 'CO52', key: {...}, date, description, mime, bytes: Buffer }]
 */
/**
 * "M" in the registration is not always a man: in a sample of this clinic's export, every "M"
 * seen only by gynaecologists was a woman (an intrauterine device, a cervical smear in the chart).
 * A wrong "masculino" misleads every screen and every AI prompt, so the registration is believed
 * only when nothing contradicts it:
 * - records that only a woman has (prenatal visits, pregnancy or gynaecology sheets) -> unknown;
 * - when the clinic's urology accounts are known and none of the person's charts is theirs -> unknown.
 * "Unknown" comes with an issue, so that the clinic gets the list to confirm.
 */
export function resolveSex(mapped, charts, { womanOnlyRecords = false, urologyUsers = null } = {}) {
  if (mapped.sex !== 'masculino') return mapped;
  if (womanOnlyRecords) return { sex: null, issues: [...mapped.issues, 'sex_conflicts_with_records'] };
  if (urologyUsers?.size && charts.length && !charts.some((c) => urologyUsers.has(Number(c.user)))) return { sex: null, issues: [...mapped.issues, 'sex_male_without_urology_chart'] };
  return mapped;
}

/** What a legacy image is, by the table it came from: the start of the name the doctor reads. */
const FILE_LABEL = { co52: 'Imagem de exame', co31_1: 'Imagem de exame ginecológico', clini_04: 'Imagem do paciente' };

/**
 * The name shown in the patient's files: what it is, its date in the legacy
 * system and where it came from. No legacy key and no free text: the row that
 * came with the image is already in the chart, as a sheet of the old record.
 */
export function legacyFileName(source, date, ext, taken = new Set()) {
  const base = `${FILE_LABEL[String(source).toLowerCase()] ?? 'Imagem do prontuário antigo'}${date ? ` de ${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}` : ''}`;
  let name = `${base} (PersonalMed).${ext}`;
  for (let n = 2; taken.has(name); n += 1) name = `${base} (${n}) (PersonalMed).${ext}`;
  taken.add(name);
  return name;
}

export function buildFiles(ctx, chart, images) {
  const out = [];
  const names = new Set();
  for (const image of images) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg' }[image.mime];
    const date = legacyDate(image.date, { max: ctx.exportDate }).date;
    const issues = [];
    if (!ext) issues.push('file_format_unsupported');
    if (image.bytes.length > 25 * 1024 * 1024) issues.push('file_too_large');
    out.push(
      envelope({
        sourceInstance: ctx.sourceInstance,
        batchId: ctx.batchId,
        sourceEntity: 'file',
        key: { pcod: chart.pcod, user: chart.user, ...image.key },
        doctor: chart.user,
        targetTable: 'patient_files',
        payload: {
          patientTargetId: chart.patientTargetId,
          file_name: legacyFileName(image.source, date, ext ?? 'bin', names),
          source: image.source,
          mime_type: image.mime,
          size_bytes: image.bytes.length,
          tag: 'importado-personalmed',
          description: text(image.description) || null,
          date,
          contentBase64: image.bytes.toString('base64'),
        },
        issues,
        status: issues.length || !chart.patientTargetId ? 'rejected' : undefined,
      }),
    );
  }
  return out;
}

/** Write one NDJSON file per entity plus manifest.json. Deterministic order. */
/**
 * Health-plan cards of one person (Clini_05 + Carrier) -> `health_plan_card`,
 * staging only until S2 gives cards a home in Cortex. "Particular" (private
 * pay) is a payment mode, not a card, and is not staged. The holder name stays
 * in the encrypted staging: it can be another person (a parent, a spouse).
 *
 * @param ctx   { sourceInstance, batchId, exportDate }
 * @param pcod  legacy person key
 * @param cards [{ carrierCod, carrier, isPrivate, disabled, card, ownerName, expiration }]
 *              expiration as ISO date (or null)
 */
export function buildHealthPlanCards(ctx, pcod, cards) {
  const seen = new Map();
  const out = [];
  for (const c of cards) {
    if (c.isPrivate) continue;
    const number = text(c.card).replace(/\s+/g, '');
    // Stable key: same person, insurer and number; repeated or blank numbers get an ordinal.
    const base = `${c.carrierCod}|${number || 'sem-numero'}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const expires = legacyDate(c.expiration, { max: '2100-12-31' });
    const issues = [];
    if (!number) issues.push('card_number_missing');
    if (n > 1) issues.push('card_duplicated');
    if (c.disabled) issues.push('carrier_disabled');
    if (expires.date && expires.date < ctx.exportDate) issues.push('card_expired');
    issues.push(...expires.issues);
    out.push(
      envelope({
        sourceInstance: ctx.sourceInstance,
        batchId: ctx.batchId,
        sourceEntity: 'health_plan_card',
        key: { pcod, carrier: c.carrierCod, card: number || 'sem-numero', n },
        targetTable: 'staging_only',
        payload: {
          carrier: text(c.carrier) || null,
          cardNumber: number || null,
          holderName: text(c.ownerName) || null,
          expiresOn: expires.date,
          carrierDisabled: Boolean(c.disabled),
          primary: false,
        },
        issues,
        status: 'ready',
      }),
    );
  }
  // Main card: the first one of an active insurer that has not expired.
  const main = out.find((e) => !e.payload.carrierDisabled && !e.issues.includes('card_expired'));
  if (main) main.payload.primary = true;
  return out;
}

/**
 * One "Atenção" text (Clini_01.Attention, one per person) -> `legacy_alert`
 * (S6): visible only to the doctors who treat the person, status
 * pending_review. Nothing goes to the chart or to the reception directly.
 *
 * D7 A (user, 05/11/2026): every alert carries the action suggested to the
 * doctor (alertSuggestedAction), confirmed by the doctor, and a review queue:
 * `at_go_live` for a person seen since ctx.reviewFrom (2025-01-01), otherwise
 * `on_return` (shown when the person comes back).
 *
 * @param ctx    { sourceInstance, batchId, reviewFrom? }
 * @param alert  { pcod, text, lastVisit? } with plain text (RTF already converted)
 * @param charts [{ user, patientTargetId }] charts built for this person
 */
export function buildLegacyAlert(ctx, alert, charts) {
  const body = text(alert.text);
  // Only punctuation or symbols ("-", ".") is not an alert.
  if (!fold(body)) return null;
  const { categories, clinical, administrative } = alertCategories(body);
  const issues = [];
  if (clinical && administrative) issues.push('alert_clinical_and_admin');
  if (categories.includes('obito')) issues.push('alert_mentions_death');
  if (!charts.length) issues.push('alert_no_chart');
  if (charts.length > 1) issues.push('alert_multiple_doctors');
  // A recipient that is a shared login (D2) has no known owner yet.
  if (charts.some((c) => SHARED_LOGINS.has(Number(c.user)))) issues.push('owner_shared_login');
  const status = charts.length === 1 ? 'ready' : 'requires_review';
  const lastVisit = legacyDate(alert.lastVisit ?? null, { max: ctx.exportDate }).date;
  const reviewQueue = lastVisit && lastVisit >= (ctx.reviewFrom ?? '2025-01-01') ? 'at_go_live' : 'on_return';
  return envelope({
    sourceInstance: ctx.sourceInstance,
    batchId: ctx.batchId,
    sourceEntity: 'legacy_alert',
    key: { pcod: alert.pcod },
    doctor: charts.length === 1 ? charts[0].user : null,
    targetTable: 'legacy_alerts',
    payload: {
      text: body,
      categories,
      clinical,
      administrative,
      suggestedAction: alertSuggestedAction({ categories, clinical, administrative }),
      reviewQueue,
      recipients: charts.map((c) => ({ doctor: `user:${c.user}`, patientTargetId: c.patientTargetId })),
      status: 'pending_review',
      visibility: 'doctor_only',
    },
    issues,
    status,
  });
}

/**
 * One legacy document template (Us05/Gintxt/Pedtxt row) -> `template`
 * envelope for document_snippets (S3). Loadable templates arrive approved
 * and editable (D19, 04/11); the others stay imported_unreviewed. Prescription
 * templates carry Cortex items; the whole text stays in `body`, so nothing is
 * lost. Usage counts come from templateUsage() and hold no document text.
 *
 * @param ctx   { sourceInstance, batchId, usageSince }
 * @param t     { table, modelNumber, user, modelType, name, text, rtfTable }
 *              `text` is plain text (RTF already converted); `user` is null
 *              for the clinic-wide library.
 * @param usage { uses, byDoctor, lastUsed } or undefined
 * @param regulated { antimicrobial: string[], controlled: string[] } found in the text
 */
export function buildTemplate(ctx, t, usage, regulated = { antimicrobial: [], controlled: [] }) {
  const kind = templateKind(t.modelType);
  const body = text(t.text);
  const issues = [];
  let name = text(t.name).replace(/\s+/g, ' ');
  if (!name) {
    name = `Modelo ${t.table} ${t.modelNumber}`;
    issues.push('template_name_missing');
  }
  if (name.length > 120) {
    name = name.slice(0, 120).trim();
    issues.push('template_name_truncated');
  }
  const merge = mergeFieldsOf(body);
  if (merge.unsupported.length) issues.push('template_merge_field_unsupported');
  if (t.rtfTable) issues.push('template_rtf_table');
  if (regulated.controlled.length) issues.push('template_controlled_substance');

  let items = [];
  let header = [];
  let footer = [];
  if (!body) issues.push('template_empty');
  else if (kind !== 'receita') issues.push('template_kind_not_supported_yet');
  else {
    const parsed = parseTemplateItems(body);
    if (parsed.kind === 'free_text') issues.push('template_items_not_found');
    else {
      header = parsed.header;
      footer = parsed.footer;
      // Legacy "quantity" (after the ____ line) is what the doctor prints next
      // to the drug; the route heading ("Uso oral") opens the instructions.
      // D19: adapted to Cortex, which fills no automatic field inside a
      // medication: any @field there becomes a blank for the doctor to fill.
      const blank = (v) => v.replace(/(?<![A-Za-z0-9._%+-])@[a-z_]+/gi, '____');
      items = parsed.items.map((i) => ({ name: blank(i.name), dosage: blank(i.quantity), instructions: blank([i.route, i.instructions].filter(Boolean).join('\n')) }));
      if (items.some((i, n) => i.instructions !== [parsed.items[n].route, parsed.items[n].instructions].filter(Boolean).join('\n') || i.name !== parsed.items[n].name || i.dosage !== parsed.items[n].quantity))
        issues.push('template_merge_field_blanked');
      if (items.length > 15) issues.push('template_items_over_limit');
      if (items.some((i) => i.name.length > 200 || i.dosage.length > 200 || i.instructions.length > 1000)) issues.push('template_item_too_long');
    }
  }
  const blocking = ['template_kind_not_supported_yet', 'template_items_not_found', 'template_items_over_limit', 'template_item_too_long', 'template_controlled_substance'];
  const status = !body ? 'rejected' : issues.some((i) => blocking.includes(i)) ? 'requires_review' : 'ready';

  return envelope({
    sourceInstance: ctx.sourceInstance,
    batchId: ctx.batchId,
    sourceEntity: 'template',
    key: { table: t.table, model: t.modelNumber },
    doctor: t.user ?? null,
    targetTable: 'document_snippets',
    payload: {
      kind,
      name,
      items,
      body,
      header,
      footer,
      scope: t.user ? 'doctor' : 'clinic',
      // D19 (04/11): loadable templates arrive approved and editable, with no
      // prior review; the others stay imported_unreviewed until adapted.
      review_status: status === 'ready' ? 'approved' : 'imported_unreviewed',
      source: 'personalmed',
      source_ref: `${t.table}:${t.modelNumber}`,
      merge_fields: merge.fields,
      unsupported_merge_fields: merge.unsupported,
      regulated: { antimicrobial: regulated.antimicrobial, controlled: regulated.controlled },
      usage: { since: ctx.usageSince, uses: usage?.uses ?? 0, by_doctor: usage?.byDoctor ?? {}, last_used: usage?.lastUsed ?? null },
    },
    issues,
    status,
  });
}

export function writeBatch(dir, envelopes, meta) {
  mkdirSync(dir, { recursive: true });
  const byEntity = new Map();
  for (const e of envelopes) {
    if (!byEntity.has(e.sourceEntity)) byEntity.set(e.sourceEntity, []);
    byEntity.get(e.sourceEntity).push(e);
  }
  const files = {};
  const counts = {};
  const issueCounts = {};
  for (const [entity, list] of [...byEntity.entries()].sort()) {
    list.sort((a, b) => (a.sourceRecordId < b.sourceRecordId ? -1 : a.sourceRecordId > b.sourceRecordId ? 1 : 0));
    const body = `${list.map((e) => JSON.stringify(e)).join('\n')}\n`;
    const name = `${entity}.ndjson`;
    writeFileSync(join(dir, name), body);
    files[name] = { sha256: createHash('sha256').update(body).digest('hex'), lines: list.length };
    counts[entity] = { total: list.length, byStatus: {}, byDoctor: {} };
    for (const e of list) {
      counts[entity].byStatus[e.mappingStatus] = (counts[entity].byStatus[e.mappingStatus] ?? 0) + 1;
      if (e.sourceDoctorId) counts[entity].byDoctor[e.sourceDoctorId] = (counts[entity].byDoctor[e.sourceDoctorId] ?? 0) + 1;
      for (const i of e.issues) issueCounts[i] = (issueCounts[i] ?? 0) + 1;
    }
  }
  const manifest = { ...meta, transformVersion: TRANSFORM_VERSION, files, counts, issues: Object.fromEntries(Object.entries(issueCounts).sort()) };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
