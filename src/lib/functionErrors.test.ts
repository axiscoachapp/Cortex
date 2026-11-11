import { describe, expect, it } from 'vitest';
import {
  BUSY_FAILURE,
  CONNECTION_FAILURE,
  FAILURE_SENTENCES,
  PRESCRIBER_FAILURE,
  SESSION_FAILURE,
  UNAVAILABLE_FAILURE,
  plainFailureMessage,
} from './functionErrors';

const http = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => body } });

describe('plainFailureMessage (round 3, M 11)', () => {
  it('never returns the server text of an unexpected failure', async () => {
    expect(await plainFailureMessage(http(500, { error: 'TypeError: x is undefined' }), 'document')).toBe(
      'Não foi possível gerar o documento. Nada foi perdido. Tente de novo.',
    );
    expect(await plainFailureMessage(http(409, { error: 'Outra operação estava em andamento.' }), 'question')).toBe(FAILURE_SENTENCES.question);
    expect(await plainFailureMessage(new Error('boom'), 'comment')).toBe(FAILURE_SENTENCES.comment);
    expect(await plainFailureMessage(null, 'profile')).toBe(FAILURE_SENTENCES.profile);
  });

  it('maps known signals to their sentence', async () => {
    expect(await plainFailureMessage(new Error('Failed to send a request to the Edge Function'), 'document')).toBe(CONNECTION_FAILURE);
    expect(await plainFailureMessage({ name: 'FunctionsFetchError', message: 'x' }, 'question')).toBe(CONNECTION_FAILURE);
    expect(await plainFailureMessage(http(401, { error: 'JWT expired' }), 'question')).toBe(SESSION_FAILURE);
    expect(await plainFailureMessage(http(503, { error: 'IA indisponível: integração OpenAI ainda não ativada.' }), 'question')).toBe(UNAVAILABLE_FAILURE);
    expect(await plainFailureMessage(http(400, { error: 'x', code: 'not_configured' }), 'document')).toBe(UNAVAILABLE_FAILURE);
    expect(await plainFailureMessage(http(429, { limited: true }), 'question')).toBe(BUSY_FAILURE);
    expect(await plainFailureMessage(http(400, { error: 'Dados do prescritor incompletos', missingPrescriber: true }), 'document')).toBe(PRESCRIBER_FAILURE);
  });

  it('keeps a written 422 instruction, which says what the doctor has to fix', async () => {
    const instruction = 'Para a receita de antimicrobiano, complete no cadastro do paciente: CPF e endereço.';
    expect(await plainFailureMessage(http(422, { error: instruction }), 'document')).toBe(instruction);
    expect(await plainFailureMessage(http(422, { error: 'violates check constraint' }), 'document')).toBe(FAILURE_SENTENCES.document);
    expect(await plainFailureMessage(http(422, { error: 'invalid payload' }), 'document')).toBe(FAILURE_SENTENCES.document);
  });

  it('every sentence says what happened and what to do, in plain words', () => {
    for (const sentence of Object.values(FAILURE_SENTENCES)) {
      expect(sentence).toMatch(/^Não foi possível /);
      expect(sentence).not.toMatch(/implantação|erro interno|status|Edge|JWT/i);
    }
  });
});
