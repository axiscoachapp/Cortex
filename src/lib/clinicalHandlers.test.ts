// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as gemini from '../../supabase/functions/_shared/gemini';
import * as http from '../../supabase/functions/_shared/http';
import * as storage from '../../supabase/functions/_shared/storage';
import * as dates from '../../supabase/functions/_shared/clinicDate';
import * as layout from '../../supabase/functions/_shared/documentLayout';

type Row = Record<string, unknown>;
const user = '11111111-1111-4111-8111-111111111111';
const patient = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';
const audio = `consultations/${user}/${draftId}.webm`;

function database(seed: Record<string, Row[]>) {
  const tables = structuredClone(seed);
  const writes: Row[] = [];
  const remove = vi.fn(async () => ({ error: null as unknown }));
  const upload = vi.fn(async () => ({ error: null as unknown }));
  const download = vi.fn(async () => ({ data: new Blob(['voice']), error: null }));
  const db = {
    tables, writes, remove, upload, download,
    storage: { from: () => ({ download, remove, upload,
      createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/document' }, error: null }) }) },
    rpc: vi.fn(async () => ({ data: true as unknown, error: null as unknown })),
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let action = 'select', value: Row | Row[] = {}, head = false;
      const execute = () => {
        if (action === 'insert') {
          const values = Array.isArray(value) ? value : [value];
          (tables[table] ??= []).push(...values); writes.push(...values);
          return { data: values[0], count: values.length, error: null };
        }
        const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
        if (action === 'update') rows.forEach(row => { Object.assign(row, value); writes.push(row); });
        if (action === 'delete') tables[table] = (tables[table] ?? []).filter(row => !rows.includes(row));
        return { data: head ? null : rows[0] ?? null, count: rows.length, error: null };
      };
      const query = {
        select: (_fields?: string, options?: { head?: boolean }) => { head = options?.head ?? false; return query; },
        eq: (key: string, expected: unknown) => { filters.push(row => row[key] === expected); return query; },
        gte: () => query, lt: () => query, in: () => query, order: () => query, limit: () => query,
        insert: (rows: Row | Row[]) => { action = 'insert'; value = rows; return query; },
        update: (row: Row) => { action = 'update'; value = row; return query; },
        delete: () => { action = 'delete'; return query; },
        maybeSingle: async () => execute(), single: async () => execute(),
        then: (resolve: (result: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
  return db;
}

function handler(name: string, db: ReturnType<typeof database>, generation = vi.fn(), network = vi.fn()) {
  let run!: (request: Request) => Promise<Response>;
  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, unknown> = {
    '../_shared/documentLayout.ts': layout,
    '../_shared/gemini.ts': { ...gemini, callGemini: generation, uploadToGeminiFiles: async () => 'https://provider.invalid/file' },
    '../_shared/storage.ts': storage, '../_shared/clinicDate.ts': dates,
    '../_shared/http.ts': { ...http, fetchWithDeadline: network },
    '../_shared/specialty_prompts.ts': { getSpecialtyPrompt: () => 'clinical', buildCustomTemplatePrompt: () => 'clinical' },
    '../_shared/quota.ts': { checkQuota: async () => ({ reservationId: 'reservation' }), recordUsage: async () => {}, creditsFromUsage: () => 1, QuotaExceededError: class extends Error {} },
    '../_shared/auth.ts': { requireUser: async () => ({ userId: user }), AuthError: class extends Error {} },
  };
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof run) => { run = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id.includes('pdf-lib@')) {
      const page = { getSize: () => ({ width: 595.28, height: 841.89 }), drawText: () => {}, drawLine: () => {} };
      const document = { addPage: () => page, getPages: () => [page], embedFont: async () => ({ widthOfTextAtSize: (text: string) => text.length * 5 }), save: async () => new Uint8Array([1,2,3]) };
      return { PDFDocument: { create: async () => document }, StandardFonts: { Helvetica: 'regular', HelveticaBold: 'bold' }, rgb: (...values: number[]) => values };
    }
    if (id.includes('qrcode@')) return { toDataURL: async () => { throw new Error('Text-only QR fallback in storage boundary test'); } };
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(require, {}, { env: { get: () => 'synthetic' } });
  return (body: Row) => run(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify(body) }));
}

describe('clinical edge handler regressions', () => {
  it('rejects an audio path that is not the exact source registered for the draft', async () => {
    const db = database({ patients: [{ id: patient, user_id: user }], consultation_drafts: [{ id: draftId, patient_id: patient, user_id: user, audio_storage_path: audio }] });
    const generation = vi.fn();
    const result = await handler('transcribe-consultation', db, generation)({ patientId: patient, draftId, audioStoragePath: `consultations/${user}/another.webm` });
    expect(result.status).toBe(403); expect(db.download).not.toHaveBeenCalled(); expect(generation).not.toHaveBeenCalled();
  });
  it('attests a new prescription only after its PDF upload succeeds', async () => {
    const db = database({ patients: [{ id: patient, user_id: user, name: 'Synthetic', age: 30, medications: [] }],
      user_settings: [{ user_id: user, doctor_name: 'Synthetic Doctor', crm_number: '123', crm_uf: 'SP', professional_address: 'Synthetic address' }] });
    db.upload.mockImplementation(async () => {
      expect(db.tables.prescriptions[0].status).toBe('revoked');
      expect(db.tables.prescriptions[0].issuance_verified_at).toBeUndefined();
      return { error: null };
    });
    const response = await handler('generate-prescription', db)({ patientId: patient, docType: 'receita_simples', medications: [{ name: 'Synthetic', dosage: '1 mg', instructions: 'Synthetic instruction' }] });
    expect(response.status).toBe(200);
    expect(db.tables.prescriptions[0]).toMatchObject({ status: 'generated', issuance_verified_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
  });
  for (const failedCleanup of [false, true]) it(`registers RX metadata before upload and ${failedCleanup ? 'retains it when object cleanup fails' : 'removes it after an upload failure'}`, async () => {
    const db = database({ patients: [{ id: patient, user_id: user, name: 'Synthetic', age: 30, medications: [] }],
      user_settings: [{ user_id: user, doctor_name: 'Synthetic Doctor', crm_number: '123', crm_uf: 'SP', professional_address: 'Synthetic address' }] });
    db.upload.mockImplementation(async () => {
      expect(db.tables.prescriptions).toHaveLength(1);
      expect(db.tables.prescriptions[0].status).toBe('revoked');
      return { error: { message: 'offline' } };
    });
    if (failedCleanup) db.remove.mockResolvedValue({ error: { message: 'offline cleanup' } });
    const response = await handler('generate-prescription', db)({ patientId: patient, docType: 'receita_simples', medications: [{ name: 'Synthetic', dosage: '1 mg', instructions: 'Synthetic instruction' }] });
    expect(response.status).toBe(500);
    expect(db.tables.prescriptions).toHaveLength(failedCleanup ? 1 : 0);
    if (failedCleanup) expect(db.tables.prescriptions[0].status).toBe('revoked');
  });
  it('preserves source audio when the provider fails after upload', async () => {
    const db = database({ patients: [{ id: patient, user_id: user }], consultation_drafts: [{ id: draftId, patient_id: patient, user_id: user, audio_storage_path: audio }] });
    const generate = vi.fn(async () => { throw new Error('Synthetic provider failure'); });
    const result = await handler('transcribe-consultation', db, generate)({ patientId: patient, draftId, audioStoragePath: audio });
    expect(result.status).toBe(500);
    expect(db.remove).not.toHaveBeenCalled();
    expect(db.tables.consultation_drafts).toHaveLength(1);
    expect(db.tables.consultations).toBeUndefined();
  });

  it('returns a regenerated preview without inserting a consultation or deleting audio', async () => {
    const db = database({ patients: [{ id: patient, user_id: user }], consultation_drafts: [{ id: draftId, patient_id: patient, user_id: user, audio_storage_path: audio }] });
    const generate = vi.fn(async () => ({ text: '{"soap_note":"Revisar este texto","whatsapp_message":""}' }));
    const result = await handler('finalize-consultation', db, generate)({ patientId: patient, draftId, transcription: 'Consulta', doctorComments: 'Correção do médico' });
    expect(await result.json()).toMatchObject({ previewOnly: true, soapNote: 'Revisar este texto' });
    expect(db.tables.consultations).toBeUndefined(); expect(db.remove).not.toHaveBeenCalled();
  });

  it('does not insert the same reviewed consultation twice after a network retry', async () => {
    const db = database({ patients: [{ id: patient, user_id: user }], consultation_drafts: [{ id: draftId, patient_id: patient, user_id: user, audio_storage_path: audio }] });
    const generate = vi.fn(async () => { throw new Error('Skip optional extraction'); });
    const invoke = handler('finalize-consultation', db, generate);
    const body = { patientId: patient, draftId, transcription: 'Consulta', saveDirect: true, reviewed: true, soapNote: 'Texto aprovado', whatsappMessage: '' };
    expect((await invoke(body)).status).toBe(200);
    expect((await invoke(body)).status).toBe(200);
    expect(db.tables.consultations).toHaveLength(1);
    expect(db.tables.consultations[0].id).toBe(draftId);
    expect(db.tables.consultation_drafts).toHaveLength(0);
  });

  it('reports a concurrent comment conflict without overwriting the patient or SOAP', async () => {
    const original = { id: patient, user_id: user, revision: 3, name: 'Paciente', medications: [], diagnoses: [], allergies: [], clinical_notes: 'Original' };
    const db = database({ patients: [original], consultations: [{ id: 'visit', patient_id: patient, user_id: user, revision: 7, soap_note: 'Original SOAP' }] });
    db.rpc.mockResolvedValue({ data: null, error: { code: '40001' } });
    const network = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ allergies_add: ['Penicilina'], medications_add: [], medications_remove: [], diagnoses_add: [], consultation_addendum: 'Adendo', long_term_note: '', summary: 'Atualizar' }) }] } }] }) }));
    const result = await handler('process-comment', db, vi.fn(), network)({ patientId: patient, comment: 'alergia' });
    expect(result.status).toBe(409);
    expect(db.tables.patients).toEqual([original]);
    expect(db.tables.consultations[0].soap_note).toBe('Original SOAP');
    expect(db.rpc).toHaveBeenCalledWith('apply_clinical_comment', expect.objectContaining({ p_expected_revision: 3, p_expected_consultation_revision: 7 }));
  });
});
