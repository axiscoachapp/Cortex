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
