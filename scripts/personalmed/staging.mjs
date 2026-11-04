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
  cleanName,
  envelope,
  findCpf,
  findOverlaps,
  hasHouseNumber,
  legacyDate,
  mapAppointmentStatus,
  mapSex,
  normalizeCep,
  normalizeCity,
  normalizeEmail,
  normalizePhone,
  normalizeUf,
  registrationPhones,
  wallClockToUtc,
} from './transforms.mjs';

const text = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/**
 * One legacy person (Clini_01 row) -> `person` (staging only, legal identity),
 * one `chart` per doctor (patients), one `contact` candidate (clinic_contacts)
 * and one `self` link per chart, proven by the legacy key (same PCod).
 *
 * @param ctx { sourceInstance, batchId, exportDate }
 * @param p   Clini_01 row with ISO dates
 * @param charts [{ user, firstVisit, lastVisit, hasConsultations }]
 * @param plans  [{ carrier, card, isPrivate }] from Clini_05 + Carrier
 */
export function buildPerson(ctx, p, charts, plans = []) {
  const base = { sourceInstance: ctx.sourceInstance, batchId: ctx.batchId };
  const name = cleanName(p.Name);
  const birth = legacyDate(p.BirthDate, { max: ctx.exportDate });
  const sex = mapSex(p.Sex);
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
    },
    issues: [...name.issues, ...birth.issues, ...sex.issues, ...cpf.issues, ...email.issues, ...addressIssues, ...phoneIssues],
  });

  const contact = envelope({
    ...base,
    sourceEntity: 'contact',
    key: { pcod: p.PCod },
    targetTable: 'clinic_contacts',
    payload: { name: name.name, phone: bestPhone?.raw ?? phones[0]?.raw ?? '', phone_normalized: bestPhone?.normalized ?? null, origin: 'personalmed_registration' },
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
export function buildAgenda(ctx, rows, chartIds) {
  const base = { sourceInstance: ctx.sourceInstance, batchId: ctx.batchId };
  const out = [];
  const appointments = [];
  for (const r of rows) {
    const key = { user: r.user, date: r.date, start: r.startMinutes };
    const start = wallClockToUtc(r.date, r.startMinutes);
    const end = wallClockToUtc(r.date, r.startMinutes + (r.duration > 0 ? r.duration : 15));
    if (r.slotType === 'B') {
      if (r.date <= ctx.exportDate) continue; // past blocks are not imported
      // Legacy blocks have no author: origin stays apart from the future executor.
      out.push(
        envelope({
          ...base,
          sourceEntity: 'schedule_block',
          key,
          doctor: r.user,
          targetTable: 'reception_schedule_blocks',
          payload: { ownerLegacyDoctor: r.user, start_time: start, end_time: end, legacyAuthor: null, executor: null },
          issues: ['block_executor_contract_pending'],
          status: 'requires_review',
        }),
      );
      continue;
    }
    const mapped = mapAppointmentStatus(r.estado, r.date, { exportDate: ctx.exportDate });
    const patientTargetId = r.pcod != null ? (chartIds.get(`${r.pcod}|${r.user}`) ?? null) : null;
    const issues = [...mapped.issues];
    let contactTargetId = null;
    if (r.pcod == null && r.preCadastro?.name) {
      if (r.date > ctx.exportDate) {
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
        contactTargetId,
        start_time: start,
        end_time: end,
        status: mapped.status,
        type: r.typeLabel ?? null,
        notes: mapped.note,
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

/** Write one NDJSON file per entity plus manifest.json. Deterministic order. */
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
