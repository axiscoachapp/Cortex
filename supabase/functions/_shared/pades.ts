/**
 * PAdES signature (ICP-Brasil AD-RB v1.1, DOC-ICP-15.03) for Cortex documents.
 * Contract: docs/prescriptions/ASSINATURA_DIGITAL.md (D17).
 *
 * Pure and dependency-free so it runs the same in Deno (Edge Functions) and
 * Node (tests): its own DER encoder/reader, WebCrypto for hashes, and a PDF
 * incremental update that only appends bytes. The original PDF is never
 * rewritten, so a later signature (a pharmacist's, for example) does not
 * invalidate this one.
 *
 * Flow: preparePades() -> SHA-256 of the signed attributes goes to the PSC
 * (DOC-ICP-17.01, signature_format RAW) -> verifyRawSignature() checks the
 * answer against the certificate -> finalizePades() writes the CMS.
 *
 * Limits of this version: PDFs with a classic cross-reference table only
 * (generate-prescription saves with useObjectStreams: false); RSA
 * certificates only (ICP-Brasil end-user certificates are RSA).
 */

// ---------------------------------------------------------------------------
// DER encoding

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
};

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => {
  const code = c.charCodeAt(0);
  if (code > 0x7e) throw new Error('Texto não ASCII em trecho binário do PDF.');
  return code;
});

function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function tlv(tag: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(...content);
  return concat(Uint8Array.of(tag), derLength(body.length), body);
}

/** X.690 11.6: SET OF elements sorted as octet strings, shorter ones padded with zeros. */
function compareDer(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const DER = {
  seq: (...c: Uint8Array[]) => tlv(0x30, ...c),
  setOf: (...items: Uint8Array[]) => tlv(0x31, ...[...items].sort(compareDer)),
  octets: (b: Uint8Array) => tlv(0x04, b),
  null: Uint8Array.of(0x05, 0x00),
  utf8: (s: string) => tlv(0x0c, new TextEncoder().encode(s)),
  ia5: (s: string) => tlv(0x16, ascii(s)),
  utcTime: (d: Date) => tlv(0x17, ascii(d.toISOString().replace(/^\d\d(\d\d)-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d).*$/, '$1$2$3$4$5$6Z'))),
  /** Context-specific tag [n], constructed (EXPLICIT or IMPLICIT constructed). */
  ctx: (n: number, ...c: Uint8Array[]) => tlv(0xa0 | n, ...c),
  int(value: number | Uint8Array): Uint8Array {
    let bytes: number[];
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Inteiro DER fora do intervalo.');
      bytes = [];
      for (let v = value; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
      if (!bytes.length) bytes = [0];
    } else {
      bytes = [...value];
      while (bytes.length > 1 && bytes[0] === 0 && bytes[1] < 0x80) bytes.shift();
    }
    if (bytes[0] >= 0x80) bytes.unshift(0);
    return tlv(0x02, Uint8Array.from(bytes));
  },
  oid(dotted: string): Uint8Array {
    const arcs = dotted.split('.').map(Number);
    if (arcs.length < 2 || arcs.some((a) => !Number.isSafeInteger(a) || a < 0)) throw new Error(`OID inválido: ${dotted}`);
    const base128 = (n: number) => {
      const out = [n % 128];
      for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) out.unshift(0x80 | (v % 128));
      return out;
    };
    return tlv(0x06, Uint8Array.from([...base128(40 * arcs[0] + arcs[1]), ...arcs.slice(2).flatMap(base128)]));
  },
};

// ---------------------------------------------------------------------------
// DER reading

export interface DerNode { tag: number; start: number; contentStart: number; end: number; bytes: Uint8Array }

export function readDer(buf: Uint8Array, offset = 0): DerNode {
  if (offset + 2 > buf.length) throw new Error('DER truncado.');
  const tag = buf[offset];
  let length = buf[offset + 1];
  let header = 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (!n || n > 4) throw new Error('Comprimento DER não suportado.');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + buf[offset + 2 + i];
    header += n;
  }
  const end = offset + header + length;
  if (end > buf.length) throw new Error('DER truncado.');
  return { tag, start: offset, contentStart: offset + header, end, bytes: buf.subarray(offset, end) };
}

export function derChildren(buf: Uint8Array, node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  for (let at = node.contentStart; at < node.end; ) { const child = readDer(buf, at); out.push(child); at = child.end; }
  return out;
}

export interface ParsedCertificate { der: Uint8Array; serial: Uint8Array; issuer: Uint8Array; subject: Uint8Array; spki: Uint8Array }

/** The parts of an X.509 certificate that a CMS signer needs (full TLVs). */
export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const cert = readDer(der);
  if (cert.tag !== 0x30) throw new Error('Certificado inválido.');
  const [tbs] = derChildren(der, cert);
  const fields = derChildren(der, tbs);
  const at = fields[0].tag === 0xa0 ? 1 : 0; // optional [0] version
  const [serial, , issuer, , subject, spki] = fields.slice(at);
  if (serial?.tag !== 0x02 || issuer?.tag !== 0x30 || subject?.tag !== 0x30 || spki?.tag !== 0x30) throw new Error('Certificado inválido.');
  return { der: cert.bytes, serial: serial.bytes, issuer: issuer.bytes, subject: subject.bytes, spki: spki.bytes };
}

/** DER UTCTime or GeneralizedTime, strict (seconds and Z), as epoch ms; null otherwise. */
function derTime(buf: Uint8Array, node: DerNode): number | null {
  const s = String.fromCharCode(...buf.subarray(node.contentStart, node.end));
  const m = node.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s)
    : node.tag === 0x18 ? /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const year = node.tag === 0x17 ? (y < 50 ? 2000 + y : 1900 + y) : y; // RFC 5280 §4.1.2.5.1
  const t = Date.UTC(year, mo - 1, d, h, mi, se);
  const back = new Date(t);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d
    || back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== se) return null;
  return t;
}

// X.509 shape (RFC 5280 §4.1) in strict DER, checked before any trust
// decision (Codex 05/11 06:35, R2): every header minimal, every constructed
// node exactly filled by its children, and the mandatory parts present with
// their content. Anything else is not a certificate.

/** DER header: low tag form and the shortest length encoding. */
function minimalHeader(buf: Uint8Array, n: DerNode): boolean {
  if ((buf[n.start] & 0x1f) === 0x1f) return false;
  const length = n.end - n.contentStart;
  let bytes = 0;
  for (let v = length; v > 0; v = Math.floor(v / 256)) bytes++;
  return n.contentStart - n.start === (length < 0x80 ? 2 : 2 + bytes);
}

/** Children that exactly fill a constructed node, each with a minimal header. */
function strictChildren(buf: Uint8Array, node: DerNode): DerNode[] {
  if (!(node.tag & 0x20)) throw new Error('DER inválido.');
  const out: DerNode[] = [];
  for (let at = node.contentStart; at < node.end;) {
    const child = readDer(buf, at);
    if (child.end > node.end || !minimalHeader(buf, child)) throw new Error('DER inválido.');
    out.push(child);
    at = child.end;
  }
  return out;
}

/**
 * Every node below `node`, recursively, in strict DER (Codex 05/11 07:36):
 * constructed universal nodes only as SEQUENCE or SET (DER has no
 * constructed strings), and every universal primitive value valid for its
 * type, wherever it is (algorithm parameters, names).
 */
function strictTree(buf: Uint8Array, node: DerNode, depth = 0): void {
  if (depth > 24) throw new Error('DER profundo demais.');
  const universal = (node.tag & 0xc0) === 0;
  if (node.tag & 0x20) {
    if (universal && node.tag !== 0x30 && node.tag !== 0x31) throw new Error('DER inválido.');
    for (const child of strictChildren(buf, node)) strictTree(buf, child, depth + 1);
  } else if (universal && !primitiveOk(buf, node)) {
    throw new Error('DER inválido.');
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
/** The content of a universal primitive value, by its type (X.690 DER). */
function primitiveOk(buf: Uint8Array, n: DerNode): boolean {
  const c = content(buf, n);
  switch (n.tag) {
    case 0x00: return false; // end-of-contents: BER only
    case 0x01: return c.length === 1 && (c[0] === 0x00 || c[0] === 0xff); // BOOLEAN
    case 0x02: case 0x0a: return integerContent(c); // INTEGER, ENUMERATED
    case 0x03: return c.length >= 1 && c[0] <= 7 && !(c.length === 1 && c[0] !== 0) // BIT STRING, unused bits zero
      && (c.length === 1 || (c[c.length - 1] & ((1 << c[0]) - 1)) === 0);
    case 0x05: return c.length === 0; // NULL
    case 0x06: return oidContent(c);
    case 0x0c: try { UTF8.decode(c); return true; } catch { return false; } // UTF8String
    case 0x17: case 0x18: return derTime(buf, n) !== null; // UTCTime, GeneralizedTime
    case 0x1c: return c.length % 4 === 0; // UniversalString (UCS-4)
    case 0x1e: return c.length % 2 === 0; // BMPString (UCS-2)
    default: return true;
  }
}

const content = (buf: Uint8Array, n: DerNode) => buf.subarray(n.contentStart, n.end);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** INTEGER content: not empty, minimal two's complement. */
const integerContent = (c: Uint8Array) => c.length > 0 && !(c.length > 1 && ((c[0] === 0 && c[1] < 0x80) || (c[0] === 0xff && c[1] >= 0x80)));
/** OBJECT IDENTIFIER content: not empty, each arc minimal and terminated. */
const oidContent = (c: Uint8Array) => c.length > 0 && !(c[c.length - 1] & 0x80) && c.every((x, i) => !(x === 0x80 && (i === 0 || !(c[i - 1] & 0x80))));
const isInteger = (buf: Uint8Array, n: DerNode) => n.tag === 0x02 && integerContent(content(buf, n));
const isOid = (buf: Uint8Array, n: DerNode) => n.tag === 0x06 && oidContent(content(buf, n));
/** BIT STRING (or its IMPLICIT [n]): unused bits 0..7, none when empty, none when `whole`. */
function isBitString(buf: Uint8Array, n: DerNode, tag: number, whole: boolean, minBytes = 0): boolean {
  const c = content(buf, n);
  return n.tag === tag && c.length >= 1 + minBytes && c[0] <= 7 && !((c.length === 1 || whole) && c[0] !== 0);
}
/** AlgorithmIdentifier: SEQUENCE { OID, parameters ANY OPTIONAL }. */
function isAlgorithm(buf: Uint8Array, n: DerNode): boolean {
  if (n.tag !== 0x30) return false;
  const parts = strictChildren(buf, n);
  return (parts.length === 1 || parts.length === 2) && isOid(buf, parts[0]);
}
/** Attribute values of a Name: the directory string types (UTF8String, PrintableString, IA5String and the others). */
const NAME_STRING_TAGS = new Set([0x0c, 0x12, 0x13, 0x14, 0x15, 0x16, 0x19, 0x1a, 0x1b, 0x1c, 0x1e]);
/** Name: SEQUENCE OF SET (1..n) OF SEQUENCE { OID, string value }. */
function isName(buf: Uint8Array, n: DerNode): boolean {
  if (n.tag !== 0x30) return false;
  return strictChildren(buf, n).every((rdn) => {
    if (rdn.tag !== 0x31) return false;
    const atvs = strictChildren(buf, rdn);
    return atvs.length > 0 && atvs.every((atv) => {
      if (atv.tag !== 0x30) return false;
      const pair = strictChildren(buf, atv);
      return pair.length === 2 && isOid(buf, pair[0]) && NAME_STRING_TAGS.has(pair[1].tag);
    });
  });
}
/** Extensions: [3] { SEQUENCE (1..n) OF SEQUENCE { OID, BOOLEAN OPTIONAL, OCTET STRING } }, ids unique. */
function isExtensions(buf: Uint8Array, n: DerNode): boolean {
  if (n.tag !== 0xa3) return false;
  const [list, ...rest] = strictChildren(buf, n);
  if (!list || rest.length || list.tag !== 0x30) return false;
  const ids = new Set<string>();
  const items = strictChildren(buf, list);
  return items.length > 0 && items.every((ext) => {
    if (ext.tag !== 0x30) return false;
    const parts = strictChildren(buf, ext);
    const critical = parts.length === 3 ? parts[1] : null;
    const value = parts[parts.length - 1];
    if ((parts.length !== 2 && parts.length !== 3) || !isOid(buf, parts[0]) || value.tag !== 0x04) return false;
    if (critical && !(critical.tag === 0x01 && critical.end - critical.contentStart === 1 && [0x00, 0xff].includes(buf[critical.contentStart]))) return false;
    const id = Array.from(content(buf, parts[0])).join('.');
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}

/**
 * The shape of one certificate, or null: Certificate ::= SEQUENCE {
 * tbsCertificate, signatureAlgorithm (the same as the TBS signature field),
 * signatureValue BIT STRING (not empty, no unused bits) } with nothing after
 * it, and a TBSCertificate with version 1..3, serial, algorithm, issuer,
 * validity, subject, key and only [1], [2], [3] after it, in order.
 */
function certificateShape(der: Uint8Array): { spki: Uint8Array; notBefore: number; notAfter: number } | null {
  const cert = readDer(der);
  if (cert.tag !== 0x30 || cert.end !== der.length || !minimalHeader(der, cert)) return null;
  strictTree(der, cert);
  const parts = strictChildren(der, cert);
  if (parts.length !== 3) return null;
  const [tbs, algorithm, signature] = parts;
  if (tbs.tag !== 0x30 || !isBitString(der, signature, 0x03, true, 1)) return null;
  const fields = strictChildren(der, tbs);
  let at = 0;
  if (fields[0]?.tag === 0xa0) {
    const version = strictChildren(der, fields[0]);
    if (version.length !== 1 || !isInteger(der, version[0]) || version[0].end - version[0].contentStart !== 1 || der[version[0].contentStart] > 2) return null;
    at = 1;
  }
  const [serial, tbsAlgorithm, issuer, validity, subject, spki, ...optional] = fields.slice(at);
  if (!serial || !isInteger(der, serial) || !tbsAlgorithm || !isAlgorithm(der, tbsAlgorithm) || !sameBytes(tbsAlgorithm.bytes, algorithm.bytes)) return null;
  if (!issuer || !isName(der, issuer) || !subject || !isName(der, subject) || validity?.tag !== 0x30 || spki?.tag !== 0x30) return null;
  const keyParts = strictChildren(der, spki);
  if (keyParts.length !== 2 || !isAlgorithm(der, keyParts[0]) || !isBitString(der, keyParts[1], 0x03, true, 1)) return null;
  let last = 0;
  for (const field of optional) {
    const order = field.tag === 0x81 ? 1 : field.tag === 0x82 ? 2 : field.tag === 0xa3 ? 3 : 0;
    if (order <= last) return null;
    if (order < 3 ? !isBitString(der, field, field.tag, false) : !isExtensions(der, field)) return null;
    last = order;
  }
  const times = strictChildren(der, validity);
  if (times.length !== 2) return null;
  const notBefore = derTime(der, times[0]);
  const notAfter = derTime(der, times[1]);
  if (notBefore === null || notAfter === null || notBefore > notAfter) return null;
  return { spki: spki.bytes, notBefore, notAfter };
}

/**
 * Whether a certificate can open a signature session or sign (Codex 05/11
 * 05:09 and 06:35, R2): exactly one X.509 certificate of the strict shape
 * above, an RSA key WebCrypto imports for RSASSA-PKCS1-v1_5 with at least
 * 2048 bits, and `at` inside its validity (inclusive). Returns null when all
 * of it holds, or the reason. Trust in the chain is for the PSC and the
 * validator (ICP-Brasil), not decided here.
 */
export async function signerCertificateProblem(der: Uint8Array, at: Date): Promise<'certificate_invalid' | 'certificate_expired' | null> {
  let shape: ReturnType<typeof certificateShape>;
  try {
    shape = certificateShape(der);
  } catch {
    return 'certificate_invalid';
  }
  if (!shape) return 'certificate_invalid';
  try {
    const key = await crypto.subtle.importKey('spki', new Uint8Array(shape.spki), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!((key.algorithm as RsaHashedKeyAlgorithm).modulusLength >= 2048)) return 'certificate_invalid';
  } catch {
    return 'certificate_invalid';
  }
  const t = at.getTime();
  if (t > shape.notAfter) return 'certificate_expired';
  if (t < shape.notBefore) return 'certificate_invalid';
  return null;
}

// ---------------------------------------------------------------------------
// Hashes and verification (WebCrypto)

// WebCrypto and the compression streams take bytes over a plain ArrayBuffer
// (TS 5.7+ / Deno types); a copy never aliases a shared buffer.
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', owned(data)));
}

/**
 * DOC-ICP-17.01 §7.2.3: before using a PSC answer, check it with the
 * certificate's public key over the data that was hashed and sent.
 */
export async function verifyRawSignature(certificate: Uint8Array, signedData: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const { spki } = parseCertificate(certificate);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('spki', owned(spki), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  } catch {
    throw new Error('Só certificados RSA são aceitos nesta versão.');
  }
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, owned(signature), owned(signedData));
}

// ---------------------------------------------------------------------------
// CMS (RFC 5652) with the AD-RB v1.1 signed attributes

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sigPolicyId: '1.2.840.113549.1.9.16.2.15',
  spqEtsUri: '1.2.840.113549.1.9.16.5.1',
};

/** ICP-Brasil PAdES AD-RB v1.1 (DOC-ICP-15.03 v8.0), valid until 02/03/2029. */
export const AD_RB_V1_1 = '2.16.76.1.7.1.11.1.1';

export interface SignaturePolicy {
  oid: string;
  /** SHA-256 of the policy artifact (LPA of the ITI). Configuration, never guessed. */
  hash: Uint8Array;
  uri?: string;
}

const sha256AlgorithmId = DER.seq(DER.oid(OID.sha256));
const attribute = (type: string, value: Uint8Array) => DER.seq(DER.oid(type), DER.setOf(value));

/** DER SET OF the four AD-RB signed attributes; its SHA-256 is what gets signed. */
export async function signedAttributes(messageDigest: Uint8Array, certificate: ParsedCertificate, policy: SignaturePolicy): Promise<Uint8Array> {
  if (policy.hash.length !== 32) throw new Error('Hash da política de assinatura ausente ou inválido.');
  const essCertIdV2 = DER.seq(
    // hashAlgorithm omitted: SHA-256 is the default (RFC 5035)
    DER.octets(await sha256(certificate.der)),
    DER.seq(DER.seq(DER.ctx(4, certificate.issuer)), certificate.serial),
  );
  const policyId = DER.seq(
    DER.oid(policy.oid),
    DER.seq(sha256AlgorithmId, DER.octets(policy.hash)),
    ...(policy.uri ? [DER.seq(DER.seq(DER.oid(OID.spqEtsUri), DER.ia5(policy.uri)))] : []),
  );
  return DER.setOf(
    attribute(OID.contentType, DER.oid(OID.data)),
    attribute(OID.messageDigest, DER.octets(messageDigest)),
    attribute(OID.signingCertificateV2, DER.seq(DER.seq(essCertIdV2))),
    attribute(OID.sigPolicyId, policyId),
    // No signingTime: in PAdES the time is the /M entry of the signature dictionary.
  );
}

/** Detached CMS SignedData with one signer (ContentInfo, DER). */
export function buildCms(attrs: Uint8Array, signature: Uint8Array, certificate: ParsedCertificate, chain: Uint8Array[] = []): Uint8Array {
  if (attrs[0] !== 0x31) throw new Error('Atributos assinados inválidos.');
  const implicitAttrs = concat(Uint8Array.of(0xa0), attrs.subarray(1)); // [0] IMPLICIT SET OF Attribute
  const signerInfo = DER.seq(
    DER.int(1),
    DER.seq(certificate.issuer, certificate.serial), // IssuerAndSerialNumber
    sha256AlgorithmId,
    implicitAttrs,
    DER.seq(DER.oid(OID.sha256WithRsa), DER.null),
    DER.octets(signature),
  );
  const certificates = [certificate.der, ...chain].sort(compareDer);
  const signedData = DER.seq(
    DER.int(1),
    DER.setOf(sha256AlgorithmId),
    DER.seq(DER.oid(OID.data)), // detached: no eContent
    DER.ctx(0, ...certificates),
    DER.setOf(signerInfo),
  );
  return DER.seq(DER.oid(OID.signedData), DER.ctx(0, signedData));
}

// ---------------------------------------------------------------------------
// PDF incremental update (classic cross-reference table)

const latin1 = (bytes: Uint8Array, start = 0, end = bytes.length) => {
  let s = '';
  for (let i = start; i < end; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 0x8000)));
  return s;
};

interface PdfIndex { offsets: Map<number, number>; size: number; root: number; info: number | null; id: string | null; startxref: number }

function parseTrailerRef(trailer: string, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`).exec(trailer);
  return m ? Number(m[1]) : null;
}

/** Cross-reference of a classic-table PDF, following /Prev; newest entry wins. */
function indexPdf(pdf: Uint8Array): PdfIndex {
  const tail = latin1(pdf, Math.max(0, pdf.length - 1024));
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!sx) throw new Error('PDF sem startxref.');
  const startxref = Number(sx[1]);
  const offsets = new Map<number, number>();
  let trailerText = '';
  for (let at: number | null = startxref, guard = 0; at !== null && guard < 32; guard++) {
    const head = latin1(pdf, at, Math.min(pdf.length, at + 4));
    if (head !== 'xref') throw new Error('PDF com tabela de referência comprimida (xref stream): gere o documento de novo para assinar.');
    const text = latin1(pdf, at, pdf.length);
    const trailerAt = text.indexOf('trailer');
    if (trailerAt < 0) throw new Error('PDF sem trailer.');
    const lines = text.slice(4, trailerAt).trim().split(/\r?\n|\r/);
    for (let i = 0; i < lines.length; ) {
      const [first, count] = lines[i].trim().split(/\s+/).map(Number);
      for (let k = 0; k < count; k++) {
        const entry = lines[i + 1 + k].trim().split(/\s+/);
        const num = first + k;
        if (entry[2] === 'n' && !offsets.has(num)) offsets.set(num, Number(entry[0]));
      }
      i += 1 + count;
    }
    const dictStart = text.indexOf('<<', trailerAt);
    const dict = text.slice(dictStart, dictEndIndex(text, dictStart));
    if (!trailerText) trailerText = dict;
    const prev = /\/Prev\s+(\d+)/.exec(dict);
    at = prev ? Number(prev[1]) : null;
  }
  const size = Number(/\/Size\s+(\d+)/.exec(trailerText)?.[1]);
  const root = parseTrailerRef(trailerText, 'Root');
  if (!size || root === null) throw new Error('Trailer do PDF incompleto.');
  return { offsets, size, root, info: parseTrailerRef(trailerText, 'Info'), id: /\/ID\s*(\[[^\]]*\])/.exec(trailerText)?.[1] ?? null, startxref };
}

/** Index just after the '>>' that closes the dictionary opened at `start`, skipping strings. */
function dictEndIndex(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '(') { // literal string, with nesting and escapes
      let level = 1;
      for (i++; i < text.length && level; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '(') level++;
        else if (text[i] === ')') level--;
      }
      i--;
    } else if (c === '<' && text[i + 1] === '<') { depth++; i++; }
    else if (c === '>' && text[i + 1] === '>') { depth--; i++; if (!depth) return i + 1; }
    else if (c === '<') { i = text.indexOf('>', i); } // hex string
  }
  throw new Error('Dicionário do PDF não fecha.');
}

function objectDict(pdf: Uint8Array, index: PdfIndex, num: number): string {
  const at = index.offsets.get(num);
  if (at === undefined) throw new Error(`Objeto ${num} ausente no PDF.`);
  const text = latin1(pdf, at, Math.min(pdf.length, at + 65536));
  if (!new RegExp(`^${num}\\s+0\\s+obj`).test(text)) throw new Error(`Objeto ${num} fora do lugar.`);
  const start = text.indexOf('<<');
  const afterObj = text.indexOf('obj') + 3;
  if (start < 0 || text.slice(afterObj, start).trim()) throw new Error(`Objeto ${num} não é um dicionário.`);
  return text.slice(start, dictEndIndex(text, start));
}

const refIn = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
};

/** Adds entries before the closing '>>' of a top-level dictionary. */
const withEntries = (dict: string, entries: string) => `${dict.slice(0, -2).trimEnd()}\n${entries}\n>>`;

function firstPage(pdf: Uint8Array, index: PdfIndex, catalog: string): { num: number; dict: string } {
  let num = refIn(catalog, 'Pages');
  for (let depth = 0; num !== null && depth < 16; depth++) {
    const dict = objectDict(pdf, index, num);
    if (/\/Type\s*\/Page(?![s\w])/.test(dict)) return { num, dict };
    const kids = /\/Kids\s*\[\s*(\d+)\s+0\s+R/.exec(dict);
    num = kids ? Number(kids[1]) : null;
  }
  throw new Error('Página do PDF não encontrada.');
}

/** PDF text string: ASCII as a literal, anything else as UTF-16BE hex. */
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/([\\()])/g, '\\$1')})`;
  let hex = 'FEFF';
  for (const c of s) {
    const code = c.codePointAt(0)!;
    const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code];
    for (const u of units) hex += u.toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
}

const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}+00'00'`;

/** OIDs that the ITI validator reads to recognise a health document. */
export const HEALTH_OIDS = {
  crm: '2.16.76.1.4.2.2.1',
  crmUf: '2.16.76.1.4.2.2.2',
  specialty: '2.16.76.1.4.2.2.3',
  documentType: { prescricao: '2.16.76.1.12.1.1', atestado: '2.16.76.1.12.1.2', pedido_exame: '2.16.76.1.12.1.3' },
} as const;

export interface HealthMetadata { crm: string; uf: string; specialty?: string; documentType: keyof typeof HEALTH_OIDS.documentType }

export interface PadesOptions {
  /** Signer certificate (DER), from the PSC certificate-discovery. */
  certificate: Uint8Array;
  chain?: Uint8Array[];
  policy: SignaturePolicy;
  signingTime: Date;
  /** Placement in the Info dictionary; where the ITI validator reads them is
   *  confirmed only with a real certificate (see the contract). */
  health?: HealthMetadata;
  reason?: string;
  /** Bytes reserved for the CMS (default 16 KB). */
  contentsSize?: number;
}

export interface PreparedPades {
  pdf: Uint8Array;
  byteRange: [number, number, number, number];
  contentsStart: number;
  contentsEnd: number;
  messageDigest: Uint8Array;
  /** DER SET OF the signed attributes: the data the signer signs. */
  signedAttributes: Uint8Array;
  /** SHA-256 of signedAttributes: what goes to the PSC (RAW). */
  toBeSignedHash: Uint8Array;
  certificate: ParsedCertificate;
  chain: Uint8Array[];
}

const BYTE_RANGE_PLACEHOLDER = '[0 ********** ********** **********]';

/** Appends an invisible signature field with a reserved /Contents and computes what must be signed. */
export async function preparePades(pdf: Uint8Array, options: PadesOptions): Promise<PreparedPades> {
  const certificate = parseCertificate(options.certificate);
  const contentsSize = options.contentsSize ?? 16384;
  const index = indexPdf(pdf);
  const catalog = objectDict(pdf, index, index.root);
  if (/\/AcroForm/.test(catalog)) throw new Error('O PDF já tem formulário ou assinatura; esta versão assina só documentos novos do Cortex.');
  const page = firstPage(pdf, index, catalog);
  if (/\/Annots\s+\d+\s+0\s+R/.test(page.dict)) throw new Error('Anotações da página em objeto separado não são suportadas.');

  const sigNum = index.size;
  const widgetNum = index.size + 1;
  const infoNum = index.size + 2;
  const widgetRef = `${widgetNum} 0 R`;

  const annots = /\/Annots\s*\[([^\]]*)\]/.exec(page.dict);
  const pageDict = annots
    ? page.dict.replace(annots[0], `/Annots [${annots[1].trim()} ${widgetRef}]`)
    : withEntries(page.dict, `/Annots [${widgetRef}]`);
  const catalogDict = withEntries(catalog, `/AcroForm << /Fields [${widgetRef}] /SigFlags 3 >>`);

  const oldInfo = index.info !== null ? objectDict(pdf, index, index.info) : '<< >>';
  const health = options.health;
  const infoEntries = health
    ? [
        `/${HEALTH_OIDS.crm} ${pdfString(health.crm)}`,
        `/${HEALTH_OIDS.crmUf} ${pdfString(health.uf)}`,
        ...(health.specialty ? [`/${HEALTH_OIDS.specialty} ${pdfString(health.specialty)}`] : []),
        `/${HEALTH_OIDS.documentType[health.documentType]} ${pdfString('')}`,
      ].join('\n')
    : '';
  const infoDict = health ? withEntries(oldInfo, infoEntries) : oldInfo;

  const placeholder = '0'.repeat(contentsSize * 2);
  const sigDict = [
    '<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached',
    `/ByteRange ${BYTE_RANGE_PLACEHOLDER}`,
    `/Contents <${placeholder}>`,
    `/M ${pdfString(pdfDate(options.signingTime))}`,
    ...(options.reason ? [`/Reason ${pdfString(options.reason)}`] : []),
    '/Reference [<< /Type /SigRef /TransformMethod /DocMDP /TransformParams << /Type /TransformParams /P 2 /V /1.2 >> >>]',
    '>>',
  ].join('\n');
  const widget = `<< /Type /Annot /Subtype /Widget /FT /Sig /T ${pdfString('Assinatura Cortex')} /V ${sigNum} 0 R /Rect [0 0 0 0] /F 132 /P ${page.num} 0 R >>`;

  const objects: Array<[number, string]> = [
    [index.root, catalogDict],
    [page.num, pageDict],
    [sigNum, sigDict],
    [widgetNum, widget],
    ...(health ? [[infoNum, infoDict] as [number, string]] : []),
  ];
  const newSize = health ? infoNum + 1 : widgetNum + 1;

  let body = pdf[pdf.length - 1] === 0x0a ? '' : '\n';
  const offsets = new Map<number, number>();
  for (const [num, dict] of objects) {
    offsets.set(num, pdf.length + body.length);
    body += `${num} 0 obj\n${dict}\nendobj\n`;
  }
  const xrefAt = pdf.length + body.length;
  const nums = [...offsets.keys()].sort((a, b) => a - b);
  let xref = 'xref\n';
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    xref += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) xref += `${String(offsets.get(nums[k])).padStart(10, '0')} 00000 n \n`;
    i = j + 1;
  }
  const infoRef = health ? infoNum : index.info;
  const trailer = `trailer\n<< /Size ${newSize} /Root ${index.root} 0 R${infoRef !== null ? ` /Info ${infoRef} 0 R` : ''}${index.id ? ` /ID ${index.id}` : ''} /Prev ${index.startxref} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  body += xref + trailer;

  // Byte-exact: dictionaries copied from the PDF were read as latin-1, and
  // everything this module writes is ASCII.
  const update = Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff);
  const out = concat(pdf, update);
  const text = latin1(update);
  const contentsStart = pdf.length + text.indexOf(`<${placeholder}>`);
  const contentsEnd = contentsStart + placeholder.length + 2;
  const byteRange: [number, number, number, number] = [0, contentsStart, contentsEnd, out.length - contentsEnd];
  const rangeText = `[0 ${byteRange[1]} ${byteRange[2]} ${byteRange[3]}]`;
  if (rangeText.length > BYTE_RANGE_PLACEHOLDER.length) throw new Error('PDF grande demais para a assinatura.');
  const brAt = pdf.length + text.indexOf(BYTE_RANGE_PLACEHOLDER);
  out.set(ascii(rangeText.padEnd(BYTE_RANGE_PLACEHOLDER.length, ' ')), brAt);

  const messageDigest = await sha256(concat(out.subarray(0, contentsStart), out.subarray(contentsEnd)));
  const attrs = await signedAttributes(messageDigest, certificate, options.policy);
  return {
    pdf: out,
    byteRange,
    contentsStart,
    contentsEnd,
    messageDigest,
    signedAttributes: attrs,
    toBeSignedHash: await sha256(attrs),
    certificate,
    chain: options.chain ?? [],
  };
}

/** Writes the CMS into the reserved /Contents. The signature must already be verified. */
export function finalizePades(prepared: PreparedPades, signature: Uint8Array): Uint8Array {
  const cms = buildCms(prepared.signedAttributes, signature, prepared.certificate, prepared.chain);
  const room = (prepared.contentsEnd - prepared.contentsStart - 2) / 2;
  if (cms.length > room) throw new Error(`Assinatura de ${cms.length} bytes não cabe nos ${room} reservados.`);
  const hex = Array.from(cms, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().padEnd(room * 2, '0');
  const out = prepared.pdf.slice();
  out.set(ascii(hex), prepared.contentsStart + 1);
  return out;
}

/** The bytes covered by a signature's /ByteRange (what messageDigest hashes). */
export function signedContent(pdf: Uint8Array, byteRange: [number, number, number, number]): Uint8Array {
  return concat(pdf.subarray(byteRange[0], byteRange[0] + byteRange[1]), pdf.subarray(byteRange[2], byteRange[2] + byteRange[3]));
}

// ---------------------------------------------------------------------------
// Final artifact check and certificate summary (used before any upload)

const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Common name of an X.501 Name (DER), or '' when there is none. */
function commonName(name: Uint8Array): string {
  const root = readDer(name);
  for (const rdn of derChildren(name, root)) {
    for (const atv of derChildren(name, rdn)) {
      const [type, value] = derChildren(name, atv);
      if (type && value && hexOf(type.bytes) === hexOf(DER.oid('2.5.4.3'))) {
        return new TextDecoder().decode(name.subarray(value.contentStart, value.end));
      }
    }
  }
  return '';
}

/**
 * Certificates carried by the last signature of a PDF, or [] when there is
 * none or it cannot be read. Used to resume a stored answer without asking
 * the PSC again; the caller checks the file's hash first and picks the
 * certificate by its SHA-256. The text "/ByteRange" may also appear inside a
 * string (a reason, a name), so every occurrence is tried from the end and
 * only one whose range covers the file and frames a readable CMS counts.
 */
export function signatureCertificates(pdf: Uint8Array): Uint8Array[] {
  const text = new TextDecoder('latin1').decode(pdf);
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].reverse();
  for (const range of ranges) {
    const [b, c, d] = range.slice(1).map(Number);
    if (c + d !== pdf.length || b >= c || pdf[b] !== 0x3c || pdf[c - 1] !== 0x3e) continue;
    const hexText = text.slice(b + 1, c - 1);
    if (!/^[0-9A-Fa-f]+$/.test(hexText) || hexText.length % 2) continue;
    try {
      const contents = Uint8Array.from(hexText.match(/../g)!.map((h) => parseInt(h, 16)));
      const cms = contents.subarray(0, readDer(contents).end);
      const signedData = derChildren(cms, derChildren(cms, readDer(cms))[1])[0];
      const certificates = derChildren(cms, signedData).find((n) => n.tag === 0xa0);
      if (certificates) return derChildren(cms, certificates).map((n) => n.bytes.slice());
    } catch {
      // not this one
    }
  }
  return [];
}

/** What the audit keeps about the signer certificate (never the CPF). */
export async function certificateSummary(der: Uint8Array): Promise<{ sha256: string; serialHex: string; issuer: string }> {
  const cert = parseCertificate(der);
  const serial = readDer(cert.serial);
  return {
    sha256: hexOf(await sha256(cert.der)),
    serialHex: hexOf(cert.serial.subarray(serial.contentStart - serial.start)).replace(/^(00)+(?=.)/, ''),
    issuer: commonName(cert.issuer) || hexOf(await sha256(cert.issuer)),
  };
}

/**
 * Re-reads a signed PDF before it is stored (or before an object already in
 * Storage is accepted): the ByteRange covers everything but /Contents, the
 * bytes outside /Contents are exactly the prepared ones, messageDigest is the
 * hash of that range, and /Contents holds exactly the CMS this preparation
 * produces for the signature it carries (same SignerInfo identifier,
 * algorithms, certificates and signed attributes, byte for byte), followed
 * only by zero padding. The signature itself must verify. Returns null when
 * all of it holds, or the reason it does not.
 */
export async function verifyPadesArtifact(signed: Uint8Array, prepared: PreparedPades): Promise<string | null> {
  const [a, b, c, d] = prepared.byteRange;
  if (a !== 0 || c + d !== signed.length || signed.length !== prepared.pdf.length || signed[b] !== 0x3c || signed[c - 1] !== 0x3e) {
    return 'ByteRange não cobre o arquivo';
  }
  const text = new TextDecoder('latin1').decode(signed.subarray(b + 1, c - 1));
  if (!/^[0-9A-F]+$/.test(text) || text.length % 2) return '/Contents inválido';
  if (!equalBytes(signed.subarray(0, b), prepared.pdf.subarray(0, b)) || !equalBytes(signed.subarray(c), prepared.pdf.subarray(c))) {
    return 'PDF alterado fora da assinatura';
  }
  if (!equalBytes(await sha256(signedContent(signed, prepared.byteRange)), prepared.messageDigest)) return 'messageDigest não confere';
  const contents = Uint8Array.from(text.match(/../g)!.map((h) => parseInt(h, 16)));
  let cms: Uint8Array;
  let signature: Uint8Array;
  try {
    cms = contents.subarray(0, readDer(contents).end);
    const signedData = derChildren(cms, derChildren(cms, readDer(cms))[1])[0];
    const parts = derChildren(cms, signedData);
    const fields = derChildren(cms, derChildren(cms, parts[parts.length - 1])[0]);
    const signatureNode = fields[fields.length - 1];
    if (signatureNode.tag !== 0x04) return 'CMS fora do formato esperado';
    signature = cms.slice(signatureNode.contentStart, signatureNode.end);
  } catch {
    return 'CMS fora do formato esperado';
  }
  if (contents.subarray(cms.length).some((byte) => byte !== 0)) return 'conteúdo extra em /Contents';
  if (!equalBytes(cms, buildCms(prepared.signedAttributes, signature, prepared.certificate, prepared.chain))) return 'CMS diferente do esperado';
  if (!(await verifyRawSignature(prepared.certificate.der, prepared.signedAttributes, signature))) return 'assinatura não confere';
  return null;
}

