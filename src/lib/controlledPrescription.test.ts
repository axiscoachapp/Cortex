import { describe, expect, it } from 'vitest';
import { numberInWords, planControlledPrescription } from '../../supabase/functions/_shared/controlledPrescription';

const ctx = { patientCpf: '52998224725', prescriberCpf: null, prescriberPhone: '(41) 3000-0000' };
const address = { patientAddress: 'Rua Sintética, 100 — Centro — Curitiba/PR' };
const item = (name: string, extra: Record<string, unknown> = {}) => ({ name, dosage: '1 comprimido', instructions: 'à noite', quantity: 30, unit: 'comprimidos', ...extra });

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
    expect(planControlledPrescription([item('Tramadol')], address, ctx)).toMatchObject({ error: expect.stringContaining('Notificação de Receita A') });
  });
});
