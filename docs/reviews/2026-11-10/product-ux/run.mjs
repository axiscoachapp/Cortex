// Run from the repository root. No hosted service or credential is used.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const root = 'docs/reviews/2026-11-10/product-ux';
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const hashes = () => Object.fromEntries([...walk('src'), 'tailwind.config.ts', 'vite.config.ts', 'scripts/app-audit-browser.mjs'].sort().map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const before = hashes(), mode = process.argv[2] || 'main';
const configurations = mode === 'whole' ? [{ name: 'whole-app-final', env: { AUDIT_CLINIC_ADMIN: '1', AUDIT_VIEWPORTS: 'desktop,celular' }, routes: null }] : [
  { name: 'main-final', env: { AUDIT_WORKSPACE_ROLE: 'admin', AUDIT_WORKSPACE_INTERACTIONS: '1', AUDIT_COMPACT: '1', AUDIT_SHORT: '1' }, routes: '/,/recepcao,/financeiro,/recepcao/financeiro' },
  { name: 'doctor-final', env: { AUDIT_WORKSPACE_ROLE: 'doctor', AUDIT_WORKSPACE_INTERACTIONS: '1', AUDIT_VIEWPORTS: 'largo,celular' }, routes: '/' },
  { name: 'reception-final', env: { AUDIT_WORKSPACE_ROLE: 'reception', AUDIT_WORKSPACE_INTERACTIONS: '1', AUDIT_VIEWPORTS: 'largo,celular' }, routes: '/,/recepcao,/recepcao/financeiro' },
];
const runs = [];
for (const config of configurations) {
  const directory = `${root}/${config.name}`;
  const result = spawnSync(process.execPath, ['scripts/app-audit-browser.mjs', ...(config.routes ? ['--only', config.routes] : [])], {
    env: { ...process.env, ...config.env, CORTEX_BROWSER_ARTIFACTS: directory }, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, windowsHide: true, timeout: 360000,
  });
  if (result.status !== 0) throw new Error(`${config.name}: ${result.error?.message || result.stderr.slice(-2500)}`);
  const report = JSON.parse(readFileSync(`${directory}/audit.json`, 'utf8'));
  const findings = Object.entries(report.routes).filter(([, value]) => value.missing || value.overflowX > 0 || Object.entries(value).some(([key, entry]) => key !== 'dialog' && Array.isArray(entry) && entry.length));
  const run = { name: config.name, states: Object.keys(report.routes).length, findings, unknown: report.unansweredCalls, privateReads: report.receptionPrivateReads || [] };
  runs.push(run);
  console.log(JSON.stringify(run));
  if (findings.length || Object.keys(run.unknown).length || run.privateReads.length) throw new Error(`Unresolved audit findings in ${config.name}`);
}
const after = hashes();
const stable = JSON.stringify(before) === JSON.stringify(after);
writeFileSync(`${root}/${mode}-summary.json`, JSON.stringify({ stable, runs, hashes: before }, null, 2) + '\n');
if (!stable) throw new Error('Source changed during the browser run');
