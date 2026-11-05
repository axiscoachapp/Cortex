// Real app routes, committed source snapshot, isolated browser and loopback APIs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, mkdtemp, rm, lstat } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import autoprefixer from 'autoprefixer';
import { startClinicFixture } from './fixtures/clinic-review-api.mjs';
import { startReceptionFixture, ids } from './fixtures/reception-api.mjs';

const args = process.argv.slice(2);
assert.ok(args.every(arg => /^--(baseline=[0-9a-f]{40}|overlay=src\/[\w/.-]+|run=[a-z0-9-]+|only=time-dialogs|only=week-caption|only=welcome-dashboard|check-time-layout|check-mobile-navigation|check-calendar-header)$/.test(arg)), 'Unsupported audit option');
const timeOnly = args.includes('--only=time-dialogs'), checkTimeLayout = args.includes('--check-time-layout');
const weekOnly = args.includes('--only=week-caption');
const welcomeOnly = args.includes('--only=welcome-dashboard'), focusedOnly = weekOnly || welcomeOnly;
assert.ok(args.filter(arg => arg.startsWith('--only=')).length <= 1, 'Only one focused audit mode is supported');
assert.ok(!weekOnly || !args.some(arg => arg.startsWith('--check-')), 'Week caption mode runs its own checks');
assert.ok(!welcomeOnly || !args.some(arg => arg.startsWith('--check-')), 'Welcome mode runs its own checks');
const checkMobileNavigation = args.includes('--check-mobile-navigation');
assert.ok(!timeOnly || !checkMobileNavigation, 'Mobile navigation checks require the full route audit');
const checkCalendarHeader = args.includes('--check-calendar-header');
assert.ok(!timeOnly || !checkCalendarHeader, 'Calendar header checks require the full route audit');
const git = options => { const result = spawnSync('git', options, { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const baseline = args.find(arg => arg.startsWith('--baseline='))?.slice(11) || git(['rev-parse', 'HEAD']);
const overlays = args.filter(arg => arg.startsWith('--overlay=')).map(arg => arg.slice(10));
const allowed = /^(src\/pages\/(Calendar|Sharing|AccountSecurity|Auth|DataPrivacy|ClinicalWorkspace)\.tsx|src\/features\/reception\/[\w/.-]+\.(ts|tsx)|src\/components\/(BottomNavigation|MobileSubpageNavigation|WelcomeDashboard)\.tsx|src\/lib\/calendarLabels\.ts)$/;
for (const path of overlays) assert.match(path, allowed, 'Overlay must be in the Codex audit scope');
const run = args.find(arg => arg.startsWith('--run='))?.slice(6) || 'baseline';
const folder = resolve('docs/reviews/2026-11-05/reception-app-audit', run);
await mkdir(dirname(folder), { recursive: true });
await mkdir(folder); // Unique run: a failed rerun must never retain an old clean report.
const paths = git(['ls-tree', '-r', '--name-only', baseline, '--', 'src']).split('\n').filter(path => /\.(tsx?|jsx?|css|json)$/.test(path));
const batch = spawnSync('git', ['cat-file', '--batch'], { input: paths.map(path => baseline + ':' + path).join('\n') + '\n', windowsHide: true, maxBuffer: 40 * 1024 * 1024 });
assert.equal(batch.status, 0);
const sources = new Map(); let offset = 0;
for (const path of paths) {
  const end = batch.stdout.indexOf(10, offset), header = batch.stdout.subarray(offset, end).toString('utf8');
  assert.match(header, /^[0-9a-f]+ blob \d+$/);
  const size = Number(header.split(' ')[2]); offset = end + 1;
  sources.set(path, batch.stdout.subarray(offset, offset + size).toString('utf8')); offset += size + 1;
}
for (const path of overlays) { assert.ok(sources.has(path) || path === 'src/lib/calendarLabels.ts', 'New source is not allowlisted'); sources.set(path, await readFile(path, 'utf8')); }
const overlayHashes = overlays.map(path => ({ path, sha256: createHash('sha256').update(sources.get(path)).digest('hex') }));
const frozen = new Map([...sources].map(([path, source]) => [resolve(path).toLowerCase(), { path, source }]));
const frozenLoads = new Set();
const sourceDigest = createHash('sha256'); for (const [path, source] of sources) sourceDigest.update(path + '\0' + source + '\0');
const configurationPaths = ['vite.config.ts', 'index.html', 'tailwind.config.ts', 'postcss.config.js', 'src/lib/interfaceScale.ts', 'package.json', 'package-lock.json'];
for (const path of configurationPaths) assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n').trim(), git(['show', baseline + ':' + path]), 'Config differs from baseline: ' + path);
assert.equal(git(['ls-tree', '-r', '--name-only', baseline, '--', 'pages', 'components', 'app']), '', 'Additional Tailwind roots need snapshotting');
const tailwindConfiguration = loadConfig(resolve('tailwind.config.ts'));
const tailwindContent = [...sources].filter(([path]) => /\.(tsx?|jsx?)$/.test(path)).map(([path, raw]) => ({ raw, extension: path.split('.').pop() }));
const ownPaths = ['scripts/reception-app-audit-browser.mjs', 'scripts/fixtures/clinic-review-api.mjs', 'scripts/fixtures/reception-api.mjs', ...configurationPaths];
const ownHashes = await Promise.all(ownPaths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
const apps = [], apis = [], contexts = [], errors = [], blocked = [], consoleErrors = [], screens = [], failedRequests = [], errorResponses = [];
const cacheOwner = randomUUID();
let browser, temporaryCache, failure, cleanupVerified = false, navigationKeyboardVerified = false;
async function appFor(api) {
  process.env.VITE_SUPABASE_URL = api.origin; process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key';
  process.env.VITE_BYPASS_EMAIL = ''; process.env.VITE_BYPASS_PASSWORD = '';
  const app = await createServer({ cacheDir: join(temporaryCache, 'app-' + apps.length), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error',
    css: { postcss: { plugins: [tailwindcss({ ...tailwindConfiguration, content: tailwindContent }), autoprefixer()] } },
    plugins: [{ name: 'audit-frozen-source', enforce: 'pre', load(id) { const entry = frozen.get(resolve(id.split('?')[0]).toLowerCase()); if (!entry) return null; frozenLoads.add(entry.path); return entry.source; } }] });
  apps.push(app); await app.listen(); return { origin: `http://127.0.0.1:${app.httpServer.address().port}`, api };
}
async function scene(app, email, next) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  contexts.push(context);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([app.origin, app.api.origin].includes(url.origin)) return route.continue();
    blocked.push({ origin: url.origin, path: url.pathname }); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ path: new URL(page.url()).pathname, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ path: new URL(page.url()).pathname, message: message.text() }); });
  const responseStatuses = new WeakMap();
  page.on('requestfailed', request => failedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, status: responseStatuses.get(request) ?? null, reason: request.failure()?.errorText }));
  page.on('response', response => { responseStatuses.set(response.request(), response.status()); if (response.status() >= 400) errorResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  if (email) {
    await page.goto(app.origin + '/auth?next=' + encodeURIComponent(next));
    await page.getByLabel(/e-?mail/i).fill(email + '@example.invalid');
    await page.getByLabel(/^senha$/i).fill('synthetic-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).not.toHaveURL(/\/auth/);
  }
  return page;
}
async function capture(page, app, role, path, width, action, variant = '') {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(app.origin + path); await page.waitForLoadState('networkidle');
  if (action) { await action(page); await page.waitForLoadState('networkidle'); }
  const file = `${role}-${path.replace(/[^a-z0-9]/gi, '-')}${variant ? '-' + variant : ''}-${width}.png`;
  await page.screenshot({ path: resolve(folder, file), fullPage: true, animations: 'disabled' });
  const measurement = await page.evaluate(() => {
    const visible = element => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('[aria-hidden="true"]'); };
    const name = element => element.getAttribute('aria-label')?.trim() || element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim() || [...(element.labels ?? [])].map(label => label.textContent).join(' ').trim() || element.getAttribute('title')?.trim() || '';
    const missingButtons = [...document.querySelectorAll('button')].filter(visible).filter(element => !name(element) && !element.textContent.trim()).map(element => element.outerHTML.slice(0, 600));
    const missingLabels = [...document.querySelectorAll('input,select,textarea')].filter(visible).filter(element => !['hidden', 'submit', 'button', 'reset'].includes(element.type)).filter(element => !name(element)).map(element => ({ tag: element.tagName, type: element.type, placeholder: element.getAttribute('placeholder'), html: element.outerHTML.slice(0, 600) }));
    const dialogElement = document.querySelector('[role="dialog"],[role="alertdialog"]'), dialog = dialogElement?.getBoundingClientRect();
    const dialogOutsideViewport = dialog ? dialog.left < -1 || dialog.top < -1 || dialog.right > innerWidth + 1 || dialog.bottom > innerHeight + 1 : false;
    const headerTitles = [...document.querySelectorAll('header h1')].filter(visible).map(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const text = range.getBoundingClientRect(), bounds = element.getBoundingClientRect();
      const controls = [...element.closest('header').querySelectorAll('button,a')].filter(visible).map(control => {
        const rect = control.getBoundingClientRect();
        return { name: name(control) || control.textContent.trim(), width: rect.width, height: rect.height,
          overlapsTitle: text.left < rect.right && text.right > rect.left && text.top < rect.bottom && text.bottom > rect.top };
      });
      return { text: element.textContent.trim(), clipped: text.left < bounds.left - 1 || text.right > bounds.right + 1 || text.top < bounds.top - 1 || text.bottom > bounds.bottom + 1, controls };
    });
    const navigationLabels = [...document.querySelectorAll('nav[aria-label="Navegação principal"] > div > a, nav[aria-label="Navegação principal"] > div > button')].filter(visible).map(element => {
      const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (!text) return null;
      const range = document.createRange(); range.selectNode(text);
      const rect = range.getBoundingClientRect(), target = element.getBoundingClientRect();
      return { label: text.textContent.trim(), left: rect.left, right: rect.right, targetLeft: target.left, targetRight: target.right, targetHeight: target.height };
    }).filter(Boolean);
    const periodElement = document.querySelector('.rbc-toolbar-label'), periodBounds = periodElement?.getBoundingClientRect();
    const periodRange = document.createRange();
    if (periodElement) periodRange.selectNodeContents(periodElement);
    const calendarPeriodClipped = periodElement ? [...periodRange.getClientRects()].some(rect => rect.left < periodBounds.left - 1 || rect.right > periodBounds.right + 1 || rect.top < periodBounds.top - 1 || rect.bottom > periodBounds.bottom + 1) : false;
    const greeting = [...document.querySelectorAll('h1')].find(element => element.textContent.trim() === 'Boa tarde'), dateLine = greeting?.nextElementSibling;
    const shortcuts = [...document.querySelectorAll('button')].filter(visible).filter(element => ['Assistente', 'Modelos', 'Conhecimento', 'Pacientes'].includes(element.textContent.trim())).map(element => {
      const label = element.querySelector('span'), bounds = label?.getBoundingClientRect(), target = element.getBoundingClientRect();
      const range = document.createRange(); if (label) range.selectNodeContents(label);
      return { label: element.textContent.trim(), fullWidth: range.getBoundingClientRect().width, availableWidth: bounds?.width, width: target.width, height: target.height,
        clipped: !label || [...range.getClientRects()].some(rect => rect.left < Math.max(bounds.left, target.left) - 1 || rect.right > Math.min(bounds.right, target.right) + 1 || rect.top < Math.max(bounds.top, target.top) - 1 || rect.bottom > Math.min(bounds.bottom, target.bottom) + 1) };
    });
    return { fontSize: getComputedStyle(document.documentElement).fontSize, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialogOutsideViewport, dialogHorizontalOverflow: dialogElement ? dialogElement.scrollWidth - dialogElement.clientWidth : 0,
      missingButtons, missingLabels, navigationLabels, headerTitles, calendarPeriod: periodElement?.textContent.trim(), calendarPeriodClipped, shortcuts,
      welcomeDate: dateLine ? { text: dateLine.textContent.trim(), transform: getComputedStyle(dateLine).textTransform } : null,
      visibleAlerts: [...document.querySelectorAll('[role="alert"]')].filter(visible).map(element => element.textContent.trim()),
      timeControls: [...document.querySelectorAll('input[type="time"]')].filter(visible).map(element => { const rect = element.getBoundingClientRect(); return { id: element.id, value: element.value, width: rect.width, top: rect.top, bottom: rect.bottom }; }),
      brokenText: document.body.innerText.match(/\bundefined\b|\bNaN\b|\[object Object\]/g) ?? [], headings: [...document.querySelectorAll('h1,h2')].filter(visible).map(element => element.textContent.trim()) };
  });
  assert.ok(Math.abs(parseFloat(measurement.fontSize) - 21.6) < 0.1, 'Interface scale changed from 135%');
  const dialogActions = [];
  for (const button of await page.locator('[role="dialog"] button,[role="alertdialog"] button').all()) {
    const name = await button.getAttribute('aria-label') || (await button.textContent()).trim();
    if (name === 'Fechar') continue;
    await button.scrollIntoViewIfNeeded();
    dialogActions.push(await button.evaluate(element => {
      const rect = element.getBoundingClientRect(), dialog = element.closest('[role="dialog"],[role="alertdialog"]'), bounds = dialog.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { name: element.getAttribute('aria-label') || element.textContent.trim(), disabled: element.disabled,
        geometryReachable: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1,
        dialogOnTop: !!hit && dialog.contains(hit), targetOnTop: element.disabled ? null : !!hit && element.contains(hit) };
    }));
  }
  const dialogActionReachable = dialogActions.length ? dialogActions.every(action => action.geometryReachable && action.dialogOnTop && (action.disabled || action.targetOnTop)) : undefined;
  const actionScreenshot = dialogActions.length ? file.replace('.png', '-actions.png') : undefined;
  if (actionScreenshot) await page.screenshot({ path: resolve(folder, actionScreenshot), fullPage: true, animations: 'disabled' });
  screens.push({ role, path, variant, actualPath: new URL(page.url()).pathname, width, dialogActions, dialogActionReachable, recoveryScreen: measurement.headings.includes('Não foi possível exibir esta tela'), ...measurement, screenshot: file, actionScreenshot });
  if (checkCalendarHeader && role === 'clinical' && path === '/agenda' && !variant) {
    assert.equal(measurement.headerTitles.length, 1);
    const [title] = measurement.headerTitles;
    assert.equal(title.text, 'Agenda');
    assert.ok(!title.clipped && title.controls.every(control => !control.overlapsTitle), 'Calendar title must fit without overlapping its controls');
    assert.deepEqual(title.controls.map(control => control.name), ['Voltar', 'Conectar Google Calendar', 'Novo Agendamento']);
    assert.ok(title.controls.every(control => control.width >= 44 && control.height >= 44), 'Calendar header controls need 44px touch targets');
  }
  if (checkMobileNavigation && !variant && role !== 'anonymous') {
    assert.equal(measurement.navigationLabels.length, role === 'staff' ? 4 : 5, 'Expected role-specific navigation labels');
    for (const [index, label] of measurement.navigationLabels.entries()) {
      assert.ok(label.targetHeight >= 44 && label.targetRight - label.targetLeft >= 44 && label.left >= label.targetLeft - 1 && label.right <= label.targetRight + 1, 'Navigation label must fit its touch target of at least 44px');
      if (index) assert.ok(label.left - measurement.navigationLabels[index - 1].right >= (width < 375 ? 4 : 8), 'Mobile navigation labels need at least 8px of separation at 375px and above, or 4px on smaller phones');
    }
  }
  if (checkTimeLayout && ['reschedule-dialog', 'block-time-dialog'].includes(variant)) {
    const [start, end] = measurement.timeControls;
    assert.equal(measurement.timeControls.length, 2);
    assert.ok(width < 864 ? end.top >= start.bottom : Math.abs(start.top - end.top) < 1, 'Time controls need separate full-width rows on mobile and the same row on desktop');
    if (variant === 'reschedule-dialog') assert.deepEqual([start.value, end.value], ['09:00', '09:30'], 'Existing time values changed');
  }
}
try {
  temporaryCache = await mkdtemp(join(tmpdir(), 'cortex-reception-audit-'));
  await writeFile(join(temporaryCache, 'audit-owner'), cacheOwner);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  if (focusedOnly) {
    const api = await startClinicFixture(welcomeOnly ? { lastVisit: '2026-10-01' } : {}); apis.push(api); const app = await appFor(api);
    const doctor = await scene(app, 'review', welcomeOnly ? '/' : '/agenda');
    await doctor.waitForLoadState('networkidle');
    await doctor.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    if (welcomeOnly) {
      for (const width of [320, 375, 1280]) for (const variant of ['overview', 'shortcuts', 'recent-patients']) {
        await capture(doctor, app, 'clinical', '/', width, async page => {
          await expect(page.getByRole('heading', { name: 'Pacientes Recentes', exact: true })).toBeVisible();
          if (variant === 'shortcuts') await page.getByRole('button', { name: 'Conhecimento', exact: true }).scrollIntoViewIfNeeded();
          if (variant === 'recent-patients') await page.getByRole('heading', { name: 'Pacientes Recentes', exact: true }).scrollIntoViewIfNeeded();
        }, variant);
        await expect(doctor.getByText('há 1 mês', { exact: true })).toHaveCount(2);
        assert.deepEqual(screens.at(-1).welcomeDate, { text: 'Quinta-feira, 5 de novembro', transform: 'none' }, 'Welcome date casing mismatch');
        assert.equal(screens.at(-1).shortcuts.length, 4);
        assert.ok(screens.at(-1).shortcuts.every(shortcut => !shortcut.clipped && shortcut.width >= 44 && shortcut.height >= 44), 'Welcome shortcut text must fit its touch target');
      }
      await doctor.getByRole('button', { name: 'Conhecimento', exact: true }).focus(); await doctor.keyboard.press('Enter');
      await expect(doctor).toHaveURL(app.origin + '/conhecimento');
      await doctor.waitForLoadState('networkidle');
      assert.deepEqual(api.metrics, { briefings: 0, checklists: 0, chat: 0, newSources: 0, patientWrites: 0, appointmentWrites: 0 }, 'Welcome audit must not invoke AI or write data');
      navigationKeyboardVerified = true;
    } else {
    for (const width of [320, 375, 1280]) for (const scenario of [
      { view: 'Semana', steps: 0, label: '1–7 de novembro', variant: 'week-same-month' },
      { view: 'Semana', steps: 4, label: '29 de nov. – 5 de dez.', variant: 'week-cross-month' },
      { view: 'Semana', steps: 8, label: '27 de dez. de 2026 – 2 de jan. de 2027', variant: 'week-cross-year' },
      { view: 'Dia', steps: 0, label: 'quinta-feira, 5 de novembro', variant: 'day-localized' },
      { view: 'Dia', steps: 1, label: 'sexta-feira, 6 de novembro', variant: 'day-next' },
      { view: 'Mês', steps: 0, label: 'novembro 2026', variant: 'month-unchanged' },
    ]) {
      await capture(doctor, app, 'clinical', '/agenda', width, async page => {
        await page.getByRole('group', { name: 'Visualização da agenda' }).getByRole('button', { name: scenario.view, exact: true }).click();
        const period = page.locator('.rbc-toolbar-label');
        for (let step = 0; step < scenario.steps; step++) {
          const before = await period.textContent();
          await page.locator('.rbc-toolbar').getByRole('button', { name: 'Próximo', exact: true }).click();
          await expect(period).not.toHaveText(before);
        }
      }, scenario.variant);
      assert.equal(screens.at(-1).calendarPeriod, scenario.label, 'Calendar period caption mismatch');
      assert.equal(screens.at(-1).calendarPeriodClipped, false, 'Calendar period caption clipped');
    }
    }
  } else {
  if (!timeOnly) {
  const doctorApi = await startClinicFixture(); apis.push(doctorApi); const doctorApp = await appFor(doctorApi);
  const anonymous = await scene(doctorApp);
  for (const width of [375, 1280]) await capture(anonymous, doctorApp, 'anonymous', '/auth', width);
  const doctor = await scene(doctorApp, 'review', '/agenda');
  for (const path of ['/agenda', '/compartilhamento', '/trabalho', '/seguranca', '/privacidade', '/permissoes-recepcao'])
    for (const width of [375, 1280]) await capture(doctor, doctorApp, 'clinical', path, width);
  if (checkMobileNavigation || checkCalendarHeader) {
    for (const width of [320, 390, 768]) await capture(doctor, doctorApp, 'clinical', '/agenda', width);
  }
  if (checkMobileNavigation) {
    const nav = doctor.getByRole('navigation', { name: 'Navegação principal' });
    await nav.getByRole('link', { name: 'Pendências', exact: true }).focus(); await doctor.keyboard.press('Enter');
    await expect(doctor).toHaveURL(doctorApp.origin + '/trabalho');
    await expect(nav.getByRole('link', { name: 'Pendências', exact: true })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('button', { name: 'Mais páginas', exact: true }).focus(); await doctor.keyboard.press('Enter');
    await expect(doctor.getByRole('menuitem', { name: 'Assistente', exact: true })).toBeFocused();
    await doctor.keyboard.press('ArrowDown');
    await expect(doctor.getByRole('menuitem', { name: 'Modelos', exact: true })).toBeFocused();
    await doctor.keyboard.press('ArrowDown');
    await expect(doctor.getByRole('menuitem', { name: 'Conhecimento', exact: true })).toBeFocused();
    await doctor.keyboard.press('Enter'); await expect(doctor).toHaveURL(doctorApp.origin + '/conhecimento');
    await expect(doctor.getByRole('menu')).toHaveCount(0); navigationKeyboardVerified = true;
  }
  for (const width of [375, 1280]) await capture(doctor, doctorApp, 'clinical', '/privacidade', width, async page => {
    await page.getByRole('button', { name: 'Excluir minha conta', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
  }, 'delete-dialog');
  }
  const receptionApi = await startReceptionFixture(); apis.push(receptionApi); const receptionApp = await appFor(receptionApi);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  receptionApi.appointments.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', doctorId: ids.admin, patientId: ids.patient, contactId: ids.contact, caseId: null,
    patientName: 'Beneficiário sintético', startTime: today + 'T12:00:00Z', endTime: today + 'T12:30:00Z', type: 'retorno', status: 'agendado', revision: 1, checkedInAt: null, googleSyncStatus: 'idle' });
  const staff = await scene(receptionApp, 'recepcao-a', '/recepcao');
  if (!timeOnly) for (const path of ['/recepcao', '/recepcao/agenda', '/recepcao/contatos'])
    for (const width of [375, 1280]) await capture(staff, receptionApp, 'staff', path, width);
  for (const width of [375, 1280]) {
    if (!timeOnly) {
    await capture(staff, receptionApp, 'staff', '/recepcao', width, async page => {
      await page.getByRole('button', { name: 'Novo atendimento', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    }, 'new-case');
    await capture(staff, receptionApp, 'staff', '/recepcao', width, async page => {
      await page.getByRole('button', { name: 'Novo atendimento', exact: true }).click();
      await page.getByRole('radio', { name: 'Novo contato', exact: true }).check();
    }, 'new-contact-case');
    }
    await capture(staff, receptionApp, 'staff', '/recepcao/agenda', width, async page => {
      await page.getByRole('button', { name: 'Remarcar', exact: true }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
    }, 'reschedule-dialog');
  }
  const admin = await scene(receptionApp, 'admin', '/recepcao/equipe');
  if (!timeOnly) for (const width of [375, 1280]) await capture(admin, receptionApp, 'admin', '/recepcao/equipe', width);
  if (!timeOnly) for (const width of [375, 1280]) await capture(admin, receptionApp, 'admin', '/recepcao/contatos', width, async page => {
    await page.getByRole('button', { name: 'Corrigir contato', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }, 'edit-contact-dialog');
  for (const width of [375, 1280]) await capture(admin, receptionApp, 'admin', '/recepcao/agenda', width, async page => {
    await page.getByRole('button', { name: 'Bloquear horário', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }, 'block-time-dialog');
  }
  for (const source of [...ownHashes, ...overlayHashes]) assert.equal(createHash('sha256').update(await readFile(source.path)).digest('hex'), source.sha256, 'Audit source changed during run');
  const requiredSources = welcomeOnly ? ['src/pages/Index.tsx', 'src/components/WelcomeDashboard.tsx'] : weekOnly ? ['src/pages/Calendar.tsx', 'src/components/CalendarWeekDetails.tsx'] : ['src/features/reception/ReceptionCalendar.tsx', ...(!timeOnly ? ['src/pages/Calendar.tsx', 'src/pages/Sharing.tsx', 'src/pages/ClinicalWorkspace.tsx', 'src/pages/AccountSecurity.tsx', 'src/pages/DataPrivacy.tsx'] : [])];
  for (const path of ['src/App.tsx', 'src/pages/Auth.tsx', ...overlays, ...requiredSources]) assert.ok(frozenLoads.has(path), 'Snapshot not served: ' + path);
  if (checkMobileNavigation || welcomeOnly) assert.equal(navigationKeyboardVerified, true, 'Keyboard navigation did not complete');
} catch (error) {
  failure = { name: error.name, message: error.message };
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  for (const app of apps) await app.close();
  for (const api of apis) await api.close();
  if (temporaryCache) {
    assert.equal(dirname(resolve(temporaryCache)), resolve(tmpdir()));
    assert.ok(basename(temporaryCache).startsWith('cortex-reception-audit-'));
    assert.equal((await lstat(temporaryCache)).isSymbolicLink(), false);
    assert.equal(await readFile(join(temporaryCache, 'audit-owner'), 'utf8'), cacheOwner);
    await rm(temporaryCache, { recursive: true, force: true });
  }
  cleanupVerified = true;
}
const report = { completed: !failure, failure, timeOnly, weekOnly, welcomeOnly, welcomeMetrics: welcomeOnly ? { ...apis[0]?.metrics } : null, fixedClock: focusedOnly ? '2026-11-05T15:00:00Z' : null, checkTimeLayout, checkMobileNavigation, checkCalendarHeader, navigationKeyboardVerified, syntheticOnly: true, baseline, overlays: overlayHashes, frozenTextSourceCount: sources.size, frozenTextSourceDigest: sourceDigest.digest('hex'), tailwindRawContentCount: tailwindContent.length, runtimeSources: ownHashes,
  frozenLoads: [...frozenLoads].sort(), screens, errors, consoleErrors, failedRequests, errorResponses, blockedExternalRequests: blocked, cleanupVerified };
await writeFile(resolve(folder, 'AUDIT.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baseline, screens: screens.length, errors: errors.length, consoleErrors: consoleErrors.length,
  failure, issues: screens.filter(screen => screen.dialogActionReachable === false || screen.dialogHorizontalOverflow > 1 || screen.dialogOutsideViewport || screen.recoveryScreen || screen.overflow > 1 || screen.missingButtons.length || screen.missingLabels.length || screen.brokenText.length).map(screen => ({ role: screen.role, path: screen.path, variant: screen.variant, actualPath: screen.actualPath, width: screen.width, dialogActionReachable: screen.dialogActionReachable, dialogHorizontalOverflow: screen.dialogHorizontalOverflow, dialogOutsideViewport: screen.dialogOutsideViewport, recoveryScreen: screen.recoveryScreen, overflow: screen.overflow, missingButtons: screen.missingButtons.length, missingLabels: screen.missingLabels.length, brokenText: screen.brokenText })), cleanupVerified }));
if (failure) throw new Error(failure.message);
