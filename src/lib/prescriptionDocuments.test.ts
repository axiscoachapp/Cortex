// @vitest-environment node
// Prescription document content (generate-prescription): prescriber contact,
// patient identification and the RDC 471/2021 antimicrobial requirements.
// Synthetic people and values only.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as patientAge from '../../supabase/functions/_shared/patientAge';
import * as dates from '../../supabase/functions/_shared/clinicDate';
import * as layout from '../../supabase/functions/_shared/documentLayout';
import * as regulated from '../../supabase/functions/_shared/regulatedMedications';

type Row = Record<string, unknown>;
const user = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.useRealTimers());

/** Minimal in-memory client: enough of supabase-js for generate-prescription. */
function database(seed: Record<string, Row[]>, options: { insertError?: { code: string; message: string } } = {}) {
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
      // maybeSingle() resolves one row; awaiting the query itself resolves the list.
      const execute = (single = true) => {
        if (action === 'insert') {
          if (options.insertError) return { data: null, error: options.insertError };
          (tables[table] ??= []).push(value);
          return { data: value, error: null };
        }
        const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (action === 'update') rows.forEach((row) => Object.assign(row, value));
        if (action === 'delete') tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
        return { data: (single ? (rows[0] ?? null) : rows) as Row | Row[] | null, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, expected: unknown) => {
          filters.push((row) => row[key] === expected);
          return query;
        },
        in: (key: string, expected: unknown[]) => {
          filters.push((row) => expected.includes(row[key]));
          return query;
        },
        limit: () => query,
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
        then: (resolve: (result: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute(action !== 'select')).then(resolve),
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
    '../_shared/clinicDate.ts': dates,
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
      template_version: 'cortex-clinical-document-v3',
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

describe('regulated drugs by brand, generic name and validity (review findings)', () => {
  const ready = () => ({ user_settings: [prescriber({ professional_phone: '(41) 3000-0000' })], patients: [person({ sex: 'feminino' })] });

  it('refuses a controlled drug known only by a catalog brand on a simple prescription', async () => {
    const db = database({ ...ready(), medication_catalog: [{ product_name: 'MARCA SINTETICA', active_ingredient: 'CLONAZEPAM', is_antimicrobial: false }] });
    const response = await generate(db)({ patientId, docType: 'receita_simples', medications: [{ name: 'Marca Sintetica 2 mg', dosage: '1 comprimido', instructions: 'à noite' }] });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/controle especial.*clonazepam/);
    expect(db.tables.prescriptions).toBeUndefined();
  });

  it('refuses an antimicrobial flagged only in the catalog on a simple prescription', async () => {
    const db = database({ ...ready(), medication_catalog: [{ product_name: 'OUTRA MARCA', active_ingredient: 'SUBSTANCIA SINTETICA', is_antimicrobial: true }] });
    const response = await generate(db)({ patientId, docType: 'receita_simples', medications: [{ name: 'Outra Marca', dosage: '1 envelope', instructions: 'dose única' }] });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain('Antimicrobiano (substancia sintetica)');
  });

  it('still catches a frequent brand without the catalog', async () => {
    const db = database(ready());
    const response = await generate(db)({ patientId, docType: 'receita_simples', medications: [{ name: 'Rivotril 2mg', dosage: '1 comprimido', instructions: 'à noite' }] });
    expect(response.status).toBe(422);
  });

  it('prints the generic name next to a brand on an antimicrobial prescription', async () => {
    const db = database({ ...ready(), medication_catalog: [{ product_name: 'OUTRA MARCA', active_ingredient: 'FOSFOMICINA TROMETAMOL', is_antimicrobial: true }] });
    const response = await generate(db)({
      patientId,
      docType: 'receita_antimicrobiano',
      medications: [
        { name: 'Outra Marca 3 g', dosage: '1 envelope', instructions: 'dose única' },
        { name: 'Nitrofurantoína 100 mg', dosage: '1 cápsula', instructions: '6/6 h' },
      ],
    });
    expect(response.status).toBe(200);
    expect(db.drawnText).toContain('1. Outra Marca 3 g (fosfomicina trometamol) — 1 envelope');
    expect(db.drawnText).toContain('2. Nitrofurantoína 100 mg — 1 cápsula');
  });

  it('keeps a prescription valid through the whole printed day in the clinic zone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T18:00:00Z')); // 15:00 in São Paulo
    const db = database(ready());
    const response = await generate(db)({ patientId, docType: 'receita_antimicrobiano', medications: [{ name: 'Amoxicilina 500 mg', dosage: '1 cápsula', instructions: '8/8 h' }] });
    expect(response.status).toBe(200);
    expect(db.tables.prescriptions[0].expires_at).toBe('2026-11-15T02:59:59.999Z');
    expect(db.drawnText.some((t) => t.includes('Válida até 14/11/2026'))).toBe(true);
  });

  it('says another operation was in progress when the insert loses the custody barrier', async () => {
    const db = database(ready(), { insertError: { code: '40001', message: 'Custody changed concurrently; retry the transaction' } });
    const response = await generate(db)({ patientId, docType: 'receita_simples', medications: [simple] });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Outra operação estava em andamento/);
    expect(db.upload).not.toHaveBeenCalled();
  });
});

describe('Receita de Controle Especial (D8)', () => {
  const settings = (extra: Row = {}) => prescriber({ professional_phone: '(41) 3000-0000', ...extra });
  const rce = { name: 'Sertralina 50 mg', concentration: '50 mg', dosage: '1 comprimido', instructions: '1 vez ao dia, pela manhã', quantity: 30, unit: 'comprimidos' };
  const address = { patientAddress: 'Rua Sintética, 100 — Centro — Curitiba/PR' };

  it('prints the legal heading, address, CPF, quantity in words, buyer blocks and both labelled copies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T18:00:00Z'));
    const db = database({ user_settings: [settings()], patients: [person({ cpf: '52998224725', sex: 'feminino' })] });
    const response = await generate(db)({ patientId, docType: 'receita_controle_especial', medications: [rce], content: address });
    expect(response.status).toBe(200);
    for (const line of [
      'RECEITA DE CONTROLE ESPECIAL',
      'Endereço: Rua Sintética, 100 — Centro — Curitiba/PR',
      'CPF: 529.982.247-25',
      '1. Sertralina 50 mg — 1 comprimido',
      'Quantidade: 30 (trinta) comprimidos',
      'IDENTIFICAÇÃO DO COMPRADOR',
      'IDENTIFICAÇÃO DO FORNECEDOR',
      '1ª via - Retenção da Farmácia ou Drogaria',
      '2ª via - Orientação ao Paciente',
    ])
      expect(db.drawnText).toContain(line);
    expect(db.drawnText.some((t) => t.includes('Válida até 04/12/2026'))).toBe(true);
    expect(db.tables.prescriptions[0]).toMatchObject({ doc_type: 'receita_controle_especial', content: { patientAddress: address.patientAddress, patientDocument: 'CPF: 529.982.247-25' } });
    expect(db.tables.prescriptions[0].issuance_snapshot).toMatchObject({ controlled: { items: [{ name: 'Sertralina 50 mg', quantity: 30, substances: ['sertralina (C1)'] }] } });
  });

  it('points a simple prescription with a C1 drug to the controlled type, and a B1 drug to its notification', async () => {
    const db = database({ user_settings: [settings()], patients: [person()] });
    const c1 = await generate(db)({ patientId, docType: 'receita_simples', medications: [rce] });
    expect(c1.status).toBe(422);
    expect((await c1.json()).error).toContain('Escolha o tipo "Controle especial"');
    const b1 = await generate(db)({ patientId, docType: 'receita_controle_especial', medications: [{ ...rce, name: 'Rivotril 2 mg' }], content: address });
    expect((await b1.json()).error).toContain('Notificação de Receita B');
  });

  it('requires the prescriber CPF and the CID for an anabolic steroid (C5)', async () => {
    const testosterone = { name: 'Cipionato de testosterona', concentration: '200 mg/ml', dosage: '1 ml', instructions: 'IM a cada 15 dias', quantity: 1, unit: 'frasco-ampola' };
    const without = await generate(database({ user_settings: [settings()], patients: [person({ cpf: '52998224725' })] }))({
      patientId, docType: 'receita_controle_especial', medications: [testosterone], content: { ...address, cid: 'E29.1' },
    });
    expect((await without.json()).error).toContain('seu CPF');
    const db = database({ user_settings: [settings({ prescriber_cpf: '11144477735' })], patients: [person({ cpf: '52998224725' })] });
    const ok = await generate(db)({ patientId, docType: 'receita_controle_especial', medications: [testosterone], content: { ...address, cid: 'E29.1' } });
    expect(ok.status).toBe(200);
    expect(db.drawnText).toContain('CPF do médico: 111.444.777-35');
    expect(db.drawnText).toContain('CID: E29.1');
    // The concentration is printed when the name does not show it.
    expect(db.drawnText).toContain('1. Cipionato de testosterona 200 mg/ml — 1 ml');
  });
});
