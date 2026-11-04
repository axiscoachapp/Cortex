/**
 * Readers for the public reference catalogs (contract:
 * docs/prescriptions/CATALOGOS_E_MANIPULADOS.md): TUSS table 22 (ANS),
 * CID-10 (DATASUS), CMED presentations (Anvisa, prices dropped) and the DCB
 * list (Anvisa). Pure and dependency-free: CSV with quotes, ZIP through the
 * platform's DecompressionStream, and a minimal XLSX reader. Same code in
 * Deno (refresh-reference-catalogs) and Node (tests).
 */

// ---------------------------------------------------------------------------
// CSV

/** Rows of a delimited text: quotes with "" escapes, separators and line
 *  breaks inside quotes, CRLF or LF, BOM removed. */
export function parseDelimited(text: string, sep = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (v: string | undefined) => (v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function columns(header: string[], wanted: Record<string, RegExp>): Record<string, number> {
  const at: Record<string, number> = {};
  for (const [key, pattern] of Object.entries(wanted)) {
    const index = header.findIndex((h) => pattern.test(clean(h)));
    if (index < 0) throw new Error(`Coluna ausente no catálogo: ${key}`);
    at[key] = index;
  }
  return at;
}

// ---------------------------------------------------------------------------
// ZIP (stored or deflate; no ZIP64, no encryption)

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('Arquivo ZIP inválido.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('Diretório do ZIP inválido.');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Entrada do ZIP inválida.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) {
      files.set(name, await inflateRaw(data));
    } else throw new Error(`Compressão ZIP não suportada (${method}).`);
  }
  return files;
}

// ---------------------------------------------------------------------------
// XLSX (first worksheet, shared and inline strings)

const xmlText = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

export async function readXlsxRows(bytes: Uint8Array, sheet = 1): Promise<string[][]> {
  const files = await unzip(bytes);
  const decode = (name: string) => { const f = files.get(name); return f ? new TextDecoder().decode(f) : ''; };
  const shared = [...decode('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
  const xml = decode(`xl/worksheets/sheet${sheet}.xml`);
  if (!xml) throw new Error('Planilha sem a aba esperada.');
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '';
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const body = cell[2] ?? '';
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      const text = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? xmlText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '') : xmlText(value);
      row[col >= 0 ? col : row.length] = text;
    }
    rows.push(Array.from(row, (v) => v ?? ''));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// TUSS table 22 (ANS open data): CD_TERMO;NM_TERMO;DT_INICIO_VIGENCIA;DT_FIM_VIGENCIA;...

export type ExamGroup = 'laboratorio' | 'imagem' | 'medicina_nuclear' | 'patologia' | 'diagnostico' | 'outro';
export interface TussTerm { code: string; name: string; group: ExamGroup; validFrom: string | null; validTo: string | null }

/** Coarse group by the code's first three digits (labels are Cortex's, not ANS's). */
export function tussGroup(code: string): ExamGroup {
  const prefix = code.slice(0, 3);
  if (prefix === '403') return 'laboratorio';
  if (['408', '409', '410', '411'].includes(prefix)) return 'imagem';
  if (prefix === '407') return 'medicina_nuclear';
  if (prefix === '406') return 'patologia';
  if (code.startsWith('4') || code === '20202016') return 'diagnostico';
  return 'outro';
}

const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null);

export function parseTuss(text: string): TussTerm[] {
  const [header, ...rows] = parseDelimited(text);
  const at = columns(header, { code: /^CD_TERMO$/, name: /^NM_TERMO$/, from: /^DT_INICIO_VIGENCIA$/, to: /^DT_FIM_VIGENCIA$/ });
  return rows
    .map((r) => ({ code: clean(r[at.code]), name: clean(r[at.name]), validFrom: isoDate(r[at.from]), validTo: isoDate(r[at.to]) }))
    .filter((t) => /^\d{8}$/.test(t.code) && t.name)
    .map((t) => ({ ...t, group: tussGroup(t.code) }));
}

// ---------------------------------------------------------------------------
// CID-10 (DATASUS CSV, latin-1, every line ends with ';')

export interface Cid10Entry { code: string; description: string; short: string; sex: 'F' | 'M' | null; kind: 'categoria' | 'subcategoria' }

/** "N760" -> "N76.0"; categories stay "N76". */
export const formatCid = (raw: string) => (raw.length === 4 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw);

export function parseCid10(text: string): Cid10Entry[] {
  const [header, ...rows] = parseDelimited(text);
  const kind = clean(header[0]) === 'SUBCAT' ? 'subcategoria' : clean(header[0]) === 'CAT' ? 'categoria' : null;
  if (!kind) throw new Error('Arquivo CID-10 desconhecido.');
  const at = columns(header, { code: kind === 'subcategoria' ? /^SUBCAT$/ : /^CAT$/, description: /^DESCRICAO$/, short: /^DESCRABREV$/ });
  const sexAt = header.findIndex((h) => clean(h) === 'RESTRSEXO');
  return rows
    .map((r) => {
      const code = clean(r[at.code]).toUpperCase();
      const sex = sexAt >= 0 ? clean(r[sexAt]).toUpperCase() : '';
      return {
        code: formatCid(code),
        description: clean(r[at.description]),
        short: clean(r[at.short]).replace(/^[A-Z]\d\d(\.\d)?\s+/, ''),
        sex: sex === 'F' || sex === 'M' ? sex : null,
        kind,
      } as Cid10Entry;
    })
    .filter((e) => /^[A-Z]\d\d(\.\d)?$/.test(e.code) && e.description);
}

// ---------------------------------------------------------------------------
// CMED (Anvisa TA_PRECO_MEDICAMENTO.csv): presentations only, no prices

export interface CmedPresentation {
  ggrem: string; registration: string; registration9: string; substance: string; laboratory: string; product: string;
  presentation: string; therapeuticClass: string; productType: string; tarja: string; eans: string[]; hospitalOnly: boolean;
}

export function parseCmed(text: string): CmedPresentation[] {
  const [header, ...rows] = parseDelimited(text);
  const at = columns(header, {
    substance: /^SUBST[ÂA]NCIA$/i, laboratory: /^LABORAT[ÓO]RIO$/i, ggrem: /^C[ÓO]DIGO GGREM$/i, registration: /^REGISTRO$/i,
    ean1: /^EAN 1$/i, ean2: /^EAN 2$/i, ean3: /^EAN 3$/i, product: /^PRODUTO$/i, presentation: /^APRESENTA[ÇC][ÃA]O$/i,
    therapeuticClass: /^CLASSE TERAP[ÊE]UTICA$/i, productType: /^TIPO DE PRODUTO/i, hospital: /^RESTRI[ÇC][ÃA]O HOSPITALAR$/i, tarja: /^TARJA$/i,
  });
  const out: CmedPresentation[] = [];
  for (const r of rows) {
    const ggrem = clean(r[at.ggrem]).replace(/\D/g, '');
    const registration = clean(r[at.registration]).replace(/\D/g, '');
    if (!ggrem || !clean(r[at.product])) continue;
    out.push({
      ggrem,
      registration,
      registration9: registration.slice(0, 9),
      substance: clean(r[at.substance]),
      laboratory: clean(r[at.laboratory]),
      product: clean(r[at.product]),
      presentation: clean(r[at.presentation]),
      therapeuticClass: clean(r[at.therapeuticClass]),
      productType: clean(r[at.productType]),
      tarja: clean(r[at.tarja]).replace(/^-\s*\(\*\)$/, ''),
      eans: [r[at.ean1], r[at.ean2], r[at.ean3]].map((e) => clean(e).replace(/\D/g, '')).filter((e) => e.length >= 8),
      hospitalOnly: /^sim$/i.test(clean(r[at.hospital])),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// DCB (Anvisa consolidated list, XLSX; header on the row that names the columns)

export interface DcbEntry { number: string; name: string; cas: string; classification: string }

export function parseDcb(rows: string[][]): DcbEntry[] {
  const headerAt = rows.findIndex((r) => r.some((c) => /DENOMINA[ÇC][ÃA]O COMUM BRASILEIRA/i.test(clean(c))));
  if (headerAt < 0) throw new Error('Lista DCB sem cabeçalho.');
  const at = columns(rows[headerAt], { number: /^N[ºo°] ?DCB$/i, name: /DENOMINA[ÇC][ÃA]O COMUM BRASILEIRA/i, cas: /^N[ºo°] ?CAS$/i, classification: /^CLASSIFICA[ÇC][ÃA]O$/i });
  return rows.slice(headerAt + 1)
    .map((r) => ({ number: clean(r[at.number]), name: clean(r[at.name]), cas: clean(r[at.cas]), classification: clean(r[at.classification]) }))
    .filter((e) => /^\d+$/.test(e.number) && e.name);
}
