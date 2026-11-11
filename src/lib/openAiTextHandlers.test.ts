// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as modelInput from '../../supabase/functions/_shared/modelInput';
import * as gemini from '../../supabase/functions/_shared/gemini';
import * as storage from '../../supabase/functions/_shared/storage';
import * as dates from '../../supabase/functions/_shared/clinicDate';

const userId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const fileId = '33333333-3333-4333-8333-333333333333';
const insights = { summary: 'Synthetic insight', symptoms: [], behavioral_observations: [], risk_factors: [], family_history: [], social_factors: [], clinical_changes: [] };

function handler(name: string, output: unknown, options: { foreignFile?: boolean; concurrent?: boolean; provider?: string; key?: string; failed?: boolean } = {}) {
  let run!: (req: Request) => Promise<Response>;
  const filters: Array<[string, unknown]> = [];
  const writes: unknown[] = [];
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const download = vi.fn(async () => ({ data: new Blob(['synthetic-pdf'], { type: 'application/pdf' }), error: null }));
  const generate = vi.fn(async () => {
    if (options.failed) throw new http.RequestError('IA indisponível.', 503);
    return { text: typeof output === 'string' ? output : JSON.stringify(output), usage: undefined, metadata: { provider: 'openai' } };
  });
  const reserve = vi.fn(async () => ({ reservationId: 'synthetic-reservation' }));
  const settle = vi.fn(async () => {});
  const legacyGenerate = vi.fn(async () => { throw new Error('Unexpected legacy inference'); });
  const db = {
    rpc,
    storage: { from: () => ({ download }) },
    from(table: string) {
      let patch: unknown;
      const row = table === 'patient_files'
        ? { id: fileId, patient_id: patientId, user_id: options.foreignFile ? 'other' : userId, storage_path: `patients/${userId}/${patientId}/synthetic.pdf`, file_name: 'synthetic.pdf', mime_type: 'application/pdf', size_bytes: 13, ai_review_status: 'pending' }
        : { id: patientId, user_id: userId, name: 'Synthetic patient', clinical_notes: 'Original note', revision: 4, allergies: [], medications: [], diagnoses: [] };
      const local: Array<[string, unknown]> = [];
      const execute = () => {
        const owned = local.every(([key, value]) => row[key as keyof typeof row] === value);
        if (patch && owned && !options.concurrent) writes.push(patch);
        return { data: owned && !(patch && options.concurrent) ? row : null, error: null };
      };
      const query = {
        select: () => query,
        update: (value: unknown) => { patch = value; return query; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); local.push([key, value]); return query; },
        is: () => query,
        gte: () => query,
        lt: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => execute(),
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
  const modules: Record<string, unknown> = {
    '../_shared/http.ts': http,
    '../_shared/modelInput.ts': modelInput,
    '../_shared/gemini.ts': { ...gemini, callGemini: legacyGenerate, uploadToGeminiFiles: legacyGenerate },
    '../_shared/clinicalAi.ts': { callClinicalText: generate, assertOpenAiEnabled: () => { if (options.provider && options.provider !== 'openai') throw new http.RequestError('IA indisponível.', 503); } },
    '../_shared/storage.ts': storage,
    '../_shared/clinicDate.ts': dates,
    '../_shared/auth.ts': { requireUser: async () => ({ userId }), AuthError: class extends Error {}, authResponse: () => new Response(null, { status: 401 }) },
    '../_shared/quota.ts': { checkQuota: reserve, recordUsage: settle, creditsFromUsage: () => 0, QuotaExceededError: class extends Error {}, quotaResponse: () => new Response(null, { status: 429 }) },
  };
  const compiled = ts.transpileModule(readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof run) => { run = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id in modules) return modules[id];
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(require, {}, { env: { get: (key: string) => key === 'OPENAI_API_KEY' ? options.key ?? 'synthetic-openai' : key === 'AI_PROVIDER' ? options.provider ?? 'openai' : key === 'GEMINI_API_KEY' ? 'synthetic-legacy' : 'synthetic' } });
  return { generate, legacyGenerate, reserve, settle, rpc, download, filters, writes, run: (body: unknown) => run(new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify(body) })) };
}

describe('OpenAI text handler integration', () => {
  it.each([
    ['create-template-ai', { mode: 'from_structure', specialty: 'geral' }],
    ['suggest-questions', { chiefComplaint: 'Synthetic complaint' }],
    ['process-clinical-notes', { patientId, notes: 'Synthetic new note' }],
    ['generate-document', { type: 'patient_summary', soapNote: 'Synthetic note' }],
    ['analyze-document', { fileId }],
  ])('does not reserve quota or infer in %s until the provider is activated', async (name, body) => {
    const test = handler(name as string, {}, { provider: 'not-enabled' });
    expect((await test.run(body)).status).toBe(503);
    expect(test.reserve).not.toHaveBeenCalled();
    expect(test.generate).not.toHaveBeenCalled();
    expect(test.legacyGenerate).not.toHaveBeenCalled();
  });

  it('generates empty templates using the OpenAI key and keeps the review marker', async () => {
    const test = handler('create-template-ai', { name: 'Synthetic template', description: 'Empty structure', content: '# Empty' });
    const result = await test.run({ mode: 'from_structure', specialty: 'geral' });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ requiresReview: true });
    expect(test.generate).toHaveBeenCalledWith('synthetic-openai', [expect.objectContaining({ text: expect.stringContaining('estrutura vazia') })], expect.objectContaining({ responseSchema: expect.any(Object) }));
    expect(test.legacyGenerate).not.toHaveBeenCalled();
  });

  it('keeps deterministic empty suggestions free of inference', async () => {
    const test = handler('suggest-questions', { questions: ['Synthetic?'] });
    expect(await (await test.run({})).json()).toEqual({ questions: [] });
    expect(test.generate).not.toHaveBeenCalled();
    expect(test.reserve).not.toHaveBeenCalled();
  });

  it('uses OpenAI for notes while preserving owner and revision checks', async () => {
    const test = handler('process-clinical-notes', insights);
    expect((await test.run({ patientId, notes: 'Synthetic new note' })).status).toBe(200);
    expect(test.filters).toContainEqual(['user_id', userId]);
    expect(test.filters).toContainEqual(['revision', 4]);
    expect(test.generate).toHaveBeenCalledTimes(1);
    expect(test.writes).toEqual([expect.objectContaining({ clinical_notes: expect.stringContaining('Original note'), ai_insights: insights })]);
    expect(test.legacyGenerate).not.toHaveBeenCalled();
  });

  it('does not overwrite notes changed during generation', async () => {
    const test = handler('process-clinical-notes', insights, { concurrent: true });
    expect((await test.run({ patientId, notes: 'Synthetic new note' })).status).toBe(409);
    expect(test.writes).toEqual([]);
  });

  it('saves the physician comment verbatim when OpenAI is not activated', async () => {
    const test = handler('process-comment', {}, { provider: 'not-enabled' });
    const result = await test.run({ patientId, comment: 'Synthetic doctor note', mode: 'extract' });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ applied: true });
    expect(test.rpc).toHaveBeenCalledWith('apply_clinical_comment', expect.objectContaining({ p_user_id: userId, p_patient_id: patientId, p_expected_revision: 4, p_patient_patch: expect.objectContaining({ clinical_notes: expect.stringContaining('Synthetic doctor note') }) }));
    expect(test.generate).not.toHaveBeenCalled();
    expect(test.reserve).not.toHaveBeenCalled();
  });

  it('returns OpenAI comment extraction for review without applying it', async () => {
    const extraction = { allergies_add: ['Synthetic allergy'], medications_add: [], medications_remove: [], diagnoses_add: [], consultation_addendum: '', long_term_note: '', summary: 'Synthetic proposal' };
    const test = handler('process-comment', extraction);
    const result = await test.run({ patientId, comment: 'Synthetic comment', mode: 'extract' });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ proposal: { allergies: ['Synthetic allergy'] } });
    expect(test.generate).toHaveBeenCalledTimes(1);
    expect(test.rpc).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
    expect(test.legacyGenerate).not.toHaveBeenCalled();
  });

  it('sends owned PDF bytes inline and persists only the pending proposal', async () => {
    const test = handler('analyze-document', { document_type: 'Synthetic exam', summary: 'Synthetic summary', key_findings: [], profile_note: '' });
    const result = await test.run({ fileId });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ reviewStatus: 'pending', sourceFileId: fileId });
    expect(test.generate).toHaveBeenCalledWith('synthetic-openai', [expect.objectContaining({ document: { data: expect.any(Uint8Array), mimeType: 'application/pdf' } }), expect.any(Object)], expect.objectContaining({ responseSchema: expect.any(Object) }));
    expect(test.rpc).toHaveBeenCalledWith('save_document_review', expect.objectContaining({ p_user_id: userId, p_file_id: fileId }));
    expect(test.legacyGenerate).not.toHaveBeenCalled();
  });

  it('rejects a foreign PDF before downloading, charging or generating', async () => {
    const test = handler('analyze-document', {}, { foreignFile: true });
    expect((await test.run({ fileId })).status).toBe(404);
    expect(test.download).not.toHaveBeenCalled();
    expect(test.reserve).not.toHaveBeenCalled();
    expect(test.generate).not.toHaveBeenCalled();
  });

  it('does not persist a document proposal when generation is unavailable', async () => {
    const test = handler('analyze-document', {}, { failed: true });
    expect((await test.run({ fileId })).status).toBe(503);
    expect(test.rpc).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });
});
