// UI conflict handling against a mocked transport, not PostgreSQL authorization
// evidence. Uses only an isolated browser and the local synthetic fixture.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { startReceptionFixture } from './fixtures/reception-api.mjs';

assert.equal(process.argv.length, 2, 'No target or arguments accepted');
const artifacts = resolve('docs/reviews/2026-11-04/legacy-array-guard/browser');
mkdirSync(artifacts, { recursive: true });
const report = { syntheticOnly: true, transportOnly: true, saveAttempts: 0, checks: [], pageErrors: [] };
let api, app, browser, failure;
try {
  api = await startReceptionFixture();
  const probe = http.createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${probe.address().port}`; await new Promise(done => probe.close(done));
  app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', new URL(origin).port, '--strictPort'],
    { env: { ...process.env, VITE_SUPABASE_URL: api.origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' }, stdio: 'ignore', windowsHide: true });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/auth')).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(done => setTimeout(done, 300));
  }
  assert.ok(ready);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === api.origin && url.pathname === '/rest/v1/rpc/update_reception_staff' && request.method() === 'POST') {
      report.saveAttempts++;
      return route.fulfill({ status: 409, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info' },
        body: JSON.stringify({ code: '40001', message: 'Approved delegation requires explicit withdrawal', details: null, hint: null }) });
    }
    return [origin, api.origin].includes(url.origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(origin + '/auth?next=' + encodeURIComponent('/recepcao/equipe'));
  await page.getByLabel(/e-?mail/i).fill('admin@example.invalid'); await page.getByLabel(/^senha$/i).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipe e permissões' })).toBeVisible();
  await page.getByLabel('Nome da secretária', { exact: true }).fill('Rascunho sintético');
  const staff = page.locator('article').first();
  await staff.getByRole('checkbox', { name: 'Dr. Bruno Exemplo' }).check();
  await staff.getByRole('checkbox', { name: 'Dra. Ana Exemplo' }).uncheck();
  await staff.getByRole('button', { name: 'Salvar permissões' }).click();
  const notice = page.getByRole('alert').filter({ hasText: 'A lista está desatualizada: ela não pode retirar uma delegação aprovada pelo médico.' });
  await expect(notice).toBeVisible();
  await page.waitForTimeout(600); assert.equal(report.saveAttempts, 1);
  report.checks.push('dedicated stale-array message from exact RPC/code/message; one request, no automatic retry');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await notice.scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Nome da secretária', { exact: true })).toHaveValue('Rascunho sintético');
    await expect(staff.getByRole('checkbox', { name: 'Dr. Bruno Exemplo' })).toBeChecked();
    await expect(staff.getByRole('checkbox', { name: 'Dra. Ana Exemplo' })).not.toBeChecked();
    await expect(staff.getByRole('button', { name: 'Desativar acesso' })).toBeEnabled();
    assert.ok(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await page.screenshot({ path: resolve(artifacts, `conflict-${width}.png`) });
    report.checks.push(`visible conflict, preserved drafts/choices, deactivation available and no overflow at ${width}px`);
  }
  assert.equal(report.saveAttempts, 1); assert.deepEqual(report.pageErrors, []);
} catch (error) { failure = error; report.failure = String(error.message ?? error).slice(0, 1500); }
finally { await browser?.close(); app?.kill(); await api?.close(); }
if (failure) process.exitCode = 1;
writeFileSync(resolve(artifacts, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
