// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as gemini from '../../supabase/functions/_shared/gemini';
import * as storage from '../../supabase/functions/_shared/storage';
import * as modelInput from '../../supabase/functions/_shared/modelInput';

const userId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';
const audioStoragePath = `consultations/${userId}/${draftId}.webm`;
const transcript = 'Conteúdo sintético para avaliação técnica.';
const metadata = { provider: 'openai', requestedModel: 'gpt-transcribe', effectiveModel: null, adapterVersion: '1', diarization: 'unavailable' };
const soap = { soap_note: 'Nota sintética.', whatsapp_message: '', clarifications: [], transcription_quality: 'good', differential_diagnoses: [], drug_interaction_alerts: [] };

function fixture(options: {
  transcript?: string; draftText?: string; draftReject?: boolean; settlementReject?: boolean; failedSettlement?: number;
  failedSave?: number; missingDraft?: boolean; wrongOwner?: boolean; provider?: string; priorContent?: Record<string, unknown>; missingRevision?: boolean; mutateBeforeSave?: number;
} = {}) {
  let handler!: (request: Request) => Promise<Response>;
  const events: string[] = [];
  const saved: Record<string, unknown>[] = [];
  const source = { id: draftId, user_id: userId, patient_id: patientId, audio_storage_path: audioStoragePath, content: options.priorContent ?? {}, updated_at: options.missingRevision ? undefined : '2026-11-10T12:00:00.000Z' };
  let attempts = 0;
  let settlements = 0;
  const db = {
    from(table: string) {
      let patch: Record<string, unknown> | undefined;
      const filters: Array<[string, unknown]> = [];
      const execute = async () => {
        const row = table === 'patients'
          ? { id: patientId, user_id: options.wrongOwner ? 'other' : userId, name: 'Synthetic', age: 30 }
          : options.missingDraft ? null : source;
        if (patch) {
          events.push('save');
          attempts++;
          if (attempts === options.mutateBeforeSave) {
            source.updated_at = '2026-11-10T12:00:01.000Z';
            source.content = { ...source.content, soapDraft: 'Edição manual concorrente sintética.' };
          }
          if (attempts === options.failedSave) return { data: null, error: { message: 'Synthetic failure' } };
        }
        const matches = row && filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value);
        if (patch && matches) {
          saved.push(structuredClone(patch.content as Record<string, unknown>));
          Object.assign(source, patch);
        }
        return { data: matches ? structuredClone(row) : null, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        maybeSingle: execute,
        update: (value: Record<string, unknown>) => { patch = value; return query; },
        then: (resolve: (value: unknown) => unknown) => execute().then(resolve),
      };
      return query;
    },
    storage: { from: () => ({
      download: async () => ({ data: new Blob(['synthetic audio'], { type: 'audio/webm' }), error: null }),
      remove: vi.fn(),
    }) },
  };
  const reserve = vi.fn(async () => { events.push('reserve'); return { reservationId: `r${events.length}` }; });
  const settle = vi.fn(async () => { events.push('settle'); settlements++; if (options.settlementReject || options.failedSettlement === settlements) throw new Error('Synthetic settlement failure'); });
  const transcribe = vi.fn(async () => { events.push('transcribe'); return { text: options.transcript ?? transcript, usage: undefined, metadata }; });
  const generate = vi.fn(async () => {
    events.push('generate');
    if (options.draftReject) throw new Error('Synthetic provider failure');
    return { text: options.draftText ?? JSON.stringify(soap), usage: undefined, metadata: { ...metadata, requestedModel: 'gpt-6.1-terra' } };
  });
  const upload = vi.fn(async () => 'https://generativelanguage.googleapis.com/v1beta/files/synthetic');
  const modules: Record<string, unknown> = {
    '../_shared/http.ts': http,
    '../_shared/storage.ts': storage,
    '../_shared/modelInput.ts': modelInput,
    '../_shared/clinicalAi.ts': {
      transcribeClinicalAudio: transcribe,
      callClinicalText: generate,
      assertOpenAiEnabled: () => { if (options.provider && options.provider !== 'openai') throw new http.RequestError('IA indisponível', 503); },
    },
    '../_shared/gemini.ts': { ...gemini, uploadToGeminiFiles: upload, trackGeminiFile: vi.fn(), cleanupGeminiFile: vi.fn(), callGemini: async (_key: string, parts: object[]) => 'fileData' in parts[0] ? transcribe() : generate() },
    '../_shared/auth.ts': { requireUser: async () => ({ userId }), AuthError: class extends Error {}, authResponse: () => new Response(null, { status: 401 }) },
    '../_shared/specialty_prompts.ts': { getSpecialtyPrompt: () => 'Instrução sintética.', buildCustomTemplatePrompt: () => 'Modelo sintético.' },
    '../_shared/quota.ts': { checkQuota: reserve, recordUsage: settle, creditsFromUsage: () => 0, quotaResponse: () => new Response(null, { status: 429 }), QuotaExceededError: class extends Error {} },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../../supabase/functions/transcribe-consultation/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const load = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof handler) => { handler = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id in modules) return modules[id];
    throw new Error(`Unexpected module: ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(load, {}, { env: { get: (name: string) => name === 'AI_PROVIDER' ? options.provider ?? 'openai' : 'synthetic' } });
  return { events, saved, source, reserve, settle, transcribe, generate, upload,
    run: (extra: Record<string, unknown> = {}) => handler(new Request('https://edge.synthetic.invalid', { method: 'POST', body: JSON.stringify({ patientId, draftId, audioStoragePath, audioMimeType: 'audio/webm', ...extra }) })),
  };
}

describe('recorded OpenAI audio draft recovery', () => {
  it('uses saved doctor comments instead of overwriting them with a stale retry payload', async () => {
    const f = fixture({ priorContent: { originalComments: ['Observação atual salva'] } });
    expect((await f.run({ consultationComments: ['Observação antiga do cliente'] })).status).toBe(200);
    expect(f.saved[0].originalComments).toEqual(['Observação atual salva']);
    expect(JSON.stringify(f.generate.mock.calls)).toContain('Observação atual salva');
    expect(JSON.stringify(f.generate.mock.calls)).not.toContain('Observação antiga do cliente');
  });
  it('persists the literal transcript before settlement and the second paid call', async () => {
    const f = fixture();
    const response = await f.run();
    expect(response.status).toBe(200);
    expect(f.events.slice(0, 5)).toEqual(['reserve', 'transcribe', 'save', 'settle', 'reserve']);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.saved[0]).toMatchObject({ transcription: transcript, soapDraft: '', aiMetadata: { transcription: metadata } });
    const result = await response.json();
    expect(result.clarifications.join(' ')).toMatch(/falantes|diarização/);
    expect(result).toMatchObject({ draftPersisted: true, draftUpdatedAt: f.source.updated_at, aiMetadata: { transcription: metadata } });
  });
  it.each([
    { draftReject: true },
    { draftText: '{}' },
    { draftText: JSON.stringify({ ...soap, soap_note: '  ' }) },
    { settlementReject: true },
    { failedSettlement: 2 },
    { failedSave: 2 },
  ])('returns the transcript and keeps its recovery checkpoint when later work fails: %j', async (options) => {
    const f = fixture(options);
    const response = await f.run();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transcription: transcript, soapNote: '', draftFailed: true });
    expect(f.saved[0]).toMatchObject({ transcription: transcript, soapDraft: '' });
  });
  it('does not start generation if the first recovery write fails', async () => {
    const f = fixture({ failedSave: 1 });
    const response = await f.run();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transcription: transcript, draftFailed: true, draftPersisted: false, draftUpdatedAt: null, draftPersistenceFailed: true });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it('does not turn an empty transcript into a clinical note', async () => {
    const f = fixture({ transcript: '  ' });
    const response = await f.run();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transcription: '', soapNote: '', transcriptionQuality: 'poor' });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it.each([true, false])('preserves a previous literal transcript when a retry recognizes no speech (prior provenance: %s)', async (withProvenance) => {
    const previousText = 'Transcrição sintética preservada da primeira tentativa.\n';
    const previousMetadata = { ...metadata, adapterVersion: 'previous-synthetic-adapter' };
    const priorContent = {
      transcription: previousText,
      ...(withProvenance ? { aiMetadata: { transcription: previousMetadata } } : {}),
    };
    const f = fixture({ transcript: '  ', priorContent });
    const response = await f.run();
    const result = await response.json();
    expect(result).toMatchObject({ transcription: previousText, soapNote: '', draftFailed: true, draftPersisted: true });
    expect(result.clarifications.join(' ')).toMatch(/nova tentativa.*não reconheceu fala.*anterior.*mantida/i);
    expect(f.saved[0].transcription).toBe(previousText);
    const savedMetadata = f.saved[0].aiMetadata as Record<string, unknown>;
    expect(savedMetadata.transcription).toEqual(withProvenance ? previousMetadata : undefined);
    expect(savedMetadata.latestTranscriptionAttempt).toMatchObject({ ...metadata, outcome: 'empty' });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.reserve).toHaveBeenCalledOnce();
  });
  it('does not interpret a spoken legacy marker as a clinical classification', async () => {
    const f = fixture({ transcript: '[SEM_CONSULTA]' });
    const response = await f.run();
    expect(response.status).toBe(200);
    expect((await response.json()).transcription).toBe('[SEM_CONSULTA]');
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it('preserves existing manual text, recording consent and pending work if generation fails', async () => {
    const priorContent = { soapDraft: 'Nota manual sintética.', whatsappDraft: 'Mensagem manual sintética.', recordingConsent: { mode: 'presencial', consentedAt: '2026-11-10T12:00:00Z' }, pendingComments: 'Observação sintética pendente.' };
    const f = fixture({ priorContent, draftReject: true });
    const response = await f.run();
    expect(f.saved[0]).toMatchObject(priorContent);
    expect(await response.json()).toMatchObject({ soapNote: priorContent.soapDraft, whatsappMessage: priorContent.whatsappDraft, transcription: transcript, draftFailed: true });
  });
  it('returns the transcript without a write or second inference when the draft revision is missing', async () => {
    const f = fixture({ missingRevision: true });
    const response = await f.run();
    expect(await response.json()).toMatchObject({ transcription: transcript, draftPersistenceFailed: true });
    expect(f.saved).toHaveLength(0);
    expect(f.generate).not.toHaveBeenCalled();
  });
  it.each([1, 2])('preserves concurrent manual edits when draft write %s loses the CAS', async (mutateBeforeSave) => {
    const f = fixture({ mutateBeforeSave });
    const response = await f.run();
    expect(await response.json()).toMatchObject({ transcription: transcript, draftFailed: true, draftPersisted: false, draftPersistenceFailed: true });
    expect(f.source.content.soapDraft).toBe('Edição manual concorrente sintética.');
    expect(f.saved).toHaveLength(mutateBeforeSave - 1);
    expect(f.generate).toHaveBeenCalledTimes(mutateBeforeSave - 1);
  });
  it.each([{ wrongOwner: true }, { missingDraft: true }, { provider: 'gemini' }])('rejects before a paid request for an unavailable owner/draft/provider: %j', async (options) => {
    const f = fixture(options);
    const response = await f.run();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });
});

describe('disabled live copilot endpoint', () => {
  function disabled(revoked = false) {
    let handler!: (request: Request) => Promise<Response>;
    class AuthError extends Error {}
    const authenticate = vi.fn(async () => { if (revoked) throw new AuthError(); return { userId }; });
    const compiled = ts.transpileModule(readFileSync(new URL('../../supabase/functions/live-copilot/index.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', 'Deno', compiled)((id: string) => {
      if (id.includes('/http/server.ts')) return { serve: (fn: typeof handler) => { handler = fn; } };
      if (id === '../_shared/auth.ts') return { requireUser: authenticate, AuthError, authResponse: () => new Response(null, { status: 401 }) };
      throw new Error(`Unexpected live-copilot dependency: ${id}`);
    }, {}, { env: { get: () => undefined } });
    return { authenticate, run: (method: string) => handler(new Request('https://edge.synthetic.invalid', { method })) };
  }
  it('rejects an authenticated direct request without a database or provider dependency', async () => {
    const f = disabled();
    const response = await f.run('POST');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/desativado/) });
    expect(f.authenticate).toHaveBeenCalledOnce();
  });
  it('keeps preflight free of authentication and rejects other methods', async () => {
    const f = disabled();
    expect((await f.run('OPTIONS')).status).toBe(200);
    expect((await f.run('GET')).status).toBe(405);
    expect(f.authenticate).not.toHaveBeenCalled();
  });
  it('preserves authentication rejection', async () => {
    expect((await disabled(true).run('POST')).status).toBe(401);
  });
});
