// Which certificate may open a signature session (D17, Codex 05/11 05:09 R2).
// Synthetic keys and certificates generated per run; nothing ICP-Brasil.
import { beforeAll, describe, expect, it } from 'vitest';
import { DER, signerCertificateProblem, tlv } from '../../supabase/functions/_shared/pades';
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
