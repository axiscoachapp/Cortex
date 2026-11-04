// Integer-neighbour browser regression. Fractional widths are reproduced by
// Index.test.tsx: Chromium rounds an iframe's layout viewport to whole pixels.
// Isolated browser, own loopback API, synthetic data; no external requests.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { startClinicFixture, patientId } from './fixtures/clinic-review-api.mjs';
import { DESKTOP_BREAKPOINT, INTERFACE_SCALE } from '../src/lib/interfaceScale.ts';

const probeSideEffects = process.argv.includes('--probe-side-effects');
assert.ok(process.argv.slice(2).every(arg => arg === '--probe-side-effects') && process.argv.length <= 3, 'No external target accepted');
const artifacts = resolve('docs/reviews/2026-11-04/desktop-breakpoint');
mkdirSync(artifacts, { recursive: true });
const report = { syntheticOnly: true, breakpoint: DESKTOP_BREAKPOINT, checks: [], failures: [], pageErrors: [],
  probeSideEffects, forbiddenRequests: [], requestsDuringResize: 0,
  notCovered: ['real browser zoom at a fractional layout width; covered by component simulation', 'timers beyond the observed resizes and 600ms settle window'],
  sources: ['src/pages/Index.tsx', 'src/pages/Index.test.tsx', 'src/index.css', 'scripts/desktop-breakpoint-browser.mjs',
    'scripts/fixtures/clinic-review-api.mjs'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })) };
const baseline = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
assert.equal(baseline.status, 0); report.sourceBaseline = baseline.stdout.trim();
let api, app, browser, stage = 'startup', observeResize = false;
try {
  api = await startClinicFixture();
  const probe = http.createServer();
  await new Promise(ready => probe.listen(0, '127.0.0.1', ready));
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { env: { ...process.env, VITE_SUPABASE_URL: api.origin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' }, stdio: 'ignore', windowsHide: true });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/auth')).ok) { ready = true; break; } } catch { /* app starting */ }
    await new Promise(done => setTimeout(done, 300));
  }
  assert.ok(ready, 'Synthetic app did not start');
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: DESKTOP_BREAKPOINT - 1, height: 900 } });
  const readRpcs = new Set(['workspace_directory', 'list_patient_chat_turns', 'clinic_access', 'get_integration_status']);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (observeResize) {
      report.requestsDuringResize++;
      const readRpc = url.origin === api.origin && method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/') && readRpcs.has(url.pathname.split('/').at(-1));
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (url.pathname.startsWith('/functions/v1/') || (write && !readRpc &&
        (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/') || ![origin, api.origin].includes(url.origin)))) {
        report.forbiddenRequests.push({ method, path: url.pathname });
      }
    }
    return [origin, api.origin].includes(url.origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  stage = 'synthetic sign-in';
  await page.goto(origin + '/auth?next=' + encodeURIComponent('/?patient=' + patientId));
  await page.getByLabel(/e-?mail/i).fill('review@example.invalid');
  await page.getByLabel(/^senha$/i).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('patient') === patientId);
  await expect(page.getByRole('heading', { name: 'Paciente Exemplo A', exact: true }).first()).toBeVisible();
  const question = page.getByLabel('Pergunta ao assistente clínico');
  await question.fill('Rascunho sintético preservado');
  const originalChat = await page.getByLabel('Conversa clínica deste paciente').elementHandle();
  stage = 'select profile tab';
  await page.getByRole('button', { name: 'Perfil', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForLoadState('networkidle');
  observeResize = true;
  for (const width of [1727, 1728, 1920, 1727, 1280, 1728, 1727]) {
    stage = 'index resize ' + width;
    await page.setViewportSize({ width, height: 900 });
    const dashboard = page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite)/, includeHidden: true });
    await expect.poll(() => dashboard.count()).toBe(width < DESKTOP_BREAKPOINT ? 1 : 0);
    assert.ok(await originalChat.evaluate(node => node.isConnected), 'Consultation unmounted');
    assert.equal(await question.inputValue(), 'Rascunho sintético preservado');
    await expect(page.getByRole('button', { name: 'Perfil', exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page');
    assert.equal(new URL(page.url()).searchParams.get('patient'), patientId);
    report.checks.push(`layout, draft, patient, chosen tab and mounted consultation at ${width}px`);
    if (!probeSideEffects && width === 1920) await page.screenshot({ path: resolve(artifacts, 'index-desktop.png') });
  }
  // networkidle may already be true: explicitly keep observing callbacks that
  // have not started a request yet, then wait for any resulting traffic.
  await page.waitForTimeout(600); await page.waitForLoadState('networkidle'); observeResize = false;
  const scale = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  assert.ok(Math.abs(scale - 16 * INTERFACE_SCALE) < 0.01);
  report.checks.push('135% interface scale unchanged');
  await page.getByRole('button', { name: 'Consulta', exact: true }).click(); await question.fill('');
  await page.goto(origin + '/agenda'); await page.waitForSelector('.rbc-calendar');
  await page.waitForLoadState('networkidle'); observeResize = true;
  for (const width of [1727, 1728, 1920, 1280]) {
    stage = 'agenda resize ' + width;
    await page.setViewportSize({ width, height: 900 });
    if (probeSideEffects && width === 1280) {
      // A delayed attempt from the last resize must be observed even though
      // this unknown-to-the-counters endpoint returns 503 in the local fixture.
      await page.evaluate(apiOrigin => {
        setTimeout(() => { void fetch(apiOrigin + '/functions/v1/live-copilot', { method: 'POST', body: '{}' }).catch(() => {}); }, 50);
      }, api.origin);
    }
    const layout = await page.evaluate(() => {
      const shell = document.querySelector('.clinic-subpage-shell');
      const nav = document.querySelector('nav[aria-label="Navegação principal"]');
      return { height: shell.getBoundingClientRect().height, navHeight: nav.getBoundingClientRect().height,
        navVisible: getComputedStyle(nav).display !== 'none', viewport: window.innerHeight };
    });
    if (width < DESKTOP_BREAKPOINT) assert.ok(layout.navVisible && Math.abs(layout.height + layout.navHeight - layout.viewport) < 2, 'Calendar must reserve bottom navigation');
    else assert.ok(!layout.navVisible);
    report.checks.push(`calendar shell and navigation at ${width}px`);
    if (!probeSideEffects && width === 1727) await page.screenshot({ path: resolve(artifacts, 'agenda-compact.png') });
  }
  await page.waitForTimeout(600); await page.waitForLoadState('networkidle'); observeResize = false;
  if (probeSideEffects) assert.ok(report.forbiddenRequests.some(request => request.path === '/functions/v1/live-copilot'), 'Delayed probe escaped request observer');
  assert.deepEqual(report.forbiddenRequests, [], 'Resize attempted an AI call or a relevant write');
  assert.ok(api.metrics.patientWrites === 0 && api.metrics.appointmentWrites === 0 && api.metrics.briefings === 0 && api.metrics.checklists === 0 && api.metrics.chat === 0);
  report.checks.push('resizing does not write patient/appointment or invoke AI'); report.metrics = api.metrics;
} catch (error) { report.failureStage = stage; report.failures.push(String(error.message ?? error).slice(0, 1500)); }
finally { await browser?.close(); app?.kill(); await api?.close(); }
if (report.failures.length || report.pageErrors.length) process.exitCode = 1;
writeFileSync(resolve(artifacts, probeSideEffects ? 'PROBE.json' : 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
