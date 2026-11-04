import { describe, expect, it } from 'vitest';
import { numberInWords, planControlledPrescription } from '../../supabase/functions/_shared/regulatedMedications';

const ctx = { patientCpf: '52998224725', prescriberCpf: null, prescriberPhone: '(41) 3000-0000' };
const address = { patientAddress: 'Rua Sintética, 100 — Centro — Curitiba/PR' };
const item = (name: string, extra: Record<string, unknown> = {}) => ({ name, concentration: '50 mg', dosage: '1 comprimido', instructions: 'à noite', quantity: 30, unit: 'comprimidos', ...extra });

describe('quantity in words', () => {
  it('writes Portuguese numbers as the RCE requires', () => {
    expect([1, 2, 10, 15, 21, 30, 60, 100, 101, 120, 200, 999, 1000, 1001, 2030].map(numberInWords)).toEqual([
      'um', 'dois', 'dez', 'quinze', 'vinte e um', 'trinta', 'sessenta', 'cem', 'cento e um', 'cento e vinte', 'duzentos',
      'novecentos e noventa e nove', 'mil', 'mil e um', 'dois mil e trinta',
    ]);
    expect(() => numberInWords(0)).toThrow();
  });
});

describe('Receita de Controle Especial rules (D8)', () => {
  it('prepares a valid C1 prescription with CPF, address and quantity in words', () => {
    const r = planControlledPrescription([item('Sertralina 50 mg')], address, ctx);
    expect('plan' in r && r.plan).toMatchObject({
      patientDocumentLine: 'CPF: 529.982.247-25',
      patientAddress: 'Rua Sintética, 100 — Centro — Curitiba/PR',
      items: [{ name: 'Sertralina 50 mg', quantity: 30, unit: 'comprimidos', quantityText: 'trinta' }],
      hasC5: false,
    });
  });

  it('refuses notification-only drugs, non-controlled items and more than 3 items', () => {
    expect(planControlledPrescription([item('Rivotril 2mg')], address, ctx)).toEqual({
      error: 'Rivotril 2mg (clonazepam, lista B1) não pode sair na receita de controle especial: exige Notificação de Receita B (azul, talão numerado).',
    });
    expect(planControlledPrescription([item('Dipirona 500 mg')], address, ctx)).toMatchObject({ error: expect.stringContaining('não é controlado') });
    expect(planControlledPrescription([item('Cytotec 200 mcg')], address, ctx)).toMatchObject({ error: expect.stringContaining('hospitais cadastrados') });
    expect(planControlledPrescription([1, 2, 3, 4].map(() => item('Sertralina 50 mg')), address, ctx)).toMatchObject({ error: expect.stringContaining('no máximo 3') });
  });

  it('requires quantity, address and a patient document', () => {
    expect(planControlledPrescription([item('Sertralina 50 mg', { quantity: '' })], address, ctx)).toMatchObject({ error: expect.stringContaining('quantidade') });
    expect(planControlledPrescription([item('Sertralina 50 mg')], { patientAddress: 'Curitiba' }, ctx)).toMatchObject({ error: expect.stringContaining('endereço completo') });
    const noCpf = { ...ctx, patientCpf: null };
    expect(planControlledPrescription([item('Sertralina 50 mg')], address, noCpf)).toMatchObject({ error: expect.stringContaining('CPF do paciente') });
    expect(planControlledPrescription([item('Sertralina 50 mg')], { ...address, patientDocument: { kind: 'nao_possui' } }, noCpf)).toMatchObject({ plan: { patientDocumentLine: 'CPF: não possui' } });
    expect(planControlledPrescription([item('Sertralina 50 mg')], { ...address, patientDocument: { kind: 'passaporte', value: 'X123' } }, noCpf)).toMatchObject({ plan: { patientDocumentLine: 'Passaporte: X123' } });
  });

  it('applies the C5 requirements and the CID for justifications', () => {
    const testosterone = [item('Cipionato de testosterona 200 mg/ml', { quantity: 1, unit: 'frasco-ampola' })];
    expect(planControlledPrescription(testosterone, address, ctx)).toMatchObject({ error: expect.stringContaining('seu CPF') });
    const withCpf = { ...ctx, prescriberCpf: '11144477735' };
    expect(planControlledPrescription(testosterone, address, withCpf)).toMatchObject({ error: expect.stringContaining('CID') });
    expect(planControlledPrescription(testosterone, { ...address, cid: 'e29.1' }, withCpf)).toMatchObject({ plan: { hasC5: true, cid: 'E29.1', items: [{ quantityText: 'um' }] } });
    expect(planControlledPrescription([item('Sertralina 50 mg')], { ...address, justification: 'Tratamento de 90 dias' }, ctx)).toMatchObject({ error: expect.stringContaining('CID') });
  });

  it('accepts codeine and tramadol within the dose adendo', () => {
    expect(planControlledPrescription([item('Tylex 30 mg')], address, ctx)).toHaveProperty('plan');
    expect(planControlledPrescription([item('Tramadol', { concentration: '150 mg' })], address, ctx)).toMatchObject({ error: expect.stringContaining('Notificação de Receita A') });
  });
});

describe('review findings on the RCE rules (Codex, 04/11 10:15)', () => {
  it('decides the codeine/tramadol adendo by the explicit concentration, also for a brand without dose in the name', () => {
    // Brand from the catalog: the name has no dose; the concentration field does.
    expect(planControlledPrescription([item('Tramal', { concentration: '50 mg', ingredients: ['cloridrato de tramadol'] })], address, ctx)).toHaveProperty('plan');
    expect(planControlledPrescription([item('Tramal', { concentration: '', ingredients: ['cloridrato de tramadol'] })], address, ctx)).toMatchObject({ error: expect.stringContaining('concentração') });
    // A combination: only the controlled substance's concentration counts.
    expect(planControlledPrescription([item('Paracetamol + codeína', { concentration: '500 mg + 30 mg' })], address, ctx)).toMatchObject({ error: expect.stringContaining('só a concentração') });
    expect(planControlledPrescription([item('Paracetamol + codeína', { concentration: '30 mg' })], address, ctx)).toHaveProperty('plan');
  });

  it('refuses an over-long address, CID, justification or document instead of cutting it', () => {
    const long = `Rua ${'Sintética '.repeat(36)}, 100 — Curitiba/PR`;
    expect(long.length).toBeGreaterThan(300);
    expect(planControlledPrescription([item('Sertralina 50 mg')], { patientAddress: long }, ctx)).toMatchObject({ error: expect.stringContaining('300 caracteres') });
    expect(planControlledPrescription([item('Sertralina 50 mg')], { ...address, cid: 'F32.1 episódio depressivo' }, ctx)).toMatchObject({ error: expect.stringContaining('CID') });
    expect(planControlledPrescription([item('Sertralina 50 mg')], { ...address, cid: 'F32.1', justification: 'x'.repeat(601) }, ctx)).toMatchObject({ error: expect.stringContaining('600') });
    const noCpf = { ...ctx, patientCpf: null };
    expect(planControlledPrescription([item('Sertralina 50 mg')], { ...address, patientDocument: { kind: 'outro', value: '9'.repeat(41) } }, noCpf)).toMatchObject({ error: expect.stringContaining('40') });
    const exact = `Rua ${'A'.repeat(280)}, 1 — Curitiba/PR`.slice(0, 300);
    expect(planControlledPrescription([item('Sertralina 50 mg')], { patientAddress: exact }, ctx)).toMatchObject({ plan: { patientAddress: exact } });
  });
});
