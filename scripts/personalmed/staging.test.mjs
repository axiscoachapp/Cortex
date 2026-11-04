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

  it('sends appointments whose doctor has no chart for the person to review (D14)', () => {
    const a = find('appointment', 'user:3|date:2025-03-12|start:960');
    expect(a).toMatchObject({ mappingStatus: 'requires_review', payload: { patientTargetId: null }, issues: ['appointment_chart_missing'] });
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
      expect(m.counts.appointment.byStatus).toEqual({ ready: 6, rejected: 2, requires_review: 2 });
      const lines = readFileSync(join(dir, 'chart.ndjson'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(6);
      expect(m.files['chart.ndjson'].sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('synthetic templates (S3)', () => {
  const tpl = (model, table = 'Us05') => find('template', `table:${table}|model:${model}`);

  it('stages every template as imported_unreviewed for document_snippets', () => {
    const all = of('template');
    expect(all).toHaveLength(9);
    for (const e of all) {
      expect(e.targetTable).toBe('document_snippets');
      expect(e.payload).toMatchObject({ review_status: 'imported_unreviewed', source: 'personalmed' });
      expect(e.payload.source_ref).toBe(e.sourceRecordId.replace(/^table:(\w+)\|model:(\d+)$/, '$1:$2'));
      expect(e.payload.name.length).toBeLessThanOrEqual(120);
    }
  });

  it('turns a clinic prescription into Cortex items without losing the text', () => {
    const e = tpl(1);
    expect(e.mappingStatus).toBe('ready');
    expect(e.sourceDoctorId).toBeNull();
    expect(e.payload.scope).toBe('clinic');
    expect(e.payload.items).toEqual([
      { name: 'Nitrofurantoína 100 mg', dosage: '1 caixa', instructions: 'Uso oral\nTomar 1 cápsula de 6 em 6 horas por 5 dias.' },
      { name: 'Fenazopiridina 200 mg', dosage: '6 comprimidos', instructions: 'Uso oral\nTomar 1 comprimido de 8 em 8 horas se ardor.' },
    ]);
    expect(e.payload.header).toEqual(['@nome']);
    expect(e.payload.footer).toEqual(['Curitiba, @extenso']);
    expect(e.payload.body).toContain('Fenazopiridina 200 mg ______ 6 comprimidos');
    expect(e.payload.regulated.antimicrobial).toEqual(['nitrofurantoina']);
  });

  it('counts usage per doctor inside the window, only when every fixed line matches', () => {
    expect(tpl(1).payload.usage).toEqual({ since: '2025-01-01', uses: 2, by_doctor: { 'user:3': 1, 'user:5': 1 }, last_used: '2026-05-02' });
    // The edited quantity (2 frascos) is not a use; the exact one is.
    expect(tpl(2).payload.usage).toMatchObject({ uses: 1, by_doctor: { 'user:5': 1 } });
    expect(tpl(3).payload.usage).toMatchObject({ uses: 0, by_doctor: {}, last_used: null });
    // Usage holds counts and dates only.
    expect(JSON.stringify(of('template').map((e) => e.payload.usage))).not.toMatch(/SINTÉTICA|Tomar/);
  });

  it('keeps a doctor-owned template with that doctor and flags unsupported merge fields', () => {
    const e = tpl(2);
    expect(e).toMatchObject({ sourceDoctorId: 'user:5', mappingStatus: 'ready', issues: ['template_merge_field_unsupported'] });
    expect(e.payload).toMatchObject({ scope: 'doctor', unsupported_merge_fields: ['@sangue'] });
  });

  it('sends what Cortex cannot take yet to review, and rejects only empty templates', () => {
    expect(tpl(3)).toMatchObject({ mappingStatus: 'requires_review', issues: ['template_items_not_found'] });
    expect(tpl(4)).toMatchObject({ mappingStatus: 'requires_review', issues: ['template_controlled_substance'] });
    expect(tpl(5)).toMatchObject({ mappingStatus: 'requires_review', issues: ['template_items_over_limit'] });
    expect(tpl(5).payload.items).toHaveLength(16);
    expect(tpl(6)).toMatchObject({ mappingStatus: 'requires_review', issues: ['template_kind_not_supported_yet'] });
    expect(tpl(6).payload.kind).toBe('texto');
    expect(tpl(1, 'Pedtxt').payload.kind).toBe('pedido_exame');
    expect(tpl(7)).toMatchObject({ mappingStatus: 'rejected', issues: ['template_empty'] });
    expect(tpl(8)).toMatchObject({ mappingStatus: 'ready', issues: ['template_name_truncated', 'template_rtf_table'] });
  });

  it('only marks ready the templates that fit the document_snippets item rules', () => {
    for (const e of of('template').filter((x) => x.mappingStatus === 'ready')) {
      expect(e.payload.kind).toBe('receita');
      expect(e.payload.items.length).toBeGreaterThanOrEqual(1);
      expect(e.payload.items.length).toBeLessThanOrEqual(15);
      for (const i of e.payload.items) {
        expect(Object.keys(i).sort()).toEqual(['dosage', 'instructions', 'name']);
        expect(i.name.trim().length).toBeGreaterThan(0);
        expect(i.name.length).toBeLessThanOrEqual(200);
        expect(i.dosage.length).toBeLessThanOrEqual(200);
        expect(i.instructions.length).toBeLessThanOrEqual(1000);
      }
    }
  });
});

describe('synthetic "Atenção" alerts (S6)', () => {
  const alert = (pcod) => find('legacy_alert', `pcod:${pcod}`);

  it('sends a one-doctor alert to that chart, for the doctor only, pending review', () => {
    const e = alert(102);
    expect(e).toMatchObject({ mappingStatus: 'ready', sourceDoctorId: 'user:3', targetTable: 'legacy_alerts', issues: ['alert_clinical_and_admin'] });
    expect(e.payload).toMatchObject({ status: 'pending_review', visibility: 'doctor_only', clinical: true, administrative: true });
    expect(e.payload.recipients).toEqual([{ doctor: 'user:3', patientTargetId: find('chart', 'pcod:102|user:3').targetId }]);
  });

  it('waits for D20 when the person has several doctors, and for review when there is no chart', () => {
    expect(alert(101)).toMatchObject({ mappingStatus: 'requires_review', sourceDoctorId: null, issues: ['alert_multiple_doctors'] });
    expect(alert(101).payload.recipients.map((r) => r.doctor)).toEqual(['user:3', 'user:5']);
    expect(alert(199)).toMatchObject({ mappingStatus: 'requires_review', issues: ['alert_no_chart'] });
  });

  it('flags a mention of death and skips empty text', () => {
    expect(alert(104)).toMatchObject({ mappingStatus: 'ready', issues: ['alert_mentions_death'] });
    expect(alert(105)).toMatchObject({ mappingStatus: 'ready', issues: [] });
    expect(alert(103)).toBeUndefined();
    expect(of('legacy_alert')).toHaveLength(5);
  });
});

describe('synthetic health-plan cards (staging only)', () => {
  const cards = (pcod) => of('health_plan_card').filter((e) => e.sourceRecordId.startsWith(`pcod:${pcod}|`));

  it('stages every card except private pay, only in staging', () => {
    expect(of('health_plan_card')).toHaveLength(4);
    expect(cards(102)).toEqual([]);
    expect(of('health_plan_card').every((e) => e.targetTable === 'staging_only' && e.mappingStatus === 'ready')).toBe(true);
  });

  it('keeps holder and expiry, flags an expired card and picks an active one as main', () => {
    const [current, old] = cards(101);
    expect(current.payload).toMatchObject({ carrier: 'PLANO SINTÉTICO A', cardNumber: '0000000000000101', holderName: 'PACIENTE SINTÉTICA UM', expiresOn: '2027-06-30', primary: true });
    expect(old).toMatchObject({ issues: ['card_expired'], payload: { cardNumber: 'C0101', holderName: 'TITULAR SINTÉTICO', primary: false } });
  });

  it('flags missing numbers, repeated cards, inactive insurers and zero dates, with stable keys', () => {
    const [first, second] = cards(105);
    expect(first.issues).toEqual(['card_number_missing', 'carrier_disabled', 'date_sentinel']);
    expect(second.issues).toEqual(['card_duplicated', 'card_number_missing', 'carrier_disabled']);
    expect([first.sourceRecordId, second.sourceRecordId]).toEqual(['pcod:105|carrier:12|card:sem-numero|n:1', 'pcod:105|carrier:12|card:sem-numero|n:2']);
    expect(cards(105).some((e) => e.payload.primary)).toBe(false);
  });
});
