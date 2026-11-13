// A staging key that never sits in clear text on disk or in a command line:
// 32 random bytes wrapped with Windows DPAPI (CurrentUser) beside the staging.
// Only the same Windows user on the same computer can unwrap it.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isInsideRepo } from './secure-staging.mjs';

const dpapi = (verb, b64) =>
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::${verb}([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`], { encoding: 'utf8' }).trim();

/** The key of a staging folder (created on first use). Refuses a folder inside the repository. */
export function loadOrCreateKey(dir) {
  if (isInsideRepo(dir)) throw new Error('A pasta do staging não pode ficar dentro do repositório.');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'key.dpapi.b64');
  if (existsSync(file)) return Buffer.from(dpapi('Unprotect', readFileSync(file, 'utf8').trim()), 'base64');
  const key = randomBytes(32);
  writeFileSync(file, dpapi('Protect', key.toString('base64')));
  return key;
}
