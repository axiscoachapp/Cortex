import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, rmdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real runner fault injection, before it creates a DB/container/network. The
// child modifies only its own fs binding, writes a partial owned helper, then
// throws ENOSPC. No disk exhaustion, application env, credentials or real data.
assert.equal(process.argv.length, 2, 'No target/arguments accepted');
const source = readFileSync('scripts/test-reception-delegation-decisions.mjs', 'utf8');
const fixed = 'moduleFiles.push(local); writeFileSync(local, sources.get(path));';
const broken = 'writeFileSync(local, sources.get(path)); moduleFiles.push(local);';
assert.equal(source.split(fixed).length, 2, 'Missing exact partial-write cleanup point');
const directory = mkdtempSync(join(tmpdir(), 'cortex-lab-cleanup-')), owned = [], checks = [];
const put = (name, text) => { const path = join(directory, name); owned.push(path); writeFileSync(path, text); return path; };
try {
  for (const variant of ['broken', 'fixed']) {
    const marker = join(directory, variant + '.marker'); owned.push(marker);
    const preload = put(variant + '-preload.mjs', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { basename, dirname } from 'node:path';
      const original=fs.writeFileSync;
      fs.writeFileSync=(path,data,...rest)=>{
        if(typeof path==='string' && basename(path)==='test-function-boundaries.mjs' && basename(dirname(path)).startsWith('cortex-delegation-')){
          original(path,String(data).slice(0,12));
          original(${JSON.stringify(marker)},dirname(path));
          const error=new Error('SYNTHETIC_HELPER_ENOSPC');error.code='ENOSPC';throw error;
        }
        return original(path,data,...rest);
      };
      syncBuiltinESMExports();
    `);
    const entry = put(variant + '-runner.mjs', variant === 'broken' ? source.replace(fixed, broken) : source);
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, entry, '--red'],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
    assert.equal(run.status, 1, run.error?.message || run.stderr);
    assert.match(run.stderr, /SYNTHETIC_HELPER_ENOSPC/);
    assert.ok(existsSync(marker), 'Fault did not reach the actual helper write');
    const moduleDirectory = readFileSync(marker, 'utf8');
    // Marker derives from our fault only. Never recursively remove a path.
    assert.equal(join(tmpdir(), moduleDirectory.split(/[\\/]/).at(-1)), moduleDirectory);
    assert.ok(moduleDirectory.split(/[\\/]/).at(-1).startsWith('cortex-delegation-'));
    assert.equal(existsSync(moduleDirectory), variant === 'broken');
    if (variant === 'broken') {
      assert.deepEqual(readdirSync(moduleDirectory), ['test-function-boundaries.mjs']);
      unlinkSync(join(moduleDirectory, 'test-function-boundaries.mjs')); rmdirSync(moduleDirectory);
    }
    checks.push(variant === 'broken' ? 'RED: post-write tracking leaks the partially created helper' : 'GREEN: planned path is removed after actual partial-write ENOSPC');
  }
} finally {
  for (const path of owned) { if (existsSync(path)) unlinkSync(path); }
  rmdirSync(directory);
}
const report = { syntheticOnly: true, actualRunnerSha256: createHash('sha256').update(source).digest('hex'),
  checks, cleanupVerified: true, databaseCreated: false };
mkdirSync('docs/reviews/2026-11-04/delegation-decisions', { recursive: true });
writeFileSync('docs/reviews/2026-11-04/delegation-decisions/cleanup.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
