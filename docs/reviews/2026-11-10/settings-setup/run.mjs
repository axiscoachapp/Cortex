// Execute from the repo root. Every browser request uses synthetic fixtures.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = 'docs/reviews/2026-11-10/settings-setup';
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const hashes = () => Object.fromEntries([...walk('src'), 'tailwind.config.ts', 'vite.config.ts', 'scripts/app-audit-browser.mjs'].sort().map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const mode = process.argv[2] || 'settings', before = hashes();
const sections = ['', 'perfil', 'implantacao', 'whatsapp', 'pre-consulta', 'conexoes', 'equipe', 'permissoes', 'usuarios', 'seguranca', 'sobre'].map(section => '/configuracoes' + (section ? '?secao=' + section : '')).join(',');
const configurations = mode === 'whole' ? [
  { name: 'whole-app', env: { AUDIT_CLINIC_ADMIN: '1', AUDIT_WORKSPACE_ROLE: 'admin', AUDIT_VIEWPORTS: 'desktop,celular' }, routes: null },
] : mode === 'final' ? [
  { name: 'final-core', env: { AUDIT_CLINIC_ADMIN: '1', AUDIT_WORKSPACE_ROLE: 'admin', AUDIT_COMPACT: '1', AUDIT_SHORT: '1' }, routes: '/,/gerenciar-pacientes,/?patient=d5110000-0000-4000-8000-0000000000a1,/recepcao/agenda,/financeiro,/configuracoes,/configuracoes?secao=perfil,/configuracoes?secao=implantacao' },
  { name: 'final-reception', env: { AUDIT_WORKSPACE_ROLE: 'reception', AUDIT_VIEWPORTS: 'largo,celular' }, routes: '/configuracoes,/configuracoes?secao=implantacao,/configuracoes?secao=perfil' },
] : [
  { name: 'settings-admin', env: { AUDIT_CLINIC_ADMIN: '1', AUDIT_WORKSPACE_ROLE: 'admin', AUDIT_COMPACT: '1', AUDIT_SHORT: '1' }, routes: sections },
  { name: 'settings-doctor', env: { AUDIT_WORKSPACE_ROLE: 'doctor', AUDIT_VIEWPORTS: 'largo,celular' }, routes: '/configuracoes,/configuracoes?secao=perfil,/configuracoes?secao=implantacao,/configuracoes?secao=equipe,/configuracoes?secao=seguranca' },
  { name: 'settings-reception', env: { AUDIT_WORKSPACE_ROLE: 'reception', AUDIT_VIEWPORTS: 'largo,celular' }, routes: '/configuracoes,/configuracoes?secao=perfil,/configuracoes?secao=implantacao,/configuracoes?secao=whatsapp,/configuracoes?secao=conexoes,/configuracoes?secao=equipe,/configuracoes?secao=seguranca' },
];
mkdirSync(root, { recursive: true });
const runs = [];
for (const config of configurations) {
  const directory = `${root}/${config.name}`;
  const result = spawnSync(process.execPath, ['scripts/app-audit-browser.mjs', ...(config.routes ? ['--only', config.routes] : [])], {
    env: { ...process.env, ...config.env, AUDIT_SETTINGS_LEGACY_COPILOT: '1', AUDIT_MANAGED_SETTINGS: '1', CORTEX_BROWSER_ARTIFACTS: directory }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 420000,
  });
  if (result.status !== 0) throw new Error(`${config.name}: ${result.error?.message || result.stderr.slice(-2500)}`);
  const report = JSON.parse(readFileSync(`${directory}/audit.json`, 'utf8'));
  const findings = Object.entries(report.routes).filter(([, value]) => value.missing || value.overflowX > 0 || Object.values(value).some(entry => Array.isArray(entry) && entry.length));
  const run = { name: config.name, states: Object.keys(report.routes).length, findings, unknown: report.unansweredCalls, privateReads: report.receptionPrivateReads };
  runs.push(run); console.log(JSON.stringify(run));
  if (findings.length || Object.keys(run.unknown).length || run.privateReads.length) throw new Error(`Unresolved audit findings in ${config.name}`);
}
const stable = JSON.stringify(before) === JSON.stringify(hashes());
writeFileSync(`${root}/${mode}-summary.json`, JSON.stringify({ stable, runs, hashes: before }, null, 2) + '\n');
if (!stable) throw new Error('Source changed during the audit');
