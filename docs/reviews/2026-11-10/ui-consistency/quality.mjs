import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = 'docs/reviews/2026-11-10/ui-consistency';
const git = spawnSync('git', ['diff', '--name-only', '-z', '--', 'src'], { encoding: 'utf8', windowsHide: true });
if (git.status !== 0) throw new Error('Cannot read changed paths');
const files = [...new Set([...git.stdout.split('\0').filter(path => /\.(ts|tsx)$/.test(path)), 'src/components/PageHeading.tsx', 'src/components/WorkspaceShell.tsx', 'src/components/WorkspaceShell.test.tsx'])];
const checks = [
  { name: 'types-app', args: ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.app.json'] },
  { name: 'types-node', args: ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.node.json'] },
  { name: 'lint', args: ['node_modules/eslint/bin/eslint.js', ...files] },
  { name: 'full-src', args: ['node_modules/vitest/vitest.mjs', 'run', 'src', '--maxWorkers=2', '--reporter=json', `--outputFile=${root}/FULL_SRC.json`] },
  { name: 'build', args: ['node_modules/vite/bin/vite.js', 'build'] },
];
const results = [];
for (const check of checks) {
  const started = Date.now();
  const result = spawnSync(process.execPath, check.args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 1200000, env: { ...process.env, VITE_SUPABASE_URL: 'http://supabase.synthetic.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' } });
  const record = { name: check.name, status: result.status, elapsedMs: Date.now() - started, error: result.error?.message ?? null, ...(result.status !== 0 ? { stderr: result.stderr.slice(-4500), stdout: result.stdout.slice(-4500) } : {}) };
  results.push(record);
  writeFileSync(`${root}/QUALITY.json`, JSON.stringify({ files, results }, null, 2) + '\n');
  console.log(JSON.stringify(record));
  if (result.status !== 0) throw new Error(`Failed ${check.name}`);
}
const tests = JSON.parse(readFileSync(`${root}/FULL_SRC.json`, 'utf8'));
console.log(JSON.stringify({ tests: tests.numPassedTests, files: tests.testResults.length, success: tests.success }));
