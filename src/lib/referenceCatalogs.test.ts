// Readers of the public reference catalogs, with synthetic files built here
// in the official formats (TUSS, CID-10, CMED, DCB). The real files were
// checked outside the repository: TUSS 5,966, CID-10 2,045 + 12,451,
// CMED 26,635 presentations, DCB 12,760 names (04/11/2026).
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_URLS, formatCid, parseCid10, parseCmed, parseDcb, parseDelimited, parseTuss, readXlsxRows, refreshCatalog, tussGroup, unzip,
  type CatalogSource, type RefreshPorts,
} from '../../supabase/functions/_shared/referenceCatalogs';

/** Minimal ZIP writer (deflate), enough for the reader under test. */
function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nameBytes.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    central.push(dir, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

describe('CSV and ZIP', () => {
  it('keeps separators, quotes and line breaks inside quoted fields, and drops the BOM', () => {
    expect(parseDelimited('﻿a;"b;c";"d ""e"""\r\n"f\ng";h\n')).toEqual([['a', 'b;c', 'd "e"'], ['f\ng', 'h']]);
  });

  it('reads deflated and stored entries', async () => {
    const files = await unzip(zip({ 'pasta/um.csv': 'x;y\n1;2\n', 'dois.txt': 'ação' }));
    expect(new TextDecoder().decode(files.get('pasta/um.csv'))).toBe('x;y\n1;2\n');
    expect(new TextDecoder().decode(files.get('dois.txt'))).toBe('ação');
    await expect(unzip(new Uint8Array([1, 2, 3]))).rejects.toThrow('ZIP inválido');
  });
});

describe('TUSS table 22', () => {
  const csv = [
    '"CD_TERMO";"NM_TERMO";"DT_INICIO_VIGENCIA";"DT_FIM_VIGENCIA";"DT_FIM_IMPLANTACAO"',
    '"40304361";"Exame laboratorial sintético; com ponto e vírgula";"2009-02-13";"";"2010-10-15"',
    '"40901114";"Ultrassonografia sintética";"2009-02-13";"2030-01-01";""',
    '"10101012";"Consulta sintética";"2009-02-13";"";""',
    '"123";"Código curto";"2009-02-13";"";""',
  ].join('\n');

  it('reads codes, names and validity, and groups lab and imaging', () => {
    expect(parseTuss(csv)).toEqual([
      { code: '40304361', name: 'Exame laboratorial sintético; com ponto e vírgula', validFrom: '2009-02-13', validTo: null, group: 'laboratorio' },
      { code: '40901114', name: 'Ultrassonografia sintética', validFrom: '2009-02-13', validTo: '2030-01-01', group: 'imagem' },
      { code: '10101012', name: 'Consulta sintética', validFrom: '2009-02-13', validTo: null, group: 'outro' },
    ]);
    expect(['40601110', '40701011', '41301013', '20202016'].map(tussGroup)).toEqual(['patologia', 'medicina_nuclear', 'diagnostico', 'diagnostico']);
  });

  it('refuses a file without the expected columns', () => {
    expect(() => parseTuss('"CODIGO";"NOME"\n"1";"x"')).toThrow('Coluna ausente');
  });
});

describe('CID-10 (DATASUS)', () => {
  it('formats subcategories, keeps the sex restriction and drops the trailing separator', () => {
    const sub = 'SUBCAT;CLASSIF;RESTRSEXO;CAUSAOBITO;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;\nN760;;F;;Vaginite sintética;N76.0 Vaginite sintetica;;;\nA000;;;;Doença sintética;A00.0 Doenca sintetica;;;\n';
    expect(parseCid10(sub)).toEqual([
      { code: 'N76.0', description: 'Vaginite sintética', short: 'Vaginite sintetica', sex: 'F', kind: 'subcategoria' },
      { code: 'A00.0', description: 'Doença sintética', short: 'Doenca sintetica', sex: null, kind: 'subcategoria' },
    ]);
    const cat = 'CAT;CLASSIF;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;\nN76;;Categoria sintética;N76   Categoria sintetica;;;\n';
    expect(parseCid10(cat)).toEqual([{ code: 'N76', description: 'Categoria sintética', short: 'Categoria sintetica', sex: null, kind: 'categoria' }]);
    expect(formatCid('Z014')).toBe('Z01.4');
    expect(() => parseCid10('X;Y\n1;2')).toThrow('desconhecido');
  });
});

describe('CMED presentations (no prices)', () => {
  it('reads the presentation columns, splits nothing inside quotes and cleans empty EANs', () => {
    const header = 'SUBSTÂNCIA;CNPJ;LABORATÓRIO;CÓDIGO GGREM;REGISTRO;EAN 1;EAN 2;EAN 3;PRODUTO;APRESENTAÇÃO;CLASSE TERAPÊUTICA;TIPO DE PRODUTO (STATUS DO PRODUTO);REGIME DE PREÇO;PF 0%;RESTRIÇÃO HOSPITALAR;CAP;COMERCIALIZAÇÃO 2025;TARJA;DESTINAÇÃO COMERCIAL ';
    const row = '"SUBSTÂNCIA A;SUBSTÂNCIA B";00.000.000/0001-00;LABORATÓRIO SINTÉTICO ;538912020009303;1705600230032;7891106000956;    -     ;    -     ;PRODUTO SINTÉTICO;10 MG COM CT BL X 30;G3A - CLASSE SINTÉTICA;Similar;Regulado;12,34;Não;Não;Sim;Tarja Vermelha;';
    const [p] = parseCmed(`﻿${header}\n${row}\n`);
    expect(p).toEqual({
      ggrem: '538912020009303', registration: '1705600230032', registration9: '170560023', substance: 'SUBSTÂNCIA A;SUBSTÂNCIA B',
      laboratory: 'LABORATÓRIO SINTÉTICO', product: 'PRODUTO SINTÉTICO', presentation: '10 MG COM CT BL X 30', therapeuticClass: 'G3A - CLASSE SINTÉTICA',
      productType: 'Similar', tarja: 'Tarja Vermelha', eans: ['7891106000956'], hospitalOnly: false,
    });
    expect(Object.keys(p)).not.toContain('price');
  });
});

describe('DCB list (XLSX)', () => {
  it('finds the header row, reads shared strings and skips history continuation rows', async () => {
    const shared = ['LISTA DCB - CONSOLIDADA', 'Nº DCB ', 'DENOMINAÇÃO COMUM BRASILEIRA', 'Nº CAS', 'CLASSIFICAÇÃO', 'HISTÓRICO', 'substância sintética', '000-00-0', 'IFA', 'nota de alteração'];
    const sst = `<?xml version="1.0"?><sst>${shared.map((t) => `<si><t>${t.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`;
    const cell = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1">${cell('A1', 0)}</row>
      <row r="2">${cell('A2', 1)}${cell('B2', 2)}${cell('C2', 3)}${cell('D2', 4)}${cell('E2', 5)}</row>
      <row r="3"><c r="A3"><v>1</v></c>${cell('B3', 6)}${cell('C3', 7)}${cell('D3', 8)}</row>
      <row r="4">${cell('E4', 9)}</row>
    </sheetData></worksheet>`;
    const rows = await readXlsxRows(zip({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet }));
    expect(rows[2]).toEqual(['1', 'substância sintética', '000-00-0', 'IFA']);
    expect(parseDcb(rows)).toEqual([{ number: '1', name: 'substância sintética', cas: '000-00-0', classification: 'IFA' }]);
    expect(() => parseDcb([['sem cabeçalho']])).toThrow('cabeçalho');
  });
});


describe('catalog refresh (fake network and database)', () => {
  const tussCsv = '"CD_TERMO";"NM_TERMO";"DT_INICIO_VIGENCIA";"DT_FIM_VIGENCIA";"DT_FIM_IMPLANTACAO"\n"40304361";"Exame sintético";"2009-02-13";"";""\n';
  const files: Record<string, Uint8Array> = {
    [CATALOG_URLS.tuss]: zip({ 'pda-049-tabela_22_procedimentos_e_eventos_em_saude.csv': tussCsv, 'outra_tabela.csv': 'x' }),
    [CATALOG_URLS.cid10]: zip({
      'CID-10-CATEGORIAS.CSV': new Uint8Array(Buffer.from('CAT;CLASSIF;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;\nN76;;Categoria sintética;N76 Cat;;;\n', 'latin1')),
      'CID-10-SUBCATEGORIAS.CSV': new Uint8Array(Buffer.from('SUBCAT;CLASSIF;RESTRSEXO;CAUSAOBITO;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;\nN760;;F;;Subcategoria sintética;N76.0 Sub;;;\n', 'latin1')),
    }),
    [CATALOG_URLS.dcb]: new TextEncoder().encode('<a href="/jspui/handle/anvisa/1">Lista DCB antiga</a><a href="/jspui/handle/anvisa/22551">Lista consolidada das DCB - VIGENTE</a>'),
    'https://bibliotecadigital.anvisa.gov.br/jspui/handle/anvisa/22551': new TextEncoder().encode('<a href="/jspui/bitstream/anvisa/22551/1/lista.xlsx">xlsx</a>'),
  };
  function ports(extra: Partial<RefreshPorts> = {}) {
    const calls = { upserts: [] as Array<{ table: string; rows: Record<string, unknown>[]; key: string }>, deletes: [] as string[], versions: [] as Record<string, unknown>[] };
    const known = new Map<CatalogSource, string>();
    const p: RefreshPorts = {
      download: async (url) => { const f = files[url]; if (!f) throw new Error(`404 ${url}`); return f; },
      version: async (source) => (known.has(source) ? { sha256: known.get(source)! } : null),
      upsert: async (table, rows, key) => { calls.upserts.push({ table, rows, key }); },
      deleteOlder: async (table) => { calls.deletes.push(table); },
      saveVersion: async (row) => { calls.versions.push(row); known.set(row.source, row.sha256); },
      now: () => new Date('2026-11-04T20:00:00Z'),
      ...extra,
    };
    return { p, calls };
  }

  it('loads TUSS and CID-10, removes rows that left the list and records the version', async () => {
    const { p, calls } = ports();
    expect(await refreshCatalog('tuss', p)).toMatchObject({ status: 'loaded', rows: 1, skipped: 0 });
    expect(await refreshCatalog('cid10', p)).toMatchObject({ status: 'loaded', rows: 2 });
    expect(calls.upserts[0]).toMatchObject({ table: 'exam_catalog', key: 'code', rows: [{ code: '40304361', exam_group: 'laboratorio', refreshed_at: '2026-11-04T20:00:00.000Z' }] });
    expect(calls.upserts[1].rows.map((r) => r.code)).toEqual(['N76', 'N76.0']);
    expect(calls.deletes).toEqual(['exam_catalog', 'cid10_catalog']);
    expect(calls.versions[0]).toMatchObject({ source: 'tuss', source_url: CATALOG_URLS.tuss, rows_loaded: 1 });
    // Same file again: nothing written.
    expect(await refreshCatalog('tuss', p)).toMatchObject({ status: 'unchanged' });
    expect(calls.upserts).toHaveLength(2);
  });

  it('finds the current DCB spreadsheet and keeps only gov.br sources', async () => {
    const urls: string[] = [];
    const { p } = ports({ download: async (url) => { urls.push(url); if (url.endsWith('.xlsx')) throw new Error('stop after resolving'); return files[url]; } });
    await expect(refreshCatalog('dcb', p)).rejects.toThrow('stop after resolving');
    expect(urls.at(-1)).toBe('https://bibliotecadigital.anvisa.gov.br/jspui/bitstream/anvisa/22551/1/lista.xlsx');
    const outside = ports({ download: async (url) => (url === CATALOG_URLS.dcb
      ? new TextEncoder().encode('<a href="https://example.com/handle/anvisa/9">DCB VIGENTE</a>')
      : new TextEncoder().encode('<a href="https://example.com/x/bitstream/x.xlsx">x</a>')) });
    await expect(refreshCatalog('dcb', outside.p)).rejects.toThrow('gov.br');
    expect(outside.calls.upserts).toHaveLength(0);
  });

  it('writes nothing when a file reads as empty', async () => {
    const empty = ports({ download: async () => zip({ 'pda-049-tabela_22_x.csv': '"CD_TERMO";"NM_TERMO";"DT_INICIO_VIGENCIA";"DT_FIM_VIGENCIA"\n' }) });
    await expect(refreshCatalog('tuss', empty.p)).rejects.toThrow('vazio');
    expect(empty.calls.upserts).toHaveLength(0);
    expect(empty.calls.deletes).toHaveLength(0);
  });
});
