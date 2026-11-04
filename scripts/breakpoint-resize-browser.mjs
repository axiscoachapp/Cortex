// Real-browser resize check of the phone breakpoint (768 x INTERFACE_SCALE,
// fractional at 135%), with the synthetic loopback fixtures only. Codex review
// of 04/11 11:48: crossing 1035 -> 1036 -> 1280 used to leave the app in phone
// mode. Prints a JSON report; exits 1 on any failure.
//
//   node scripts/breakpoint-resize-browser.mjs
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { resolve } from 'node:path';
import { startClinicFixture } from './fixtures/clinic-review-api.mjs';
import { startReceptionFixture, ids } from './fixtures/reception-api.mjs';
import { MOBILE_BREAKPOINT } from '../src/lib/interfaceScale.ts';

async function startApp(apiOrigin) {
  const probe = http.createServer();
  await new Promise((ready) => probe.listen(0, '127.0.0.1', ready));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: apiOrigin, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/auth')).ok) return { origin, app }; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  app.kill();
  throw new Error('Synthetic app failed to start');
}

const report = { synthetic: true, breakpoint: MOBILE_BREAKPOINT, checks: [], pageErrors: [] };
const stops = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  async function signIn(origin, email, next) {
    const context = await browser.newContext({ viewport: { width: 1035, height: 900 } });
    await context.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    const page = await context.newPage();
    page.on('pageerror', (e) => report.pageErrors.push(e.message));
    await page.goto(origin + '/auth?next=' + encodeURIComponent(next));
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/^senha$/i).fill('synthetic-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL((u) => u.pathname !== '/auth');
    return page;
  }

  // 1. Agenda: the calendar box height follows useIsMobile; the doctor's view choice survives resizes.
  const clinic = await startClinicFixture();
  const doctorApp = await startApp(clinic.origin);
  stops.push(() => doctorApp.app.kill(), () => clinic.close());
  const doctor = await signIn(doctorApp.origin, 'review@example.invalid', '/');
  await doctor.goto(doctorApp.origin + '/agenda');
  await doctor.waitForSelector('.rbc-calendar');
  const phoneMode = () => doctor.evaluate(() => {
    // The box around the calendar: 100dvh-based height on phones, 100vh otherwise
    // (Chrome serializes calc() in its own order, so only the unit is compared).
    const box = document.querySelector('.rbc-calendar')?.parentElement;
    if (!box?.style.height) throw new Error('calendar box not found');
    return box.style.height.includes('dvh');
  });
  const seen = [];
  for (const width of [1035, 1036, 1280, 1036, 390, 1280]) {
    await doctor.setViewportSize({ width, height: 900 });
    await doctor.waitForTimeout(150);
    const phone = await phoneMode();
    seen.push({ width, phone });
    if (phone !== width < MOBILE_BREAKPOINT) throw new Error(`Agenda in ${phone ? 'phone' : 'desktop'} mode at ${width}px`);
  }
  report.checks.push({ agendaModes: seen });
  const views = doctor.getByRole('group', { name: 'Visualização da agenda' });
  await doctor.setViewportSize({ width: 1035, height: 900 });
  await views.getByRole('button', { name: 'Mês', exact: true }).click();
  await doctor.setViewportSize({ width: 1280, height: 900 });
  await doctor.waitForTimeout(150);
  await expect(views.getByRole('button', { name: 'Mês', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(doctor.locator('.rbc-month-view')).toBeVisible();
  report.checks.push('month chosen at 1035px stays chosen after widening to 1280px');

  // 2. Reception queue: on the phone layout, selecting a case scrolls it into view.
  const reception = await startReceptionFixture();
  const receptionApp = await startApp(reception.origin);
  stops.push(() => receptionApp.app.kill(), () => reception.close());
  const staff = await signIn(receptionApp.origin, 'recepcao-a@example.invalid', '/recepcao');
  for (const [width, shouldScroll] of [[1036, true], [1280, false]]) {
    await staff.setViewportSize({ width, height: 700 });
    await staff.goto(receptionApp.origin + '/recepcao');
    await staff.waitForLoadState('networkidle');
    await staff.evaluate(() => window.scrollTo(0, 0));
    await staff.goto(receptionApp.origin + '/recepcao?case=' + ids.case);
    await expect(staff.getByRole('button', { name: 'Assumir atendimento' })).toBeVisible();
    await staff.waitForTimeout(400);
    const top = await staff.getByRole('button', { name: 'Assumir atendimento' }).evaluate((el) => {
      let p = el; while (p && !p.matches('[tabindex="-1"], section, article')) p = p.parentElement;
      const scroller = [...document.querySelectorAll('*')].find((n) => n.scrollTop > 0);
      return { scrolled: window.scrollY > 0 || !!scroller, workspaceTop: Math.round((p ?? el).getBoundingClientRect().top) };
    });
    report.checks.push({ receptionQueue: { width, ...top } });
    if (shouldScroll && !top.scrolled && top.workspaceTop > 700) throw new Error(`Case not brought into view at ${width}px`);
  }
} catch (error) {
  report.failure = String(error?.message ?? error).split('\n')[0];
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const stop of stops) await stop();
}
if (report.pageErrors.length) process.exitCode = 1;
console.log(JSON.stringify(report, null, 2));
