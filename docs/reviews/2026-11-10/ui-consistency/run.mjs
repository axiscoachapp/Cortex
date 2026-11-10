// Local browser QA. All data and every backend response are synthetic.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = 'docs/reviews/2026-11-10/ui-consistency';
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const hashes = () => Object.fromEntries([...walk('src'), 'tailwind.config.ts', 'vite.config.ts', 'scripts/app-audit-browser.mjs'].sort().map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const mode = process.argv[2] || 'whole';
const before = hashes();
const core = '/,/gerenciar-pacientes,/agenda,/modelos,/conhecimento,/assistente,/compartilhamento,/seguranca,/privacidade,/configuracoes,/configuracoes?secao=perfil,/configuracoes?secao=implantacao,/configuracoes?secao=equipe,/configuracoes?secao=permissoes,/recepcao,/recepcao/agenda,/recepcao/contatos,/recepcao/painel,/recepcao/pre-consultas,/financeiro';
const configurations = mode === 'whole' ? [
  { name: 'whole-app', env: { AUDIT_WORKSPACE_ROLE: 'admin', AUDIT_VIEWPORTS: 'largo,celular' }, routes: null },
] : mode === 'compact' ? [
  { name: 'compact-core', env: { AUDIT_WORKSPACE_ROLE: 'admin', AUDIT_VIEWPORTS: 'desktop,compacto', AUDIT_COMPACT: '1', AUDIT_SHORT: '1' }, routes: core },
] : mode === 'roles' ? [
  { name: 'doctor', env: { AUDIT_WORKSPACE_ROLE: 'doctor', AUDIT_VIEWPORTS: 'largo,celular', AUDIT_SHORT: '1' }, routes: '/,/agenda,/financeiro,/configuracoes,/configuracoes?secao=perfil,/configuracoes?secao=implantacao,/configuracoes?secao=equipe,/seguranca' },
  { name: 'reception', env: { AUDIT_WORKSPACE_ROLE: 'reception', AUDIT_VIEWPORTS: 'largo,celular', AUDIT_SHORT: '1' }, routes: '/recepcao,/recepcao/agenda,/recepcao/contatos,/recepcao/painel,/recepcao/pre-consultas,/recepcao/financeiro,/configuracoes,/configuracoes?secao=perfil,/configuracoes?secao=implantacao,/configuracoes?secao=equipe,/seguranca' },
] : (() => { throw new Error('Unknown mode'); })();
mkdirSync(root, { recursive: true });
const runs = [];
for (const config of configurations) {
  const directory = `${root}/${config.name}`;
  const result = spawnSync(process.execPath, ['scripts/app-audit-browser.mjs', ...(config.routes ? ['--only', config.routes] : [])], {
    env: { ...process.env, ...config.env, AUDIT_MANAGED_SETTINGS: '1', AUDIT_UI_CONSISTENCY: '1', AUDIT_SETTINGS_LEGACY_COPILOT: '1', CORTEX_BROWSER_ARTIFACTS: directory },
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 600000,
  });
  if (result.status !== 0) throw new Error(`${config.name}: ${result.error?.message || result.stderr.slice(-3500)}`);
  const report = JSON.parse(readFileSync(`${directory}/audit.json`, 'utf8'));
  const findings = Object.entries(report.routes).filter(([, value]) => value.missing || value.overflowX > 0 || Object.values(value).some(entry => Array.isArray(entry) && entry.length));
  const run = { name: config.name, states: Object.keys(report.routes).length, findings, unknown: report.unansweredCalls, privateReads: report.receptionPrivateReads };
  runs.push(run);
  console.log(JSON.stringify(run));
  if (findings.length || Object.keys(run.unknown).length || run.privateReads.length) throw new Error(`Unresolved findings in ${config.name}`);
}
const stable = JSON.stringify(before) === JSON.stringify(hashes());
writeFileSync(`${root}/${mode}-summary.json`, JSON.stringify({ stable, runs, hashes: before }, null, 2) + '\n');
if (!stable) throw new Error('Source changed during audit');
