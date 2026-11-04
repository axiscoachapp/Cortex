// Visual check of the prescription screens with a fully synthetic backend.
// The app runs on a local Vite server; every Supabase call is answered inside
// the browser by Playwright routes below (invented doctor, patient and drugs).
// Nothing reaches a hosted project, and no real credential is used.
//
//   node scripts/prescription-browser.mjs [--explore]
//
// Screenshots go to CORTEX_BROWSER_ARTIFACTS or
// docs/reviews/2026-11-04/prescription-visual/.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const explore = process.argv.includes('--explore');
const SUPABASE = 'http://supabase.synthetic.invalid';
const doctorId = 'd4110000-0000-4000-8000-000000000001';
const patientId = 'd4110000-0000-4000-8000-0000000000a1';
const now = () => new Date().toISOString();
const user = {
  id: doctorId,
  email: 'medica-sintetica@example.invalid',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: now(),
  email_confirmed_at: now(),
  app_metadata: { provider: 'email' },
  user_metadata: {},
  factors: [],
};
const token = [
  { alg: 'HS256', typ: 'JWT' },
  { sub: doctorId, role: 'authenticated', aud: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000) },
]
  .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
  .join('.') + '.synthetic-signature';

// Synthetic state the routes read and write.
const state = {
  settings: {
    user_id: doctorId,
    specialty: 'ginecologia',
    daily_credit_limit: 1500,
    live_copilot_enabled: false,
    doctor_name: 'Dra. Médica Sintética',
    crm_number: '00000',
    crm_uf: 'PR',
    professional_address: 'Rua Sintética, 100 — Curitiba',
    professional_phone: null,
    rqe: null,
    active_template_id: null,
  },
  patients: [
    {
      id: patientId,
      user_id: doctorId,
      name: 'Paciente Sintética',
      age: null,
      date_of_birth: '1990-05-10',
      sex: 'nao_informado',
      cpf: null,
      status: 'retorno',
      medications: [{ name: 'Medicamento sintético A', dosage: '1 comprimido', instructions: 'ao deitar' }],
      allergies: [],
      diagnoses: [],
      created_at: now(),
      updated_at: now(),
    },
  ],
  snippets: [
    {
      id: 'd4110000-0000-4000-8000-0000000000b1',
      owner_user_id: doctorId,
      name: 'Infecção urinária (sintético)',
      items: [{ name: 'Nitrofurantoína 100 mg', dosage: '1 cápsula', instructions: 'de 6 em 6 horas por 5 dias' }],
      review_status: 'approved',
      revision: 1,
    },
  ],
};
const unknown = new Map();

function respond(route, body, status = 200) {
  return route.fulfill({
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function supabase(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') return respond(route, {});
  const body = request.postData() ? JSON.parse(request.postData()) : {};
  const path = url.pathname;
  if (path === '/auth/v1/token')
    return respond(route, { access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user });
  if (path === '/auth/v1/user') return respond(route, user);
  if (path === '/auth/v1/logout') return respond(route, {});
  if (path.startsWith('/auth/v1/factors')) return respond(route, { all: [], totp: [], phone: [] });
  if (path.startsWith('/functions/')) return respond(route, { error: 'Operação externa bloqueada no ensaio' }, 503);
  const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const table = path.replace('/rest/v1/', '');
  // Honour PostgREST paging (offset/limit), or fetchAllRows() never sees the empty last page.
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity;
  const rows = (list) => respond(route, single ? (list[0] ?? null) : list.slice(offset, offset + limit));
  if (table === 'user_settings') return rows([state.settings]);
  if (table === 'patients') return rows(state.patients);
  if (table === 'document_snippets') return rows(state.snippets.filter((s) => s.review_status === 'approved'));
  if (table === 'rpc/update_user_settings') {
    Object.assign(state.settings, body.p_patch);
    return respond(route, null);
  }
  if (table === 'rpc/save_document_snippet') {
    const id = body.p_id ?? `d4110000-0000-4000-8000-${String(state.snippets.length + 0xb1).padStart(12, '0')}`;
    const existing = state.snippets.find((s) => s.id === id);
    if (existing) Object.assign(existing, { name: body.p_name, items: body.p_items, revision: existing.revision + 1, review_status: 'approved' });
    else state.snippets.push({ id, owner_user_id: doctorId, name: body.p_name, items: body.p_items, review_status: 'approved', revision: 1 });
    return respond(route, { id, revision: (existing?.revision ?? 1) });
  }
  if (table === 'rpc/clinic_access') return respond(route, { kind: 'clinical', active: true, admin: false, actorId: doctorId, clinic: null, doctors: [], staff: [] });
  if (table === 'rpc/workspace_directory') return respond(route, { patients: state.patients, counts: { total: state.patients.length, new: 0, returns: state.patients.length } });
  unknown.set(`${request.method()} ${table}`, (unknown.get(`${request.method()} ${table}`) ?? 0) + 1);
  return rows([]);
}

const probe = http.createServer();
await new Promise((ready) => probe.listen(0, '127.0.0.1', ready));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve(process.env.CORTEX_BROWSER_ARTIFACTS || 'docs/reviews/2026-11-04/prescription-visual');
await mkdir(artifacts, { recursive: true });
const app = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_SUPABASE_URL: SUPABASE, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let logs = '';
app.stdout.on('data', (d) => (logs = (logs + d).slice(-6000)));
app.stderr.on('data', (d) => (logs = (logs + d).slice(-6000)));
let browser;
let page;
const errors = [];
const checks = [];
try {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try {
      ready = (await fetch(origin + '/auth')).ok;
    } catch {}
    if (!ready) await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error(logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'supabase.synthetic.invalid') return supabase(route);
    return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(origin + '/auth');
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/^senha$/i).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Configurações' }).first()).toBeVisible();
  // The type cards animate for 200ms; wait for the final state before capturing.
  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(artifacts, name) });
  };

  // 1. Composer: antimicrobial warning names the prescriber phone and the patient's sex.
  await page.goto(origin + '/?patient=' + patientId);
  const openComposer = page.getByRole('button', { name: /Receita \/ atestado/ });
  await expect(openComposer).toBeVisible();
  await openComposer.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Modelos de receita')).toBeVisible();
  await dialog.getByRole('button', { name: /Antimicrobiano/ }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'A receita de antimicrobiano exige' })).toHaveText(
    /seu telefone profissional \(Configurações\) e o sexo do paciente/,
  );
  await shot('01-antimicrobial-warning.png');
  checks.push('antimicrobial type lists the missing prescriber phone and patient sex before generating');

  // 2. Template with a selection: explicit choice, keep the selection.
  await dialog.getByRole('button', { name: /Receita simples/ }).click();
  await dialog.getByLabel('Modelos de receita').selectOption(state.snippets[0].id);
  const choice = dialog.getByRole('group', { name: 'Como aplicar o modelo' });
  await expect(choice).toContainText('Medicamento sintético A');
  await shot('02-template-choice.png');
  await choice.getByRole('button', { name: 'Manter a seleção' }).click();
  await expect(choice).toHaveCount(0);
  checks.push('applying a template with a selection asks replace / add / keep, and keep changes nothing');

  // 3. Replace: the template drug arrives checked, the old one stays unchecked, type turns antimicrobial.
  await dialog.getByLabel('Modelos de receita').selectOption(state.snippets[0].id);
  await choice.getByRole('button', { name: 'Substituir a seleção' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'no lugar de 1 medicamento' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Antimicrobiano/ })).toHaveAttribute('aria-pressed', 'true');
  await shot('03-template-replaced.png');
  checks.push('replace keeps the previous drug unchecked in the list and suggests the antimicrobial type');

  // 4. Save the current selection as a template.
  await dialog.getByRole('button', { name: /Salvar como modelo/ }).click();
  await dialog.getByLabel('Nome do novo modelo').fill('Cistite (sintético)');
  await shot('04-save-template.png');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Modelo "Cistite (sintético)" salvo.' })).toBeVisible();
  if (!state.snippets.some((s) => s.name === 'Cistite (sintético)')) throw new Error('Template was not sent to save_document_snippet');
  checks.push('save as template sends the selection to save_document_snippet');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // 5. Settings (home screen): phone without DDD is refused before saving; a valid phone and RQE are saved.
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Configurações' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Telefone profissional').fill('3000-0000');
  await sheet.getByRole('button', { name: 'Salvar dados do prescritor' }).click();
  await expect(sheet.getByRole('alert')).toContainText('com DDD');
  if (state.settings.professional_phone) throw new Error('Phone without DDD reached the server');
  await shot('05-settings-phone-without-ddd.png');
  await sheet.getByLabel('Telefone profissional').fill('(41) 3000-0000');
  await sheet.getByLabel('RQE (opcional)').fill('12345');
  await sheet.getByRole('button', { name: 'Salvar dados do prescritor' }).click();
  await expect(sheet.getByRole('status')).toContainText('Dados do prescritor salvos.');
  if (state.settings.professional_phone !== '(41) 3000-0000' || state.settings.rqe !== '12345') throw new Error('Phone/RQE not saved');
  await shot('06-settings-saved.png');
  checks.push('settings refuse a phone without DDD locally and save phone and RQE through update_user_settings');
  await page.keyboard.press('Escape');

  // 6. Back in the composer: only the patient's sex is missing now.
  await page.goto(origin + '/?patient=' + patientId);
  await page.getByRole('button', { name: /Receita \/ atestado/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Antimicrobiano/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert').filter({ hasText: 'A receita de antimicrobiano exige' })).toHaveText(/exige o sexo do paciente\./);
  await shot('07-antimicrobial-only-sex.png');
  checks.push('after saving the phone, the warning names only the patient sex');

  // 7. Phone width: the template picker and choice fit without horizontal scroll.
  await page.setViewportSize({ width: 375, height: 812 });
  const mobile = page.getByRole('dialog');
  await mobile.getByRole('button', { name: /Receita simples/ }).click();
  await mobile.getByLabel('Modelos de receita').selectOption(state.snippets[0].id);
  await expect(mobile.getByRole('group', { name: 'Como aplicar o modelo' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Horizontal overflow of ${overflow}px at 375px`);
  // Inside the dialog too: every control within its box, and no text spilling out of an element.
  const escaped = await page.evaluate(() => {
    const box = document.querySelector('[role="dialog"]').getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll('[role="dialog"] button, [role="dialog"] input, [role="dialog"] select, [role="dialog"] p')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      // Inputs scroll their own text by design; only their box must fit.
      const spills = el.tagName !== 'INPUT' && el.scrollWidth > el.clientWidth + 1;
      if (r.left < box.left - 1 || r.right > box.right + 1 || spills)
        out.push(`${el.tagName.toLowerCase()}: ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}`);
    }
    return out;
  });
  if (escaped.length) throw new Error(`Elements escaping the dialog at 375px: ${escaped.join(' | ')}`);
  await shot('08-mobile-template-choice.png');
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar documento' }).scrollIntoViewIfNeeded();
  await shot('09-mobile-footer.png');
  checks.push('at 375px the picker, the choice, the type cards and the footer fit inside the dialog');

  const report = { synthetic: true, checks, pageErrors: errors, unansweredCalls: Object.fromEntries(unknown) };
  await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} catch (error) {
  if (page) await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ failure: String(error?.message ?? error).split('\n')[0], url: page?.url(), unknown: Object.fromEntries(unknown), errors, logs: logs.slice(-1500) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  app.kill();
}
