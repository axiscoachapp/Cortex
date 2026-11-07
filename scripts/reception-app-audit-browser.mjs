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
import { auditWhatsAppRead } from './fixtures/whatsapp-read-browser.mjs';
import { auditSettingsAccess } from './fixtures/settings-access-browser.mjs';
import { auditPatientWorkspace } from './fixtures/patient-workspace-browser.mjs';
import { auditPostConsultation } from './fixtures/post-consultation-browser.mjs';
import { auditRecoveryNotice } from './fixtures/recovery-notice-browser.mjs';
import { auditSchedulingMigration } from './fixtures/scheduling-migration-browser.mjs';

const args = process.argv.slice(2);
assert.ok(args.every(arg => ['--check-post-consultation','--check-local-recording-recovery','--check-whatsapp-bot-read','--check-whatsapp-history','--check-whatsapp-list'].includes(arg) || /^--(baseline=[0-9a-f]{40}|overlay=src\/[\w/.-]+|run=[a-z0-9-]+|only=time-dialogs|only=week-caption|only=welcome-dashboard|only=chat-prompts|only=short-timestamps|only=medical-delivery|only=delegation-read|only=delegation-decision|only=delegation-conflict|only=delegation-denied|only=delegation-retry|only=mfa-preparation|only=mfa-cleanup|only=mfa-enrollment|only=new-consultation|only=settings-embedded|only=whatsapp-read|only=settings-access|only=patient-workspace|only=recovery-notice|only=scheduling-migration|settings-admin-only|medical-history-only|check-time-layout|check-mobile-navigation|check-calendar-header|check-workspace-layout|check-mfa-error-focus|check-mfa-cancellation)$/.test(arg)), 'Unsupported audit option');
const timeOnly = args.includes('--only=time-dialogs'), checkTimeLayout = args.includes('--check-time-layout');
const weekOnly = args.includes('--only=week-caption');
const chatOnly = args.includes('--only=chat-prompts');
const timestampOnly = args.includes('--only=short-timestamps');
const medicalOnly = args.includes('--only=medical-delivery');
const settingsEmbeddedOnly = args.includes('--only=settings-embedded');
const schedulingMigrationOnly=args.includes('--only=scheduling-migration');
assert.ok(!schedulingMigrationOnly||!args.some(arg=>arg.startsWith('--check-')),'Scheduling migration runs its own checks');
const recoveryNoticeOnly = args.includes('--only=recovery-notice');
const localRecordingRecovery=args.includes('--check-local-recording-recovery');
const postConsultation=args.includes('--check-post-consultation');
assert.ok(!postConsultation||recoveryNoticeOnly&&!localRecordingRecovery,'Post consultation checks require independent recovery notice mode');
assert.ok(!localRecordingRecovery||recoveryNoticeOnly,'Local recording checks require recovery notice mode');
assert.ok(!recoveryNoticeOnly || !args.some(arg=>arg.startsWith('--check-')&&!['--check-local-recording-recovery','--check-post-consultation'].includes(arg)), 'Recovery notice runs its own checks');
const patientWorkspaceOnly = args.includes('--only=patient-workspace');
assert.ok(!patientWorkspaceOnly || !args.some(arg => arg.startsWith('--check-')), 'Patient workspace runs its own checks');
const whatsappReadOnly = args.includes('--only=whatsapp-read');
const whatsappBotRead=args.includes('--check-whatsapp-bot-read');
const whatsappHistory=args.includes('--check-whatsapp-history');
const whatsappList=args.includes('--check-whatsapp-list');
assert.ok(!whatsappList||whatsappReadOnly,'Conversation paging checks require WhatsApp read mode');
assert.ok(!whatsappHistory||whatsappReadOnly,'Message history checks require WhatsApp read mode');
assert.ok(!whatsappBotRead||whatsappReadOnly,'Bot read checks require WhatsApp read mode');
const settingsAccessOnly = args.includes('--only=settings-access'), settingsAdminOnly = args.includes('--settings-admin-only');
assert.ok(!settingsAccessOnly || !args.some(arg => arg.startsWith('--check-')), 'Settings access runs its own checks');
assert.ok(!settingsAdminOnly || settingsAccessOnly, 'Settings admin requires settings access');
assert.ok(!whatsappReadOnly || !args.some(arg => arg.startsWith('--check-')&&!['--check-whatsapp-bot-read','--check-whatsapp-history','--check-whatsapp-list'].includes(arg)), 'WhatsApp read runs its own checks');
assert.ok(!settingsEmbeddedOnly || !args.some(arg => arg.startsWith('--check-')), 'Settings embedded runs its own checks');
const consultationOnly = args.includes('--only=new-consultation');
assert.ok(!consultationOnly || !args.some(arg => arg.startsWith('--check-')), 'New consultation runs its own layout checks');
const mfaOnly = args.includes('--only=mfa-preparation');
const mfaCleanupOnly = args.includes('--only=mfa-cleanup'), mfaEnrollmentOnly = args.includes('--only=mfa-enrollment'), mfaMode = mfaOnly || mfaCleanupOnly || mfaEnrollmentOnly;
const checkMfaErrorFocus = args.includes('--check-mfa-error-focus');
assert.ok(!checkMfaErrorFocus || mfaCleanupOnly, 'MFA error focus requires MFA cleanup mode');
const checkMfaCancellation = args.includes('--check-mfa-cancellation');
assert.ok(!checkMfaCancellation || mfaEnrollmentOnly, 'MFA cancellation requires enrollment mode');
const delegationOnly = args.includes('--only=delegation-read');
const delegationDecisionOnly = args.includes('--only=delegation-decision'), delegationConflictOnly = args.includes('--only=delegation-conflict'), delegationDeniedOnly = args.includes('--only=delegation-denied'), delegationRetryOnly = args.includes('--only=delegation-retry'), delegationMode = delegationOnly || delegationDecisionOnly || delegationConflictOnly || delegationDeniedOnly || delegationRetryOnly;
const medicalHistoryOnly = args.includes('--medical-history-only');
assert.ok(!medicalHistoryOnly || medicalOnly, 'Medical history focus requires medical delivery mode');
const checkWorkspaceLayout = args.includes('--check-workspace-layout');
assert.ok(!checkWorkspaceLayout || timestampOnly, 'Workspace layout checks require the populated timestamp audit');
const welcomeOnly = args.includes('--only=welcome-dashboard'), focusedOnly = weekOnly || welcomeOnly || chatOnly || timestampOnly || medicalOnly || delegationMode || mfaMode || consultationOnly;
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
assert.ok(!delegationRetryOnly || !args.some(arg => arg.startsWith('--check-')), 'Delegation retry mode runs its own checks');
assert.ok(!mfaOnly || !args.some(arg => arg.startsWith('--check-')), 'MFA preparation mode runs its own checks');
assert.ok(!mfaCleanupOnly || !args.some(arg => arg.startsWith('--check-') && arg !== '--check-mfa-error-focus'), 'MFA cleanup only supports error focus checks');
assert.ok(!mfaEnrollmentOnly || !args.some(arg => arg.startsWith('--check-') && arg !== '--check-mfa-cancellation'), 'MFA enrollment only supports cancellation checks');
const checkMobileNavigation = args.includes('--check-mobile-navigation');
assert.ok(!timeOnly || !checkMobileNavigation, 'Mobile navigation checks require the full route audit');
const checkCalendarHeader = args.includes('--check-calendar-header');
assert.ok(!timeOnly || !checkCalendarHeader, 'Calendar header checks require the full route audit');
const git = options => { const result = spawnSync('git', options, { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const baseline = args.find(arg => arg.startsWith('--baseline='))?.slice(11) || git(['rev-parse', 'HEAD']);
const medicalPaths = ['src/components/PatientProfileDrawer.tsx', 'src/pages/PatientManagement.tsx', 'src/pages/KnowledgeBase.tsx', 'src/pages/Templates.tsx', 'src/pages/Assistant.tsx'];
const medicalDelivery = medicalOnly ? git(['rev-parse', 'f2eb189']) : null;
const overlays = args.filter(arg => arg.startsWith('--overlay=')).map(arg => arg.slice(10));
const allowed = /^(src\/App\.tsx|src\/pages\/(Calendar|Sharing|AccountSecurity|Auth|DataPrivacy|ClinicalWorkspace|Index|LegacyWorkspaceRedirect)\.tsx|src\/features\/reception\/[\w/.-]+\.(ts|tsx)|src\/components\/(BottomNavigation|MobileSubpageNavigation|WelcomeDashboard|ChatPanel|PatientProfileDrawer|NewConsultationModal|ConsultationReviewModal|PatientAdministrativeFields|PatientWorkspaceDialog|ClinicalWorkEditor|ConsultationRecoveryNotice|LocalRecordingRecoveryNotice|SchedulingFollowups|PatientSidebar)\.tsx|src\/lib\/(calendarLabels|recordingRescue)\.ts)$/;
for (const path of overlays) assert.match(path, allowed, 'Overlay must be in the Codex audit scope');
assert.ok(!overlays.includes('src/components/PatientProfileDrawer.tsx') || medicalOnly, 'Profile overlay requires medical delivery mode');
assert.ok(!medicalOnly || overlays.length <= 1 && overlays.every(path => path === 'src/components/PatientProfileDrawer.tsx'), 'Medical delivery only permits the explicit profile overlay');
assert.ok(!delegationMode || overlays.length === 0, 'Delegation modes use only the committed snapshot');
assert.ok(!mfaOnly || overlays.length <= 1 && overlays.every(path => path === 'src/pages/AccountSecurity.tsx'), 'MFA preparation permits only the AccountSecurity overlay');
assert.ok(!mfaCleanupOnly || overlays.length <= 1 && overlays.every(path => path === 'src/pages/AccountSecurity.tsx'), 'MFA cleanup permits only the AccountSecurity overlay');
assert.ok(!mfaEnrollmentOnly || overlays.length <= 1 && overlays.every(path => path === 'src/pages/AccountSecurity.tsx'), 'MFA enrollment permits only the AccountSecurity overlay');
assert.ok(!consultationOnly || overlays.length <= 2 && new Set(overlays).size === overlays.length && overlays.every(path => ['src/components/NewConsultationModal.tsx', 'src/components/PatientAdministrativeFields.tsx'].includes(path)), 'New consultation permits only its modal and administrative fields overlays');
assert.ok(!settingsEmbeddedOnly || overlays.length <= 2 && new Set(overlays).size === overlays.length && overlays.every(path => ['src/features/reception/TeamSettings.tsx', 'src/features/reception/DelegationPermissions.tsx'].includes(path)), 'Settings embedded permits only its two section overlays');
const patientWorkspacePaths = ['src/pages/Index.tsx', 'src/pages/ClinicalWorkspace.tsx', 'src/components/ChatPanel.tsx', 'src/components/PatientWorkspaceDialog.tsx', 'src/components/ClinicalWorkEditor.tsx'];
assert.ok(!patientWorkspaceOnly || overlays.length <= 5 && new Set(overlays).size === overlays.length && overlays.every(path => patientWorkspacePaths.includes(path)), 'Patient workspace only permits its five UI overlays');
assert.ok(patientWorkspaceOnly || postConsultation || !overlays.some(path => path === 'src/components/PatientWorkspaceDialog.tsx' || path === 'src/pages/Index.tsx' && !recoveryNoticeOnly), 'Patient workspace overlay requires focused mode');
const schedulingMigrationPaths=['src/App.tsx','src/pages/Calendar.tsx','src/pages/ClinicalWorkspace.tsx','src/pages/LegacyWorkspaceRedirect.tsx','src/components/SchedulingFollowups.tsx','src/components/MobileSubpageNavigation.tsx','src/components/PatientSidebar.tsx','src/features/reception/ClinicAccessGate.tsx'];
assert.ok(!schedulingMigrationOnly||overlays.length<=8&&new Set(overlays).size===overlays.length&&overlays.every(path=>schedulingMigrationPaths.includes(path)),'Scheduling migration only permits its eight route and UI overlays');
assert.ok(schedulingMigrationOnly||!overlays.some(path=>['src/App.tsx','src/pages/LegacyWorkspaceRedirect.tsx','src/components/SchedulingFollowups.tsx','src/components/PatientSidebar.tsx'].includes(path)),'Scheduling migration overlay requires focused mode');
assert.ok(localRecordingRecovery||!overlays.some(path=>['src/components/LocalRecordingRecoveryNotice.tsx','src/lib/recordingRescue.ts'].includes(path)),'Local recording overlays require local recovery checks');
assert.ok(postConsultation||!overlays.includes('src/components/ConsultationReviewModal.tsx'),'Review modal overlay requires post consultation checks');
const recoveryNoticePaths=['src/pages/Index.tsx','src/components/WelcomeDashboard.tsx','src/components/ChatPanel.tsx','src/components/ConsultationRecoveryNotice.tsx',...(postConsultation?['src/components/ConsultationReviewModal.tsx','src/components/PatientWorkspaceDialog.tsx']:[]),...(localRecordingRecovery?['src/components/LocalRecordingRecoveryNotice.tsx','src/lib/recordingRescue.ts']:[])];
assert.ok(!recoveryNoticeOnly || overlays.length<=(localRecordingRecovery?6:postConsultation?3:4) && new Set(overlays).size===overlays.length && overlays.every(path=>recoveryNoticePaths.includes(path)), 'Recovery notice only permits its scoped UI and local-reader overlays');
assert.ok(recoveryNoticeOnly || !overlays.includes('src/components/ConsultationRecoveryNotice.tsx'), 'Recovery notice overlay requires focused mode');
const whatsappPaths = ['src/features/reception/ReceptionQueue.tsx', 'src/features/reception/WhatsAppInbox.tsx', 'src/features/reception/WhatsAppMessages.tsx','src/features/reception/WhatsAppBotSession.tsx'];
assert.ok(!whatsappReadOnly || overlays.length <= 5 && new Set(overlays).size === overlays.length && overlays.every(path => [...whatsappPaths, 'src/features/reception/whatsappApi.ts'].includes(path)), 'WhatsApp read only permits its UI and read-client overlays');
assert.ok(!settingsAccessOnly || overlays.length <= 2 && new Set(overlays).size === overlays.length && overlays.every(path => ['src/features/reception/ClinicAccessGate.tsx', 'src/features/reception/ReceptionLayout.tsx'].includes(path)), 'Settings access only permits gate and reception entry overlays');
const run = args.find(arg => arg.startsWith('--run='))?.slice(6) || 'baseline';
const folder = resolve('docs/reviews/2026-11-05/reception-app-audit', run);
await mkdir(dirname(folder), { recursive: true });
await mkdir(folder); // Unique run: a failed rerun must never retain an old clean report.
const paths = git(['ls-tree', '-r', '--name-only', baseline, '--', 'src']).split('\n').filter(path => /\.(tsx?|jsx?|css|json)$/.test(path));
// C5 consumes this pure module outside src; freeze it along with its UI importer.
const sharedFlowPath='supabase/functions/_shared/whatsappFlow.ts';
if(git(['ls-tree','--name-only',baseline,'--',sharedFlowPath]))paths.push(sharedFlowPath);
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
for (const path of overlays) { assert.ok(sources.has(path) || schedulingMigrationOnly && ['src/pages/LegacyWorkspaceRedirect.tsx','src/components/SchedulingFollowups.tsx'].includes(path) || recoveryNoticeOnly && ['src/components/ConsultationRecoveryNotice.tsx','src/components/LocalRecordingRecoveryNotice.tsx'].includes(path) || patientWorkspaceOnly && path === 'src/components/PatientWorkspaceDialog.tsx' || path === 'src/lib/calendarLabels.ts' || whatsappReadOnly && whatsappPaths.includes(path), 'New source is not allowlisted'); sources.set(path, await readFile(path, 'utf8')); }
assert.ok(!whatsappReadOnly||!sources.get('src/features/reception/WhatsAppMessages.tsx')?.includes('WhatsAppBotSession')||sources.has('src/features/reception/WhatsAppBotSession.tsx'),'Bot component must be explicitly included in the snapshot');
const overlayHashes = overlays.map(path => ({ path, sha256: createHash('sha256').update(sources.get(path)).digest('hex') }));
const frozen = new Map([...sources].map(([path, source]) => [resolve(path).toLowerCase(), { path, source }]));
const frozenLoads = new Set();
const sourceDigest = createHash('sha256'); for (const [path, source] of sources) sourceDigest.update(path + '\0' + source + '\0');
const configurationPaths = ['vite.config.ts', 'index.html', 'tailwind.config.ts', 'postcss.config.js', 'src/lib/interfaceScale.ts', 'package.json', 'package-lock.json'];
for (const path of configurationPaths) assert.equal((await readFile(path, 'utf8')).replaceAll('\r\n', '\n').trim(), git(['show', baseline + ':' + path]), 'Config differs from baseline: ' + path);
assert.equal(git(['ls-tree', '-r', '--name-only', baseline, '--', 'pages', 'components', 'app']), '', 'Additional Tailwind roots need snapshotting');
const tailwindConfiguration = loadConfig(resolve('tailwind.config.ts'));
const tailwindContent = [...sources].filter(([path]) => /\.(tsx?|jsx?)$/.test(path)).map(([path, raw]) => ({ raw, extension: path.split('.').pop() }));
const previewEntry = 'scripts/fixtures/settings-embedded-preview.tsx';
if (settingsEmbeddedOnly) tailwindContent.push({ raw: await readFile(previewEntry, 'utf8'), extension: 'tsx' });
const ownPaths = ['scripts/reception-app-audit-browser.mjs', 'scripts/fixtures/patient-workspace-browser.mjs', 'scripts/fixtures/recovery-notice-api.mjs', 'scripts/fixtures/recovery-notice-browser.mjs', 'scripts/fixtures/post-consultation-api.mjs', 'scripts/fixtures/post-consultation-browser.mjs', 'scripts/fixtures/scheduling-migration-api.mjs', 'scripts/fixtures/scheduling-migration-browser.mjs', 'scripts/fixtures/clinic-review-api.mjs', 'scripts/fixtures/reception-api.mjs', 'scripts/fixtures/whatsapp-read-api.mjs', 'scripts/fixtures/whatsapp-read-browser.mjs', 'scripts/fixtures/settings-access-api.mjs', 'scripts/fixtures/settings-access-browser.mjs', ...(settingsEmbeddedOnly ? [previewEntry] : []), ...configurationPaths];
const ownHashes = await Promise.all(ownPaths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
const apps = [], apis = [], contexts = [], errors = [], blocked = [], consoleErrors = [], screens = [], failedRequests = [], errorResponses = [];
const medicalCaseFailures = []; let medicalCasesAttempted = 0;
const delegationDecisionChecks = [], delegationConflictChecks = [], delegationDeniedChecks = [], delegationRetryChecks = [];
const mfaPreparationChecks = [];
const mfaCleanupChecks = [];
const mfaErrorFocusChecks = [];
const mfaEnrollmentChecks = [], mfaEnrollmentQrChecks = [];
const mfaCancellationChecks = [];
const consultationChecks = [], consultationRequests = [];
const settingsChecks = [], settingsRequests = [], settingsFixtureMetrics = [];
const whatsappChecks = [], whatsappRequests = [];
const settingsAccessChecks = [], settingsAccessRequests = [];
const patientWorkspaceChecks = [], recoveryNoticeChecks = [], schedulingMigrationChecks = [], localRecoveryRequests=[];
const cacheOwner = randomUUID();
let browser, temporaryCache, failure, cleanupVerified = false, navigationKeyboardVerified = false, draftPreserved = false, timestampDataPreserved = false, medicalDataPreserved = false, delegationDataPreserved = false;
async function appFor(api) {
  process.env.VITE_SUPABASE_URL = api.origin; process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key';
  process.env.VITE_BYPASS_EMAIL = ''; process.env.VITE_BYPASS_PASSWORD = '';
  const app = await createServer({ cacheDir: join(temporaryCache, 'app-' + apps.length), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error',
    css: { postcss: { plugins: [tailwindcss({ ...tailwindConfiguration, content: tailwindContent }), autoprefixer()] } },
    plugins: [{ name: 'audit-frozen-source', enforce: 'pre', load(id) { const entry = frozen.get(resolve(id.split('?')[0]).toLowerCase()); if (!entry) return null; frozenLoads.add(entry.path); return entry.source; }, transformIndexHtml(html) { if (!settingsEmbeddedOnly) return html; assert.ok(html.includes('src="/src/main.tsx"')); return html.replace('src="/src/main.tsx"', 'src="/' + previewEntry + '"'); } }] });
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
  if (settingsAccessOnly) page.on('request', request => { if (new URL(request.url()).origin === app.api.origin && request.method() !== 'OPTIONS') settingsAccessRequests.push({ actor: email, method: request.method(), path: new URL(request.url()).pathname }); });
  if (whatsappReadOnly) page.on('request', request => { if (new URL(request.url()).origin === app.api.origin && request.method() !== 'OPTIONS') whatsappRequests.push({ actor: email, method: request.method(), path: new URL(request.url()).pathname }); });
  if (settingsEmbeddedOnly) page.on('request', request => { if (new URL(request.url()).origin === app.api.origin && request.method() !== 'OPTIONS') settingsRequests.push({ actor: email, method: request.method(), path: new URL(request.url()).pathname }); });
  if(localRecordingRecovery||postConsultation)page.on('request',request=>{if(new URL(request.url()).origin===app.api.origin&&request.method()!=='OPTIONS')localRecoveryRequests.push({method:request.method(),path:new URL(request.url()).pathname});});
  page.on('pageerror', error => errors.push({ path: new URL(page.url()).pathname, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ path: new URL(page.url()).pathname, message: message.text(), ...(delegationConflictOnly || delegationDeniedOnly || delegationRetryOnly || mfaCleanupOnly ? { resource: message.location().url ? new URL(message.location().url).pathname : null } : {}) }); });
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
async function capture(page, app, role, path, width, action, variant = '', { navigate = true,viewportOnly=false } = {}) {
  await page.setViewportSize({ width, height: 1000 });
  if (navigate) await page.goto(app.origin + path);
  await page.waitForLoadState('networkidle');
  if (action) { await action(page); await page.waitForLoadState('networkidle'); }
  const file = `${role}-${path.replace(/[^a-z0-9]/gi, '-')}${variant ? '-' + variant : ''}-${width}.png`;
  await page.screenshot({ path: resolve(folder, file), fullPage: !viewportOnly, animations: 'disabled' });
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
  if (actionScreenshot) await page.screenshot({ path: resolve(folder, actionScreenshot), fullPage: !viewportOnly, animations: 'disabled' });
  screens.push({ role, path, variant, actualPath: new URL(page.url()).pathname, width,viewportOnly, dialogActions, dialogActionReachable, recoveryScreen: measurement.headings.includes('Não foi possível exibir esta tela'), ...measurement, screenshot: file, actionScreenshot });
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
  if(schedulingMigrationOnly){
    const api=await startClinicFixture({workspaceDates:true,schedulingReview:true});apis.push(api);const app=await appFor(api);
    const receptionApi=await startReceptionFixture();apis.push(receptionApi);const receptionApp=await appFor(receptionApi);
    await auditSchedulingMigration({api,app,receptionApi,receptionApp,scene,capture,checks:schedulingMigrationChecks,screens,errors,blocked});
  } else if (recoveryNoticeOnly) {
    const api=await startClinicFixture({workspaceDates:true,recoveryNoticeReview:true,postConsultationReview:postConsultation});apis.push(api);
    const app=await appFor(api);
    if(postConsultation)await auditPostConsultation({api,app,scene,capture,checks:recoveryNoticeChecks,screens,errors,blocked,requests:localRecoveryRequests,consoleErrors,errorResponses,failedRequests});
    else await auditRecoveryNotice({api,app,scene,capture,checks:recoveryNoticeChecks,screens,errors,blocked,localReview:localRecordingRecovery,requests:localRecoveryRequests,consoleErrors,errorResponses,failedRequests});
  } else if (patientWorkspaceOnly) {
    const api = await startClinicFixture({ workspaceDates: true, patientWorkspaceReview: true }); apis.push(api);
    const app = await appFor(api);
    await auditPatientWorkspace({ api, app, scene, capture, checks: patientWorkspaceChecks, screens, errors, blocked });
  } else if (settingsAccessOnly) {
    const api = await startReceptionFixture({ settingsReview: true }); apis.push(api);
    const app = await appFor(api);
    await auditSettingsAccess({ api, app, scene, capture, checks: settingsAccessChecks, requests: settingsAccessRequests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked, adminOnly: settingsAdminOnly });
  } else if (whatsappReadOnly) {
    const api = await startReceptionFixture({ whatsappReadReview: true }); apis.push(api);
    const app = await appFor(api);
    await auditWhatsAppRead({ api, app, scene, capture, checks: whatsappChecks, requests: whatsappRequests, screens, errors, consoleErrors, failedRequests, errorResponses, blocked,botReview:whatsappBotRead,historyReview:whatsappHistory,listReview:whatsappList });
  } else if (settingsEmbeddedOnly) {
    for (const scenario of ['admin', 'recepcao-a', 'review']) {
      const permissions = scenario === 'review';
      const api = permissions ? await startClinicFixture({ delegationPermissions: true }) : await startReceptionFixture(); apis.push(api);
      const before = permissions ? null : structuredClone({ staff: api.staff, cases: api.cases, contacts: api.contacts, appointments: api.appointments });
      const app = await appFor(api), path = '/configuracoes-preview?secao=' + (permissions ? 'permissoes' : 'equipe');
      const page = await scene(app, scenario, path); await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
      for (const width of [375, 1280, 1920]) {
        await capture(page, app, scenario, path, width, async () => { await expect(page.getByRole('heading', { name: permissions ? 'Permissões da recepção' : scenario === 'admin' ? 'Equipe e permissões' : 'Configurações', exact: true })).toBeVisible(); }, 'embedded-section');
        const measurement = await page.evaluate(() => ({ mains: document.querySelectorAll('main').length, h1s: document.querySelectorAll('h1').length, regions: [...document.querySelectorAll('section[aria-labelledby]')].map(element => ({ name: document.getElementById(element.getAttribute('aria-labelledby'))?.textContent, tag: document.getElementById(element.getAttribute('aria-labelledby'))?.tagName })) }));
        settingsChecks.push({ scenario, width, ...measurement });
        assert.equal(measurement.mains, 1); assert.equal(measurement.h1s, 1, 'Embedded section duplicated the page heading');
        if (scenario === 'recepcao-a') {
          await expect(page.getByRole('alert')).toHaveText('Somente o administrador pode gerenciar a equipe.'); await expect(page.getByLabel('Nome da secretária', { exact: true })).toHaveCount(0); assert.deepEqual(measurement.regions, []);
        } else {
          const title = permissions ? 'Permissões da recepção' : 'Equipe e permissões'; assert.ok(measurement.regions.some(region => region.name === title && region.tag === 'H2'));
          await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible();
          if (permissions) {
            await expect(page.getByRole('heading', { name: 'Meus pedidos e aprovações', level: 3 })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Recepção pendente', level: 4 })).toBeVisible(); await expect(page.getByRole('link', { name: 'Voltar ao início', exact: true })).toHaveCount(0);
            await capture(page, app, scenario, path, width, async () => { await page.getByRole('button', { name: 'Aprovar acesso', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Recepção pendente'); await expect(page.getByRole('button', { name: 'Confirmar aprovação', exact: true })).toBeEnabled(); }, 'embedded-confirmation', { navigate: false });
            await page.getByRole('dialog').getByRole('button', { name: 'Voltar', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
          } else {
            await expect(page.getByRole('heading', { name: 'Criar conta de recepção', level: 3 })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Contas cadastradas', level: 3 })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Secretária A', level: 4 })).toBeVisible(); await expect(page.getByRole('button', { name: 'Criar conta com acesso restrito', exact: true })).toBeDisabled();
          }
        }
      }
      if (permissions) { assert.deepEqual(api.metrics.delegationUnexpected, []); assert.ok(api.metrics.delegationCalls.length >= 3); }
      else { assert.deepEqual({ staff: api.staff, cases: api.cases, contacts: api.contacts, appointments: api.appointments }, before); assert.deepEqual(api.metrics.clinicalReads, []); assert.deepEqual(api.metrics.externalCalls, []); assert.deepEqual(api.metrics.unknown, []); for (const key of ['bookings','contacts','caseWrites']) assert.equal(api.metrics[key], 0); }
      settingsFixtureMetrics.push({ scenario, metrics: structuredClone(api.metrics) });
    }
    const reads = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_team_doctors', 'POST /rest/v1/rpc/reception_delegation_requests']);
    assert.ok(settingsRequests.every(call => reads.has(call.method + ' ' + call.path))); assert.ok(!settingsRequests.some(call => call.actor === 'recepcao-a' && call.path.endsWith('/reception_team_doctors')));
    assert.equal(screens.length, 12); assert.equal(settingsChecks.length, 9);
    for (const collection of [errors, consoleErrors, failedRequests, errorResponses, blocked]) assert.deepEqual(collection, []);
    for (const screen of screens) { assert.ok(screen.overflow <= 1 && screen.dialogHorizontalOverflow <= 1 && !screen.dialogOutsideViewport && screen.dialogActionReachable !== false); assert.equal(screen.recoveryScreen, false); for (const key of ['missingButtons','missingLabels','brokenText']) assert.deepEqual(screen[key], []); }
  } else if (focusedOnly) {
    const api = await startClinicFixture(welcomeOnly ? { lastVisit: '2026-10-01' } : timestampOnly ? { workspaceDates: true } : medicalOnly || consultationOnly ? { medicalUI: true } : mfaMode ? { mfaReview: true, mfaCleanupReview: mfaCleanupOnly, mfaEnrollmentReview: mfaEnrollmentOnly, mfaCancellationReview: checkMfaCancellation } : delegationMode ? { delegationPermissions: true, delegationDecisions: delegationDecisionOnly || delegationConflictOnly || delegationRetryOnly, delegationReplay: delegationRetryOnly } : {}); apis.push(api); const app = await appFor(api);
    const chatPath = '/?patient=' + patientId;
    const doctor = await scene(app, 'review', mfaMode ? '/seguranca' : delegationMode ? '/permissoes-recepcao' : timestampOnly ? '/trabalho' : chatOnly || medicalOnly ? chatPath : welcomeOnly || consultationOnly ? '/' : '/agenda');
    await doctor.waitForLoadState('networkidle');
    await doctor.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    if (consultationOnly) {
      doctor.on('request', request => { const url = new URL(request.url()); if (url.origin === api.origin && request.method() !== 'OPTIONS') consultationRequests.push({ method: request.method(), path: url.pathname }); });
      const patientBefore = structuredClone(api.medicalData.patients);
      const dialog = () => doctor.getByRole('dialog');
      const measure = async (width, variant, prefix = 'new-patient') => {
        const measured = await dialog().evaluate((element, prefix) => {
          const bounds = element.getBoundingClientRect();
          const fields = Object.fromEntries([...element.querySelectorAll('input,select,textarea')].map(input => { const box = input.getBoundingClientRect(); return [input.id, { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, value: input.value }]; }));
          return { dialogWidth: bounds.width, left: bounds.left, right: bounds.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, fields, prefix };
        }, prefix);
        consultationChecks.push({ width, variant, ...measured });
        assert.ok(measured.left >= -1 && measured.right <= width + 1 && measured.scrollWidth <= measured.clientWidth + 1, 'Consultation dialog is clipped');
        const pairs = prefix === 'new-patient' ? [['name','birth-date'],['age','profession'],['phone','email'],['cpf','healthInsurance']] : [['phone','email'],['cpf','healthInsurance']];
        for (const [first, second] of pairs) {
          const a = measured.fields[prefix + '-' + first], b = measured.fields[prefix + '-' + second];
          assert.ok(a && b); assert.ok(a.left >= measured.left && b.right <= measured.right && a.height >= 44 && b.height >= 44);
          assert.ok(width >= 864 ? Math.abs(a.top - b.top) <= 1 : b.top >= a.bottom, 'Paired fields are misaligned: ' + first + '/' + second);
        }
        if (prefix === 'new-patient') {
          assert.ok(measured.dialogWidth >= Math.min(width - 43.2, 1209.6) - 2, 'New consultation wastes available width');
          for (const field of Object.values(measured.fields)) assert.ok(field.left >= measured.left && field.right <= measured.right && field.height >= 58, 'Consultation control is clipped or too short');
          if (width >= 864) {
            for (const field of Object.values(measured.fields)) assert.ok(field.width >= 300, 'Consultation control is too narrow');
            for (const column of [['name','age','phone','cpf','sex'],['birth-date','profession','email','healthInsurance']]) {
              const first = measured.fields[prefix + '-' + column[0]];
              for (const id of column) { const field = measured.fields[prefix + '-' + id]; assert.ok(Math.abs(field.left - first.left) <= 1 && Math.abs(field.right - first.right) <= 1, 'Form columns do not align across groups'); }
            }
          } else {
            const first = measured.fields[prefix + '-name'];
            for (const field of Object.values(measured.fields)) assert.ok(Math.abs(field.left - first.left) <= 1 && Math.abs(field.right - first.right) <= 1, 'Mobile controls need the full form width');
          }
        }
      };
      for (const width of [933, 375, 1280, 1920]) {
        await capture(doctor, app, 'clinical', '/', width, async page => { await page.getByRole('button', { name: 'Nova Consulta', exact: true }).first().click(); await expect(dialog()).toBeVisible(); await expect(dialog().getByRole('option', { name: /Paciente Exemplo A/ })).toBeVisible(); }, 'consultation-existing');
        const marker = randomUUID(); await doctor.evaluate(value => { document.documentElement.dataset.auditDocument = value; }, marker);
        const sameDocument = async () => assert.equal(await doctor.evaluate(() => document.documentElement.dataset.auditDocument), marker);
        await capture(doctor, app, 'clinical', '/', width, async () => { await dialog().getByRole('button', { name: 'Novo Paciente', exact: true }).click(); await expect(dialog().getByLabel('Nome do Paciente *', { exact: true })).toBeVisible(); }, 'consultation-new-empty', { navigate: false });
        await measure(width, 'empty');
        await capture(doctor, app, 'clinical', '/', width, async () => {
          await sameDocument();
          const values = { 'new-patient-name': 'Pessoa sintética de revisão', 'new-patient-age': '35', 'new-patient-profession': 'Profissão sintética', 'new-patient-phone': '+5511000000000', 'new-patient-email': 'review@example.invalid', 'new-patient-healthInsurance': 'Plano sintético', 'chief-complaint': 'Queixa sintética para revisão visual.' };
          for (const [id, value] of Object.entries(values)) await dialog().locator('#' + id).fill(value);
          await dialog().getByRole('button', { name: 'Paciente Existente', exact: true }).click(); await dialog().getByRole('button', { name: 'Novo Paciente', exact: true }).click();
          for (const [id, value] of Object.entries(values)) await expect(dialog().locator('#' + id)).toHaveValue(value);
          await expect(dialog().getByRole('button', { name: 'Iniciar Consulta', exact: true })).toBeEnabled(); await expect(dialog().getByRole('alert')).toHaveCount(0);
        }, 'consultation-new-filled', { navigate: false });
        await measure(width, 'filled');
        const discardWait = doctor.waitForEvent('dialog'), cancel = dialog().getByRole('button', { name: 'Cancelar', exact: true }).click(); const discard = await discardWait; assert.equal(discard.type(), 'confirm'); await discard.accept(); await cancel; await expect(dialog()).toHaveCount(0);
        await capture(doctor, app, 'clinical', '/gerenciar-pacientes', width, async page => { await page.getByRole('button', { name: 'Novo Paciente', exact: true }).click(); await expect(dialog()).toBeVisible(); }, 'administrative-fields-regression');
        await measure(width, 'administrative-regression', 'patient');
      }
      assert.equal(screens.length, 16); assert.equal(consultationChecks.length, 12); assert.deepEqual(api.medicalData.patients, patientBefore);
      const readPosts = new Set(['/auth/v1/token', '/rest/v1/rpc/clinic_access', '/rest/v1/rpc/workspace_directory']);
      assert.ok(consultationRequests.every(call => ['GET','HEAD'].includes(call.method) || call.method === 'POST' && readPosts.has(call.path)), 'Unexpected mutation in consultation audit');
      for (const key of ['briefings','checklists','chat','newSources','patientWrites','appointmentWrites']) assert.equal(api.metrics[key], 0);
      assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(errorResponses, []); assert.deepEqual(blocked, []);
      assert.ok(failedRequests.every(item => item.method === 'HEAD' && item.path === '/rest/v1/patients' && item.reason === 'net::ERR_ABORTED' && item.status === 200), 'Unexpected consultation request failure');
      for (const screen of screens) { assert.ok(screen.overflow <= 1 && screen.dialogHorizontalOverflow <= 1 && !screen.dialogOutsideViewport && screen.dialogActionReachable !== false); assert.equal(screen.recoveryScreen, false); for (const key of ['missingButtons','missingLabels','brokenText']) assert.deepEqual(screen[key], []); }
    } else if (mfaEnrollmentOnly) {
      const original = structuredClone(api.mfaFactors), newId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const rows = async (page, expected) => {
        await expect(page.locator('main li')).toHaveCount(expected.length);
        for (const factor of expected) { const row = page.locator('main li').filter({ hasText: factor.friendly_name }); await expect(row).toHaveCount(1); await expect(row.locator('span').first()).toHaveText(factor.friendly_name + ' · ' + (factor.status === 'verified' ? 'Ativo' : 'Configuração pendente')); }
      };
      const qr = page => page.getByRole('img', { name: 'QR code para configurar seu autenticador', exact: true });
      for (const width of [375, 1280, 1920]) {
        api.resetMfaEnrollment(); const before = api.metrics.mfaEnrollmentCalls.length;
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await rows(page, original); await expect(page.getByRole('button', { name: 'Adicionar autenticador', exact: true })).toBeEnabled(); assert.equal(api.metrics.mfaEnrollmentCalls.length, before); }, 'enrollment-initial');
        const marker = randomUUID(); await doctor.evaluate(value => { document.documentElement.dataset.auditDocument = value; }, marker);
        const sameDocument = async page => assert.equal(await page.evaluate(() => document.documentElement.dataset.auditDocument), marker, 'MFA enrollment reloaded the document');
        await doctor.getByRole('button', { name: 'Adicionar autenticador', exact: true }).click(); await expect(doctor.getByRole('heading', { name: 'Configurar aplicativo', exact: true })).toBeVisible();
        await capture(doctor, app, 'security', '/seguranca', width, async page => {
          await sameDocument(page); await expect(qr(page)).toBeVisible();
          const measurement = await qr(page).evaluate(image => { const box = image.getBoundingClientRect(), section = image.closest('section'), parent = section.getBoundingClientRect(), style = getComputedStyle(section), scale = parent.width / section.offsetWidth, contentLeft = parent.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * scale, contentRight = parent.right - (parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)) * scale; return { width: box.width, height: box.height, left: box.left, right: box.right, contentLeft, contentRight, contentWidth: contentRight - contentLeft }; });
          mfaEnrollmentQrChecks.push({ width, ...measurement });
        }, 'enrollment-setup', { navigate: false });
        const measurement = mfaEnrollmentQrChecks.at(-1); assert.ok(Math.abs(measurement.width - measurement.height) <= 1, 'QR image distorted: ' + JSON.stringify(measurement)); assert.ok(measurement.width <= measurement.contentWidth + 2); assert.ok(measurement.left >= measurement.contentLeft - 2 && measurement.right <= measurement.contentRight + 2, 'QR image crosses section content edges');
        const expected = structuredClone(api.mfaFactors); assert.deepEqual(expected.slice(0, 2), original.slice(0, 2)); assert.equal(expected[2].id, newId); assert.equal(expected[2].status, 'unverified'); await rows(doctor, expected);
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await rows(page, expected); await page.getByText('Inserir chave manualmente', { exact: true }).click(); await expect(page.getByText('SYNTHETIC-NOT-A-REAL-SECRET', { exact: true })).toBeVisible(); await page.getByLabel('Código do aplicativo', { exact: true }).fill('1234'); await expect(page.getByRole('button', { name: 'Verificar código', exact: true })).toBeDisabled(); assert.equal(api.metrics.mfaEnrollmentCalls.length, before + 2); }, 'enrollment-manual-placeholder', { navigate: false });
        const dialogWait = doctor.waitForEvent('dialog'), click = doctor.getByRole('button', { name: 'Cancelar configuração', exact: true }).click(); const dialog = await dialogWait; assert.equal(dialog.type(), 'confirm'); assert.equal(dialog.message(), 'Remover este autenticador da sua conta?'); await dialog.dismiss(); await click;
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await rows(page, expected); await expect(qr(page)).toBeVisible(); await expect(page.getByLabel('Código do aplicativo', { exact: true })).toHaveValue('1234'); await expect(page.getByRole('alert')).toHaveCount(0); assert.equal(api.metrics.mfaEnrollmentCalls.length, before + 2); }, 'enrollment-cancellation-dismissed', { navigate: false });
        const [removed, enrolled] = api.metrics.mfaEnrollmentCalls.slice(before); assert.deepEqual(removed, { kind: 'remove', factorId: original[2].id }); assert.equal(enrolled.kind, 'enroll'); assert.equal(enrolled.factorId, newId); assert.equal(enrolled.args.factor_type, 'totp'); assert.equal(enrolled.args.issuer, 'Haddad Nicola'); assert.equal(enrolled.args.friendly_name, expected[2].friendly_name); assert.deepEqual(api.mfaFactors, expected);
        mfaEnrollmentChecks.push({ width, sameDocument: true, removedId: removed.factorId, enrolledId: newId, verifiedFactorsUnchanged: true, newFactorVerified: false, cancellationDismissed: true, calls: 2 });
        if (checkMfaCancellation) {
          await doctor.getByLabel('Código do aplicativo', { exact: true }).fill('123456');
          const confirmation = doctor.waitForEvent('dialog'), cancelClick = doctor.getByRole('button', { name: 'Cancelar configuração', exact: true }).click(); const cancelDialog = await confirmation;
          assert.equal(cancelDialog.type(), 'confirm'); assert.equal(cancelDialog.message(), 'Remover este autenticador da sua conta?'); await cancelDialog.accept(); await cancelClick;
          await expect(doctor.getByText('Autenticador removido.', { exact: true })).toBeVisible();
          await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await rows(page, original.slice(0, 2)); await expect(qr(page)).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Configurar aplicativo', exact: true })).toHaveCount(0); }, 'cancellation-confirmed', { navigate: false });
          const input = doctor.getByLabel('Código do aplicativo', { exact: true }), selector = doctor.getByRole('combobox', { name: 'Autenticador', exact: true });
          const observation = { width, code: await input.inputValue(), selectedId: await selector.inputValue(), optionIds: await selector.locator('option').evaluateAll(options => options.map(option => option.value)), calls: api.metrics.mfaEnrollmentCalls.length - before, sameDocument: true };
          mfaCancellationChecks.push(observation);
          assert.equal(observation.code, '', 'Code from the removed setup was retained'); assert.equal(observation.selectedId, original[0].id, 'Removed setup selection was retained'); assert.deepEqual(observation.optionIds, ['', ...original.slice(0, 2).map(factor => factor.id)]);
          await expect(doctor.getByRole('button', { name: 'Verificar código', exact: true })).toBeDisabled();
          await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await input.fill('654321'); await expect(selector).toHaveValue(original[0].id); await expect(page.getByRole('button', { name: 'Verificar código', exact: true })).toBeEnabled(); assert.equal(await input.evaluate(element => element.form.checkValidity()), true); await rows(page, original.slice(0, 2)); await expect(page.getByRole('button', { name: 'Adicionar autenticador', exact: true })).toBeEnabled(); }, 'cancellation-fresh-code', { navigate: false });
          assert.deepEqual(api.mfaFactors, original.slice(0, 2)); assert.deepEqual(api.metrics.mfaEnrollmentCalls.slice(before + 2), [{ kind: 'remove', factorId: newId }]); assert.equal(observation.calls, 3);
        }
      }
      const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'DELETE /auth/v1/factors/' + original[2].id, 'POST /auth/v1/factors', ...(checkMfaCancellation ? ['DELETE /auth/v1/factors/' + newId] : [])]); assert.ok(api.metrics.mfaRequests.every(call => allowed.has(call.method + ' ' + call.path))); assert.deepEqual(api.metrics.mfaUnexpected, []); assert.equal(api.metrics.mfaEnrollmentCalls.length, checkMfaCancellation ? 9 : 6); assert.equal(screens.length, checkMfaCancellation ? 18 : 12);
      for (const measured of screens) { assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'MFA enrollment layout is clipped'); assert.equal(measured.recoveryScreen, false); assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []); }
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0); for (const observations of [errors, consoleErrors, errorResponses, failedRequests, blocked]) assert.deepEqual(observations, []);
    } else if (mfaCleanupOnly) {
      const factors = structuredClone(api.mfaFactors), pending = factors.find(factor => factor.status === 'unverified'), deletePath = '/auth/v1/factors/' + pending.id;
      const ready = async page => {
        await expect(page.getByRole('heading', { name: 'Segurança da conta', exact: true })).toBeVisible(); await expect(page.locator('main li')).toHaveCount(3);
        for (const factor of factors) { const row = page.locator('main li').filter({ hasText: factor.friendly_name }); await expect(row).toHaveCount(1); await expect(row.locator('span').first()).toHaveText(factor.friendly_name + ' · ' + (factor.status === 'verified' ? 'Ativo' : 'Configuração pendente')); }
        await expect(page.getByRole('button', { name: 'Adicionar autenticador', exact: true })).toBeEnabled(); await expect(page.getByRole('heading', { name: 'Configurar aplicativo', exact: true })).toHaveCount(0);
      };
      const denied = async page => {
        await ready(page); const alert = page.getByRole('alert'); await expect(alert).toHaveText('Não foi possível concluir. Confira o código e a conexão e tente novamente.');
        if (!checkMfaErrorFocus) { await alert.scrollIntoViewIfNeeded(); return null; }
        await expect(alert).toBeFocused(); let visibility;
        await expect.poll(async () => {
          visibility = await alert.evaluate(element => {
            const rect = element.getBoundingClientRect(), points = [[rect.left + 1, rect.top + 1], [rect.right - 1, rect.top + 1], [rect.left + 1, rect.bottom - 1], [rect.right - 1, rect.bottom - 1], [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2]];
            return { top: rect.top, bottom: rect.bottom, focused: document.activeElement === element, fits: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth, exposed: points.every(([x,y]) => { const hit = document.elementFromPoint(x,y); return hit === element || !!hit && element.contains(hit); }) };
          }); return visibility.focused && visibility.fits && visibility.exposed;
        }).toBe(true); return visibility;
      };
      const recordFocus = async (page, width, phase, code) => {
        const visibility = await denied(page);
        if (checkMfaErrorFocus) { await expect(page.getByRole('combobox', { name: 'Autenticador', exact: true })).toHaveValue(factors[1].id); await expect(page.getByLabel('Código do aplicativo', { exact: true })).toHaveValue(code); mfaErrorFocusChecks.push({ width, phase, codeLength: code.length, ...visibility }); }
      };
      for (const width of [375, 1280, 1920]) {
        const before = api.metrics.mfaCleanupCalls.length;
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await ready(page); if (checkMfaErrorFocus) { await page.getByRole('combobox', { name: 'Autenticador', exact: true }).selectOption(factors[1].id); await page.getByLabel('Código do aplicativo', { exact: true }).fill('1234'); } }, 'cleanup-initial');
        const marker = randomUUID(); await doctor.evaluate(value => { document.documentElement.dataset.auditDocument = value; }, marker);
        const sameDocument = async page => assert.equal(await page.evaluate(() => document.documentElement.dataset.auditDocument), marker, 'MFA cleanup reloaded the document');
        await doctor.getByRole('button', { name: 'Adicionar autenticador', exact: true }).click(); await denied(doctor);
        assert.deepEqual(api.metrics.mfaUnexpected, [], 'Failed cleanup must not attempt enrollment');
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await recordFocus(page, width, 'first', '1234'); assert.equal(api.metrics.mfaCleanupCalls.length, before + 1); }, 'cleanup-denied', { navigate: false });
        if (checkMfaErrorFocus) { const input = doctor.getByLabel('Código do aplicativo', { exact: true }); await input.fill('12345'); await expect(input).toHaveValue('12345'); await expect(input).toBeFocused(); }
        await doctor.getByRole('button', { name: 'Adicionar autenticador', exact: true }).click(); await denied(doctor);
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await recordFocus(page, width, 'repeat', '12345'); assert.equal(api.metrics.mfaCleanupCalls.length, before + 2); assert.deepEqual(api.metrics.mfaUnexpected, []); }, 'cleanup-retry-denied', { navigate: false });
        const dialogWait = doctor.waitForEvent('dialog'), click = doctor.locator('main li').filter({ hasText: pending.friendly_name }).getByRole('button', { name: 'Remover', exact: true }).click();
        const dialog = await dialogWait; assert.equal(dialog.type(), 'confirm'); assert.equal(dialog.message(), 'Remover este autenticador da sua conta?'); await dialog.dismiss(); await click;
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await ready(page); await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByText('Autenticador removido.', { exact: true })).toHaveCount(0); if (checkMfaErrorFocus) { await expect(page.getByLabel('Código do aplicativo', { exact: true })).toHaveValue('12345'); await expect(page.getByRole('combobox', { name: 'Autenticador', exact: true })).toHaveValue(factors[1].id); } assert.equal(api.metrics.mfaCleanupCalls.length, before + 2); }, 'cleanup-removal-cancelled', { navigate: false });
        assert.deepEqual(api.mfaFactors, factors); mfaCleanupChecks.push({ width, sameDocument: true, failedDeletes: 2, enrollmentAttempted: false, removalCancelled: true });
      }
      const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'DELETE ' + deletePath]); assert.ok(api.metrics.mfaRequests.every(call => allowed.has(call.method + ' ' + call.path))); assert.deepEqual(api.metrics.mfaUnexpected, []);
      assert.deepEqual(api.metrics.mfaCleanupCalls, Array.from({ length: 6 }, () => ({ factorId: pending.id, status: 403 })));
      assert.deepEqual(errorResponses, Array.from({ length: 6 }, () => ({ path: deletePath, status: 403 })));
      assert.deepEqual(consoleErrors, Array.from({ length: 6 }, () => ({ path: '/seguranca', resource: deletePath, message: 'Failed to load resource: the server responded with a status of 403 (Forbidden)' })));
      assert.equal(screens.length, 12);
      if (checkMfaErrorFocus) assert.equal(mfaErrorFocusChecks.length, 6);
      for (const measured of screens) { assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'MFA cleanup layout is clipped'); assert.equal(measured.recoveryScreen, false); assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []); }
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0);
      for (const observations of [errors, failedRequests, blocked]) assert.deepEqual(observations, []);
    } else if (mfaOnly) {
      const factors = structuredClone(api.mfaFactors), selected = factors[1];
      const ready = async page => {
        await expect(page.getByRole('heading', { name: 'Segurança da conta', exact: true })).toBeVisible(); await expect(page.locator('main li')).toHaveCount(3);
        for (const factor of factors) { const row = page.locator('main li').filter({ hasText: factor.friendly_name }); await expect(row).toHaveCount(1); await expect(row.locator('span').first()).toHaveText(factor.friendly_name + ' · ' + (factor.status === 'verified' ? 'Ativo' : 'Configuração pendente')); }
        await expect(page.getByRole('button', { name: 'Remover', exact: true })).toHaveCount(3); await expect(page.getByRole('button', { name: 'Adicionar autenticador', exact: true })).toBeEnabled();
        await expect(page.getByRole('combobox', { name: 'Autenticador', exact: true }).locator('option')).toHaveCount(3); await expect(page.getByRole('option', { name: factors[2].friendly_name, exact: true })).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
      };
      for (const width of [375, 1280, 1920]) {
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await ready(page); await expect(page.getByLabel('Código do aplicativo', { exact: true })).toHaveValue(''); await expect(page.getByRole('button', { name: 'Verificar código', exact: true })).toBeDisabled(); }, 'mfa-factors');
        const marker = randomUUID(); await doctor.evaluate(value => { document.documentElement.dataset.auditDocument = value; }, marker);
        const sameDocument = async page => assert.equal(await page.evaluate(() => document.documentElement.dataset.auditDocument), marker, 'MFA preparation reloaded the document');
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await page.getByRole('combobox', { name: 'Autenticador', exact: true }).selectOption(selected.id); await expect(page.getByRole('combobox', { name: 'Autenticador', exact: true })).toHaveValue(selected.id); await expect(page.getByRole('button', { name: 'Verificar código', exact: true })).toBeDisabled(); }, 'mfa-selected', { navigate: false });
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await page.getByLabel('Código do aplicativo', { exact: true }).fill('12x34'); await expect(page.getByLabel('Código do aplicativo', { exact: true })).toHaveValue('1234'); await expect(page.getByRole('button', { name: 'Verificar código', exact: true })).toBeDisabled(); }, 'mfa-short-code', { navigate: false });
        await capture(doctor, app, 'security', '/seguranca', width, async page => { await sameDocument(page); await page.getByLabel('Código do aplicativo', { exact: true }).fill('123456'); await expect(page.getByLabel('Código do aplicativo', { exact: true })).toHaveValue('123456'); await expect(page.getByRole('combobox', { name: 'Autenticador', exact: true })).toHaveValue(selected.id); await expect(page.getByRole('button', { name: 'Verificar código', exact: true })).toBeEnabled(); await ready(page); }, 'mfa-ready-without-submit', { navigate: false });
        assert.deepEqual(api.mfaFactors, factors); mfaPreparationChecks.push({ width, factorId: selected.id, sameDocument: true, incompleteCodeDisabled: true, completeCodeEnabled: true, submitted: false });
      }
      assert.ok(api.metrics.mfaRequests.length > 0); const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user']); assert.ok(api.metrics.mfaRequests.every(call => allowed.has(call.method + ' ' + call.path))); assert.deepEqual(api.metrics.mfaUnexpected, []);
      assert.equal(screens.length, 12);
      for (const measured of screens) { assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'MFA preparation layout is clipped'); assert.equal(measured.recoveryScreen, false); assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []); }
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0);
      for (const observations of [errors, errorResponses, consoleErrors, failedRequests, blocked]) assert.deepEqual(observations, []);
    } else if (delegationRetryOnly) {
      const originalRows = structuredClone(api.delegationRows), targetId = originalRows[0].id, approvePath = '/rest/v1/rpc/reception_decide_delegation';
      const target = page => page.locator('article').filter({ has: page.getByRole('heading', { name: originalRows[0].staffName, exact: true }) });
      const confirm = page => page.getByRole('dialog').getByRole('button', { name: 'Confirmar aprovação', exact: true });
      const verifyRows = async (page, approved = false) => {
        await expect(page.locator('article')).toHaveCount(3);
        for (const [index, row] of originalRows.entries()) {
          const card = page.locator('article').filter({ has: page.getByRole('heading', { name: row.staffName, exact: true }) }), changed = index === 0 && approved;
          await expect(card).toHaveCount(1); await expect(card).toContainText(row.clinicName + ' · ' + row.doctorName); await expect(card).toContainText('05/11/2026, 11:00:00');
          await expect(card.getByText(changed || row.state === 'approved' ? 'Aprovado' : 'Aguardando médico', { exact: true })).toBeVisible();
          await expect(card.getByText(changed || row.effective ? 'Acesso ativo' : 'Sem acesso ativo', { exact: true })).toBeVisible();
          for (const label of ['Aprovar acesso', 'Recusar pedido']) await expect(card.getByRole('button', { name: label, exact: true })).toHaveCount(!changed && row.canDecide ? 1 : 0);
          await expect(card.getByRole('button', { name: 'Revogar acesso', exact: true })).toHaveCount(changed || row.canRevoke ? 1 : 0);
        }
      };
      const openConfirmation = async page => {
        await target(page).getByRole('button', { name: 'Aprovar acesso', exact: true }).click();
        for (const label of [originalRows[0].staffName, originalRows[0].clinicName, originalRows[0].doctorName, 'prontuários']) await expect(page.getByRole('dialog')).toContainText(label);
        await expect(confirm(page)).toBeEnabled();
      };
      for (const width of [375, 1280, 1920]) {
        api.resetDelegationDecisions(); const attemptsBefore = api.metrics.delegationAttempts.length, writesBefore = api.metrics.delegationWrites.length, repliesBefore = api.metrics.delegationReplies.length;
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => { await verifyRows(page); await openConfirmation(page); }, 'retry-initial-confirmation');
        assert.equal(api.metrics.delegationAttempts.length, attemptsBefore);
        const marker = randomUUID(); await doctor.evaluate(value => { document.documentElement.dataset.auditDocument = value; }, marker);
        const sameDocument = async page => assert.equal(await page.evaluate(() => document.documentElement.dataset.auditDocument), marker, 'Decision retry reloaded the document');
        api.armDelegationLostReply(targetId); await confirm(doctor).click();
        await expect(doctor.getByRole('dialog').getByRole('alert')).toHaveText('Não foi possível confirmar a operação. Tente novamente com os mesmos dados.'); await expect(confirm(doctor)).toBeEnabled();
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await sameDocument(page); await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Não foi possível confirmar a operação. Tente novamente com os mesmos dados.');
          assert.equal(api.metrics.delegationAttempts.length, attemptsBefore + 1); assert.equal(api.metrics.delegationWrites.length, writesBefore + 1); assert.equal(api.metrics.delegationReplies.at(-1).kind, 'truncated');
        }, 'retry-unconfirmed-reply', { navigate: false });
        await doctor.getByRole('dialog').getByRole('button', { name: 'Voltar', exact: true }).click();
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await sameDocument(page); await verifyRows(page); await openConfirmation(page);
          assert.equal(api.metrics.delegationAttempts.length, attemptsBefore + 1); assert.equal(api.metrics.delegationWrites.length, writesBefore + 1);
        }, 'retry-explicit-confirmation', { navigate: false });
        await confirm(doctor).click(); await expect(doctor.getByRole('dialog')).toHaveCount(0); await expect(target(doctor).getByText('Aprovado', { exact: true })).toBeVisible();
        await capture(doctor, app, 'permissions', '/permissoes-recepcao', width, async page => {
          await sameDocument(page); await verifyRows(page, true); await expect(page.getByRole('alert')).toHaveCount(0); await target(page).scrollIntoViewIfNeeded();
        }, 'retry-acknowledged', { navigate: false });
        const [first, replay] = api.metrics.delegationAttempts.slice(attemptsBefore), [truncatedReply, replayedReply] = api.metrics.delegationReplies.slice(repliesBefore);
        assert.equal(api.metrics.delegationAttempts.length, attemptsBefore + 2); assert.equal(api.metrics.delegationWrites.length, writesBefore + 1); assert.equal(api.metrics.delegationReplies.length, repliesBefore + 2);
        assert.deepEqual(first.args, replay.args); assert.equal(first.args.p_request, targetId); assert.equal(first.args.p_revision, 1); assert.equal(first.args.p_decision, 'approve'); assert.equal(first.path, approvePath); assert.equal(replay.path, approvePath); assert.equal(replay.replay, true);
        assert.equal(truncatedReply.kind, 'truncated'); assert.equal(replayedReply.kind, 'replay'); assert.deepEqual(truncatedReply.snapshot, replayedReply.snapshot);
        assert.deepEqual(api.delegationRows, [{ ...originalRows[0], state: 'approved', revision: 2, effective: true, canDecide: false, canRevoke: true }, ...originalRows.slice(1)]);
        delegationRetryChecks.push({ width, sameDocument: true, first, replay, snapshot: replayedReply.snapshot, successfulWrites: 1 });
      }
      const allowed = new Set(['POST /auth/v1/token', 'GET /auth/v1/user', 'POST /rest/v1/rpc/clinic_access', 'POST /rest/v1/rpc/reception_delegation_requests', 'POST ' + approvePath]);
      assert.ok(api.metrics.delegationRequests.every(call => allowed.has(call.method + ' ' + call.path))); assert.deepEqual(api.metrics.delegationUnexpected, []);
      assert.equal(api.metrics.delegationWrites.length, 3); assert.equal(api.metrics.delegationAttempts.length, 6); assert.equal(new Set(api.metrics.delegationAttempts.map(attempt => attempt.args.p_operation)).size, 3);
      assert.deepEqual(failedRequests, Array.from({ length: 3 }, () => ({ method: 'POST', path: approvePath, status: 200, reason: 'net::ERR_CONTENT_LENGTH_MISMATCH' })));
      assert.deepEqual(consoleErrors, Array.from({ length: 3 }, () => ({ path: '/permissoes-recepcao', resource: approvePath, message: 'Failed to load resource: net::ERR_CONTENT_LENGTH_MISMATCH' })));
      assert.equal(screens.length, 12);
      for (const measured of screens) {
        assert.ok(measured.overflow <= 1 && measured.dialogHorizontalOverflow <= 1 && !measured.dialogOutsideViewport && measured.dialogActionReachable !== false, 'Delegation retry layout or dialog action is clipped');
        assert.equal(measured.recoveryScreen, false); assert.deepEqual(measured.missingButtons, []); assert.deepEqual(measured.missingLabels, []); assert.deepEqual(measured.brokenText, []);
      }
      for (const key of ['briefings', 'checklists', 'chat', 'newSources', 'patientWrites', 'appointmentWrites']) assert.equal(api.metrics[key], 0);
      for (const observations of [errors, errorResponses, blocked]) assert.deepEqual(observations, []);
    } else if (delegationDeniedOnly) {
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
    await nav.getByRole('link', { name: 'Pacientes', exact: true }).focus(); await doctor.keyboard.press('Enter');
    await expect(doctor).toHaveURL(doctorApp.origin + '/gerenciar-pacientes');
    await expect(nav.getByRole('link', { name: 'Pacientes', exact: true })).toHaveAttribute('aria-current', 'page');
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
  const requiredSources = consultationOnly ? ['src/components/NewConsultationModal.tsx', 'src/components/PatientAdministrativeFields.tsx', 'src/pages/PatientManagement.tsx'] : mfaMode ? ['src/pages/AccountSecurity.tsx', 'src/lib/mfa.ts'] : delegationMode ? ['src/features/reception/DelegationPermissions.tsx', 'src/features/reception/delegationApi.ts'] : medicalOnly ? medicalHistoryOnly ? ['src/components/PatientProfileDrawer.tsx'] : medicalPaths : timestampOnly ? ['src/pages/ClinicalWorkspace.tsx', 'src/components/ChatPanel.tsx', 'src/lib/recordingRescue.ts'] : chatOnly ? ['src/pages/Index.tsx', 'src/components/ChatPanel.tsx'] : welcomeOnly ? ['src/pages/Index.tsx', 'src/components/WelcomeDashboard.tsx'] : weekOnly ? ['src/pages/Calendar.tsx', 'src/components/CalendarWeekDetails.tsx'] : ['src/features/reception/ReceptionCalendar.tsx', ...(!timeOnly ? ['src/pages/Calendar.tsx', 'src/pages/Sharing.tsx', 'src/pages/AccountSecurity.tsx', 'src/pages/ClinicalWorkspace.tsx', 'src/pages/DataPrivacy.tsx'] : [])];
  const requiredEntrySources = schedulingMigrationOnly ? ['src/pages/Auth.tsx',...schedulingMigrationPaths,'src/components/PatientWorkspaceDialog.tsx','src/features/reception/ReceptionCalendar.tsx'] : recoveryNoticeOnly ? ['src/App.tsx','src/pages/Auth.tsx',...recoveryNoticePaths] : patientWorkspaceOnly ? ['src/App.tsx', 'src/pages/Auth.tsx', ...patientWorkspacePaths, 'src/components/ClinicalWorkEditor.tsx'] : settingsAccessOnly ? ['src/App.tsx', 'src/pages/Auth.tsx', 'src/features/reception/ClinicAccessGate.tsx', 'src/pages/Settings.tsx', 'src/features/settings/WhatsAppSettings.tsx', 'src/features/settings/AutomationEditor.tsx', ...(sources.get('src/features/settings/WhatsAppSettings.tsx')?.includes('<FlowEditor')?['src/features/settings/FlowEditor.tsx',sharedFlowPath]:[]), ...(!settingsAdminOnly ? ['src/features/reception/ReceptionLayout.tsx'] : [])] : whatsappReadOnly ? ['src/App.tsx', 'src/pages/Auth.tsx', ...whatsappPaths.filter(path=>path!=='src/features/reception/WhatsAppBotSession.tsx'||sources.get('src/features/reception/WhatsAppMessages.tsx')?.includes('WhatsAppBotSession')), 'src/features/reception/whatsappApi.ts'] : settingsEmbeddedOnly ? ['src/contexts/AuthContext.tsx', 'src/features/reception/TeamSettings.tsx', 'src/features/reception/DelegationPermissions.tsx'] : ['src/App.tsx', 'src/pages/Auth.tsx', ...requiredSources];
  for (const path of [...requiredEntrySources, ...overlays]) assert.ok(frozenLoads.has(path), 'Snapshot not served: ' + path);
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
const report = { completed: !failure, failure, timeOnly, weekOnly, welcomeOnly, chatOnly, timestampOnly, checkWorkspaceLayout, timestampDataPreserved, timestampMetrics: timestampOnly ? { ...apis[0]?.metrics } : null, draftPreserved, welcomeMetrics: welcomeOnly || chatOnly ? { ...apis[0]?.metrics } : null, fixedClock: focusedOnly || settingsEmbeddedOnly ? '2026-11-05T15:00:00Z' : null, checkTimeLayout, checkMobileNavigation, checkCalendarHeader, navigationKeyboardVerified, syntheticOnly: true, baseline, overlays: overlayHashes, frozenTextSourceCount: sources.size, frozenTextSourceDigest: sourceDigest.digest('hex'), tailwindRawContentCount: tailwindContent.length, runtimeSources: ownHashes,
  consultationOnly, consultationChecks, consultationRequests, consultationMetrics: consultationOnly ? { ...apis[0]?.metrics } : null,
  settingsEmbeddedOnly, previewEntry: settingsEmbeddedOnly ? previewEntry : null, settingsChecks, settingsRequests, settingsFixtureMetrics,
  whatsappReadOnly, whatsappBotRead,whatsappHistory,whatsappList, whatsappChecks, whatsappRequests, whatsappFixtureCalls: whatsappReadOnly ? apis[0]?.whatsappRead.calls : null,
  schedulingMigrationOnly, schedulingMigrationChecks, schedulingMigrationCalls: schedulingMigrationOnly ? apis[0]?.scheduling.calls : null, schedulingMigrationReads: schedulingMigrationOnly ? apis[0]?.scheduling.allReads : null, schedulingMigrationMetrics: schedulingMigrationOnly ? apis[0]?.metrics : null, schedulingReceptionMetrics: schedulingMigrationOnly ? apis[1]?.metrics : null,
  recoveryNoticeOnly, localRecordingRecovery, postConsultation, localRecoveryRequests, postConsultationCalls:postConsultation?apis[0]?.postConsultation.calls:null, recoveryNoticeChecks, recoveryNoticeCalls: recoveryNoticeOnly ? apis[0]?.recoveryNotice.calls : null, recoveryNoticeMetrics: recoveryNoticeOnly ? apis[0]?.metrics : null,
  patientWorkspaceOnly, patientWorkspaceChecks, patientWorkspaceMetrics: patientWorkspaceOnly ? apis[0]?.metrics : null,
  settingsAccessOnly, settingsAdminOnly, settingsAccessChecks, settingsAccessRequests, settingsAccessCalls: settingsAccessOnly ? apis[0]?.settingsRead.calls : null,
  mfaOnly, mfaCleanupOnly, mfaEnrollmentOnly, checkMfaErrorFocus, checkMfaCancellation, mfaPreparationChecks, mfaCleanupChecks, mfaErrorFocusChecks, mfaEnrollmentChecks, mfaEnrollmentQrChecks, mfaCancellationChecks, mfaMetrics: mfaMode ? { ...apis[0]?.metrics } : null,
  delegationOnly, delegationDecisionOnly, delegationConflictOnly, delegationDeniedOnly, delegationRetryOnly, delegationDecisionChecks, delegationConflictChecks, delegationDeniedChecks, delegationRetryChecks, delegationDataPreserved, delegationMetrics: delegationMode ? { ...apis[0]?.metrics } : null,
  medicalOnly, medicalHistoryOnly, medicalDelivery, medicalBaseSources, medicalCasesAttempted, medicalCaseFailures, medicalDataPreserved, medicalMetrics: medicalOnly ? { ...apis[0]?.metrics } : null,
  medicalSources: medicalOnly ? medicalPaths.map(path => ({ path, sha256: createHash('sha256').update(sources.get(path)).digest('hex') })) : [],
  frozenLoads: [...frozenLoads].sort(), screens, errors, consoleErrors, failedRequests, errorResponses, blockedExternalRequests: blocked, cleanupVerified };
await writeFile(resolve(folder, 'AUDIT.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baseline, screens: screens.length, errors: errors.length, consoleErrors: consoleErrors.length,
  failure, issues: screens.filter(screen => screen.dialogActionReachable === false || screen.dialogHorizontalOverflow > 1 || screen.dialogOutsideViewport || screen.recoveryScreen || screen.overflow > 1 || screen.missingButtons.length || screen.missingLabels.length || screen.brokenText.length).map(screen => ({ role: screen.role, path: screen.path, variant: screen.variant, actualPath: screen.actualPath, width: screen.width, dialogActionReachable: screen.dialogActionReachable, dialogHorizontalOverflow: screen.dialogHorizontalOverflow, dialogOutsideViewport: screen.dialogOutsideViewport, recoveryScreen: screen.recoveryScreen, overflow: screen.overflow, missingButtons: screen.missingButtons.length, missingLabels: screen.missingLabels.length, brokenText: screen.brokenText })), cleanupVerified }));
if (failure) throw new Error(failure.message);
