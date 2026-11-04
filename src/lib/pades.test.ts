// PAdES AD-RB (D17) with synthetic material only: the CA, the "Médica
// Sintética" certificate and their keys are generated in memory for each run
// and never saved. The policy hash is a test value, not the ITI artifact.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AD_RB_V1_1, DER, HEALTH_OIDS, derChildren, finalizePades, preparePades, readDer, sha256, signedContent, tlv, verifyRawSignature,
  type PadesOptions,
} from '../../supabase/functions/_shared/pades';

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' } as const;
const name = (cn: string) => DER.seq(DER.setOf(DER.seq(DER.oid('2.5.4.3'), DER.utf8(cn))));

async function certificate(subject: string, issuer: string, key: CryptoKeyPair, issuerKey: CryptoKey, serial: number) {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', key.publicKey));
  const algorithm = DER.seq(DER.oid('1.2.840.113549.1.1.11'), DER.null);
  const tbs = DER.seq(
    DER.ctx(0, DER.int(2)),
    DER.int(serial),
    algorithm,
    name(issuer),
    DER.seq(DER.utcTime(new Date('2026-01-01T00:00:00Z')), DER.utcTime(new Date('2027-01-01T00:00:00Z'))),
    name(subject),
    spki,
  );
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', issuerKey, tbs));
  return DER.seq(tbs, algorithm, tlv(0x03, Uint8Array.of(0), signature)); // BIT STRING, no unused bits
}

/** Minimal classic-xref PDF with one page and an Info dictionary. */
function minimalPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Receita teste) Tj ET\nendstream',
    '<< /Producer (Cortex sintetico) /Title (Documento \\(teste\\)) >>',
  ];
  let body = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R /ID [<AB12> <AB12>] >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Uint8Array.from(body, (c) => c.charCodeAt(0));
}

let doctor: CryptoKeyPair;
let doctorCert: Uint8Array;
let caCert: Uint8Array;
let options: PadesOptions;
const SIGNING_TIME = new Date('2026-11-04T15:30:00Z');

beforeAll(async () => {
  const ca = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  doctor = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  caCert = await certificate('AC Sintética de Teste', 'AC Sintética de Teste', ca, ca.privateKey, 1);
  doctorCert = await certificate('Médica Sintética:00000000000', 'AC Sintética de Teste', doctor, ca.privateKey, 4242);
  options = {
    certificate: doctorCert,
    chain: [caCert],
    policy: { oid: AD_RB_V1_1, hash: new Uint8Array(32).fill(7), uri: 'http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der' },
    signingTime: SIGNING_TIME,
    health: { crm: '00000', uf: 'PR', specialty: 'Ginecologia e Obstetrícia', documentType: 'prescricao' },
    reason: 'Prescrição médica',
  };
}, 30_000);

async function signedPdf(pdf = minimalPdf()) {
  const prepared = await preparePades(pdf, options);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', doctor.privateKey, prepared.signedAttributes));
  return { original: pdf, prepared, signature, signed: finalizePades(prepared, signature) };
}

function cmsFrom(pdf: Uint8Array, start: number, end: number): Uint8Array {
  const hex = text(pdf.subarray(start + 1, end - 1));
  const bytes = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  return bytes.subarray(0, readDer(bytes).end);
}

describe('DER', () => {
  it('encodes OIDs and integers as X.690 says', () => {
    expect(Buffer.from(DER.oid('1.2.840.113549')).toString('hex')).toBe('06062a864886f70d');
    expect(Buffer.from(DER.oid(AD_RB_V1_1)).toString('hex')).toBe('0608604c0107010b0101');
    expect(Buffer.from(DER.int(128)).toString('hex')).toBe('02020080');
    expect(Buffer.from(DER.int(Uint8Array.of(0, 0, 5))).toString('hex')).toBe('020105');
  });
});

describe('PAdES AD-RB incremental signature', () => {
  it('only appends: the original PDF stays byte for byte at the start', async () => {
    const { original, signed } = await signedPdf();
    expect(Buffer.from(signed.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    expect(text(signed).trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('covers the whole file except /Contents, and messageDigest is the SHA-256 of that range', async () => {
    const { prepared, signed } = await signedPdf();
    const [a, b, c, d] = prepared.byteRange;
    expect(a).toBe(0);
    expect(c + d).toBe(signed.length);
    expect(text(signed.subarray(b, b + 1))).toBe('<');
    expect(text(signed.subarray(c - 1, c))).toBe('>');
    expect(text(signed)).toContain(`/ByteRange [0 ${b} ${c} ${d}]`);
    expect(await sha256(signedContent(signed, prepared.byteRange))).toEqual(prepared.messageDigest);
  });

  it('builds the CMS with the four AD-RB signed attributes, no signingTime, and a valid signature', async () => {
    const { prepared, signed, signature } = await signedPdf();
    const cms = cmsFrom(signed, prepared.contentsStart, prepared.contentsEnd);
    const contentInfo = readDer(cms);
    const [type, wrapped] = derChildren(cms, contentInfo);
    expect(Buffer.from(type.bytes).toString('hex')).toBe(Buffer.from(DER.oid('1.2.840.113549.1.7.2')).toString('hex'));
    const signedData = derChildren(cms, wrapped)[0];
    const parts = derChildren(cms, signedData);
    const signerInfo = derChildren(cms, parts[parts.length - 1])[0];
    const attrsNode = derChildren(cms, signerInfo).find((n) => n.tag === 0xa0)!;
    const attrOids = derChildren(cms, attrsNode).map((attr) => Buffer.from(derChildren(cms, attr)[0].bytes).toString('hex'));
    const oidHex = (o: string) => Buffer.from(DER.oid(o)).toString('hex');
    expect(attrOids.sort()).toEqual(
      ['1.2.840.113549.1.9.3', '1.2.840.113549.1.9.4', '1.2.840.113549.1.9.16.2.47', '1.2.840.113549.1.9.16.2.15'].map(oidHex).sort(),
    );
    expect(attrOids).not.toContain(oidHex('1.2.840.113549.1.9.5'));
    // The signed bytes are the attributes as a DER SET (tag 0x31), as RFC 5652 requires.
    const asSet = Uint8Array.from(attrsNode.bytes);
    asSet[0] = 0x31;
    expect(asSet).toEqual(prepared.signedAttributes);
    expect(await verifyRawSignature(doctorCert, prepared.signedAttributes, signature)).toBe(true);
    const forged = signature.slice();
    forged[10] ^= 0xff;
    expect(await verifyRawSignature(doctorCert, prepared.signedAttributes, forged)).toBe(false);
  });

  it('points signingCertificateV2 at the signer certificate and the policy at AD-RB v1.1', async () => {
    const { prepared } = await signedPdf();
    const attrs = prepared.signedAttributes;
    const hex = Buffer.from(attrs).toString('hex');
    expect(hex).toContain(Buffer.from(await sha256(doctorCert)).toString('hex'));
    expect(hex).toContain(Buffer.from(DER.oid(AD_RB_V1_1)).toString('hex'));
    expect(hex).toContain(Buffer.from(new Uint8Array(32).fill(7)).toString('hex'));
  });

  it('writes DocMDP P=2 without /Perms, the signing time in /M and the health OIDs', async () => {
    const { signed, original } = await signedPdf();
    const update = text(signed.subarray(original.length));
    expect(update).toContain('/SubFilter /ETSI.CAdES.detached');
    expect(update).toContain('/TransformMethod /DocMDP /TransformParams << /Type /TransformParams /P 2 /V /1.2 >>');
    expect(update).not.toContain('/Perms');
    expect(update).toContain("/M (D:20261104153000+00'00')");
    expect(update).toContain('/AcroForm << /Fields [7 0 R] /SigFlags 3 >>');
    expect(update).toContain('/Annots [7 0 R]');
    expect(update).toContain(`/${HEALTH_OIDS.crm} (00000)`);
    expect(update).toContain(`/${HEALTH_OIDS.crmUf} (PR)`);
    expect(update).toContain(`/${HEALTH_OIDS.documentType.prescricao} ()`);
    expect(update).toContain('/Producer (Cortex sintetico)'); // old Info entries kept
    expect(update).toMatch(/trailer\n<< \/Size 9 \/Root 1 0 R \/Info 8 0 R \/ID \[<AB12> <AB12>\] \/Prev \d+ >>/);
  });

  it('keeps the first signature valid when another incremental update is appended later', async () => {
    const { prepared, signed } = await signedPdf();
    const later = new Uint8Array([...signed, ...Buffer.from('\n% assinatura de farmacêutico viria aqui\n', 'latin1')]);
    expect(await sha256(signedContent(later, prepared.byteRange))).toEqual(prepared.messageDigest);
  });

  it('refuses what this version cannot sign safely', async () => {
    const { signed } = await signedPdf();
    await expect(preparePades(signed, options)).rejects.toThrow('já tem formulário ou assinatura');
    await expect(preparePades(minimalPdf(), { ...options, policy: { oid: AD_RB_V1_1, hash: new Uint8Array(0) } })).rejects.toThrow('política');
    const xrefStream = Uint8Array.from('%PDF-1.7\n1 0 obj\n<< /Type /XRef >>\nendobj\nstartxref\n9\n%%EOF\n', (c) => c.charCodeAt(0));
    await expect(preparePades(xrefStream, options)).rejects.toThrow('xref stream');
    const prepared = await preparePades(minimalPdf(), { ...options, contentsSize: 64 });
    expect(() => finalizePades(prepared, new Uint8Array(256))).toThrow('não cabe');
  });
});

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

describe.skipIf(!hasOpenssl)('external check with OpenSSL (cms -verify)', () => {
  it('accepts the CMS over the signed byte range and rejects a changed PDF', async () => {
    const { prepared, signed } = await signedPdf();
    const dir = mkdtempSync(join(tmpdir(), 'pades-'));
    try {
      writeFileSync(join(dir, 'sig.der'), cmsFrom(signed, prepared.contentsStart, prepared.contentsEnd));
      writeFileSync(join(dir, 'content.bin'), signedContent(signed, prepared.byteRange));
      const verify = (content: string) =>
        spawnSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', join(dir, 'sig.der'), '-binary', '-content', join(dir, content), '-noverify', '-out', join(dir, 'out.bin')], { encoding: 'utf8' });
      const ok = verify('content.bin');
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stderr).toContain('Verification successful');
      const changed = signedContent(signed, prepared.byteRange);
      changed[200] ^= 0x01;
      writeFileSync(join(dir, 'changed.bin'), changed);
      expect(verify('changed.bin').status).not.toBe(0);
      const printed = execFileSync('openssl', ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', join(dir, 'sig.der')], { encoding: 'utf8' });
      expect(printed).toContain('id-smime-aa-signingCertificateV2');
      expect(printed).toContain('id-smime-aa-ets-sigPolicyId');
      expect(printed).toContain('2.16.76.1.7.1.11.1.1');
      expect(printed).not.toContain('signingTime');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
