#!/usr/bin/env node
// Encrypted staging for REAL PersonalMed batches (patient data).
//
// - AES-256-GCM per file, streamed. Layout: "PMS1" | 12-byte IV | ciphertext | 16-byte tag.
// - The key comes only from the PM_STAGING_KEY environment variable (64 hex chars).
//   This module never writes or prints the key.
// - Refuses to write inside the repository.
// - manifest.json stays in plain text and holds only aggregates: counts per
//   entity/status/doctor, issue codes, SHA-256 of each plaintext file.
//
// Generate a key (store it in a password manager, never in the repo):
//   node scripts/personalmed/secure-staging.mjs --new-key

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSFORM_VERSION } from './transforms.mjs';

const MAGIC = Buffer.from('PMS1');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function keyFromEnv(env = process.env) {
  const hex = (env.PM_STAGING_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('PM_STAGING_KEY ausente ou inválida: use 64 caracteres hexadecimais (gere com --new-key).');
  return Buffer.from(hex, 'hex');
}

/** True when `dir` is the repository or inside it. */
export function isInsideRepo(dir, root = REPO_ROOT) {
  const rel = relative(root, resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !/^[a-zA-Z]:/.test(rel));
}

export function encryptBuffer(plain, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([MAGIC, iv, c.update(plain), c.final(), c.getAuthTag()]);
}

export function decryptBuffer(data, key) {
  if (data.length < 32 || !data.subarray(0, 4).equals(MAGIC)) throw new Error('Arquivo não é um staging cifrado (PMS1).');
  const iv = data.subarray(4, 16);
  const tag = data.subarray(data.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data.subarray(16, data.length - 16)), d.final()]); // throws if tampered or wrong key
}

/** Read one encrypted NDJSON file back into envelopes (for the loader). */
export function readEncryptedNdjson(file, key) {
  return decryptBuffer(readFileSync(file), key)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Streaming writer: one encrypted NDJSON per entity + plain-text aggregate manifest. */
export class SecureBatchWriter {
  constructor(dir, key, { allowInsideRepo = false } = {}) {
    if (!allowInsideRepo && isInsideRepo(dir)) throw new Error('Staging real não pode ser gravado dentro do repositório.');
    this.dir = dir;
    this.key = key;
    this.files = new Map();
    this.counts = {};
    this.issues = {};
    mkdirSync(dir, { recursive: true });
  }

  #file(entity) {
    if (!this.files.has(entity)) {
      const name = `${entity}.ndjson.enc`;
      const fd = openSync(join(this.dir, name), 'w');
      const iv = randomBytes(12);
      writeSync(fd, Buffer.concat([MAGIC, iv]));
      this.files.set(entity, { name, fd, cipher: createCipheriv('aes-256-gcm', this.key, iv), hash: createHash('sha256'), lines: 0 });
    }
    return this.files.get(entity);
  }

  add(e) {
    const f = this.#file(e.sourceEntity);
    const line = Buffer.from(`${JSON.stringify(e)}\n`, 'utf8');
    f.hash.update(line);
    writeSync(f.fd, f.cipher.update(line));
    f.lines += 1;
    const c = (this.counts[e.sourceEntity] ??= { total: 0, byStatus: {}, byDoctor: {} });
    c.total += 1;
    c.byStatus[e.mappingStatus] = (c.byStatus[e.mappingStatus] ?? 0) + 1;
    if (e.sourceDoctorId) c.byDoctor[e.sourceDoctorId] = (c.byDoctor[e.sourceDoctorId] ?? 0) + 1;
    for (const i of e.issues) this.issues[`${e.sourceEntity}.${i}`] = (this.issues[`${e.sourceEntity}.${i}`] ?? 0) + 1;
  }

  close(meta = {}) {
    const files = {};
    for (const [entity, f] of [...this.files.entries()].sort()) {
      writeSync(f.fd, Buffer.concat([f.cipher.final(), f.cipher.getAuthTag()]));
      closeSync(f.fd);
      files[f.name] = { entity, lines: f.lines, plaintextSha256: f.hash.digest('hex') };
    }
    const manifest = { ...meta, transformVersion: TRANSFORM_VERSION, encrypted: 'aes-256-gcm/PMS1', files, counts: this.counts, issues: Object.fromEntries(Object.entries(this.issues).sort()) };
    writeFileSync(join(this.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--new-key')) {
  console.log(randomBytes(32).toString('hex'));
}
