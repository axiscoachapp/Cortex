// Real layout regression; isolated browser and synthetic loopback fixture only.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { startClinicFixture, uid, patientId } from './fixtures/clinic-review-api.mjs';
import { INTERFACE_SCALE } from '../src/lib/interfaceScale.ts';

const red = process.argv.includes('--red');
const probeSideEffects = process.argv.includes('--probe-side-effects');
const t38 = process.argv.includes('--t38');
assert.ok(process.argv.slice(2).every(arg => ['--red', '--probe-side-effects', '--t38'].includes(arg)) && process.argv.length <= 3, 'No external target accepted');
const artifacts = resolve(t38 ? 'docs/reviews/2026-11-05/calendar-week-mobile/header-regression' : 'docs/reviews/2026-11-04/calendar-header');
mkdirSync(artifacts, { recursive: true });
const baseline = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
assert.equal(baseline.status, 0);
const report = { syntheticOnly: true, red, probeSideEffects, sourceBaseline: baseline.stdout.trim(), checks: [], layouts: [], pageErrors: [], forbiddenRequests: [],
  sources: ['src/index.css', 'src/pages/Calendar.tsx', 'src/components/CalendarWeekDetails.tsx', 'scripts/calendar-header-browser.mjs', 'scripts/fixtures/clinic-review-api.mjs']
    .map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })) };
let api, app, browser, failure;
try {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const fixtureDate = new Date(day + 'T12:00:00Z'); fixtureDate.setUTCDate(fixtureDate.getUTCDate() + 35);
  const fixtureDay = fixtureDate.toISOString().slice(0, 10);
  api = await startClinicFixture({ appointments: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: uid, patient_id: patientId,
    title: 'Reserva sintética', start_time: fixtureDay + 'T12:00:00Z', end_time: fixtureDay + 'T12:30:00Z', status: 'agendado', type: 'primeira', revision: 1 }] });
  const probe = http.createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + probe.address().port; await new Promise(done => probe.close(done));
  app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', new URL(origin).port, '--strictPort'],
    { env: { ...process.env, VITE_SUPABASE_URL: api.origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' }, stdio: 'ignore', windowsHide: true });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/auth')).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(done => setTimeout(done, 300));
  }
  assert.ok(ready, 'Synthetic app not ready');
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1727, height: 1000 }, timezoneId: 'America/Sao_Paulo' });
  const reads = new Set(['clinic_access', 'get_integration_status']);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const readRpc = url.origin === api.origin && method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/') && reads.has(url.pathname.split('/').at(-1));
    const syntheticSignIn = url.origin === api.origin && method === 'POST' && url.pathname === '/auth/v1/token';
    if (url.pathname.startsWith('/functions/v1/') || (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !readRpc && !syntheticSignIn))
      report.forbiddenRequests.push({ method, path: url.pathname });
    return [origin, api.origin].includes(url.origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(origin + '/auth?next=' + encodeURIComponent('/agenda'));
  await page.getByLabel(/e-?mail/i).fill('review@example.invalid'); await page.getByLabel(/^senha$/i).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForSelector('.rbc-time-header-content .rbc-header');
  await page.evaluate(() => document.fonts.ready); await page.waitForLoadState('networkidle');
  const views = page.getByRole('group', { name: 'Visualização da agenda' });
  await expect(views.getByRole('button', { name: 'Semana', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const measure = selector => page.locator(selector).evaluateAll(headers => headers.map(header => {
    const visible = [...header.querySelectorAll('[aria-hidden="true"]')];
    const ranges = (visible.length ? visible : [header]).map(node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); });
    const text = { top: Math.min(...ranges.map(box => box.top)), bottom: Math.max(...ranges.map(box => box.bottom)) };
    const box = header.getBoundingClientRect(), style = getComputedStyle(header);
    return { label: header.textContent, height: box.height, clientHeight: header.clientHeight, scrollHeight: header.scrollHeight,
      fontSize: style.fontSize, lineHeight: style.lineHeight, padding: style.padding, overflow: style.overflow,
      top: text.top - box.top, bottom: text.bottom - box.top,
      clipped: text.top < box.top + header.clientTop - 0.5 || text.bottom > box.top + header.clientTop + header.clientHeight + 0.5 };
  }));
  const layout = await measure('.rbc-time-header-content .rbc-header');
  report.layouts.push({ width: 1727, view: 'week', headers: layout });
  if (!probeSideEffects) await page.screenshot({ path: resolve(artifacts, red ? 'before-1727.png' : 'after-1727.png') });
  assert.equal(layout.length, 7); assert.ok(layout.every(header => !header.clipped), 'Calendar date text is vertically clipped');
  assert.ok(Math.abs(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)) - 16 * INTERFACE_SCALE) < 0.01);
  report.checks.push('seven week labels fit their clipping boxes and scale remains 135%');
  const initialPeriod = await page.locator('.rbc-toolbar-label').textContent();
  for (let i = 0; i < 5; i++) await page.locator('.rbc-toolbar').getByRole('button', { name: 'Próximo', exact: true }).click();
  const period = await page.locator('.rbc-toolbar-label').textContent();
  assert.notEqual(period, initialPeriod, 'Noncurrent week control missing');
  const eventTime = await page.locator('.rbc-event-label').first().textContent();
  assert.ok(eventTime.includes('09:00') && eventTime.includes('09:30'), 'Synthetic time control missing');
  for (const width of [390, 768, 1035, 1036, 1280, 1727, 1728, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const headers = await measure('.rbc-time-header-content .rbc-header');
    report.layouts.push({ width, view: 'week', headers });
    assert.equal(headers.length, 7); assert.ok(headers.every(header => !header.clipped), 'Week labels clipped at ' + width);
    await expect(views.getByRole('button', { name: 'Semana', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await page.locator('.rbc-toolbar-label').textContent(), period);
    assert.equal(await page.locator('.rbc-event-label').first().textContent(), eventTime);
    assert.ok(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    report.checks.push(`week labels fit vertically; week, period and 09:00–09:30 event retained at ${width}px`);
    if (width === 390 && !probeSideEffects) await page.screenshot({ path: resolve(artifacts, 'after-390.png') });
  }
  await page.setViewportSize({ width: 1727, height: 1000 });
  await page.locator('.rbc-time-header-content .rbc-header button').first().focus();
  await page.keyboard.press('Enter');
  await expect(views.getByRole('button', { name: 'Dia', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const sunday = new Date(fixtureDate); sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
  const expectedDay = format(sunday, 'cccc MMM dd', { locale: ptBR });
  for (const width of [390, 1920, 1727]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.rbc-toolbar-label')).toHaveText(expectedDay);
    await expect(views.getByRole('button', { name: 'Dia', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  report.checks.push('keyboard drilldown selects the expected noncurrent Sunday and retains it through three day resizes');
  await views.getByRole('button', { name: 'Mês', exact: true }).click();
  const month = await page.locator('.rbc-toolbar-label').textContent();
  for (const width of [1920, 1280, 768, 390, 1727]) {
    await page.setViewportSize({ width, height: 1000 });
    const headers = await measure('.rbc-month-header .rbc-header');
    report.layouts.push({ width, view: 'month', headers });
    assert.equal(headers.length, 7); assert.ok(headers.every(header => !header.clipped), 'Month labels clipped at ' + width);
    await expect(views.getByRole('button', { name: 'Mês', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await page.locator('.rbc-toolbar-label').textContent(), month);
  }
  report.checks.push('month labels fit and chosen month/period survive five resizes');
  await views.getByRole('button', { name: 'Dia', exact: true }).click();
  await expect(page.locator('.rbc-toolbar-label')).toHaveText(expectedDay);
  report.checks.push('the exact selected Sunday survives month resizes and return to day');
  await views.getByRole('button', { name: 'Semana', exact: true }).click();
  assert.equal(await page.locator('.rbc-toolbar-label').textContent(), period);
  assert.equal(await page.locator('.rbc-event-label').first().textContent(), eventTime);
  report.checks.push('return from month restores the same week and event time');
  if (probeSideEffects) await page.evaluate(apiOrigin => {
    setTimeout(() => { void fetch(apiOrigin + '/functions/v1/calendar-header-probe', { method: 'POST', body: '{}' }).catch(() => {}); }, 50);
  }, api.origin);
  await page.waitForTimeout(600); await page.waitForLoadState('networkidle');
  report.fixtureMetrics = { ...api.metrics };
  assert.ok(Object.values(report.fixtureMetrics).every(count => count === 0), 'Calendar triggered a synthetic data/AI mutation');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.forbiddenRequests, []);
} catch (error) { failure = error; report.failure = String(error.message ?? error).slice(0, 1200); }
finally { await browser?.close(); app?.kill(); await api?.close(); }
writeFileSync(resolve(artifacts, red ? 'RED.json' : probeSideEffects ? 'PROBE.json' : 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
