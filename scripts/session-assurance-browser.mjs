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
const artifacts = resolve(process.env.CORTEX_MFA_ARTIFACTS || 'docs/reviews/2026-11-04/session-recovery/browser');
await mkdir(artifacts, { recursive: true });
const app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_SUPABASE_URL: api.origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', browser, page;
app.stdout.on('data', data => { logs = (logs + data).slice(-6000); });
app.stderr.on('data', data => { logs = (logs + data).slice(-6000); });
const checks = [], errors = [], logouts = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(origin + '/scripts/fixtures/session-assurance.html')).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  if (!ready) throw new Error(logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/auth/v1/logout') logouts.push('synthetic logout'); });
  await page.goto(origin + '/scripts/fixtures/session-assurance.html');
  await page.getByRole('button', { name: 'Entrar no ensaio' }).click();
  const draft = page.getByRole('textbox', { name: 'Rascunho clínico' });
  await draft.fill('Rascunho sintético preservado.');
  await page.getByRole('button', { name: 'Abrir documento' }).click();
  const doc = page.getByRole('dialog', { name: 'Documento sintético' });
  const text = page.getByRole('textbox', { name: 'Texto do documento' });
  await text.fill('Texto sintético permanece editável.');
  await page.evaluate(async () => { window.syntheticAssurance.set({ mode: 'error' }); await window.syntheticAssurance.recheck(); });
  const recovery = page.getByRole('alertdialog', { name: 'Segurança da sessão' });
  await expect(recovery).toBeVisible();
  await expect(doc).not.toBeVisible();
  await expect(page.getByLabel('Captura sintética')).toHaveCount(0);
  const retry = recovery.getByRole('button', { name: 'Tentar novamente' });
  await retry.focus();
  await page.keyboard.press('Tab');
  await expect(recovery.getByRole('button', { name: 'Sair', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(retry).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(recovery).toBeVisible();
  await retry.click();
  await expect(recovery).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await recovery.getByRole('button', { name: 'Sair', exact: true }).click();
  if (logouts.length) throw new Error('Canceled draft exit logged out');
  await page.screenshot({ path: resolve(artifacts, 'error-recovery.png'), animations: 'disabled' });
  checks.push('open document concealed; error recovery owns ARIA, pointer and Tab loop; Escape cannot dismiss and canceled unsaved exit does not log out');

  await page.evaluate(() => window.syntheticAssurance.set({ mode: 'factor', factorFailure: true }));
  await retry.press('Enter');
  const factor = page.getByRole('alertdialog', { name: 'Verifique seu acesso' });
  await expect(factor).toBeVisible();
  await page.evaluate(() => window.syntheticAssurance.set({ factorFailure: false }));
  await factor.getByRole('button', { name: 'Carregar autenticadores novamente' }).click();
  const code = factor.getByLabel('Código de 6 dígitos');
  await code.fill('123456');
  await page.evaluate(() => window.syntheticAssurance.set({ invalidCode: true }));
  await factor.getByRole('button', { name: 'Verificar código' }).click();
  await expect(factor.getByRole('alert')).toContainText('Código incorreto ou expirado');
  await expect(doc).not.toBeVisible();
  for (const width of [390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const escaped = await factor.evaluate(element => {
      const box = element.getBoundingClientRect();
      return [...element.querySelectorAll('button,input,a')].filter(control => {
        const rect = control.getBoundingClientRect();
        return rect.width && (rect.left < box.left - 1 || rect.right > box.right + 1);
      }).length;
    });
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, font: getComputedStyle(document.documentElement).fontSize }));
    if (escaped || layout.scroll > layout.width + 2 || layout.font !== '24px') throw new Error('MFA recovery layout/scale failure at ' + width);
    await page.screenshot({ path: resolve(artifacts, `factor-${width}.png`), animations: 'disabled' });
  }
  checks.push('inline factor-list retry and rejected code remain recoverable; controls fit at 150% in 390/768/1280/1920 px');
  await page.evaluate(() => window.syntheticAssurance.set({ invalidCode: false }));
  await factor.getByRole('button', { name: 'Verificar código' }).click();
  await expect(doc).toBeVisible();
  await expect(text).toHaveValue('Texto sintético permanece editável.');
  await expect(text).toBeFocused();
  await page.keyboard.type(' Continuação sintética.');
  await expect(text).toHaveValue('Texto sintético permanece editável. Continuação sintética.');
  checks.push('successful inline MFA restores the same document draft and its keyboard focus without remounting');

  api.setClinicAccessFailure({ status: 403, code: '42501', message: 'Synthetic clinic denial' });
  await page.evaluate(() => window.syntheticAssurance.clinicRecheck());
  const clinic = page.getByRole('alertdialog', { name: 'Verificação de acesso' });
  await expect(clinic).toBeVisible();
  await page.evaluate(async () => { window.syntheticAssurance.set({ mode: 'error' }); await window.syntheticAssurance.recheck(); });
  await expect(recovery).toBeVisible();
  await expect(clinic).not.toBeVisible();
  await page.evaluate(() => window.syntheticAssurance.set({ mode: 'allowed' }));
  await recovery.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(clinic).toBeVisible();
  await expect(doc).not.toBeVisible();
  api.setClinicAccessFailure(null);
  await clinic.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(doc).toBeVisible();
  await expect(text).toHaveValue('Texto sintético permanece editável. Continuação sintética.');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(draft).toHaveValue('Rascunho sintético preservado.');
  await expect(page.getByLabel('Captura sintética')).toBeVisible();
  checks.push('outer MFA recovery takes precedence over clinic recovery; each gate must recover before document/capture reappear');
  if (errors.length || api.metrics.clinicalReads.length || api.metrics.externalCalls.length || api.metrics.unknown.length) throw new Error('Unexpected reads/calls/errors');
  const report = { checks, errors, metrics: api.metrics, assurance: await page.evaluate(() => window.syntheticAssurance.metrics()), browser: 'isolated headless Edge/Chromium', data: 'synthetic loopback; assurance provider responses replaced in browser fixture; no real OTP, microphone or clinical document generation' };
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
