// @vitest-environment node
// Review probes reproduce current defects; passing means reproduced, NOT fixed.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import * as gemini from '../../../../supabase/functions/_shared/gemini';
import * as http from '../../../../supabase/functions/_shared/http';
import * as storage from '../../../../supabase/functions/_shared/storage';
import * as dates from '../../../../supabase/functions/_shared/clinicDate';

type Row = Record<string, unknown>;
const user = '11111111-1111-4111-8111-111111111111';
const patient = '22222222-2222-4222-8222-222222222222';
const draft = '33333333-3333-4333-8333-333333333333';

function database(seed: Record<string, Row[]>) {
  const tables = structuredClone(seed);
  return {
    tables,
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let action = 'select', value: Row | Row[] = {}, head = false;
      const execute = () => {
        if (action === 'insert') {
          const values = Array.isArray(value) ? value : [value];
          (tables[table] ??= []).push(...values);
          return { data: values[0], count: values.length, error: null };
        }
        const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
        if (action === 'update') rows.forEach(row => Object.assign(row, value));
        if (action === 'delete') tables[table] = (tables[table] ?? []).filter(row => !rows.includes(row));
        return { data: head ? null : rows[0] ?? null, count: rows.length, error: null };
      };
      const query = {
        select: (_fields?: string, options?: { head?: boolean }) => { head = options?.head ?? false; return query; },
        eq: (key: string, expected: unknown) => { filters.push(row => row[key] === expected); return query; },
        gte: (key: string, expected: string) => { filters.push(row => String(row[key]) >= expected); return query; },
        lt: (key: string, expected: string) => { filters.push(row => String(row[key]) < expected); return query; },
        in: (key: string, expected: unknown[]) => { filters.push(row => expected.includes(row[key])); return query; },
        insert: (rows: Row | Row[]) => { action = 'insert'; value = rows; return query; },
        update: (row: Row) => { action = 'update'; value = row; return query; },
        delete: () => { action = 'delete'; return query; },
        maybeSingle: async () => execute(), single: async () => execute(),
        then: (resolve: (result: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
}

function handler(db: ReturnType<typeof database>, generate: ReturnType<typeof vi.fn>) {
  let run!: (request: Request) => Promise<Response>;
  const source = readFileSync(new URL('../../../../supabase/functions/finalize-consultation/index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, unknown> = {
    '../_shared/gemini.ts': { ...gemini, callGemini: generate },
    '../_shared/http.ts': http, '../_shared/storage.ts': storage, '../_shared/clinicDate.ts': dates,
    '../_shared/specialty_prompts.ts': { getSpecialtyPrompt: () => 'clinical', buildCustomTemplatePrompt: () => 'clinical' },
    '../_shared/quota.ts': { checkQuota: async () => ({ reservationId: 'synthetic' }), recordUsage: async () => {}, creditsFromUsage: () => 1, QuotaExceededError: class extends Error {} },
    '../_shared/auth.ts': { requireUser: async () => ({ userId: user }), AuthError: class extends Error {} },
  };
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof run) => { run = fn; } };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(require, {}, { env: { get: () => 'synthetic-only' } });
  return () => run(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify({
    patientId: patient, draftId: draft, transcription: 'Synthetic source transcript',
    saveDirect: true, reviewed: true, soapNote: 'Physician-reviewed SOAP only', whatsappMessage: '',
  }) }));
}

afterEach(() => vi.useRealTimers());

it('reproduces one completed visit marking every same-day appointment complete', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T15:00:00.000Z'));
  const appt = (id: string, start: string, status = 'agendado') => ({ id, patient_id: patient, user_id: user, start_time: start, status });
  const db = database({
    patients: [{ id: patient, user_id: user, medical_history: 'present', social_anamnesis: 'present' }],
    consultation_drafts: [{ id: draft, patient_id: patient, user_id: user, audio_storage_path: null }],
    appointments: [appt('morning', '2026-10-28T12:00:00.000Z'), appt('later', '2026-10-28T20:00:00.000Z', 'confirmado'),
      appt('tomorrow', '2026-10-29T12:00:00.000Z'), appt('cancelled', '2026-10-28T18:00:00.000Z', 'cancelado')],
  });
  const run = handler(db, vi.fn(async () => { throw new Error('Optional enrichment unavailable'); }));
  expect((await run()).status).toBe(200);
  expect(db.tables.appointments.map(row => [row.id, row.status])).toEqual([
    ['morning', 'realizado'], ['later', 'realizado'], ['tomorrow', 'agendado'], ['cancelled', 'cancelado'],
  ]);
});

it('reproduces newly generated history being persisted after SOAP approval without a second review', async () => {
  const db = database({
    patients: [{ id: patient, user_id: user, revision: 1, medical_history: '', social_anamnesis: '' }],
    consultation_drafts: [{ id: draft, patient_id: patient, user_id: user, audio_storage_path: null }],
  });
  const generate = vi.fn()
    .mockResolvedValueOnce({ text: JSON.stringify({ diagnoses: [], medications: [], allergies: [] }) })
    .mockResolvedValueOnce({ text: JSON.stringify({ medical_history: ['Unreviewed synthetic fact'], social_anamnesis: ['Unreviewed synthetic social fact'] }) });
  const response = await handler(db, generate)();
  expect(response.status).toBe(200);
  expect((await response.json()).historyFilled).toBe(true);
  expect(db.tables.patients[0]).toMatchObject({ medical_history: '- Unreviewed synthetic fact', social_anamnesis: '- Unreviewed synthetic social fact' });
  expect(db.tables.consultations[0].soap_note).toBe('Physician-reviewed SOAP only');
});
