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
import { startClinicFixture, patientId, uid } from './fixtures/clinic-review-api.mjs';
import { startReceptionFixture, ids } from './fixtures/reception-api.mjs';

const args = process.argv.slice(2);
assert.ok(args.every(arg => /^--(baseline=[0-9a-f]{40}|overlay=src\/[\w/.-]+|run=[a-z0-9-]+|only=time-dialogs|only=week-caption|only=welcome-dashboard|only=chat-prompts|only=short-timestamps|only=medical-delivery|only=delegation-read|only=delegation-decision|only=delegation-conflict|only=delegation-denied|medical-history-only|check-time-layout|check-mobile-navigation|check-calendar-header|check-workspace-layout)$/.test(arg)), 'Unsupported audit option');
const timeOnly = args.includes('--only=time-dialogs'), checkTimeLayout = args.includes('--check-time-layout');
const weekOnly = args.includes('--only=week-caption');
const chatOnly = args.includes('--only=chat-prompts');
const timestampOnly = args.includes('--only=short-timestamps');
const medicalOnly = args.includes('--only=medical-delivery');
const delegationOnly = args.includes('--only=delegation-read');
const delegationDecisionOnly = args.includes('--only=delegation-decision'), delegationConflictOnly = args.includes('--only=delegation-conflict'), delegationDeniedOnly = args.includes('--only=delegation-denied'), delegationMode = delegationOnly || delegationDecisionOnly || delegationConflictOnly || delegationDeniedOnly;
const medicalHistoryOnly = args.includes('--medical-history-only');
assert.ok(!medicalHistoryOnly || medicalOnly, 'Medical history focus requires medical delivery mode');
const checkWorkspaceLayout = args.includes('--check-workspace-layout');
assert.ok(!checkWorkspaceLayout || timestampOnly, 'Workspace layout checks require the populated timestamp audit');
const welcomeOnly = args.includes('--only=welcome-dashboard'), focusedOnly = weekOnly || welcomeOnly || chatOnly || timestampOnly || medicalOnly || delegationMode;
assert.ok(args.filter(arg => arg.startsWith('--only=')).length <= 1, 'Only one focused audit mode is supported');
assert.ok(!weekOnly || !args.some(arg => arg.startsWith('--check-')), 'Week caption mode runs its own checks');
assert.ok(!welcomeOnly || !args.some(arg => arg.startsWith('--check-')), 'Welcome mode runs its own checks');
assert.ok(!chatOnly || !args.some(arg => arg.startsWith('--check-')), 'Chat prompt mode runs its own checks');
assert.ok(!timestampOnly || !args.some(arg => arg.startsWith('--check-') && arg !== '--check-workspace-layout'), 'Timestamp mode only supports workspace layout checks');
assert.ok(!medicalOnly || !args.some(arg => arg.startsWith('--check-')), 'Medical delivery mode runs its own checks');
assert.ok(!delegationOnly || !args.some(arg => arg.startsWith('--check-')), 'Delegation read mode runs its own checks');
assert.ok(!delegationDecisionOnly || !args.some(arg => arg.startsWith('--check-')), 'Delegation decision mode runs its own checks');
assert.ok(!delegationConflictOnly || !args.some(arg => arg.startsWith('--check-')), 'Delegation conflict mode runs its own checks');
assert.ok(!delegationDeniedOnly || !args.some(arg => arg.startsWith('--check-')), 'Delegation denial mode runs its own checks');
const checkMobileNavigation = args.includes('--check-mobile-navigation');
assert.ok(!timeOnly || !checkMobileNavigation, 'Mobile navigation checks require the full route audit');
const checkCalendarHeader = args.includes('--check-calendar-header');
assert.ok(!timeOnly || !checkCalendarHeader, 'Calendar header checks require the full route audit');
const git = options => { const result = spawnSync('git', options, { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const baseline = args.find(arg => arg.startsWith('--baseline='))?.slice(11) || git(['rev-parse', 'HEAD']);
const medicalPaths = ['src/components/PatientProfileDrawer.tsx', 'src/pages/PatientManagement.tsx', 'src/pages/KnowledgeBase.tsx', 'src/pages/Templates.tsx', 'src/pages/Assistant.tsx'];
const medicalDelivery = medicalOnly ? git(['rev-parse', 'f2eb189']) : null;
const overlays = args.filter(arg => arg.startsWith('--overlay=')).map(arg => arg.slice(10));
const allowed = /^(src\/pages\/(Calendar|Sharing|AccountSecurity|Auth|DataPrivacy|ClinicalWorkspace)\.tsx|src\/features\/reception\/[\w/.-]+\.(ts|tsx)|src\/components\/(BottomNavigation|MobileSubpageNavigation|WelcomeDashboard|ChatPanel|PatientProfileDrawer)\.tsx|src\/lib\/calendarLabels\.ts)$/;
for (const path of overlays) assert.match(path, allowed, 'Overlay must be in the Codex audit scope');
assert.ok(!overlays.includes('src/components/PatientProfileDrawer.tsx') || medicalOnly, 'Profile overlay requires medical delivery mode');
assert.ok(!medicalOnly || overlays.length <= 1 && overlays.every(path => path === 'src/components/PatientProfileDrawer.tsx'), 'Medical delivery only permits the explicit profile overlay');
assert.ok(!delegationMode || overlays.length === 0, 'Delegation modes use only the committed snapshot');
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
if (medicalOnly) for (const path of medicalPaths) assert.equal(sources.get(path).replaceAll('\r\n', '\n').trim(), git(['show', medicalDelivery + ':' + path]), 'Medical delivery source differs: ' + path);
const medicalBaseSources = medicalOnly ? medicalPaths.map(path => ({ path, sha256: createHash('sha256').update(sources.get(path)).digest('hex') })) : [];
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
const medicalCaseFailures = []; let medicalCasesAttempted = 0;
const delegationDecisionChecks = [], delegationConflictChecks = [], delegationDeniedChecks = [];
const cacheOwner = randomUUID();
let browser, temporaryCache, failure, cleanupVerified = false, navigationKeyboardVerified = false, draftPreserved = false, timestampDataPreserved = false, medicalDataPreserved = false, delegationDataPreserved = false;
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
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ path: new URL(page.url()).pathname, message: message.text(), ...(delegationConflictOnly || delegationDeniedOnly ? { resource: message.location().url ? new URL(message.location().url).pathname : null } : {}) }); });
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
async function capture(page, app, role, path, width, action, variant = '', { navigate = true } = {}) {
  await page.setViewportSize({ width, height: 1000 });
  if (navigate) await page.goto(app.origin + path);
  await page.waitForLoadState('networkidle');
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
    const clinicalInput = [...document.querySelectorAll('input[type="text"]')].find(element => visible(element) && ['Pergunta ao assistente clínico', 'Comentário clínico para este paciente'].includes(element.getAttribute('aria-label')));
    let clinicalPrompt = null;
    if (clinicalInput) {
      const style = getComputedStyle(clinicalInput), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const spacing = parseFloat(style.letterSpacing) || 0;
      clinicalPrompt = { label: clinicalInput.getAttribute('aria-label'), placeholder: clinicalInput.placeholder, hint: clinicalInput.title,
        textWidth: context.measureText(clinicalInput.placeholder).width + spacing * Math.max(0, clinicalInput.placeholder.length - 1),
        availableWidth: clinicalInput.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), empty: clinicalInput.value === '' };
    }
    const medicalTextFit = [...document.querySelectorAll('header h1, [role="dialog"] h2 span.line-clamp-2, [role="tab"], [role="tabpanel"] .bg-medical-blue, main button[aria-label^="Pré-visualizar"] p:first-child')].filter(visible).map(element => {
      const box = element.getBoundingClientRect(), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node, clipped = false, left = 0, right = innerWidth;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        if (!['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(ancestor).overflowX)) continue;
        const bounds = ancestor.getBoundingClientRect(); left = Math.max(left, bounds.left + ancestor.clientLeft); right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
      }
      const lineClamped = parseInt(getComputedStyle(element).webkitLineClamp) > 0, textRects = [];
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim() || node.parentElement.closest('.sr-only,[aria-hidden="true"]') || !visible(node.parentElement)) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0) {
          textRects.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
          if (rect.left < left - 1 || rect.right > right + 1 || (lineClamped && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1))) clipped = true;
        }
      }
      return { text: element.textContent.trim(), tab: element.getAttribute('role') === 'tab', clipped, textRects };
    });
    const overlappingMedicalTabs = medicalTextFit.flatMap((item, index) => !item.tab ? [] : medicalTextFit.slice(index + 1).filter(other => other.tab && item.textRects.some(a => other.textRects.some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))).map(other => [item.text, other.text]));
    const medicalPlaceholders = [...document.querySelectorAll('input')].filter(element => visible(element) && ['Buscar pacientes', 'Buscar modelos', 'Escreva sua pergunta'].includes(element.getAttribute('aria-label'))).map(element => {
      const style = getComputedStyle(element), context = document.createElement('canvas').getContext('2d'); context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return { label: element.getAttribute('aria-label'), placeholder: element.placeholder, textWidth: context.measureText(element.placeholder).width + (parseFloat(style.letterSpacing) || 0) * Math.max(0, element.placeholder.length - 1), availableWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
    });
    const workspaceMain = location.pathname === '/trabalho' ? document.querySelector('main') : null;
    let workspaceGeometry = null;
    if (workspaceMain) {
      const shell = document.querySelector('[data-clinic-page-shell]');
      const bounds = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft }; };
      workspaceGeometry = { shell: bounds(shell), main: bounds(workspaceMain),
        overflowingContainers: [...workspaceMain.querySelectorAll('section,article,div')].filter(visible).filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ tag: element.tagName, className: element.className, ...bounds(element) })),
        clippedControls: [...workspaceMain.querySelectorAll('button,a,summary')].filter(visible).filter(element => { const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1; }).map(element => ({ label: name(element) || element.textContent.trim(), ...bounds(element) })) };
    }
    return { fontSize: getComputedStyle(document.documentElement).fontSize, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialogOutsideViewport, dialogHorizontalOverflow: dialogElement ? dialogElement.scrollWidth - dialogElement.clientWidth : 0,
      missingButtons, missingLabels, navigationLabels, headerTitles, calendarPeriod: periodElement?.textContent.trim(), calendarPeriodClipped, shortcuts, clinicalPrompt, workspaceGeometry, medicalTextFit, overlappingMedicalTabs, medicalPlaceholders,
      timestampLabels: [...document.querySelectorAll('a,p,summary')].filter(element => visible(element) && /\b05\/11\/2026/.test(element.textContent)).map(element => element.textContent.trim()),
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
    const api = await startClinicFixture(welcomeOnly ? { lastVisit: '2026-10-01' } : timestampOnly ? { workspaceDates: true } : medicalOnly ? { medicalUI: true } : delegationMode ? { delegationPermissions: true, delegationDecisions: delegationDecisionOnly || delegationConflictOnly } : {}); apis.push(api); const app = await appFor(api);
    const chatPath = '/?patient=' + patientId;
    const doctor = await scene(app, 'review', delegationMode ? '/permissoes-recepcao' : timestampOnly ? '/trabalho' : chatOnly || medicalOnly ? chatPath : welcomeOnly ? '/' : '/agenda');
    await doctor.waitForLoadState('networkidle');
    await doctor.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    if (delegationDeniedOnly) {
      const originalRows = structuredClone(api.delegationRows), listPath = '/rest/v1/rpc/reception_delegation_requests';
      const ready = async page => {
        await expect(page.getByRole('heading', { name: 'Permissões da recepção', exact: true })).toBeVisible(); await expect(page.locator('article')).toHaveCount(3);
        for (const row of originalRows) await expect(page.getByRole('heading', { name: row.staffName, exact: true })).toBeVisible();
        await expect(page.getByText('Acesso ativo', { exact: true })).toHaveCount(1); await expect(page.getByText('Sem acesso ativo', { exact: true })).toHaveCount(2);
        await expect(page.getByRole('button', { name: 'Aprovar acesso', exact: true })).toBeEnabled(); await expect(page.getByRole('button', { name: 'Revogar acesso', exact: true })).toHaveCount(2);
        await expect(page.getByRole('heading', { name: 'Solicitar acesso para uma conta existente', exact: true })).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
      };
      const hidden = async page => {
        await expect(page.getByRole('alert')).toContainText('Você não tem permissão para esta ação. Atualize a lista.'); await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeEnabled();
        await expect(page.locator('article')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Meus pedidos e aprovações', exact: true })).toHaveCount(0);
        for (const label of ['Aprovar acesso', 'Recusar pedido', 'Revogar acesso', 'Cancelar pedido', 'Enviar pedido ao médico']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
        for (const row of originalRows) await expect(page.getByText(row.staffName, { exact: true })).toHaveCount(0);
      };
      for (const width of [375, 1280, 1920]) {
        api.setDelegationReadMode('valid'); const readsBefore = api.metrics.delegationCalls.filter(call => call.mode === 'denied').length;
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, ready, 'denial-initial');
        const marker = randomUUID(); await doctor.evaluate(value => { document.documentElement.dataset.auditDocument = value; }, marker);
        const sameDocument = async page => assert.equal(await page.evaluate(() => document.documentElement.dataset.auditDocument), marker, 'Denial recovery reloaded the document');
        api.setDelegationReadMode('denied'); await doctor.getByRole('button', { name: 'Atualizar lista', exact: true }).click(); await hidden(doctor);
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => { await sameDocument(page); await hidden(page); }, 'denial-hidden', { navigate: false });
        await doctor.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await hidden(doctor);
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => { await sameDocument(page); await hidden(page); }, 'denial-retry-denied', { navigate: false });
        assert.equal(api.metrics.delegationCalls.filter(call => call.mode === 'denied').length, readsBefore + 2);
        api.setDelegationReadMode('valid'); await doctor.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await ready(doctor);
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => { await sameDocument(page); await ready(page); }, 'denial-recovered', { navigate: false });
        assert.deepEqual(api.delegationRows, originalRows); delegationDeniedChecks.push({ width, deniedReads: 2, sameDocument: true, rowsAndActionsHidden: true, recoveryRestored: true });
      }
      const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST ' + listPath]);
      assert.ok(api.metrics.delegationRequests.every(call => allowed.has(call.method + ' ' + call.path))); assert.deepEqual(api.metrics.delegationUnexpected, []);
      assert.equal('delegationWrites' in api.metrics, false); assert.equal('delegationAttempts' in api.metrics, false);
      for (const call of api.metrics.delegationCalls) assert.deepEqual(call.args, { p_clinic: null, p_after: null, p_after_id: null, p_limit: 50 });
      assert.deepEqual(errorResponses, Array.from({ length: 6 }, () => ({ path: listPath, status: 403 })));
      assert.deepEqual(consoleErrors, Array.from({ length: 6 }, () => ({ path: '/permissoes-recepcao', resource: listPath, message: 'Failed to load resource: the server responded with a status of 403 (Forbidden)' })));
      assert.equal(screens.length, 12);
      for (const measured of screens) {
        assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'Delegation denial layout is clipped');
        assert.equal(measured.recoveryScreen, false); assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []);
      }
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0);
      for (const observations of [errors, failedRequests, blocked]) assert.deepEqual(observations, []);
      delegationDataPreserved = true;
    } else if (delegationConflictOnly) {
      const originalRows = structuredClone(api.delegationRows), targetId = originalRows[0].id;
      const target = page => page.locator('article').filter({ has: page.getByRole('heading', { name: originalRows[0].staffName, exact: true }) });
      const approvePath = '/rest/v1/rpc/reception_decide_delegation';
      const openConfirmation = async page => {
        await target(page).getByRole('button', { name: 'Aprovar acesso', exact: true }).click();
        const dialog = page.getByRole('dialog');
        for (const label of [originalRows[0].staffName, originalRows[0].clinicName, originalRows[0].doctorName, 'prontuários']) await expect(dialog).toContainText(label);
        await expect(dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true })).toBeEnabled();
      };
      for (const width of [375, 1280, 1920]) {
        api.resetDelegationDecisions(); const writesBefore = api.metrics.delegationWrites.length, attemptsBefore = api.metrics.delegationAttempts.length;
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await expect(target(page).getByText('Aguardando médico', { exact: true })).toBeVisible(); await openConfirmation(page);
          assert.equal(api.metrics.delegationAttempts.length, attemptsBefore);
        }, 'conflict-old-confirmation');
        const revisionChange = api.advanceDelegationRevision(targetId);
        await doctor.getByRole('dialog').getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
        await expect(doctor.getByRole('dialog')).toHaveCount(0);
        await expect(doctor.getByRole('alert')).toHaveText('O pedido mudou. Atualize a lista e revise a ação antes de tentar novamente.');
        await expect(target(doctor).getByRole('button', { name: 'Aprovar acesso', exact: true })).toBeEnabled(); await doctor.waitForLoadState('networkidle');
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await expect(target(page).getByText('Aguardando médico', { exact: true })).toBeVisible(); await expect(target(page).getByText('Sem acesso ativo', { exact: true })).toBeVisible();
          await expect(page.getByRole('alert')).toHaveText('O pedido mudou. Atualize a lista e revise a ação antes de tentar novamente.');
          await expect(page.getByRole('dialog')).toHaveCount(0); await target(page).scrollIntoViewIfNeeded();
          assert.equal(api.metrics.delegationWrites.length, writesBefore); assert.equal(api.metrics.delegationAttempts.length, attemptsBefore + 1);
          assert.deepEqual(api.delegationRows, [{ ...originalRows[0], revision: 2 }, ...originalRows.slice(1)]);
        }, 'conflict-refreshed', { navigate: false });
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await openConfirmation(page); assert.equal(api.metrics.delegationAttempts.length, attemptsBefore + 1); assert.equal(api.metrics.delegationWrites.length, writesBefore);
        }, 'conflict-new-confirmation', { navigate: false });
        await doctor.getByRole('dialog').getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
        await expect(target(doctor).getByText('Aprovado', { exact: true })).toBeVisible(); await doctor.waitForLoadState('networkidle');
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await expect(target(page).getByText('Acesso ativo', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0); await target(page).scrollIntoViewIfNeeded();
        }, 'conflict-approved', { navigate: false });
        const [rejected, approved] = api.metrics.delegationAttempts.slice(attemptsBefore);
        assert.equal(api.metrics.delegationAttempts.length, attemptsBefore + 2); assert.equal(api.metrics.delegationWrites.length, writesBefore + 1);
        for (const attempt of [rejected, approved]) { assert.equal(attempt.path, approvePath); assert.equal(attempt.args.p_request, targetId); assert.equal(attempt.args.p_decision, 'approve'); assert.equal(attempt.currentRevision, 2); }
        assert.equal(rejected.status, 409); assert.equal(rejected.args.p_revision, 1); assert.equal(approved.status, 200); assert.equal(approved.args.p_revision, 2); assert.notEqual(rejected.args.p_operation, approved.args.p_operation);
        assert.deepEqual(api.delegationRows, [{ ...originalRows[0], state: 'approved', revision: 3, effective: true, canDecide: false, canRevoke: true }, ...originalRows.slice(1)]);
        delegationConflictChecks.push({ width, revisionChange, rejected, approved, successfulWrites: 1 });
      }
      const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_delegation_requests', 'POST ' + approvePath]);
      assert.ok(api.metrics.delegationRequests.every(call => allowed.has(call.method + ' ' + call.path))); assert.deepEqual(api.metrics.delegationUnexpected, []);
      assert.equal(api.metrics.delegationRequests.filter(call => call.path === approvePath).length, 6); assert.equal(api.metrics.delegationWrites.length, 3);
      assert.equal(new Set(api.metrics.delegationAttempts.map(attempt => attempt.args.p_operation)).size, 6);
      assert.deepEqual(errorResponses, Array.from({ length: 3 }, () => ({ path: approvePath, status: 409 })));
      assert.deepEqual(consoleErrors, Array.from({ length: 3 }, () => ({ path: '/permissoes-recepcao', resource: approvePath, message: 'Failed to load resource: the server responded with a status of 409 (Conflict)' })));
      assert.equal(screens.length, 12);
      for (const measured of screens) {
        assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'Delegation conflict layout or dialog action is clipped');
        assert.equal(measured.recoveryScreen, false); assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []);
      }
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0);
      for (const observations of [errors, failedRequests, blocked]) assert.deepEqual(observations, []);
    } else if (delegationDecisionOnly) {
      const originalRows = structuredClone(api.delegationRows), targetId = originalRows[0].id;
      const target = page => page.locator('article').filter({ has: page.getByRole('heading', { name: originalRows[0].staffName, exact: true }) });
      for (const width of [375, 1280, 1920]) {
        api.resetDelegationDecisions(); const before = api.metrics.delegationWrites.length;
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await expect(target(page).getByText('Aguardando médico', { exact: true })).toBeVisible();
          await target(page).getByRole('button', { name: 'Aprovar acesso', exact: true }).click();
          const dialog = page.getByRole('dialog'); for (const label of [originalRows[0].staffName, originalRows[0].clinicName, originalRows[0].doctorName, 'prontuários']) await expect(dialog).toContainText(label);
          await expect(dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true })).toBeEnabled(); assert.equal(api.metrics.delegationWrites.length, before);
        }, 'decision-approval-confirmation');
        await doctor.getByRole('dialog').getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
        await expect(target(doctor).getByText('Aprovado', { exact: true })).toBeVisible(); await doctor.waitForLoadState('networkidle');
        assert.equal(api.metrics.delegationWrites.length, before + 1);
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await expect(target(page).getByText('Acesso ativo', { exact: true })).toBeVisible(); await expect(target(page).getByRole('button', { name: 'Aprovar acesso', exact: true })).toHaveCount(0); await target(page).scrollIntoViewIfNeeded();
        }, 'decision-approved');
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await target(page).getByRole('button', { name: 'Revogar acesso', exact: true }).click(); const dialog = page.getByRole('dialog'); for (const label of [originalRows[0].staffName, originalRows[0].clinicName, originalRows[0].doctorName, 'O histórico será preservado']) await expect(dialog).toContainText(label);
          await expect(dialog.getByRole('button', { name: 'Confirmar revogação', exact: true })).toBeEnabled(); assert.equal(api.metrics.delegationWrites.length, before + 1);
        }, 'decision-revocation-confirmation');
        await doctor.getByRole('dialog').getByRole('button', { name: 'Confirmar revogação', exact: true }).click();
        await expect(target(doctor).getByText('Revogado', { exact: true })).toBeVisible(); await doctor.waitForLoadState('networkidle');
        assert.equal(api.metrics.delegationWrites.length, before + 2);
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await expect(target(page).getByText('Revogado', { exact: true })).toBeVisible(); await expect(target(page).getByText('Sem acesso ativo', { exact: true })).toBeVisible(); await expect(target(page).getByRole('button', { name: 'Revogar acesso', exact: true })).toHaveCount(0); await target(page).scrollIntoViewIfNeeded();
        }, 'decision-revoked');
        const [approval, revocation] = api.metrics.delegationWrites.slice(before);
        assert.equal(approval.args.p_request, targetId); assert.equal(revocation.args.p_request, targetId); assert.equal(approval.args.p_revision, 1); assert.equal(revocation.args.p_revision, 2); assert.notEqual(approval.args.p_operation, revocation.args.p_operation);
        assert.deepEqual(api.delegationRows.slice(1), originalRows.slice(1));
        assert.deepEqual(api.delegationRows[0], { ...originalRows[0], state: 'revoked', revision: 3, effective: false, canDecide: false, canRevoke: false });
        delegationDecisionChecks.push({ width, targetId, approvalOperation: approval.args.p_operation, revocationOperation: revocation.args.p_operation, successfulWrites: 2 });
      }
      assert.equal(api.metrics.delegationWrites.length, 6);
      const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_delegation_requests', 'POST /rest/v1/rpc/reception_decide_delegation', 'POST /rest/v1/rpc/reception_revoke_delegation']);
      assert.ok(api.metrics.delegationRequests.every(call => allowed.has(call.method + ' ' + call.path))); assert.deepEqual(api.metrics.delegationUnexpected, []);
      assert.equal(api.metrics.delegationRequests.filter(call => /reception_(decide|revoke)_delegation$/.test(call.path)).length, 6);
      assert.equal(new Set(api.metrics.delegationWrites.map(write => write.args.p_operation)).size, 6);
      assert.equal(screens.length, 12, 'Expected four decision states at three widths');
      for (const measured of screens) {
        assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'Delegation decision layout or dialog action is clipped');
        assert.equal(measured.recoveryScreen, false);
        assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []);
      }
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0);
      for (const observations of [errors, consoleErrors, failedRequests, errorResponses, blocked]) assert.deepEqual(observations, []);
    } else if (delegationOnly) {
      const originalData = JSON.stringify(api.delegationRows);
      const ready = async page => {
        await expect(page.getByRole('heading', { name: 'Permissões da recepção', exact: true })).toBeVisible();
        await expect(page.locator('article')).toHaveCount(3);
        await expect(page.getByRole('button', { name: 'Aprovar acesso', exact: true })).toBeEnabled();
        await expect(page.getByRole('heading', { name: 'Solicitar acesso para uma conta existente', exact: true })).toHaveCount(0);
      };
      const invalidate = async page => {
        api.setDelegationReadMode('invalid'); await page.getByRole('button', { name: 'Atualizar lista', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('A resposta não pôde ser validada');
        await expect(page.locator('article')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Aprovar acesso', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Revogar acesso', exact: true })).toHaveCount(0);
        for (const row of api.delegationRows) await expect(page.getByText(row.staffName, { exact: true })).toHaveCount(0);
      };
      const cases = [
        { variant: 'requests', action: async page => { await expect(page.getByText('Aguardando médico', { exact: true })).toBeVisible(); await expect(page.getByText('Aprovado', { exact: true })).toHaveCount(2); await expect(page.getByText('Acesso ativo', { exact: true })).toHaveCount(1); await expect(page.getByText('Sem acesso ativo', { exact: true })).toHaveCount(2); } },
        { variant: 'approval-confirmation', action: async page => { await page.getByRole('button', { name: 'Aprovar acesso', exact: true }).click(); const dialog = page.getByRole('dialog'); for (const label of ['Recepção pendente', 'Clínica sintética', 'Profissional de Demonstração', 'prontuários']) await expect(dialog).toContainText(label); await expect(dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true })).toBeEnabled(); } },
        { variant: 'withdrawal-confirmation', action: async page => { const row = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Recepção aprovada', exact: true }) }); await row.getByRole('button', { name: 'Revogar acesso', exact: true }).click(); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Recepção aprovada'); await expect(dialog).toContainText('O histórico será preservado'); await expect(dialog.getByRole('button', { name: 'Confirmar revogação', exact: true })).toBeEnabled(); } },
        { variant: 'invalid-response', action: invalidate },
        { variant: 'recovered', action: async page => { await invalidate(page); api.setDelegationReadMode('valid'); await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await ready(page); await expect(page.getByRole('alert')).toHaveCount(0); } },
      ];
      for (const width of [375, 1280, 1920]) for (const entry of cases) {
        api.setDelegationReadMode('valid');
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => { await ready(page); await entry.action(page); }, entry.variant);
        const measured = screens.at(-1);
        assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'Delegation read layout or dialog action is clipped');
        assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []);
      }
      assert.equal(JSON.stringify(api.delegationRows), originalData);
      assert.deepEqual(api.metrics.delegationUnexpected, []);
      const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_delegation_requests']);
      assert.ok(api.metrics.delegationRequests.length > 0 && api.metrics.delegationRequests.every(call => allowed.has(call.method + ' ' + call.path)), 'Delegation read contacted an unexpected resource');
      assert.ok(api.metrics.delegationCalls.some(call => call.mode === 'invalid'));
      for (const call of api.metrics.delegationCalls) assert.deepEqual(call.args, { p_clinic: null, p_after: null, p_after_id: null, p_limit: 50 });
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0);
      for (const observations of [errors, consoleErrors, failedRequests, errorResponses, blocked]) assert.deepEqual(observations, []);
      delegationDataPreserved = true;
    } else if (medicalOnly) {
      const originalData = JSON.stringify(api.medicalData);
      const openProfile = async (page, width) => {
        await expect(page.getByRole('heading', { name: 'Paciente Exemplo A', exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: width < 1728 ? 'Perfil' : 'Perfil Completo & Arquivos', exact: true }).click();
        const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); return dialog;
      };
      const cases = [
        { variant: 'profile-overview', path: chatPath, ready: async (page, width) => { const dialog = await openProfile(page, width); await expect(dialog.getByText(/no painel Perfil/)).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Perguntar à IA', exact: true })).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Dossiê', exact: true })).toBeVisible(); await dialog.getByRole('tab', { name: 'Geral', exact: true }).scrollIntoViewIfNeeded(); } },
        { variant: 'profile-history', path: chatPath, ready: async (page, width) => { const dialog = await openProfile(page, width); const tab = dialog.getByRole('tab', { name: /^Histórico/ }); await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true'); const panel = dialog.getByRole('tabpanel'); await expect(panel.getByText('há 1 mês', { exact: true })).toBeVisible(); await expect(panel.getByText('há 1 ano', { exact: true })).toBeVisible(); await expect(panel.getByText('Última', { exact: true })).toBeVisible(); } },
        { variant: 'profile-documents', path: chatPath, ready: async (page, width) => { const dialog = await openProfile(page, width); const tab = dialog.getByRole('tab', { name: 'Documentos', exact: true }); await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true'); await expect(dialog.getByRole('heading', { name: 'Arquivos anexados', exact: true })).toBeVisible(); } },
        { variant: 'patients', path: '/gerenciar-pacientes', ready: async (page, width) => { await expect(page.getByRole('heading', { name: width < 864 ? 'Pacientes' : 'Gerenciar pacientes', exact: true, level: 1 })).toBeVisible(); await expect(page.getByRole('searchbox', { name: 'Buscar pacientes', exact: true })).toHaveAttribute('placeholder', 'Nome ou profissão…'); await expect(page.getByRole('link', { name: 'Abrir prontuário de Paciente Exemplo A', exact: true })).toBeVisible(); } },
        { variant: 'templates', path: '/modelos', ready: async (page, width) => { await expect(page.getByRole('heading', { name: width < 864 ? 'Modelos' : 'Modelos de documento', exact: true, level: 1 })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Buscar modelos', exact: true })).toHaveAttribute('placeholder', 'Nome do modelo…'); for (const action of ['Editar', 'Duplicar', 'Excluir']) await expect(page.getByRole('button', { name: action + ' Modelo de revisão sintético', exact: true })).toBeVisible(); } },
        { variant: 'template-preview', path: '/modelos', ready: async page => { await page.getByRole('button', { name: 'Pré-visualizar Modelo de revisão sintético', exact: true }).click(); await expect(page.getByRole('dialog').getByText('Texto sintético do modelo.', { exact: true })).toBeVisible(); } },
        { variant: 'knowledge', path: '/conhecimento', ready: async page => { await expect(page.getByRole('heading', { name: 'Fonte sintética revisada', exact: true })).toBeVisible(); await expect(page.getByText('Revisão: 04/11/2026, 16:21 · Profissional de Demonstração', { exact: false })).toBeVisible(); } },
        { variant: 'knowledge-source', path: '/conhecimento', ready: async page => { await page.getByRole('button', { name: 'Ver fonte', exact: true }).click(); await expect(page.getByRole('dialog').getByText('Texto original sintético para revisão visual.', { exact: true })).toBeVisible(); await expect(page.getByRole('dialog').getByText('Profissional de Demonstração · 04/11/2026, 16:21', { exact: true })).toBeVisible(); } },
        { variant: 'assistant-initial', path: '/assistente', ready: async page => { await expect(page.getByRole('textbox', { name: 'Escreva sua pergunta', exact: true })).toHaveAttribute('placeholder', 'Escreva sua pergunta'); } },
        { variant: 'assistant-conversation', path: '/assistente', ready: async page => { await page.getByRole('textbox', { name: 'Escreva sua pergunta', exact: true }).fill('Pergunta sintética sem dados pessoais'); await page.getByRole('button', { name: 'Enviar pergunta', exact: true }).click(); await expect(page.getByRole('log', { name: 'Conversa com o assistente', exact: true })).toContainText('Verificação farmacológica necessária'); await expect(page.getByRole('textbox', { name: 'Escreva sua pergunta', exact: true })).toBeEmpty(); } },
      ];
      for (const width of [375, 1280, 1920]) for (const entry of medicalHistoryOnly ? cases.filter(entry => entry.variant === 'profile-history') : cases) {
        medicalCasesAttempted++;
        try {
          await capture(doctor, app, 'medical', entry.path, width, page => entry.ready(page, width), entry.variant);
          const measured = screens.at(-1);
          assert.ok(measured.medicalTextFit.every(item => !item.clipped), 'Medical delivery text is clipped: ' + entry.variant);
          assert.deepEqual(measured.overlappingMedicalTabs, [], 'Medical profile tab labels overlap');
          assert.ok(measured.medicalPlaceholders.every(item => item.textWidth <= item.availableWidth + 1), 'Medical delivery placeholder is clipped: ' + entry.variant);
          assert.ok(measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.overflow <= 1, 'Medical delivery container overflows: ' + entry.variant);
        } catch (error) {
          medicalCaseFailures.push({ width, variant: entry.variant, name: error.name, message: error.message });
        }
      }
      assert.equal(JSON.stringify(api.medicalData), originalData, 'Medical review changed stored data');
      assert.equal(api.metrics.chat, medicalHistoryOnly ? 0 : 3, 'Only the explicitly selected synthetic assistant submissions are allowed');
      assert.ok(Object.entries(api.metrics).every(([key, value]) => key === 'chat' || value === 0), 'Medical review must not write data or invoke another AI operation');
      medicalDataPreserved = true;
    } else if (timestampOnly) {
      const originalData = JSON.stringify(api.displayData);
      await doctor.evaluate(async ({ uid, patientId }) => {
        const { saveRescuedRecording } = await import('/src/lib/recordingRescue.ts');
        await saveRescuedRecording({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: uid, patientId, patientName: 'Paciente Exemplo A', mimeType: 'audio/webm', blob: new Blob(['synthetic unsubmitted bytes'], { type: 'audio/webm' }), comments: [], createdAt: '2026-11-05T20:06:59Z' });
      }, { uid, patientId });
      const cases = [
        { variant: 'audio-list', path: '/trabalho', dates: ['05/11/2026, 14:03'], ready: async page => { const target = page.getByRole('link', { name: /Retomar consulta/ }); await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded(); } },
        { variant: 'work-updated', path: '/trabalho', dates: ['05/11/2026, 15:04'], ready: async page => { const target = page.getByText(/^Atualizado em/); await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded(); } },
        { variant: 'work-versions', path: '/trabalho?patient=' + patientId, dates: ['05/11/2026, 13:02'], ready: async page => { await page.getByRole('button', { name: 'Ver versões', exact: true }).click(); const target = page.locator('summary', { hasText: 'Versão 1' }); await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded(); } },
        { variant: 'clinical-versions', path: '/trabalho?patient=' + patientId, dates: ['05/11/2026, 16:05'], ready: async page => { const timeline = page.getByRole('button', { name: 'Linha do tempo', exact: true }); await timeline.click(); await expect(timeline).toHaveAttribute('aria-pressed', 'true'); await page.getByRole('button', { name: 'Comparar revisões', exact: true }).click(); const target = page.locator('summary', { hasText: 'Versão 1' }); await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded(); } },
        { variant: 'rescued-recording', path: chatPath, dates: ['05/11/2026, 17:06'], ready: async page => { const target = page.getByRole('status').filter({ hasText: 'Uma gravação desta consulta foi interrompida' }); await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded(); } },
      ];
      for (const width of [320, 375, 1280]) for (const entry of cases) {
        await capture(doctor, app, 'clinical', entry.path, width, entry.ready, entry.variant);
        const labels = screens.at(-1).timestampLabels;
        for (const date of entry.dates) assert.ok(labels.some(label => label.includes(date)), 'Expected short timestamp: ' + date);
        assert.ok(labels.every(label => !/\d{2}:\d{2}:\d{2}/.test(label)), 'Timestamp must omit seconds');
      }
      assert.equal(JSON.stringify(api.displayData), originalData, 'Display changed fixture data');
      const rescuedDates = await doctor.evaluate(async uid => {
        const { listRescuedRecordings } = await import('/src/lib/recordingRescue.ts');
        return (await listRescuedRecordings(uid)).map(entry => ({ id: entry.id, createdAt: entry.createdAt }));
      }, uid);
      assert.deepEqual(rescuedDates, [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-11-05T20:06:59Z' }], 'Display must retain the rescued recording and its original timestamp');
      assert.ok(Object.values(api.metrics).every(value => value === 0), 'Display must not invoke AI or write data');
      timestampDataPreserved = true;
      if (checkWorkspaceLayout) {
        const workspaceScreens = screens.filter(screen => screen.workspaceGeometry);
        assert.equal(workspaceScreens.length, 12, 'Expected four workspace states at three widths');
        const clipped = workspaceScreens.filter(({ workspaceGeometry: geometry }) => geometry.shell.scrollWidth > geometry.shell.clientWidth + 1 || Math.abs(geometry.shell.scrollLeft) > 1 || geometry.main.scrollWidth > geometry.main.clientWidth + 1 || geometry.overflowingContainers.length || geometry.clippedControls.length);
        assert.deepEqual(clipped.map(screen => ({ variant: screen.variant, width: screen.width })), [], 'Workspace content is clipped inside its scroll container');
      }
    } else if (chatOnly) {
      for (const width of [320, 375, 1280]) for (const mode of ['question', 'comment']) {
        const label = mode === 'question' ? 'Pergunta ao assistente clínico' : 'Comentário clínico para este paciente';
        await capture(doctor, app, 'clinical', chatPath, width, async page => {
          await expect(page.getByRole('textbox', { name: 'Pergunta ao assistente clínico', exact: true })).toBeVisible();
          const toggle = page.getByRole('button', { name: mode === 'question' ? 'Pergunta' : 'Comentário', exact: true });
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByRole('textbox', { name: label, exact: true })).toBeVisible();
        }, mode);
        const prompt = screens.at(-1).clinicalPrompt;
        assert.ok(prompt && prompt.empty && prompt.placeholder.length > 0, 'Expected an empty clinical input with a placeholder');
        assert.equal(prompt.label, label, 'Clinical input mode did not match the requested state');
        assert.ok(prompt.textWidth <= prompt.availableWidth + 1, 'Clinical placeholder is clipped');
        assert.ok(prompt.hint.length > prompt.placeholder.length, 'Keep the full clinical hint available');
      }
      const draft = 'Rascunho sintético sem envio';
      await doctor.getByRole('textbox', { name: 'Comentário clínico para este paciente', exact: true }).fill(draft);
      await doctor.getByRole('button', { name: 'Pergunta', exact: true }).click();
      await expect(doctor.getByRole('textbox', { name: 'Pergunta ao assistente clínico', exact: true })).toHaveValue(draft);
      await doctor.getByRole('button', { name: 'Comentário', exact: true }).click();
      await expect(doctor.getByRole('textbox', { name: 'Comentário clínico para este paciente', exact: true })).toHaveValue(draft);
      await doctor.waitForLoadState('networkidle');
      assert.equal(api.metrics.chat, 0); assert.equal(api.metrics.newSources, 0); assert.equal(api.metrics.patientWrites, 0); assert.equal(api.metrics.appointmentWrites, 0);
      draftPreserved = true;
    } else if (welcomeOnly) {
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
  const requiredSources = delegationMode ? ['src/features/reception/DelegationPermissions.tsx', 'src/features/reception/delegationApi.ts'] : medicalOnly ? medicalHistoryOnly ? ['src/components/PatientProfileDrawer.tsx'] : medicalPaths : timestampOnly ? ['src/pages/ClinicalWorkspace.tsx', 'src/components/ChatPanel.tsx', 'src/lib/recordingRescue.ts'] : chatOnly ? ['src/pages/Index.tsx', 'src/components/ChatPanel.tsx'] : welcomeOnly ? ['src/pages/Index.tsx', 'src/components/WelcomeDashboard.tsx'] : weekOnly ? ['src/pages/Calendar.tsx', 'src/components/CalendarWeekDetails.tsx'] : ['src/features/reception/ReceptionCalendar.tsx', ...(!timeOnly ? ['src/pages/Calendar.tsx', 'src/pages/Sharing.tsx', 'src/pages/ClinicalWorkspace.tsx', 'src/pages/AccountSecurity.tsx', 'src/pages/DataPrivacy.tsx'] : [])];
  for (const path of ['src/App.tsx', 'src/pages/Auth.tsx', ...overlays, ...requiredSources]) assert.ok(frozenLoads.has(path), 'Snapshot not served: ' + path);
  if (medicalOnly) assert.deepEqual(medicalCaseFailures, [], 'Medical delivery has unresolved case failures');
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
const report = { completed: !failure, failure, timeOnly, weekOnly, welcomeOnly, chatOnly, timestampOnly, checkWorkspaceLayout, timestampDataPreserved, timestampMetrics: timestampOnly ? { ...apis[0]?.metrics } : null, draftPreserved, welcomeMetrics: welcomeOnly || chatOnly ? { ...apis[0]?.metrics } : null, fixedClock: focusedOnly ? '2026-11-05T15:00:00Z' : null, checkTimeLayout, checkMobileNavigation, checkCalendarHeader, navigationKeyboardVerified, syntheticOnly: true, baseline, overlays: overlayHashes, frozenTextSourceCount: sources.size, frozenTextSourceDigest: sourceDigest.digest('hex'), tailwindRawContentCount: tailwindContent.length, runtimeSources: ownHashes,
  delegationOnly, delegationDecisionOnly, delegationConflictOnly, delegationDeniedOnly, delegationDecisionChecks, delegationConflictChecks, delegationDeniedChecks, delegationDataPreserved, delegationMetrics: delegationMode ? { ...apis[0]?.metrics } : null,
  medicalOnly, medicalHistoryOnly, medicalDelivery, medicalBaseSources, medicalCasesAttempted, medicalCaseFailures, medicalDataPreserved, medicalMetrics: medicalOnly ? { ...apis[0]?.metrics } : null,
  medicalSources: medicalOnly ? medicalPaths.map(path => ({ path, sha256: createHash('sha256').update(sources.get(path)).digest('hex') })) : [],
  frozenLoads: [...frozenLoads].sort(), screens, errors, consoleErrors, failedRequests, errorResponses, blockedExternalRequests: blocked, cleanupVerified };
await writeFile(resolve(folder, 'AUDIT.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baseline, screens: screens.length, errors: errors.length, consoleErrors: consoleErrors.length,
  failure, issues: screens.filter(screen => screen.dialogActionReachable === false || screen.dialogHorizontalOverflow > 1 || screen.dialogOutsideViewport || screen.recoveryScreen || screen.overflow > 1 || screen.missingButtons.length || screen.missingLabels.length || screen.brokenText.length).map(screen => ({ role: screen.role, path: screen.path, variant: screen.variant, actualPath: screen.actualPath, width: screen.width, dialogActionReachable: screen.dialogActionReachable, dialogHorizontalOverflow: screen.dialogHorizontalOverflow, dialogOutsideViewport: screen.dialogOutsideViewport, recoveryScreen: screen.recoveryScreen, overflow: screen.overflow, missingButtons: screen.missingButtons.length, missingLabels: screen.missingLabels.length, brokenText: screen.brokenText })), cleanupVerified }));
if (failure) throw new Error(failure.message);
