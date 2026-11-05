// Which certificate may open a signature session (D17, Codex 05/11 05:09 R2).
// Synthetic keys and certificates generated per run; nothing ICP-Brasil.
import { X509Certificate } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DER, readDer, signerCertificateProblem, tlv } from '../../supabase/functions/_shared/pades';
import { RSA, syntheticCertificate } from '../test/syntheticPki';

const NOW = new Date('2026-11-05T12:00:00Z');
const window = (from: string, to: string) => ({ notBefore: new Date(from), notAfter: new Date(to) });
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

let ca: CryptoKeyPair;
let doctor: CryptoKeyPair;
let valid: Uint8Array;

beforeAll(async () => {
  ca = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  doctor = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  valid = await syntheticCertificate('Médica Sintética', 'AC Sintética', doctor, ca.privateKey, 7, window('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'));
}, 30_000);

/** A certificate whose validity is given as raw DER times. */
async function withTimes(notBefore: Uint8Array, notAfter: Uint8Array) {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', doctor.publicKey));
  const algorithm = DER.seq(DER.oid('1.2.840.113549.1.1.11'), DER.null);
  const name = DER.seq(DER.setOf(DER.seq(DER.oid('2.5.4.3'), DER.utf8('Sintética'))));
  const tbs = DER.seq(DER.ctx(0, DER.int(2)), DER.int(9), algorithm, name, DER.seq(notBefore, notAfter), name, spki);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', ca.privateKey, tbs));
  return DER.seq(tbs, algorithm, tlv(0x03, Uint8Array.of(0), signature));
}

describe('signerCertificateProblem', () => {
  it('accepts one complete RSA-2048 certificate inside its validity (control)', async () => {
    expect(await signerCertificateProblem(valid, NOW)).toBeNull();
  });

  it('refuses empty, short, truncated, padded or partial DER', async () => {
    const tbsOnly = tlv(0x30, ...[]);
    for (const der of [new Uint8Array(0), Uint8Array.of(9, 9, 9), valid.slice(0, -1), Uint8Array.from([...valid, 0]), tbsOnly]) {
      expect(await signerCertificateProblem(der, NOW)).toBe('certificate_invalid');
    }
    // Only the TBS part, or a certificate without its signature value.
    const parts = valid.subarray(4); // skip the outer SEQUENCE header (long form, 2 length bytes)
    expect(await signerCertificateProblem(parts, NOW)).toBe('certificate_invalid');
  });

  it('refuses a key it cannot sign with: EC, or RSA under 2048 bits', async () => {
    const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const small = (await crypto.subtle.generateKey({ ...RSA, modulusLength: 1024 }, true, ['sign', 'verify'])) as CryptoKeyPair;
    for (const key of [ec, small]) {
      const der = await syntheticCertificate('Sintética', 'AC Sintética', key, ca.privateKey, 3, window('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'));
      expect(await signerCertificateProblem(der, NOW)).toBe('certificate_invalid');
    }
  });

  it('refuses outside the validity: expired is its own reason, not yet valid is invalid', async () => {
    const expired = await syntheticCertificate('Sintética', 'AC Sintética', doctor, ca.privateKey, 4, window('2025-01-01T00:00:00Z', '2026-11-05T11:59:59Z'));
    expect(await signerCertificateProblem(expired, NOW)).toBe('certificate_expired');
    const future = await syntheticCertificate('Sintética', 'AC Sintética', doctor, ca.privateKey, 5, window('2026-11-05T12:00:01Z', '2027-11-05T00:00:00Z'));
    expect(await signerCertificateProblem(future, NOW)).toBe('certificate_invalid');
    // Inclusive bounds (RFC 5280 §4.1.2.5).
    const edge = await syntheticCertificate('Sintética', 'AC Sintética', doctor, ca.privateKey, 6, window('2026-11-05T12:00:00Z', '2026-11-05T12:00:00Z'));
    expect(await signerCertificateProblem(edge, NOW)).toBeNull();
  });

  it('reads GeneralizedTime and refuses times that are not strict DER', async () => {
    const utc = (s: string) => tlv(0x17, ascii(s));
    const gen = (s: string) => tlv(0x18, ascii(s));
    expect(await signerCertificateProblem(await withTimes(utc('260101000000Z'), gen('20510101000000Z')), NOW)).toBeNull();
    for (const [from, to] of [
      [utc('260101000000Z'), utc('270101000000+0000')], // offset instead of Z
      [utc('2601010000Z'), utc('270101000000Z')], // no seconds
      [utc('260101000000Z'), utc('271301000000Z')], // month 13
      [utc('260101000000Z'), utc('270230000000Z')], // 30 February
      [utc('260101000000Z'), utc('270101006000Z')], // minute 60
      [utc('260101000000Z'), tlv(0x04, ascii('270101000000Z'))], // not a time
    ]) {
      expect(await signerCertificateProblem(await withTimes(from, to), NOW)).toBe('certificate_invalid');
    }
  });
});

// ---------------------------------------------------------------------------
// Codex 05/11 06:35, R2: the whole X.509 shape, not only the outer tags.

/** A v3 certificate with two RDN names and two extensions, like an end-entity one. */
async function fullCertificate() {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', doctor.publicKey));
  const algorithm = DER.seq(DER.oid('1.2.840.113549.1.1.11'), DER.null);
  const bmp = (text: string) => tlv(0x1e, Uint8Array.from([...text].flatMap((ch) => [0, ch.charCodeAt(0)])));
  const name = (cn: string) => DER.seq(
    DER.setOf(DER.seq(DER.oid('2.5.4.6'), tlv(0x13, ascii('BR')))),
    DER.setOf(DER.seq(DER.oid('2.5.4.10'), DER.utf8('ICP-Brasil Sintética'))),
    DER.setOf(DER.seq(DER.oid('2.5.4.11'), bmp('Unidade'))),
    DER.setOf(DER.seq(DER.oid('1.2.840.113549.1.9.1'), tlv(0x16, ascii('sintetica@example.invalid')))),
    DER.setOf(DER.seq(DER.oid('2.5.4.3'), DER.utf8(cn))),
  );
  const extensions = DER.ctx(3, DER.seq(
    DER.seq(DER.oid('2.5.29.19'), tlv(0x01, Uint8Array.of(0xff)), DER.octets(DER.seq())),
    DER.seq(DER.oid('2.5.29.15'), tlv(0x01, Uint8Array.of(0xff)), DER.octets(tlv(0x03, Uint8Array.of(6, 0xc0)))),
  ));
  const tbs = DER.seq(DER.ctx(0, DER.int(2)), DER.int(0x2a17), algorithm, name('AC Sintética'),
    DER.seq(DER.utcTime(new Date('2026-01-01T00:00:00Z')), DER.utcTime(new Date('2027-01-01T00:00:00Z'))),
    name('Médica Sintética'), spki, extensions);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', ca.privateKey, tbs));
  return DER.seq(tbs, algorithm, tlv(0x03, Uint8Array.of(0), signature));
}

const openssl = (der: Uint8Array) => { try { new X509Certificate(Buffer.from(der)); return true; } catch { return false; } };

/** DER tree of a certificate: constructed nodes keep children, primitive ones their bytes. */
interface Node { tag: number; children?: Node[]; body?: Uint8Array }
function tree(buf: Uint8Array, at = 0): Node {
  const n = readDer(buf, at);
  if (!(n.tag & 0x20)) return { tag: n.tag, body: buf.slice(n.contentStart, n.end) };
  const children: Node[] = [];
  for (let i = n.contentStart; i < n.end;) { const c = readDer(buf, i); children.push(tree(buf, i)); i = c.end; }
  return { tag: n.tag, children };
}
/** Encodes a tree; `odd` gives one node a non-minimal (long form) length, or a length one byte past its content. */
function encode(n: Node, odd?: { node: Node; kind: 'long' | 'overrun' }): Uint8Array {
  const inner = n.children ? Uint8Array.from(n.children.flatMap((c) => [...encode(c, odd)])) : n.body!;
  if (n !== odd?.node) return tlv(n.tag, inner);
  if (odd.kind === 'overrun') {
    const claimed = tlv(n.tag, inner, Uint8Array.of(0)); // header for one byte more than the content
    return Uint8Array.from([...claimed.subarray(0, claimed.length - inner.length - 1), ...inner]);
  }
  const len = inner.length;
  const header = len < 0x80 ? [n.tag, 0x81, len] : [n.tag, 0x83, 0, (len >> 8) & 0xff, len & 0xff];
  return Uint8Array.from([...header, ...inner]);
}
const clone = (n: Node): Node => ({ tag: n.tag, children: n.children?.map(clone), body: n.body?.slice() });
function paths(n: Node, at: number[] = []): number[][] {
  return [at, ...(n.children ?? []).flatMap((c, i) => paths(c, [...at, i]))];
}
const nodeAt = (root: Node, path: number[]) => path.reduce((n, i) => n.children![i], root);

/** Corrupted variants of one certificate, each named. */
function variants(der: Uint8Array): Array<[string, Uint8Array]> {
  const root = tree(der);
  const out: Array<[string, Uint8Array]> = [];
  // Inside an AlgorithmIdentifier, the same change is also made to the other
  // copy (TBS 0.2 and outer 1), so the equality of the two does not hide it.
  const inAlgorithm = (path: number[]) => (path[0] === 0 && path[1] === 2 && path.length > 2) || (path[0] === 1 && path.length > 1);
  const mutate = (label: string, path: number[], change: (n: Node, parent: Node | null, index: number) => void) => {
    const copy = clone(root);
    const parent = path.length ? nodeAt(copy, path.slice(0, -1)) : null;
    change(nodeAt(copy, path), parent, path[path.length - 1]);
    out.push([`${label} @${path.join('.') || 'root'}`, encode(copy)]);
    if (inAlgorithm(path)) {
      if (path[0] === 0) copy.children![1] = clone(nodeAt(copy, [0, 2]));
      else copy.children![0].children![2] = clone(copy.children![1]);
      out.push([`${label} (both algorithms) @${path.join('.')}`, encode(copy)]);
    }
  };
  for (const path of paths(root)) {
    const n = nodeAt(root, path);
    mutate('empty', path, (x) => { if (x.children) x.children = []; else x.body = new Uint8Array(0); });
    if (path.length) {
      mutate('drop', path, (_x, parent, i) => { parent!.children!.splice(i, 1); });
      mutate('duplicate', path, (x, parent, i) => { parent!.children!.splice(i, 0, clone(x)); });
    }
    mutate('retag', path, (x) => {
      if (x.children) { x.body = Uint8Array.from(x.children.flatMap((c) => [...encode(c)])); x.children = undefined; x.tag = 0x04; } else x.tag = x.tag === 0x04 ? 0x0c : 0x04;
    });
    if (n.body && n.body.length) {
      mutate('short', path, (x) => { x.body = x.body!.slice(0, -1); });
      mutate('pad', path, (x) => { x.body = Uint8Array.from([...x.body!, 0]); });
      if (n.tag === 0x02 || n.tag === 0x06) mutate('lead', path, (x) => { x.body = Uint8Array.from([n.tag === 0x02 ? 0 : 0x80, ...x.body!]); });
      if (n.tag === 0x03) for (const bits of [1, 7, 8, 255]) mutate(`unused${bits}`, path, (x) => { x.body![0] = bits; });
    }
    if (n.body && !(n.tag & 0xc0)) {
      mutate('content FF', path, (x) => { x.body = Uint8Array.of(0xff); });
      mutate('content 00', path, (x) => { x.body = Uint8Array.of(0x00); });
      mutate('content C3', path, (x) => { x.body = Uint8Array.of(0xc3); }); // a UTF-8 sequence cut short
      mutate('content 0001', path, (x) => { x.body = Uint8Array.of(0x00, 0x01); });
    }
    for (const kind of ['long', 'overrun'] as const) {
      const copy = clone(root);
      out.push([`${kind}-length @${path.join('.') || 'root'}`, encode(copy, { node: nodeAt(copy, path), kind })]);
    }
  }
  out.push(['trailing byte', Uint8Array.from([...der, 0])]);
  for (const cut of [1, 2, 10, 100, der.length - 1]) out.push([`truncated ${cut}`, der.slice(0, der.length - cut)]);
  return out;
}

describe('signerCertificateProblem: the X.509 shape (Codex 05/11 06:35, R2)', () => {
  it('refuses the three probe shapes: empty outer algorithm, empty signature value, 255 unused bits', async () => {
    const [tbs, algorithm, signature] = (() => {
      const root = readDer(valid);
      const parts: Uint8Array[] = [];
      for (let at = root.contentStart; at < root.end;) { const n = readDer(valid, at); parts.push(valid.slice(n.start, n.end)); at = n.end; }
      return parts;
    })();
    const sigBody = signature.slice(readDer(signature).contentStart - readDer(signature).start);
    for (const der of [
      DER.seq(tbs, DER.seq(), signature),
      DER.seq(tbs, algorithm, tlv(0x03)),
      DER.seq(tbs, algorithm, tlv(0x03, Uint8Array.of(255), sigBody.subarray(1))),
    ]) {
      expect(openssl(der)).toBe(false);
      expect(await signerCertificateProblem(der, NOW)).toBe('certificate_invalid');
    }
  });

  it('refuses an outer algorithm other than the one in the TBS (RFC 5280 §4.1.1.2)', async () => {
    const root = tree(valid);
    root.children![1] = tree(DER.seq(DER.oid('1.2.840.113549.1.1.13'), DER.null)); // sha512WithRSAEncryption
    expect(await signerCertificateProblem(encode(root), NOW)).toBe('certificate_invalid');
  });

  it('accepts a full v3 certificate with names and extensions (control), as OpenSSL does', async () => {
    const full = await fullCertificate();
    expect(openssl(full)).toBe(true);
    expect(openssl(valid)).toBe(true);
    expect(await signerCertificateProblem(full, NOW)).toBeNull();
  });

  it('refuses what strict DER and RFC 5280 forbid even where OpenSSL parses it', async () => {
    const full = await fullCertificate();
    // Paths in fullCertificate: 0 TBS (0.0 version, 0.1 serial, 0.2 algorithm, 0.3 issuer, 0.4 validity,
    // 0.5 subject, 0.6 key, 0.7 extensions [3] > 0.7.0 list), 1 algorithm, 2 signature value.
    const edit = (change: (root: Node) => void) => { const root = tree(full); change(root); return encode(root); };
    const cases: Array<[string, Uint8Array]> = [
      ['signature value with only the unused-bits byte', edit((r) => { r.children![2].body = Uint8Array.of(0); })],
      ['signature value with unused bits', edit((r) => { r.children![2].body![0] = 1; })],
      ['key with unused bits', edit((r) => { nodeAt(r, [0, 6, 1]).body![0] = 1; })],
      ['version 4', edit((r) => { nodeAt(r, [0, 0, 0]).body = Uint8Array.of(3); })],
      ['empty RDN set', edit((r) => { nodeAt(r, [0, 3]).children!.push({ tag: 0x31, children: [] }); })],
      ['empty extension list', edit((r) => { nodeAt(r, [0, 7, 0]).children = []; })],
      ['duplicate extension', edit((r) => { const list = nodeAt(r, [0, 7, 0]); list.children!.push(clone(list.children![0])); })],
      ['long-form length on the serial', (() => { const r = tree(full); return encode(r, { node: nodeAt(r, [0, 1]), kind: 'long' }); })()],
    ];
    // Non-minimal length deep inside the algorithm parameters (same bytes inside and outside the TBS).
    const root = tree(full);
    const algorithm = DER.seq(DER.oid('1.2.840.113549.1.1.11'), Uint8Array.of(0x30, 0x03, 0x05, 0x81, 0x00));
    const fields = root.children![0].children!.map((n, i) => (i === 2 ? algorithm : encode(n)));
    cases.push(['non-minimal length inside the algorithm parameters', DER.seq(DER.seq(...fields), algorithm, encode(root.children![2]))]);
    for (const [label, der] of cases) expect([label, await signerCertificateProblem(der, NOW)]).toEqual([label, 'certificate_invalid']);
    expect(await signerCertificateProblem(full, NOW)).toBeNull();
  });

  it('refuses invalid primitive contents: algorithm parameters and name strings (Codex 05/11 07:36)', async () => {
    const full = await fullCertificate();
    const root = tree(full);
    // The same parameters inside and outside the TBS, so the equality holds.
    const withParameters = (parameters: Uint8Array | null) => {
      const algorithm = parameters ? DER.seq(DER.oid('1.2.840.113549.1.1.11'), parameters) : DER.seq(DER.oid('1.2.840.113549.1.1.11'));
      const fields = root.children![0].children!.map((n, i) => (i === 2 ? algorithm : encode(n)));
      return DER.seq(DER.seq(...fields), algorithm, encode(root.children![2]));
    };
    const withIssuerValue = (value: Uint8Array) => {
      const copy = tree(full);
      nodeAt(copy, [0, 3]).children!.push(tree(DER.setOf(DER.seq(DER.oid('2.5.4.11'), value))));
      return encode(copy);
    };
    const cases: Array<[string, Uint8Array]> = [
      ['NULL parameters with content', withParameters(Uint8Array.of(0x05, 0x01, 0x00))],
      ['empty INTEGER parameters', withParameters(Uint8Array.of(0x02, 0x00))],
      ['non-minimal INTEGER parameters', withParameters(Uint8Array.of(0x02, 0x02, 0x00, 0x01))],
      ['UTF8String with FF in the issuer', withIssuerValue(tlv(0x0c, Uint8Array.of(0xff)))],
      ['BMPString of one byte in the issuer', withIssuerValue(tlv(0x1e, Uint8Array.of(0x00)))],
      ['UniversalString of three bytes in the issuer', withIssuerValue(tlv(0x1c, Uint8Array.of(0x00, 0x00, 0x41)))],
      ['end-of-contents as parameters', withParameters(Uint8Array.of(0x00, 0x00))],
    ];
    for (const [label, der] of cases) {
      expect([label, openssl(der)]).toEqual([label, false]);
      expect([label, await signerCertificateProblem(der, NOW)]).toEqual([label, 'certificate_invalid']);
    }
    // A constructed string is BER, which OpenSSL parses; DER forbids it.
    expect(await signerCertificateProblem(withIssuerValue(tlv(0x2c, tlv(0x0c, ascii('a')))), NOW)).toBe('certificate_invalid');
    // What DER forbids in any value, here as algorithm parameters (in both copies).
    const strict: Array<[string, Uint8Array]> = [
      ['BOOLEAN other than 00/FF', Uint8Array.of(0x01, 0x01, 0x05)],
      ['BIT STRING with a set unused bit', Uint8Array.of(0x03, 0x02, 0x01, 0x01)],
      ['OID with a padded arc', Uint8Array.of(0x06, 0x02, 0x80, 0x01)],
      ['UTCTime without seconds', tlv(0x17, ascii('2601010000Z'))],
      ['constructed OCTET STRING', Uint8Array.of(0x24, 0x03, 0x04, 0x01, 0x00)],
    ];
    for (const [label, parameters] of strict) {
      expect([label, await signerCertificateProblem(withParameters(parameters), NOW)]).toEqual([label, 'certificate_invalid']);
    }
    // Valid forms still pass: NULL parameters (the usual) and no parameters.
    for (const der of [withParameters(DER.null), withParameters(null)]) {
      expect(openssl(der)).toBe(true);
      expect(await signerCertificateProblem(der, NOW)).toBeNull();
    }
  });

  it('never accepts a corrupted variant that OpenSSL refuses', async () => {
    const full = await fullCertificate();
    const accepted: string[] = [];
    let refusedByOpenssl = 0;
    for (const [label, der] of [...variants(full), ...variants(valid)]) {
      if (openssl(der)) continue;
      refusedByOpenssl++;
      if ((await signerCertificateProblem(der, NOW)) === null) accepted.push(label);
    }
    expect(accepted).toEqual([]);
    expect(refusedByOpenssl).toBeGreaterThan(150);
  }, 60_000);
});
