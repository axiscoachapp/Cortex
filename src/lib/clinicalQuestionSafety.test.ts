import { describe, expect, it, vi } from 'vitest';
import { requiresMedicationVerification } from '../../supabase/functions/_shared/clinicalQuestionSafety';
import { admitOperation, OperationRateError } from '../../supabase/functions/_shared/quota';

describe('shared medication question routing', () => {
  it.each([
    'Há interação entre paroxetina e propranolol?',
    'Posso tomar os dois?',
    'Pode acrescentar outro medicamento?',
    'É seguro aumentar a dose?',
    'Quais as contraindicações dessa associação?',
    'Can I combine these medications?',
  ])('requires verification for %s', (question) => {
    expect(requiresMedicationVerification(question, [])).toBe(true);
  });
  it('uses bounded user history for an indirect follow-up', () => {
    expect(requiresMedicationVerification('E em dose baixa?', [{ type: 'user', content: 'Existe interação entre A e B?' }])).toBe(true);
  });
  it.each(['Quais medicamentos foram registrados na última consulta?', 'Qual foi a conduta em outubro?', 'Como eu gero um documento no Cortex?'])('allows ordinary chart/product questions: %s', (question) => {
    expect(requiresMedicationVerification(question, [])).toBe(false);
  });
  // The reviewer's examples (relatorios/ia-openai.md, finding 14) plus the pilot's specialty.
  // true = record mode with a patient (chart only, then the fixed notice) / fixed notice without one.
  it.each([
    ['E qual foi a queixa da última consulta?', [{ type: 'user', content: 'Quais medicamentos ela usa?' }], false],
    ['E qual foi a queixa da última consulta?', [{ type: 'user', content: 'Há interação entre paroxetina e propranolol?' }], false],
    ['Resuma o exame e a conduta', [{ type: 'user', content: 'Qual a dose da levotiroxina registrada?' }], false],
    ['Pode resumir a última consulta e manter o foco no plano?', [], false],
    ['Ela pode iniciar o pré-natal aqui?', [], false],
    ['Quais medicamentos ela usa?', [], false],
    ['Podemos revisar os exames juntos?', [], false],
    ['Qual exame é indicado para rastreio?', [], false],
    ['Qual a dose máxima de metformina na gestação?', [], true],
    ['Qual antibiótico para ITU em gestante de 20 semanas e em que dose?', [], true],
    ['Ibuprofeno é permitido no terceiro trimestre?', [], true],
    ['Metformina é segura na lactação?', [], true],
    ['Pode amamentar tomando sertralina?', [], true],
    ['Quantos mg de ácido fólico ela deve tomar?', [], true],
    ['Pode manter os dois?', [{ type: 'user', content: 'Paroxetina e propranolol juntos têm interação?' }], true],
    ['E a sertralina?', [{ type: 'user', content: 'Há interação entre paroxetina e propranolol?' }], true],
    ['E a sertralina, desde quando?', [{ type: 'user', content: 'Quais medicamentos ela usa?' }], false],
  ] as const)('%s (after %j) → %s', (question, history, expected) => {
    expect(requiresMedicationVerification(question, history)).toBe(expected);
  });
  it('does not treat a previous assistant claim as evidence or a trusted safety decision', () => {
    expect(requiresMedicationVerification('Qual foi a conduta?', [{ type: 'assistant', content: 'Nenhuma interação' }])).toBe(false);
  });
});

describe('non-billable rate admission', () => {
  it('retains operation limits without reserving credits or enabling AI', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { allowed: true, used: 1, limit: 30 }, error: null });
    await admitOperation({ rpc } as never, 'doctor');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admit_operation', { p_user_id: 'doctor', p_operation: 'ai' });
  });
  it('fails closed on exhausted or unavailable rate admission', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { allowed: false, used: 30, limit: 30 }, error: null });
    await expect(admitOperation({ rpc } as never, 'doctor')).rejects.toBeInstanceOf(OperationRateError);
    rpc.mockResolvedValue({ data: null, error: new Error('unavailable') });
    await expect(admitOperation({ rpc } as never, 'doctor')).rejects.toThrow('Controle de operações indisponível');
  });
});
