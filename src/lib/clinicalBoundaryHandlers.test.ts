// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as gemini from '../../supabase/functions/_shared/gemini';
import * as http from '../../supabase/functions/_shared/http';
import * as modelInput from '../../supabase/functions/_shared/modelInput';
import * as clinicDates from '../../supabase/functions/_shared/clinicDate';

type Row = Record<string, unknown>;
const user = '11111111-1111-4111-8111-111111111111';
const patient = '22222222-2222-4222-8222-222222222222';
const patientRow = { id: patient, user_id: user, name: 'Synthetic', age: 30, revision: 0, clinical_notes: '' };
const visit = { id: 'visit', user_id: user, patient_id: patient, revision: 0, created_at: '2026-10-25', soap_note: 'Synthetic SOAP' };
const insights = { summary: 'Synthetic summary', symptoms: [], behavioral_observations: [], risk_factors: [], family_history: [], social_factors: [], clinical_changes: [] };
const briefing = { returnInfo: 'Synthetic return', previousComplaint: '', pending: '', alert: '', details: { lastConsultationDate: '', mainComplaint: '', previousConduct: '', evolution: '' } };

function database(seed: Record<string, Row[]> = {}, failedTable?: string) {
  const tables = structuredClone(seed);
  const reads: string[] = [];
  return { tables, reads, rpc: vi.fn(async (_name: string, _args?: unknown): Promise<{data:unknown;error:unknown}> => ({data:[],error:null})), from(table: string) {
    reads.push(table);
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined;
    const execute = () => {
      const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
      if (patch) rows.forEach(row => {
        Object.assign(row, patch);
        if (table === 'consultations' || table === 'patients') row.revision = Number(row.revision ?? 0) + 1;
      });
      return { data: table === failedTable ? null : structuredClone(rows), error: table === failedTable ? { message: 'Synthetic database failure' } : null };
    };
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query; },
      update: (value: Row) => { patch = value; return query; },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return query;
  } };
}

function loadHandler(name: string, db = database()) {
  const reserve = vi.fn(async () => ({ reservationId: 'reservation' }));
  const settle = vi.fn(async () => {});
  const generate = vi.fn(async (_key?: string, _parts?: unknown, _options?: unknown) => ({ text: '{}', usage: { promptTokenCount: 10 } }));
  const embed = vi.fn(async (): Promise<number[]> => []);
  const network = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 10 } })));
  let handler!: (request: Request) => Promise<Response>;
  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, unknown> = {
    '../_shared/gemini.ts': { ...gemini, callGemini: generate, embedText: embed },
    '../_shared/http.ts': { ...http, fetchWithDeadline: network },
    '../_shared/modelInput.ts': modelInput,
    '../_shared/clinicDate.ts': clinicDates,
    '../_shared/auth.ts': { requireUser: async () => ({ userId: user }), AuthError: class extends Error {} },
    '../_shared/quota.ts': { checkQuota: reserve, recordUsage: settle, creditsFromUsage: () => 1, QuotaExceededError: class extends Error {} },
  };
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof handler) => { handler = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(require, {}, { env: { get: () => 'synthetic' } });
  return { reserve, settle, generate, embed, network, run: (body: Row) => handler(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify(body) })) };
}

describe('clinical request boundaries before quota reservation', () => {
  for (const name of ['chat-assistant', 'generate-prebriefing', 'process-clinical-notes']) {
    it(`${name} reports a failed patient read without reserving or inventing an empty history`, async () => {
      const handler = loadHandler(name, database({ consultations: [visit] }, 'patients'));
      const response = await handler.run({ patientId: patient, userMessage: 'Synthetic question', notes: 'Synthetic note' });
      expect(response.status).toBe(503);
      expect(handler.reserve).not.toHaveBeenCalled();
      expect(handler.generate).not.toHaveBeenCalled();
      expect(handler.network).not.toHaveBeenCalled();
    });
  }
  for (const name of ['chat-assistant', 'generate-prebriefing']) {
    it(`${name} rejects a failed history read instead of asserting no previous consultation`, async () => {
      const handler = loadHandler(name, database({ patients: [patientRow] }, 'consultations'));
      const response = await handler.run({ patientId: patient, userMessage: 'Synthetic question' });
      expect(response.status).toBe(503);
      expect(handler.reserve).not.toHaveBeenCalled();
    });
  }
  it('does not reserve credits for a missing notes patient', async () => {
    const handler = loadHandler('process-clinical-notes');
    expect((await handler.run({ patientId: patient, notes: 'Synthetic note' })).status).toBe(404);
    expect(handler.reserve).not.toHaveBeenCalled();
  });
  for (const name of ['generate-prebriefing', 'process-clinical-notes']) {
    it(`${name} rejects an oversized accumulated clinical prompt before reserving`, async () => {
      const handler = loadHandler(name, database({ patients: [{ ...patientRow, clinical_notes: 'x'.repeat(131072) }], consultations: [visit] }));
      expect((await handler.run({ patientId: patient, notes: 'New note' })).status).toBe(413);
      expect(handler.reserve).not.toHaveBeenCalled();
    });
  }
  for (const name of ['chat-assistant', 'live-copilot', 'suggest-questions', 'generate-document']) {
    it(`${name} bounds the complete prompt before its first paid operation`, async () => {
      const handler = loadHandler(name);
      const context = { name: 'x'.repeat(130900), age: 30, diagnoses: [], medications: [], allergies: [] };
      const request = name === 'chat-assistant' ? { patientContext: context, userMessage: 'Question' }
        : name === 'live-copilot' ? { patientContext: context, audioChunks: [{ data: 'YXVkaW8=', mimeType: 'audio/webm' }] }
        : name === 'suggest-questions' ? { patientContext: context, chiefComplaint: 'Complaint' }
        : { patientContext: context, type: 'referral', soapNote: 'SOAP' };
      const response = await handler.run(request);
      expect(response.status).toBe(413);
      expect(handler.reserve).not.toHaveBeenCalled();
      expect(handler.embed).not.toHaveBeenCalled();
      expect(handler.generate).not.toHaveBeenCalled();
    });
  }
  it('rejects an oversized template source instead of silently truncating and charging it', async () => {
    const handler = loadHandler('create-template-ai');
    expect((await handler.run({ mode: 'from_example', input: 'x'.repeat(12001) })).status).toBe(413);
    expect(handler.reserve).not.toHaveBeenCalled();
  });
  it('rejects patient examples before a provider can convert identifying data into a reusable template', async () => {
    const handler = loadHandler('create-template-ai');
    const response = await handler.run({ mode: 'from_example', input: 'Prontuário sintético de pessoa identificada' });
    expect(response.status).toBe(400);
    expect(handler.reserve).not.toHaveBeenCalled();
    expect(handler.generate).not.toHaveBeenCalled();
  });
  it('rejects a non-text SOAP before reserving', async () => {
    const handler = loadHandler('generate-document');
    expect((await handler.run({ type: 'referral', soapNote: { text: 'SOAP' } })).status).toBe(400);
    expect(handler.reserve).not.toHaveBeenCalled();
  });
});

describe('clinical result failures remain failures', () => {
  for (const name of ['live-copilot', 'suggest-questions']) {
    it(`${name} rejects an incomplete model object instead of blanking a successful result`, async () => {
      const handler = loadHandler(name);
      const response = await handler.run({ chiefComplaint: 'Synthetic complaint', audioChunks: [{ data: 'YXVkaW8=' }], prevState: { resumo: [], alertas: ['Known allergy'], nao_explorado: [], sugestoes: [] } });
      expect(response.status).toBe(500);
      expect(handler.settle).toHaveBeenCalledOnce();
    });
  }
  it('prebriefing rejects invalid model output instead of reporting a first consultation', async () => {
    const handler = loadHandler('generate-prebriefing', database({ patients: [patientRow], consultations: [visit] }));
    expect((await handler.run({ patientId: patient })).status).toBe(500);
    expect(handler.settle).toHaveBeenCalledOnce();
  });
  it('does not convert a model object into printable template text', async () => {
    const handler = loadHandler('create-template-ai');
    handler.generate.mockResolvedValue({ text: '{"name":"Template","description":"","content":{"invalid":true}}', usage: { promptTokenCount: 1 } });
    expect((await handler.run({ mode: 'from_structure', specialty: 'urologia' })).status).toBe(500);
    expect(handler.settle).toHaveBeenCalledOnce();
  });
  it('retains a reservation when a started provider call fails', async () => {
    const handler = loadHandler('live-copilot');
    handler.generate.mockRejectedValue(new Error('Provider interrupted'));
    expect((await handler.run({ audioChunks: [{ data: 'YXVkaW8=' }] })).status).toBe(500);
    expect(handler.reserve).toHaveBeenCalledOnce();
    expect(handler.settle).not.toHaveBeenCalled();
  });
  it('still returns null without charge for an owned patient with no prior consultation', async () => {
    const handler = loadHandler('generate-prebriefing', database({ patients: [patientRow] }));
    const response = await handler.run({ patientId: patient });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(handler.reserve).not.toHaveBeenCalled();
  });
  it('saves complete clinical notes successfully after settling usage', async () => {
    const db = database({ patients: [patientRow] });
    const handler = loadHandler('process-clinical-notes', db);
    handler.network.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(insights) }] } }] })));
    expect((await handler.run({ patientId: patient, notes: 'New note' })).status).toBe(200);
    expect(db.tables.patients[0].clinical_notes).toContain('New note');
    expect(handler.reserve).toHaveBeenCalledOnce();
    expect(handler.settle).toHaveBeenCalledOnce();
  });
  it('returns and caches a complete prebriefing successfully', async () => {
    const db = database({ patients: [patientRow], consultations: [visit] });
    const handler = loadHandler('generate-prebriefing', db);
    handler.network.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(briefing) }] } }] })));
    const response = await handler.run({ patientId: patient });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(briefing);
    expect(db.tables.consultations[0].pre_briefing).toMatchObject(briefing);
  });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const validBriefingResponse = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(briefing) }] } }] }));

describe('prebriefing source fingerprint', () => {
  const source = { patientRevision: 3, consultationRevision: 8, clinicDate: '2026-10-27' };
  const cachedBriefing = { ...briefing, returnInfo: 'Stale cached return', _source: source };
  function setup(now = '2026-10-27T15:00:00Z', patientRevision = 3, consultationRevision = 8) {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    const db = database({ patients: [{ ...patientRow, revision: patientRevision }], consultations: [{ ...visit, revision: consultationRevision, pre_briefing: cachedBriefing }] });
    const handler = loadHandler('generate-prebriefing', db);
    handler.network.mockImplementation(async () => validBriefingResponse());
    return { db, handler };
  }
  it('reuses a complete cache only while all source fields still match', async () => {
    const { handler } = setup();
    const response = await handler.run({ patientId: patient });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ returnInfo: 'Stale cached return' });
    expect(handler.reserve).not.toHaveBeenCalled();
    expect(handler.network).not.toHaveBeenCalled();
  });
  it('keeps a same-clinic-day cache across UTC midnight', async () => {
    const { handler } = setup('2026-10-28T01:00:00Z');
    expect((await handler.run({ patientId: patient })).status).toBe(200);
    expect(handler.network).not.toHaveBeenCalled();
    expect(handler.reserve).not.toHaveBeenCalled();
  });
  it('regenerates an incomplete cached schema even when its source still matches', async () => {
    const { handler, db } = setup();
    db.tables.consultations[0].pre_briefing = { returnInfo: 'Incomplete cache', _source: source };
    const response = await handler.run({ patientId: patient });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(briefing);
    expect(handler.network).toHaveBeenCalledOnce();
  });
  for (const [reason, now, patientRevision, consultationRevision] of [
    ['patient changed', '2026-10-27T15:00:00Z', 4, 8],
    ['consultation changed', '2026-10-27T15:00:00Z', 3, 9],
    ['clinic day changed', '2026-10-28T15:00:00Z', 3, 8],
  ] as const) {
    it(`regenerates when the ${reason}`, async () => {
      const { handler, db } = setup(now, patientRevision, consultationRevision);
      const response = await handler.run({ patientId: patient });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ returnInfo: briefing.returnInfo });
      expect(handler.network).toHaveBeenCalledOnce();
      expect(handler.reserve).toHaveBeenCalledOnce();
      expect(db.tables.consultations[0].pre_briefing).toMatchObject({ _source: {
        patientRevision, consultationRevision: consultationRevision + 1, clinicDate: clinicDates.clinicDate(new Date(now)),
      } });
    });
  }
  it('regenerates an old cache with no source metadata', async () => {
    const { handler, db } = setup();
    db.tables.consultations[0].pre_briefing = { ...briefing, returnInfo: 'Old untracked cache' };
    expect((await handler.run({ patientId: patient })).status).toBe(200);
    expect(handler.network).toHaveBeenCalledOnce();
  });
  it('reuses the generated result after its cache write increments the consultation revision', async () => {
    const { handler, db } = setup();
    db.tables.consultations[0].pre_briefing = null;
    expect((await handler.run({ patientId: patient })).status).toBe(200);
    expect((await handler.run({ patientId: patient })).status).toBe(200);
    expect(handler.network).toHaveBeenCalledOnce();
    expect(handler.reserve).toHaveBeenCalledOnce();
  });
  it('rejects a concurrent consultation change instead of caching or returning an outdated result', async () => {
    const { handler, db } = setup();
    db.tables.consultations[0].pre_briefing = null;
    handler.network.mockImplementation(async () => {
      db.tables.consultations[0].revision = 9;
      return validBriefingResponse();
    });
    expect((await handler.run({ patientId: patient })).status).toBe(409);
    expect(db.tables.consultations[0].pre_briefing).toBeNull();
    expect(handler.settle).toHaveBeenCalledOnce();
  });
});

describe('clinical catch logs exclude provider payloads', () => {
  for (const name of ['create-template-ai', 'live-copilot', 'suggest-questions']) {
    it(`${name} logs a static label`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = loadHandler(name);
      handler.generate.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD'));
      const response = await handler.run({ mode: 'from_structure', specialty: 'urologia', chiefComplaint: 'Complaint', audioChunks: [{ data: 'YXVkaW8=' }] });
      expect(response.status).toBe(500);
      expect(log).toHaveBeenCalledWith(`${name} error:`);
      expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_PAYLOAD');
    });
  }
});

describe('authorized shared protocol citations and delayed revocation',()=>{
  const source={document_id:'66666666-6666-4666-8666-666666666666',content:'SYNTHETIC_SHARED_PROTOCOL_EXCERPT',similarity:0.9,source_title:'Protocolo da clínica',source_reference:'https://example.invalid/publicacao',source_version:'v3',source_author:'Dra Revisora Sintética',source_owner_user_id:'77777777-7777-4777-8777-777777777777',reviewed_at:'2026-10-28T12:00:00Z',authorization_revision:4,source_review_revision:2};
  it('uses RPC-authorized source version and reviewer metadata without an owner-only second lookup',async()=>{
    const db=database();db.rpc.mockImplementation(async name=>({data:name==='match_knowledge'?[source]:true,error:null}));
    const handler=loadHandler('chat-assistant',db);handler.embed.mockResolvedValue([0.1]);handler.generate.mockResolvedValue({text:'Resposta com fonte autorizada',usage:{promptTokenCount:10}});
    const response=await handler.run({userMessage:'Consultar protocolo'});
    expect(response.status).toBe(200);
    expect((await response.json()).sources).toEqual([expect.objectContaining({id:source.document_id,label:source.source_title,sourceVersion:'v3',sourceReference:source.source_reference,reviewedBy:source.source_author,reviewedAt:source.reviewed_at,shared:true})]);
    expect(JSON.stringify(handler.generate.mock.calls[0][1])).toContain('Revisado/compartilhado por: Dra Revisora Sintética');
    expect(db.reads).not.toContain('knowledge_documents');
    expect(db.rpc).toHaveBeenCalledWith('authorize_protocol_sources',{p_actor_user_id:user,p_sources:[{document_id:source.document_id,authorization_revision:4,source_review_revision:2}]});
  });
  it('does not send a revoked source to the model after retrieval',async()=>{
    const db=database();db.rpc.mockImplementation(async name=>({data:name==='match_knowledge'?[source]:false,error:null}));
    const handler=loadHandler('chat-assistant',db);handler.embed.mockResolvedValue([0.1]);
    const response=await handler.run({userMessage:'Consultar protocolo'});
    expect(response.status).toBe(409);expect(handler.generate).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(source.content);
  });
  it('suppresses derived text after a source is revoked during generation while settling used quota',async()=>{
    let active=true;const db=database();db.rpc.mockImplementation(async name=>({data:name==='match_knowledge'?[source]:active,error:null}));
    const handler=loadHandler('chat-assistant',db);handler.embed.mockResolvedValue([0.1]);
    handler.generate.mockImplementation(async()=>{active=false;return{text:'SYNTHETIC_DERIVED_SHARED_TEXT',usage:{promptTokenCount:10}};});
    const response=await handler.run({userMessage:'Consultar protocolo'});
    expect(response.status).toBe(409);expect(handler.settle).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain('SYNTHETIC_DERIVED_SHARED_TEXT');
  });
  it('fails closed on a post-generation authorization outage after settling used quota',async()=>{
    let checks=0;const db=database();db.rpc.mockImplementation(async name=>{
      if(name==='match_knowledge')return{data:[source],error:null};
      if(++checks>1)throw new Error('Synthetic authorization outage');
      return{data:true,error:null};
    });
    const handler=loadHandler('chat-assistant',db);handler.embed.mockResolvedValue([0.1]);handler.generate.mockResolvedValue({text:'SYNTHETIC_PRIVATE_REPLY',usage:{promptTokenCount:10}});
    const response=await handler.run({userMessage:'Consultar protocolo'});
    expect(response.status).toBe(409);expect(handler.settle).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE_REPLY');
  });
});
