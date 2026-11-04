// Synthetic batch: invented rows only (fixtures/synthetic-legacy.mjs).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syntheticBatch } from './make-synthetic-batch.mjs';
import { writeBatch } from './staging.mjs';
import { wallClockToUtc } from './transforms.mjs';

const { envelopes } = syntheticBatch();
const of = (entity) => envelopes.filter((e) => e.sourceEntity === entity);
const find = (entity, id) => envelopes.find((e) => e.sourceEntity === entity && e.sourceRecordId === id);

describe('synthetic staging batch', () => {
  it('is deterministic', () => {
    expect(syntheticBatch().envelopes.map((e) => e.targetId)).toEqual(envelopes.map((e) => e.targetId));
  });

  it('keeps one person and one contact, with a chart and a self link per doctor', () => {
    expect(find('person', 'pcod:101')).toBeTruthy();
    const contact = find('contact', 'pcod:101');
    const charts = of('chart').filter((c) => c.sourceRecordId.startsWith('pcod:101|'));
    expect(charts.map((c) => c.sourceDoctorId)).toEqual(['user:3', 'user:5']);
    const links = of('contact_chart_link').filter((l) => l.payload.contactTargetId === contact.targetId);
    expect(links.map((l) => l.payload.patientTargetId).sort()).toEqual(charts.map((c) => c.targetId).sort());
    expect(links.every((l) => l.payload.relationship === 'self' && l.payload.evidence === 'same_legacy_pcod')).toBe(true);
  });

  it('never links family members through a shared phone', () => {
    const mother = find('contact', 'pcod:102');
    const daughter = find('contact', 'pcod:103');
    expect(mother.payload.phone_normalized).toBe(daughter.payload.phone_normalized);
    expect(mother.targetId).not.toBe(daughter.targetId);
    const daughterChart = find('chart', 'pcod:103|user:3');
    expect(of('contact_chart_link').some((l) => l.payload.contactTargetId === mother.targetId && l.payload.patientTargetId === daughterChart.targetId)).toBe(false);
  });

  it('adds DDD 41 only inside the 41 area', () => {
    expect(find('chart', 'pcod:101|user:3').payload.phone).toBe('554130000101');
    expect(find('person', 'pcod:104').issues).toContain('phone_no_ddd_outside_41');
    expect(find('chart', 'pcod:104|user:9').payload.phone).toBeNull();
  });

  it('keeps CPF, accommodation and address problems as issue codes', () => {
    const p1 = find('person', 'pcod:101');
    expect(p1.payload.cpf).toMatch(/^\d{11}$/);
    expect(p1.payload.healthPlan.accommodation.category).toBe('apartamento');
    expect(find('chart', 'pcod:101|user:3').payload.health_insurance).toBe('PLANO SINTÉTICO A (apartamento)');
    const p5 = find('person', 'pcod:105');
    expect(p5.payload.cpf).toBeNull();
    expect(p5.issues).toEqual(expect.arrayContaining(['cpf_checksum_invalid', 'sex_missing', 'cep_generic', 'address_without_number', 'date_sentinel', 'email_field_reused']));
    expect(find('person', 'pcod:102').payload.address).toMatchObject({ city: 'Curitiba', uf: 'PR' });
  });

  it('marks every chart as waiting for the doctor map (D2)', () => {
    expect(of('chart').every((c) => c.issues.includes('doctor_map_pending'))).toBe(true);
  });

  it('rejects overlapping and status-less past appointments, without moving times', () => {
    const second = find('appointment', 'user:3|date:2026-09-01|start:550');
    expect(second.mappingStatus).toBe('rejected');
    expect(second.issues).toContain('appointment_overlap');
    expect(second.payload.start_time).toBe('2026-09-01T12:10:00.000Z');
    expect(find('appointment', 'user:3|date:2026-09-01|start:540').mappingStatus).toBe('ready');
    expect(find('appointment', 'user:5|date:2024-09-09|start:660')).toMatchObject({ mappingStatus: 'rejected', issues: ['status_unknown_past'] });
  });

  it('turns a future pre-registration into a provisional contact for review', () => {
    const a = find('appointment', 'user:5|date:2026-09-03|start:600');
    expect(a.payload.patientTargetId).toBeNull();
    expect(a.mappingStatus).toBe('requires_review');
    const c = envelopes.find((e) => e.targetId === a.payload.contactTargetId);
    expect(c).toMatchObject({ sourceEntity: 'contact', mappingStatus: 'requires_review', payload: { origin: 'personalmed_precadastro', phone_normalized: '5541990000909' } });
  });

  it('keeps future blocks in staging with no executor and drops past ones', () => {
    const blocks = of('schedule_block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ mappingStatus: 'requires_review', payload: { legacyAuthor: null, executor: null }, issues: ['block_executor_contract_pending'] });
  });

  it('maps statuses and converts São Paulo wall-clock times, including daylight saving', () => {
    expect(find('appointment', 'user:3|date:2026-04-07|start:900').payload.status).toBe('faltou');
    expect(find('appointment', 'user:3|date:2026-03-03|start:900').payload.status).toBe('cancelado');
    expect(find('appointment', 'user:9|date:2018-12-10|start:540').payload.start_time).toBe('2018-12-10T11:00:00.000Z');
    expect(wallClockToUtc('2025-01-15', 600)).toBe('2025-01-15T13:00:00.000Z');
  });

  it('keeps the whole universe with cohort flags for the reception (D12)', () => {
    expect(find('person', 'pcod:101').payload.cohort).toEqual({ active: true, futureAppointment: true });
    expect(find('contact', 'pcod:104').payload.cohort).toEqual({ active: false, futureAppointment: false });
  });

  it('builds one consultation per day, merging structured data and the running history', () => {
    const ofChart = of('consultation').filter((c) => c.sourceRecordId.startsWith('pcod:101|user:3|'));
    expect(ofChart.map((c) => c.sourceRecordId).sort()).toEqual(['pcod:101|user:3|day:2024-03-10', 'pcod:101|user:3|day:2025-05-15', 'pcod:101|user:3|day:2026-07-10', 'pcod:101|user:3|page:qp-hda']);
    const mixed = find('consultation', 'pcod:101|user:3|day:2024-03-10').payload.soap_note;
    expect(mixed).toContain('### Evolução');
    expect(mixed).toContain('### Histórico corrido');
    expect(mixed).toContain('Antecedentes sintéticos: G1P1.'); // text before the first date is kept
    expect(mixed).toContain('Peso (valor original): 10060');
    const historyOnly = find('consultation', 'pcod:101|user:3|day:2025-05-15').payload;
    expect(historyOnly.chief_complaint).toBe('Anotação do histórico (PersonalMed)');
    expect(historyOnly.soap_note).toContain('Acrescentado no mesmo dia.');
  });

  it('dates a consultation by its attended appointment and points to it', () => {
    const c = find('consultation', 'pcod:101|user:3|day:2026-07-10').payload;
    expect(c.created_at).toBe('2026-07-10T11:00:00.000Z');
    expect(c.appointmentSourceRecordId).toBe('user:3|date:2026-07-10|start:480');
    expect(c.soap_note.startsWith('[Importado do PersonalMed em 2026-11-03]')).toBe(true);
    expect(c.soap_note).toContain('**Receita**');
  });

  it('keeps an undated history as one consultation at the last visit', () => {
    expect(find('consultation', 'pcod:101|user:5|day:historico').payload).toMatchObject({ chief_complaint: 'Histórico PersonalMed (texto corrido)', created_at: '2026-05-04T15:00:00.000Z' });
  });

  it('imports only non-Z diagnoses, history pages and pregnancies still in course', () => {
    expect(find('diagnosis_set', 'pcod:101|user:3').payload.diagnoses).toEqual([
      { code: 'B37.9', description: 'Candidíase NE' },
      { code: 'N95.9', description: 'Transtorno NE da menopausa' },
    ]);
    expect(find('diagnosis_set', 'pcod:102|user:3')).toBeUndefined();
    expect(find('medical_history', 'pcod:101|user:3').payload.text).toContain('## Antecedentes');
    const pregnancies = of('pregnancy_item');
    expect(pregnancies).toHaveLength(1);
    expect(pregnancies[0].payload).toMatchObject({ kind: 'pregnancy', status: 'open', details: { date: '2026-10-22', source: 'DUM' } });
    expect(find('consultation', 'pcod:102|user:3|day:2026-06-01').payload.soap_note).toContain('IG: 20 semanas');
  });

  it('writes NDJSON files and a manifest with counts and hashes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-batch-'));
    try {
      const m = writeBatch(dir, envelopes, { synthetic: true });
      expect(m.counts.chart.total).toBe(6);
      expect(m.counts.appointment.byStatus).toEqual({ ready: 6, rejected: 2, requires_review: 1 });
      const lines = readFileSync(join(dir, 'chart.ndjson'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(6);
      expect(m.files['chart.ndjson'].sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
