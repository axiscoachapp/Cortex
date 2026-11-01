import { describe, expect, it } from 'vitest';
import { parseDecimalPtBR, validateWorkItem } from './clinicalWorkspace';
import { functionErrorBody, functionErrorMessage } from './functionErrors';
import { mfaErrorMessage, newFactorName } from './mfa';

function httpError(body: unknown) {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & { context: unknown };
  error.context = { json: async () => body };
  return error;
}

describe('parseDecimalPtBR', () => {
  it('accepts pt-BR comma, period and thousands separators', () => {
    expect(parseDecimalPtBR('11,5')).toBe(11.5);
    expect(parseDecimalPtBR('11.5')).toBe(11.5);
    expect(parseDecimalPtBR('1.234,5')).toBe(1234.5);
    expect(parseDecimalPtBR(' 68,4 ')).toBe(68.4);
  });
  it('rejects non-numeric text', () => {
    expect(parseDecimalPtBR('abc')).toBeNaN();
    expect(parseDecimalPtBR('')).toBeNaN();
  });
  it('lets an observation with a decimal comma pass validation', () => {
    expect(validateWorkItem('observation', 'Hemoglobina', '', { value: '11,5', unit: 'g/dL', date: '2026-10-01' })).toBeNull();
  });
});

describe('functionErrorMessage', () => {
  it('prefers the server pt-BR message over the transport text', async () => {
    const error = httpError({ error: 'IA temporariamente indisponível. Você pode registrar a consulta manualmente.' });
    expect(await functionErrorMessage(error, 'fallback')).toMatch(/IA temporariamente indisponível/);
  });
  it('can be read after another reader consumed the body (quota check first)', async () => {
    const error = httpError({ error: 'Arquivo de áudio muito grande.', quotaExceeded: false });
    await functionErrorBody(error);
    expect(await functionErrorMessage(error, 'fallback')).toBe('Arquivo de áudio muito grande.');
  });
  it('maps network failures to a connection message', async () => {
    expect(await functionErrorMessage(new Error('Failed to send a request to the Edge Function'), 'fb')).toMatch(/conexão/);
  });
  it('never shows English library text', async () => {
    expect(await functionErrorMessage(httpError(null), 'Tente novamente.')).toBe('Tente novamente.');
    expect(await functionErrorMessage(new Error('Not authorized'), 'Sem acesso.')).toBe('Sem acesso.');
  });
});

describe('MFA helpers', () => {
  it('maps verification failures to a clear message', () => {
    expect(mfaErrorMessage({ code: 'mfa_verification_failed' })).toMatch(/Código incorreto/);
    expect(mfaErrorMessage(new Error('x'))).toMatch(/Não foi possível/);
  });
  it('generates distinct factor names so a backup authenticator can be added the same day', () => {
    const names = new Set(Array.from({ length: 20 }, () => newFactorName(1)));
    expect(names.size).toBeGreaterThan(15);
  });
});
