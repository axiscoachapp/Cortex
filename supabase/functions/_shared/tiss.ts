/**
 * TISS batch XML (ANS, Componente de Comunicação 4.03.00): consultation and SP/SADT guides,
 * the MD5 hash of the epilogue and an optional ZIP (stored, no compression).
 * Pure module, no network: the billing-api function feeds it rows already authorized.
 * Rules and sources: docs/product/faturamento/pesquisa/TISS_PESQUISA.md (07/11/2026).
 *
 * Notes that matter for portals:
 * - `Padrao` is "4.03.00" (no leading zero; "04.03.00" fails the XSD enumeration).
 * - The hash is MD5 (hex) of the concatenated text of every leaf element of the header and body,
 *   without tags and without the epilogue (Componente Organizacional 202609, §148), encoded in
 *   ISO-8859-1. Some portals compute it over UTF-8; the encoding is configurable per payer and
 *   only changes the result when the text has accents.
 * - The XML is written without indentation, so whitespace never enters the hash.
 * - Since 4.00.00 the beneficiary's name is not in the guides (it fails the XSD).
 * - At most 100 guides per batch, all of the same type.
 */

export type GuideType = 'consulta' | 'sadt';

export interface TissProvider {
  /** Código do prestador na operadora. */
  providerCode: string;
  /** CNES; 9999999 when the clinic has none. */
  cnes: string;
  /** Razão social, used as "nomeContratadoSolicitante" in SP/SADT. */
  legalName: string;
}

export interface TissProfessional { name: string; council: string; councilNumber: string; uf: string; cbo: string }

export interface TissGuide {
  guideNumber: string;
  cardNumber: string;
  newborn: boolean;
  serviceDate: string; // YYYY-MM-DD
  professional: TissProfessional;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantity: number;
  unitAmount: number;
  /** Consultation only: 1 first visit, 2 return, 3 prenatal, 4 referral. */
  consultationType?: '1' | '2' | '3' | '4';
  authorization?: { number?: string | null; password?: string | null; date?: string | null; validUntil?: string | null } | null;
}

export interface TissBatch {
  version: string;
  ansRegistry: string;
  batchNumber: number;
  guideType: GuideType;
  provider: TissProvider;
  guides: TissGuide[];
  /** São Paulo date and time of the transaction. */
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  hashEncoding: 'latin1' | 'utf8';
}

// ---------------------------------------------------------------- MD5 (RFC 1321)

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(bytes: Uint8Array): string {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- text

/** ISO-8859-1 bytes; characters outside it become "?" (callers clean text first). */
export function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c <= 0xff ? c : 0x3f;
  }
  return out;
}

/** Text allowed in TISS fields: Latin-1 printable, trimmed, single spaces, at most `max` characters. */
export function tissText(value: string, max: number): string {
  return value.normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Tiny XML writer: elements keep their order; the hash collects leaf texts in the same order. */
class Writer {
  private parts: string[] = [];
  readonly leaves: string[] = [];
  open(name: string) { this.parts.push(`<ans:${name}>`); return this; }
  close(name: string) { this.parts.push(`</ans:${name}>`); return this; }
  leaf(name: string, value: string | number | null | undefined) {
    if (value === null || value === undefined || value === '') return this;
    const text = String(value);
    this.parts.push(`<ans:${name}>${esc(text)}</ans:${name}>`);
    this.leaves.push(text);
    return this;
  }
  toString() { return this.parts.join(''); }
}

// ---------------------------------------------------------------- validation

const DIGITS = (n: number) => new RegExp(`^[0-9]{${n}}$`);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems that would make the portal refuse the batch; empty when it can be generated. */
export function checkBatch(b: TissBatch): string[] {
  const e: string[] = [];
  if (!['4.03.00', '4.02.00', '4.01.00'].includes(b.version)) e.push('Versão TISS não suportada.');
  if (!DIGITS(6).test(b.ansRegistry)) e.push('Registro ANS do convênio precisa ter 6 dígitos.');
  if (!/^[0-9A-Za-z]{1,20}$/.test(b.provider.providerCode)) e.push('Código do prestador na operadora inválido.');
  if (!DIGITS(7).test(b.provider.cnes)) e.push('CNES precisa ter 7 dígitos (use 9999999 se a clínica não tiver).');
  if (b.guideType === 'sadt' && !tissText(b.provider.legalName, 70)) e.push('Informe a razão social da clínica para as guias SP/SADT.');
  if (b.guides.length === 0 || b.guides.length > 100) e.push('Um lote tem de 1 a 100 guias.');
  if (!DATE.test(b.date) || !/^\d{2}:\d{2}:\d{2}$/.test(b.time)) e.push('Data da transação inválida.');
  const seen = new Set<string>();
  for (const g of b.guides) {
    const at = `Guia ${g.guideNumber}`;
    if (!/^[0-9]{1,20}$/.test(g.guideNumber) || seen.has(g.guideNumber)) e.push(`${at}: número inválido ou repetido.`);
    seen.add(g.guideNumber);
    if (!/^[0-9A-Za-z]{1,20}$/.test(g.cardNumber.replace(/[ .-]/g, ''))) e.push(`${at}: número da carteirinha inválido.`);
    if (!DATE.test(g.serviceDate)) e.push(`${at}: data do atendimento inválida.`);
    const p = g.professional;
    if (!tissText(p.name, 70)) e.push(`${at}: nome do profissional ausente.`);
    if (!DIGITS(2).test(p.council) || !/^[0-9]{1,15}$/.test(p.councilNumber) || !DIGITS(2).test(p.uf) || !DIGITS(6).test(p.cbo))
      e.push(`${at}: conselho, número, UF (código IBGE) ou CBO do profissional incompletos.`);
    if (!['00', '18', '19', '20', '22', '90', '98'].includes(g.tableCode) || !/^[0-9A-Za-z]{1,10}$/.test(g.procedureCode))
      e.push(`${at}: tabela ou código do procedimento inválidos.`);
    if (!(g.unitAmount >= 0) || !Number.isInteger(g.quantity) || g.quantity < 1 || g.quantity > 999) e.push(`${at}: valor ou quantidade inválidos.`);
    if (b.guideType === 'consulta') {
      if (!g.consultationType) e.push(`${at}: informe o tipo de consulta.`);
      if (g.quantity !== 1) e.push(`${at}: a guia de consulta tem um procedimento.`);
    }
    if (g.authorization?.date && !DATE.test(g.authorization.date)) e.push(`${at}: data da autorização inválida.`);
  }
  return e;
}

// ---------------------------------------------------------------- XML

function professional(w: Writer, p: TissProfessional) {
  w.leaf('nomeProfissional', tissText(p.name, 70)).leaf('conselhoProfissional', p.council).leaf('numeroConselhoProfissional', p.councilNumber)
    .leaf('UF', p.uf).leaf('CBOS', p.cbo);
}

function consultaGuide(w: Writer, b: TissBatch, g: TissGuide) {
  w.open('guiaConsulta');
  w.open('cabecalhoConsulta').leaf('registroANS', b.ansRegistry).leaf('numeroGuiaPrestador', g.guideNumber).close('cabecalhoConsulta');
  w.leaf('numeroGuiaOperadora', g.authorization?.number ? tissText(g.authorization.number, 20) : null);
  w.open('dadosBeneficiario').leaf('numeroCarteira', g.cardNumber.replace(/[ .-]/g, '')).leaf('atendimentoRN', g.newborn ? 'S' : 'N').close('dadosBeneficiario');
  w.open('contratadoExecutante').leaf('codigoPrestadorNaOperadora', b.provider.providerCode).leaf('CNES', b.provider.cnes).close('contratadoExecutante');
  w.open('profissionalExecutante'); professional(w, g.professional); w.close('profissionalExecutante');
  w.leaf('indicacaoAcidente', '9');
  w.open('dadosAtendimento').leaf('regimeAtendimento', '01').leaf('dataAtendimento', g.serviceDate).leaf('tipoConsulta', g.consultationType)
    .open('procedimento').leaf('codigoTabela', g.tableCode).leaf('codigoProcedimento', g.procedureCode).leaf('valorProcedimento', money(g.unitAmount))
    .close('procedimento').close('dadosAtendimento');
  w.close('guiaConsulta');
}

function sadtGuide(w: Writer, b: TissBatch, g: TissGuide) {
  const total = money(g.unitAmount * g.quantity);
  w.open('guiaSP-SADT');
  w.open('cabecalhoGuia').leaf('registroANS', b.ansRegistry).leaf('numeroGuiaPrestador', g.guideNumber).close('cabecalhoGuia');
  const auth = g.authorization;
  if (auth?.date) {
    w.open('dadosAutorizacao').leaf('numeroGuiaOperadora', auth.number ? tissText(auth.number, 20) : null).leaf('dataAutorizacao', auth.date)
      .leaf('senha', auth.password ? tissText(auth.password, 20) : null).leaf('dataValidadeSenha', auth.validUntil ?? null).close('dadosAutorizacao');
  }
  w.open('dadosBeneficiario').leaf('numeroCarteira', g.cardNumber.replace(/[ .-]/g, '')).leaf('atendimentoRN', g.newborn ? 'S' : 'N').close('dadosBeneficiario');
  w.open('dadosSolicitante')
    .open('contratadoSolicitante').leaf('codigoPrestadorNaOperadora', b.provider.providerCode).close('contratadoSolicitante')
    .leaf('nomeContratadoSolicitante', tissText(b.provider.legalName, 70))
    .open('profissionalSolicitante'); professional(w, g.professional); w.close('profissionalSolicitante')
    .close('dadosSolicitante');
  w.open('dadosSolicitacao').leaf('dataSolicitacao', auth?.date ?? g.serviceDate).leaf('caraterAtendimento', '1').close('dadosSolicitacao');
  w.open('dadosExecutante').open('contratadoExecutante').leaf('codigoPrestadorNaOperadora', b.provider.providerCode).close('contratadoExecutante')
    .leaf('CNES', b.provider.cnes).close('dadosExecutante');
  w.open('dadosAtendimento').leaf('tipoAtendimento', '23').leaf('indicacaoAcidente', '9').leaf('regimeAtendimento', '01').close('dadosAtendimento');
  w.open('procedimentosExecutados').open('procedimentoExecutado').leaf('sequencialItem', 1).leaf('dataExecucao', g.serviceDate)
    .open('procedimento').leaf('codigoTabela', g.tableCode).leaf('codigoProcedimento', g.procedureCode)
    .leaf('descricaoProcedimento', tissText(g.description, 150)).close('procedimento')
    .leaf('quantidadeExecutada', g.quantity).leaf('reducaoAcrescimo', '1.00').leaf('valorUnitario', money(g.unitAmount)).leaf('valorTotal', total)
    .close('procedimentoExecutado').close('procedimentosExecutados');
  w.open('valorTotal').leaf('valorProcedimentos', total).leaf('valorTotalGeral', total).close('valorTotal');
  w.close('guiaSP-SADT');
}

/** The batch XML (string, to be encoded in ISO-8859-1), its hash, bytes and file name. */
export function buildBatchXml(b: TissBatch): { xml: string; hash: string; bytes: Uint8Array; fileName: string } {
  const problems = checkBatch(b);
  if (problems.length) throw Object.assign(new Error(problems[0]), { problems });
  const w = new Writer();
  w.open('cabecalho')
    .open('identificacaoTransacao').leaf('tipoTransacao', 'ENVIO_LOTE_GUIAS').leaf('sequencialTransacao', b.batchNumber)
    .leaf('dataRegistroTransacao', b.date).leaf('horaRegistroTransacao', b.time).close('identificacaoTransacao')
    .open('origem').open('identificacaoPrestador').leaf('codigoPrestadorNaOperadora', b.provider.providerCode).close('identificacaoPrestador').close('origem')
    .open('destino').leaf('registroANS', b.ansRegistry).close('destino')
    .leaf('Padrao', b.version)
    .close('cabecalho');
  w.open('prestadorParaOperadora').open('loteGuias').leaf('numeroLote', b.batchNumber).open('guiasTISS');
  for (const g of b.guides) (b.guideType === 'consulta' ? consultaGuide : sadtGuide)(w, b, g);
  w.close('guiasTISS').close('loteGuias').close('prestadorParaOperadora');
  const joined = w.leaves.join('');
  const hash = md5(b.hashEncoding === 'utf8' ? new TextEncoder().encode(joined) : latin1(joined));
  const xml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n'
    + `<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">${w.toString()}<ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo></ans:mensagemTISS>`;
  // File name used by most portals: sequential number padded, then the hash.
  const fileName = `${String(b.batchNumber).padStart(20, '0')}_${hash}.xml`;
  return { xml, hash, bytes: latin1(xml), fileName };
}

// ---------------------------------------------------------------- ZIP (stored)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP with one file, stored without compression (accepted by every unzip tool). */
export function zipOne(name: string, data: Uint8Array, when = new Date()): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(data);
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const dosDate = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0, true); local.setUint16(8, 0, true);
  local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
  local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0, true);
  central.setUint16(10, 0, true); central.setUint16(12, dosTime, true); central.setUint16(14, dosDate, true); central.setUint32(16, crc, true);
  central.setUint32(20, data.length, true); central.setUint32(24, data.length, true); central.setUint16(28, nameBytes.length, true);
  central.setUint32(42, 0, true);
  const centralOffset = 30 + nameBytes.length + data.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nameBytes.length, true); end.setUint32(16, centralOffset, true);
  const out = new Uint8Array(centralOffset + 46 + nameBytes.length + 22);
  let o = 0;
  for (const part of [new Uint8Array(local.buffer), nameBytes, data, new Uint8Array(central.buffer), nameBytes, new Uint8Array(end.buffer)]) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
