// Isolated browser and loopback synthetic API. SQL tests prove authorization.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';
import { INTERFACE_SCALE } from '../src/lib/interfaceScale.ts';

const slot = (hour) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return { start_time: date.toISOString(), end_time: new Date(date.getTime() + 30 * 60000).toISOString() };
};
const appointments = [true, false].map((crm, index) => ({
  id: `a1000000-0000-4000-8000-00000000000${index + 1}`, user_id: uid, patient_id: patientId,
  title: crm ? 'Reserva CRM sintética' : 'Reserva clínica sintética', ...slot(index + 10),
  status: 'agendado', type: 'retorno', notes: null, revision: 1,
  clinic_id: crm ? 'a2000000-0000-4000-8000-000000000001' : null,
  google_sync_status: 'idle', reminder_sent: false,
}));
const api = await startClinicFixture({ appointments });
const probe = http.createServer();
await new Promise((ready) => probe.listen(0, '127.0.0.1', ready));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve('docs/reviews/2026-11-03/appointment-identity/browser');
await mkdir(artifacts, { recursive: true });
const app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_SUPABASE_URL: api.origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let logs = '';
for (const stream of [app.stdout, app.stderr]) stream.on('data', (chunk) => { logs = (logs + chunk).slice(-6000); });
let browser;
const errors = [], checks = [];
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/auth')).ok) { ready = true; break; } } catch {}
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error(logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(origin + '/auth?next=%2Fagenda');
  await page.getByLabel(/e-?mail/i).fill('review@example.invalid');
  await page.getByLabel(/^senha$/i).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  await page.getByRole('group', { name: 'Visualização da agenda' }).getByRole('button', { name: 'Mês', exact: true }).click();
  for (const width of [390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByText('Reserva CRM sintética', { exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: 'Paciente' })).toBeDisabled();
    await expect(dialog.getByText(/Para trocar o paciente, cancele este agendamento/)).toBeVisible();
    if (await page.evaluate(() => getComputedStyle(document.documentElement).fontSize) !== `${16 * INTERFACE_SCALE}px`) throw new Error(`Expected ${INTERFACE_SCALE * 100}% default scale`);
    const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    await page.screenshot({ path: resolve(artifacts, `crm-${width}.png`), fullPage: true });
    if (overflow) {
      const oversized = await dialog.evaluate((element) => [...element.querySelectorAll('*')]
        .filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right)
        .slice(0, 10).map((child) => ({ tag: child.tagName, className: child.className, width: child.getBoundingClientRect().width })));
      throw new Error('Dialog overflow at ' + width + ': ' + JSON.stringify(oversized));
    }
    await page.keyboard.press('Escape');
    checks.push('CRM patient fixed, explanatory copy and ' + INTERFACE_SCALE * 100 + '% layout at ' + width);
  }
  await page.getByText('Reserva CRM sintética', { exact: true }).first().click();
  await page.getByLabel('Observações').fill('Edição sintética preservando beneficiário');
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  if (appointments[0].patient_id !== patientId || appointments[0].revision !== 2 || appointments[0].notes !== 'Edição sintética preservando beneficiário') throw new Error('Original patient edit was not preserved');
  checks.push('saving clinical notes keeps the original CRM patient and uses the current revision');
  await page.getByText('Reserva CRM sintética', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  if (appointments[0].status !== 'cancelado' || appointments[0].patient_id !== patientId) throw new Error('Cancellation changed historical beneficiary');
  checks.push('cancellation keeps historical beneficiary');
  await page.getByText('Reserva clínica sintética', { exact: true }).first().click();
  await expect(page.getByRole('combobox', { name: 'Paciente' })).toBeEnabled();
  await expect(page.getByText(/Para trocar o paciente, cancele este agendamento/)).not.toBeVisible();
  checks.push('clinical-only appointment keeps its existing patient selector');
  if (errors.length) throw new Error(errors.join('; '));
  const report = { checks, errors, metrics: api.metrics, data: 'synthetic only', browser: 'isolated Chromium/Edge' };
  await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  app.kill();
  await api.close();
}
