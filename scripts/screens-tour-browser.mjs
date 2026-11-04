// Layout tour of every screen with synthetic loopback APIs (no hosted project,
// no real data, no credentials). For each screen and width it saves a
// screenshot and measures what breaks a layout: horizontal page scroll,
// controls outside the viewport or dialog, and text cut inside buttons.
//
//   node scripts/screens-tour-browser.mjs [outDir] [--widths 390,768,1280,1536]
//
// Default outDir: docs/reviews/2026-11-04/screens-tour/. Reuses the fixtures
// of clinic-review-browser.mjs (doctor) and reception-browser.mjs (staff).
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startClinicFixture, patientId } from './fixtures/clinic-review-api.mjs';
import { startReceptionFixture } from './fixtures/reception-api.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outDir = resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) ?? 'docs/reviews/2026-11-04/screens-tour');
const widths = (opt('--widths') ?? '390,768,1280,1536').split(',').map(Number);
await mkdir(outDir, { recursive: true });

async function freePort() {
  const probe = http.createServer();
  await new Promise((ready) => probe.listen(0, '127.0.0.1', ready));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  return port;
}

async function startApp(apiOrigin) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: apiOrigin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  app.stdout.on('data', (d) => { logs = (logs + d).slice(-4000); });
  app.stderr.on('data', (d) => { logs = (logs + d).slice(-4000); });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/auth')).ok) return { origin, app }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  app.kill();
  throw new Error('Synthetic app failed to start: ' + logs);
}

/** What is broken on the current page (empty when the layout holds). */
async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const issues = [];
    const overflow = document.documentElement.scrollWidth - vw;
    if (overflow > 1) issues.push(`page scrolls sideways by ${overflow}px`);
    const dialog = document.querySelector('[role="dialog"]');
    const scope = dialog ?? document.body;
    const box = dialog ? dialog.getBoundingClientRect() : { left: 0, right: vw };
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    for (const el of scope.querySelectorAll('button, a, input, select, textarea, [role="tab"], h1, h2, h3, label')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden') continue;
      // Ignore what sits inside a horizontally scrollable strip on purpose.
      let p = el.parentElement, scroller = false;
      while (p && p !== scope) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) { scroller = true; break; } p = p.parentElement; }
      if (scroller) continue;
      if (r.left < box.left - 1 || r.right > box.right + 1) issues.push(`outside the ${dialog ? 'dialog' : 'screen'}: ${el.tagName.toLowerCase()} "${label(el)}"`);
      else if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && style.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && style.overflowX !== 'visible')
        issues.push(`text cut: ${el.tagName.toLowerCase()} "${label(el)}"`);
    }
    return [...new Set(issues)].slice(0, 25);
  });
}

const report = { synthetic: true, fontSize: null, widths, screens: [], pageErrors: [] };
let browser;
const stops = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });

  async function signIn(origin, email, next = '/') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    page.on('pageerror', (e) => report.pageErrors.push(e.message));
    page.on('dialog', (d) => d.dismiss());
    await page.goto(origin + '/auth?next=' + encodeURIComponent(next));
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/^senha$/i).fill('synthetic-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL((u) => u.pathname !== '/auth');
    return page;
  }

  async function capture(page, name, width, open) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    try {
      await open(page);
      await page.waitForTimeout(400);
      const issues = await measure(page);
      const file = `${name}-${width}.png`;
      await page.screenshot({ path: resolve(outDir, file), fullPage: !(await page.locator('[role="dialog"]').count()) });
      report.screens.push({ name, width, file, issues });
    } catch (error) {
      report.screens.push({ name, width, file: null, issues: [`could not open: ${String(error.message).split('\n')[0]}`] });
    }
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Doctor screens.
  const clinic = await startClinicFixture();
  const doctorApp = await startApp(clinic.origin);
  stops.push(() => doctorApp.app.kill(), () => clinic.close());
  const go = (path) => async (page) => { await page.goto(doctorApp.origin + path); await page.waitForLoadState('networkidle'); };
  const then = (path, action) => async (page) => { await go(path)(page); await action(page); };
  // A logged-out page first.
  {
    const context = await browser.newContext();
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    for (const w of widths) await capture(page, 'login', w, go('/auth'));
    await context.close();
  }
  const doctor = await signIn(doctorApp.origin, 'review@example.invalid');
  report.fontSize = await doctor.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const doctorScreens = [
    ['home', go('/')],
    ['chart', go('/?patient=' + patientId)],
    ['document-composer', then('/?patient=' + patientId, (p) => p.getByRole('button', { name: /Receita \/ atestado/ }).first().click())],
    ['settings', then('/', (p) => p.getByRole('button', { name: 'Configurações' }).first().click())],
    ['patients', go('/gerenciar-pacientes')],
    ['new-patient', then('/gerenciar-pacientes', async (p) => { await p.getByRole('button', { name: 'Novo Paciente' }).click(); await expect(p.getByRole('dialog')).toBeVisible(); })],
    ['calendar', go('/agenda')],
    ['templates', go('/modelos')],
    ['knowledge', go('/conhecimento')],
    ['assistant', go('/assistente')],
    ['sharing', go('/compartilhamento')],
    ['workspace', go('/trabalho')],
    ['security', go('/seguranca')],
    ['privacy', go('/privacidade')],
    ['about', go('/sobre')],
  ];
  for (const [name, open] of doctorScreens) for (const w of widths) await capture(doctor, name, w, open);

  // Reception screens (staff and administrator).
  const reception = await startReceptionFixture();
  const receptionApp = await startApp(reception.origin);
  stops.push(() => receptionApp.app.kill(), () => reception.close());
  const rgo = (path) => async (page) => { await page.goto(receptionApp.origin + path); await page.waitForLoadState('networkidle'); };
  const staff = await signIn(receptionApp.origin, 'recepcao-a@example.invalid', '/recepcao');
  for (const [name, open] of [['reception-queue', rgo('/recepcao')], ['reception-calendar', rgo('/recepcao/agenda')], ['reception-contacts', rgo('/recepcao/contatos')]])
    for (const w of widths) await capture(staff, name, w, open);
  const admin = await signIn(receptionApp.origin, 'admin@example.invalid', '/recepcao/equipe');
  for (const w of widths) await capture(admin, 'reception-team', w, rgo('/recepcao/equipe'));
} finally {
  await browser?.close();
  for (const stop of stops) await stop();
}

report.broken = report.screens.filter((s) => s.issues.length).map((s) => `${s.name}@${s.width}: ${s.issues.join(' | ')}`);
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ fontSize: report.fontSize, screens: report.screens.length, broken: report.broken.length, pageErrors: report.pageErrors.length }, null, 2));
