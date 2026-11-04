// Readers of the public reference catalogs, with synthetic files built here
// in the official formats (TUSS, CID-10, CMED, DCB). The real files were
// checked outside the repository: TUSS 5,966, CID-10 2,045 + 12,451,
// CMED 26,635 presentations, DCB 12,760 names (04/11/2026).
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  formatCid, parseCid10, parseCmed, parseDcb, parseDelimited, parseTuss, readXlsxRows, tussGroup, unzip,
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
