// Synthetic data only.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syntheticBatch } from './make-synthetic-batch.mjs';
import { SecureBatchWriter, decryptBuffer, encryptBuffer, isInsideRepo, keyFromEnv, readEncryptedNdjson } from './secure-staging.mjs';

const key = randomBytes(32);

describe('encrypted staging', () => {
  it('round-trips and detects tampering or a wrong key', () => {
    const enc = encryptBuffer(Buffer.from('linha sintética\n'), key);
    expect(enc.subarray(0, 4).toString()).toBe('PMS1');
    expect(decryptBuffer(enc, key).toString()).toBe('linha sintética\n');
    const tampered = Buffer.from(enc);
    tampered[20] ^= 1;
    expect(() => decryptBuffer(tampered, key)).toThrow();
    expect(() => decryptBuffer(enc, randomBytes(32))).toThrow();
  });

  it('reads the key only from PM_STAGING_KEY and rejects bad keys', () => {
    expect(() => keyFromEnv({})).toThrow(/PM_STAGING_KEY/);
    expect(() => keyFromEnv({ PM_STAGING_KEY: 'abc' })).toThrow();
    expect(keyFromEnv({ PM_STAGING_KEY: 'a'.repeat(64) })).toHaveLength(32);
  });

  it('refuses to write real staging inside the repository', () => {
    const repo = resolve(import.meta.dirname, '..', '..');
    expect(isInsideRepo(join(repo, 'staging'))).toBe(true);
    expect(isInsideRepo(tmpdir())).toBe(false);
    expect(() => new SecureBatchWriter(join(repo, 'tmp-staging-test'), key)).toThrow(/repositório/);
  });

  it('writes encrypted NDJSON per entity with a plain aggregate manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-secure-'));
    try {
      const { envelopes } = syntheticBatch();
      const w = new SecureBatchWriter(dir, key);
      for (const e of envelopes) w.add(e);
      const m = w.close({ synthetic: true });
      expect(readdirSync(dir).sort()).toContain('chart.ndjson.enc');
      // Ciphertext does not contain the plaintext.
      expect(readFileSync(join(dir, 'chart.ndjson.enc')).includes(Buffer.from('PACIENTE SINTÉTICA'))).toBe(false);
      const charts = readEncryptedNdjson(join(dir, 'chart.ndjson.enc'), key);
      expect(charts).toHaveLength(m.counts.chart.total);
      const plain = Buffer.from(charts.map((c) => `${JSON.stringify(c)}\n`).join(''));
      expect(createHash('sha256').update(plain).digest('hex')).toBe(m.files['chart.ndjson.enc'].plaintextSha256);
      // The manifest has aggregates only (hashes aside, which are hex digests).
      const { files, ...rest } = m;
      expect(JSON.stringify(rest)).not.toMatch(/SINTÉTICA|\d{11}/);
      expect(Object.values(files).every((f) => /^[0-9a-f]{64}$/.test(f.plaintextSha256))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
