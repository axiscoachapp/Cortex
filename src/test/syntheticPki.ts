// Synthetic PKI for D17 tests: keys and certificates generated in memory for
// each run, never saved. Nothing here is an ICP-Brasil artifact.
import { DER, tlv } from '../../supabase/functions/_shared/pades';

export const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' } as const;

const name = (cn: string) => DER.seq(DER.setOf(DER.seq(DER.oid('2.5.4.3'), DER.utf8(cn))));

export async function syntheticCertificate(subject: string, issuer: string, key: CryptoKeyPair, issuerKey: CryptoKey, serial: number) {
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
  return DER.seq(tbs, algorithm, tlv(0x03, Uint8Array.of(0), signature));
}

const big = (b64url: string) => BigInt('0x' + Buffer.from(b64url, 'base64url').toString('hex'));
function modPow(base: bigint, exp: bigint, mod: bigint) {
  let result = 1n;
  for (base %= mod; exp > 0n; exp >>= 1n, base = (base * base) % mod) if (exp & 1n) result = (result * base) % mod;
  return result;
}

/** PKCS#1 v1.5 signature of an already computed SHA-256 hash (what a PSC does for RAW). */
export function rawRsaSign(jwk: JsonWebKey, hash: Uint8Array): Uint8Array {
  const n = big(jwk.n!);
  const k = (n.toString(16).length + 1) >> 1;
  const digestInfo = Buffer.concat([Buffer.from('3031300d060960864801650304020105000420', 'hex'), Buffer.from(hash)]);
  const em = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(k - digestInfo.length - 3, 0xff), Buffer.from([0]), digestInfo]);
  const s = modPow(BigInt('0x' + em.toString('hex')), big(jwk.d!), n);
  return Uint8Array.from(Buffer.from(s.toString(16).padStart(k * 2, '0'), 'hex'));
}

/** Minimal classic-xref PDF with one page and an Info dictionary. */
export function minimalPdf(label = 'Receita teste'): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${label}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Producer (Cortex sintetico) >>',
  ];
  let body = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R /ID [<CD34> <CD34>] >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Uint8Array.from(body, (c) => c.charCodeAt(0));
}
