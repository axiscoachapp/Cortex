import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startReceptionFixture } from './fixtures/reception-api.mjs';

const api = await startReceptionFixture();
const probe = http.createServer();
await new Promise(ready => probe.listen(0, '127.0.0.1', ready));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve(process.env.CORTEX_CONTINUITY_ARTIFACTS || 'docs/reviews/2026-11-04/clinical-continuity/browser');
await mkdir(artifacts, { recursive: true });
const app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_SUPABASE_URL: api.origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', browser, page;
app.stdout.on('data', data => { logs = (logs + data).slice(-6000); });
app.stderr.on('data', data => { logs = (logs + data).slice(-6000); });
const checks = [], errors = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(origin + '/scripts/fixtures/clinic-access.html')).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  if (!ready) throw new Error(logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/scripts/fixtures/clinic-access.html');
  await page.getByRole('button', { name: 'Entrar no ensaio' }).click();
  await expect(page.getByRole('heading', { name: 'Consulta sintética' })).toBeVisible();
  const draft = page.getByRole('textbox', { name: 'Rascunho clínico' });
  const warning = page.getByRole('status', { name: 'Estado da conexão com a clínica' });
  await draft.fill('Rascunho sintético permanece na mesma árvore.');
  api.setClinicAccessFailure({ status: 503, code: 'PGRST002' });
  await page.getByRole('button', { name: 'Conferir acesso' }).click();
  await expect(warning).toContainText('atendimento permanece aberto');
  await expect(draft).toHaveValue('Rascunho sintético permanece na mesma árvore.');
  checks.push('verified same-page clinical workspace and draft remain visible on pool/database outage');
  for (const width of [390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('button', { name: 'Verificar acesso novamente' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Conferir acesso' })).toBeInViewport();
    const captureBox = await page.getByLabel('Captura sintética').boundingBox();
    const warningBox = await warning.boundingBox();
    if (!captureBox || !warningBox || captureBox.y + captureBox.height > warningBox.y + 2) throw new Error('Recording strip covers continuity warning at ' + width);
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, font: getComputedStyle(document.documentElement).fontSize }));
    if (layout.scroll > layout.width + 2 || layout.font !== '24px') throw new Error('Continuity overflow/scale at ' + width);
    await page.screenshot({ path: resolve(artifacts, `continued-${width}.png`), animations: 'disabled' });
  }
  checks.push('live capture strip does not cover warning, draft or footer at 150% in 390/768/1280/1920 px');
  api.setClinicAccessFailure(null);
  await page.getByRole('button', { name: 'Verificar acesso novamente' }).click();
  await expect(warning).toHaveCount(0);
  await expect(draft).toHaveValue('Rascunho sintético permanece na mesma árvore.');
  // Browser offline events must not silently pause the role query with old success.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Conferir acesso' }).click();
  await expect(warning).toContainText('atendimento permanece aberto');
  await expect(draft).toBeVisible();
  await context.setOffline(false);
  await expect(warning).toHaveCount(0);
  checks.push('real browser offline triggers classified failure and recovery instead of paused stale success');
  await page.getByRole('button', { name: 'Abrir documento' }).click();
  const documentDialog = page.getByRole('dialog', { name: 'Documento sintético' });
  await expect(documentDialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Texto do documento' }).fill('Conteúdo sintético do documento preservado.');
  api.setClinicAccessFailure({ status: 403, code: '42501', message: 'Synthetic authoritative denial' });
  // Focus causes the real gate's refetch without interacting with background UI under a modal.
  await page.getByRole('textbox', { name: 'Texto do documento' }).focus();
  // The normal 15-second role poll runs while the real modal remains open.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
  await expect(documentDialog).not.toBeVisible();
  await expect(page.getByLabel('Captura sintética')).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'Tentar novamente' });
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(retry).toBeFocused();
  await page.screenshot({ path: resolve(artifacts, 'blocked-dialog.png'), animations: 'disabled' });
  api.setClinicAccessFailure({ status: 503, code: 'PGRST002' });
  await retry.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(documentDialog).not.toBeVisible();
  api.setClinicAccessFailure(null);
  await retry.press('Enter');
  await expect(documentDialog).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Texto do documento' })).toHaveValue('Conteúdo sintético do documento preservado.');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(draft).toHaveValue('Rascunho sintético permanece na mesma árvore.');
  checks.push('authoritative denial conceals Radix dialog and capture portal; keyboard recovery survives later transport and preserves document draft');
  if (errors.length || api.metrics.clinicalReads.length || api.metrics.externalCalls.length || api.metrics.unknown.length) throw new Error('Unexpected reads/calls/errors');
  const report = { checks, errors, metrics: api.metrics, browser: 'isolated headless Edge/Chromium', data: 'synthetic loopback only' };
  await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'failure.txt'), await page.locator('body').innerText());
  }
  throw error;
} finally {
  if (browser) await browser.close();
  app.kill();
  await api.close();
}
