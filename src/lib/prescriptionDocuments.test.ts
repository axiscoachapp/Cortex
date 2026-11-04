// @vitest-environment node
// Prescription document content (generate-prescription): prescriber contact,
// patient identification and the RDC 471/2021 antimicrobial requirements.
// Synthetic people and values only.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as patientAge from '../../supabase/functions/_shared/patientAge';
import * as layout from '../../supabase/functions/_shared/documentLayout';
import * as regulated from '../../supabase/functions/_shared/regulatedMedications';

type Row = Record<string, unknown>;
const user = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.useRealTimers());

/** Minimal in-memory client: enough of supabase-js for generate-prescription. */
function database(seed: Record<string, Row[]>) {
  const tables = structuredClone(seed);
  const upload = vi.fn(async () => ({ error: null as unknown }));
  const signedUrl = vi.fn(async (_path: string, _seconds: number) => ({ data: { signedUrl: 'https://example.invalid/document' }, error: null }));
  const db = {
    tables,
    upload,
    signedUrl,
    drawnText: [] as string[],
    storage: {
      from: () => ({
        upload,
        remove: async () => ({ error: null }),
        createSignedUrl: signedUrl,
      }),
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let action = 'select';
      let value: Row = {};
      const execute = () => {
        if (action === 'insert') {
          (tables[table] ??= []).push(value);
          return { data: value, error: null };
        }
        const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (action === 'update') rows.forEach((row) => Object.assign(row, value));
        if (action === 'delete') tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
        return { data: rows[0] ?? null, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, expected: unknown) => {
          filters.push((row) => row[key] === expected);
          return query;
        },
        insert: (row: Row) => {
          action = 'insert';
          value = row;
          return query;
        },
        update: (row: Row) => {
          action = 'update';
          value = row;
          return query;
        },
        delete: () => {
          action = 'delete';
          return query;
        },
        maybeSingle: async () => execute(),
        then: (resolve: (result: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
  return db;
}

function generate(db: ReturnType<typeof database>) {
  let run!: (request: Request) => Promise<Response>;
  const source = readFileSync(new URL('../../supabase/functions/generate-prescription/index.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    '../_shared/regulatedMedications.ts': regulated,
    '../_shared/documentLayout.ts': layout,
    '../_shared/patientAge.ts': patientAge,
    '../_shared/http.ts': http,
    '../_shared/auth.ts': {
      requireUser: async () => ({ userId: user }),
      AuthError: class extends Error {},
      authResponse: () => new Response(null, { status: 401 }),
    },
  };
  const page = () => ({
    getSize: () => ({ width: 595.28, height: 841.89 }),
    drawText: (text: string) => {
      db.drawnText.push(text);
    },
    drawLine: () => {},
    drawImage: () => {},
  });
  const document = () => {
    const pages: Array<ReturnType<typeof page>> = [];
    return {
      // addPage([width, height]) creates a page; addPage(copy) appends a copied one.
      addPage: (existing?: unknown) => {
        const added = existing && !Array.isArray(existing) ? (existing as ReturnType<typeof page>) : page();
        pages.push(added);
        return added;
      },
      getPages: () => pages.slice(),
      embedFont: async () => ({ widthOfTextAtSize: (text: string) => text.length * 5 }),
      embedPng: async () => ({}),
      copyPages: async (_source: unknown, indexes: number[]) => indexes.map(() => page()),
      save: async () => new Uint8Array([1, 2, 3]),
    };
  };
  const require = (id: string) => {
    if (id.includes('/http/server.ts')) return { serve: (fn: typeof run) => (run = fn) };
    if (id.includes('@supabase/supabase-js')) return { createClient: () => db };
    if (id.includes('pdf-lib@'))
      return {
        PDFDocument: { create: async () => document(), load: async () => document() },
        StandardFonts: { Helvetica: 'regular', HelveticaBold: 'bold' },
        rgb: (...values: number[]) => values,
      };
    if (id.includes('qrcode@'))
      return {
        toDataURL: async () => {
          throw new Error('text-only validation block');
        },
      };
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'exports', 'Deno', compiled)(require, {}, { env: { get: () => 'synthetic' } });
  return (body: Row) => run(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify(body) }));
}

const prescriber = (extra: Row = {}) => ({
  user_id: user,
  doctor_name: 'Médica sintética',
  crm_number: '123',
  crm_uf: 'PR',
  professional_address: 'Endereço sintético',
  ...extra,
});
const person = (extra: Row = {}) => ({
  id: patientId,
  user_id: user,
  name: 'Pessoa sintética',
  age: null,
  date_of_birth: '1990-05-10',
  medications: [],
  ...extra,
});
const simple = { name: 'Medicamento sintético', dosage: 'dose de teste', instructions: 'instrução de teste' };
const antimicrobial = { name: 'Amoxicilina 500 mg', dosage: '1 cápsula', instructions: 'de 8 em 8 horas por 7 dias' };

describe('prescription document content', () => {
  it('prints prescriber phone and RQE, and the patient CPF, and keeps them in the snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const db = database({
      user_settings: [prescriber({ professional_phone: '(41) 3000-0000', rqe: 'RQE 4567' })],
      patients: [person({ cpf: '52998224725', sex: 'feminino' })],
    });
    const response = await generate(db)({ patientId, docType: 'receita_simples', medications: [simple] });
    expect(response.status).toBe(200);
    expect(db.drawnText).toContain('CRM 123/PR · RQE 4567');
    expect(db.drawnText).toContain('Endereço sintético · Tel. (41) 3000-0000');
    expect(db.drawnText).toContain('CPF: 529.982.247-25');
    // Sex is printed only where the law asks for it (antimicrobial).
    expect(db.drawnText).toContain('Paciente: Pessoa sintética, 36 anos');
    expect(db.tables.prescriptions[0].issuance_snapshot).toMatchObject({
      prescriber: { professional_phone: '(41) 3000-0000', rqe: 'RQE 4567' },
      patient: { cpf: '52998224725', sex: 'feminino', age: 36 },
      template_version: 'cortex-clinical-document-v2',
    });
    // The preview link is a bearer URL: it must expire quickly (5 min).
    expect(db.signedUrl).toHaveBeenCalledWith(expect.stringMatching(/^rx\//), 300);
  });

  it('omits the optional lines when there is no phone, RQE or valid CPF', async () => {
    const db = database({
      user_settings: [prescriber()],
      patients: [person({ cpf: '529.982.247-2X' })],
    });
    const response = await generate(db)({ patientId, docType: 'receita_simples', medications: [simple] });
    expect(response.status).toBe(200);
    expect(db.drawnText).toContain('CRM 123/PR');
    expect(db.drawnText).toContain('Endereço sintético');
    expect(db.drawnText.some((text) => /RQE|Tel\.|CPF:/.test(text))).toBe(false);
    expect(db.tables.prescriptions[0].issuance_snapshot).toMatchObject({
      prescriber: { professional_phone: null, rqe: null },
      patient: { cpf: null },
    });
  });

  it('refuses an antimicrobial prescription without the prescriber phone (RDC 471/2021)', async () => {
    const db = database({ user_settings: [prescriber()], patients: [person({ sex: 'feminino' })] });
    const response = await generate(db)({ patientId, docType: 'receita_antimicrobiano', medications: [antimicrobial] });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/telefone profissional/);
    expect(db.tables.prescriptions).toBeUndefined();
    expect(db.upload).not.toHaveBeenCalled();
  });

  it('names every missing patient field for an antimicrobial prescription', async () => {
    const db = database({
      user_settings: [prescriber({ professional_phone: '(41) 3000-0000' })],
      patients: [person({ date_of_birth: null, age: null, sex: 'nao_informado' })],
    });
    const response = await generate(db)({ patientId, docType: 'receita_antimicrobiano', medications: [antimicrobial] });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe(
      'Para a receita de antimicrobiano, complete no cadastro do paciente: idade ou data de nascimento e sexo.',
    );
    expect(db.tables.prescriptions).toBeUndefined();
  });

  it('issues a complete antimicrobial prescription with age, sex and both copies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const db = database({
      user_settings: [prescriber({ professional_phone: '(41) 3000-0000' })],
      patients: [person({ sex: 'masculino' })],
    });
    const response = await generate(db)({ patientId, docType: 'receita_antimicrobiano', medications: [antimicrobial] });
    expect(response.status).toBe(200);
    expect(db.drawnText).toContain('Paciente: Pessoa sintética, 36 anos, sexo masculino');
    expect(db.drawnText).toContain('1ª via — paciente');
    expect(db.drawnText).toContain('2ª via — retenção da farmácia');
    expect(db.tables.prescriptions[0]).toMatchObject({ doc_type: 'receita_antimicrobiano', status: 'generated' });
  });
});
