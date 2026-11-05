// General UI/UX audit of the doctor screens and public pages, with a fully
// synthetic backend: the app runs on a local Vite server and every Supabase
// call is answered inside the browser (invented doctor, patients, visits and
// documents). Nothing reaches a hosted project; no real credential is used.
//
//   node scripts/app-audit-browser.mjs [--only /route,/route]
//
// For each route, at 1280x900 and 375x812: a screenshot and automatic
// findings (page/console errors, sideways scroll, broken text, unnamed
// controls, unlabelled fields, images without alt, elements past the
// viewport). Output: CORTEX_BROWSER_ARTIFACTS or docs/reviews/<today>/app-audit/.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SUPABASE = 'http://supabase.synthetic.invalid';
const doctorId = 'd5110000-0000-4000-8000-000000000001';
const pid = (n) => `d5110000-0000-4000-8000-0000000000a${n}`;
const day = (offset, h = 9, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const now = () => new Date().toISOString();
const user = {
  id: doctorId, email: 'medica-sintetica@example.invalid', aud: 'authenticated', role: 'authenticated',
  created_at: now(), email_confirmed_at: now(), app_metadata: { provider: 'email' }, user_metadata: {}, factors: [],
};
const token = [
  { alg: 'HS256', typ: 'JWT' },
  { sub: doctorId, role: 'authenticated', aud: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000) },
].map((v) => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.synthetic-signature';

const patient = (n, over) => ({
  id: pid(n), user_id: doctorId, name: `Paciente Sintética ${n}`, age: null, date_of_birth: `19${80 + n}-0${n}-1${n}`,
  sex: 'feminino', cpf: null, status: 'retorno', phone: '(41) 99999-000' + n, email: null,
  medications: [], allergies: [], diagnoses: [], medical_history: null, clinical_notes: null,
  last_visit: day(-30 * n).slice(0, 10), created_at: day(-400), updated_at: day(-1), ...over,
});
const state = {
  settings: {
    user_id: doctorId, specialty: 'ginecologia', daily_credit_limit: 1500, live_copilot_enabled: false,
    doctor_name: 'Dra. Médica Sintética', crm_number: '00000', crm_uf: 'PR', professional_address: 'Rua Sintética, 100 — Curitiba',
    professional_phone: '(41) 3000-0000', rqe: null, active_template_id: null, prescriber_cpf: null,
  },
  patients: [
    patient(1, {
      medications: [{ name: 'Medicamento sintético A 10 mg', dosage: '1 comprimido', instructions: 'ao deitar' }],
      allergies: ['Dipirona'], diagnoses: [{ code: 'N95.1', description: 'Estados da menopausa e do climatério' }],
      medical_history: 'Histórico sintético: G2P2, sem cirurgias.', status: 'retorno',
    }),
    patient(2, { status: 'novo', last_visit: null }),
    patient(3, { name: 'Paciente Sintética com um nome bem comprido para testar quebras de linha', status: 'retorno' }),
  ],
  consultations: [
    { id: 'd5110000-0000-4000-8000-0000000000c1', user_id: doctorId, patient_id: pid(1), appointment_id: null, chief_complaint: 'Retorno com exames', created_at: day(-30), soap_note: '## S\nPaciente sintética sem queixas.\n\n## O\nPA 110/70.\n\n## A\nClimatério.\n\n## P\nManter conduta.', transcription: null, revision: 1, history_proposals: [], pre_briefing: null, recording_consent: null, whatsapp_message: null },
    { id: 'd5110000-0000-4000-8000-0000000000c2', user_id: doctorId, patient_id: pid(1), appointment_id: null, chief_complaint: 'Primeira consulta', created_at: day(-200), soap_note: 'Consulta sintética antiga.', transcription: null, revision: 1, history_proposals: [], pre_briefing: null, recording_consent: null, whatsapp_message: null },
  ],
  appointments: [
    { id: 'd5110000-0000-4000-8000-0000000000e1', user_id: doctorId, patient_id: pid(1), title: 'Paciente Sintética 1', start_time: day(0, 9), end_time: day(0, 9, 30), status: 'agendado', type: 'retorno', notes: null, created_at: day(-5), revision: 1, reminder_sent: false, checked_in_at: null, clinic_id: null, contact_id: null, created_by: doctorId, updated_by: null, reception_case_id: null, google_event_id: null, google_sync_claim: null, google_sync_error: null, google_sync_lease_until: null, google_sync_revision: 0, google_sync_status: 'none' },
    { id: 'd5110000-0000-4000-8000-0000000000e2', user_id: doctorId, patient_id: pid(2), title: 'Paciente Sintética 2', start_time: day(0, 10), end_time: day(0, 10, 30), status: 'confirmado', type: 'novo', notes: null, created_at: day(-5), revision: 1, reminder_sent: false, checked_in_at: null, clinic_id: null, contact_id: null, created_by: doctorId, updated_by: null, reception_case_id: null, google_event_id: null, google_sync_claim: null, google_sync_error: null, google_sync_lease_until: null, google_sync_revision: 0, google_sync_status: 'none' },
  ],
  prescriptions: [
    { id: 'd5110000-0000-4000-8000-0000000000f1', user_id: doctorId, patient_id: pid(1), doc_type: 'receita_simples', status: 'generated', secret_code: 'SINT01', created_at: day(-2), expires_at: day(28), issuance_verified_at: day(-2), signature_verified_at: null, issuance_snapshot: { pdf_sha256: 'a'.repeat(64) } },
    { id: 'd5110000-0000-4000-8000-0000000000f2', user_id: doctorId, patient_id: pid(1), doc_type: 'atestado', status: 'signed', secret_code: 'SINT02', created_at: day(-10), expires_at: day(20), issuance_verified_at: day(-10), signature_verified_at: day(-10), issuance_snapshot: { pdf_sha256: 'b'.repeat(64) } },
  ],
  clinical_work_items: [
    { id: 'd5110000-0000-4000-8000-0000000000d1', user_id: doctorId, patient_id: pid(1), kind: 'task', title: 'Ver resultado do exame sintético', content: 'Exame sintético pedido na última consulta.', details: {}, due_date: day(7).slice(0, 10), status: 'open', revision: 1, created_at: day(-30), updated_at: day(-30) },
  ],
  document_templates: [
    { id: 'd5110000-0000-4000-8000-0000000000b1', user_id: doctorId, name: 'Modelo sintético de consulta', description: 'Estrutura SOAP sintética', content: '## S\n\n## O\n\n## A\n\n## P\n', created_at: day(-60), updated_at: day(-60) },
  ],
  knowledge_documents: [
    { id: 'd5110000-0000-4000-8000-0000000000b2', user_id: doctorId, title: 'Protocolo sintético de climatério', source_type: 'text', status: 'ready', review_status: 'approved', review_revision: 1, index_revision: 1, char_count: 1200, created_at: day(-20), indexed_at: day(-20), reviewed_at: day(-20), reviewed_by: doctorId, reviewer_name: 'Dra. Médica Sintética', source_reference: null, source_text: 'Texto sintético.', source_version: null, embedding_model: null, index_started_at: null, supersedes_document_id: null },
  ],
};
const unknown = new Map();

function respond(route, body, status = 200) {
  return route.fulfill({
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json', 'Content-Range': '*/*' },
    body: JSON.stringify(body),
  });
}
/** PostgREST eq./in. filters on the seeded rows (enough for per-patient reads). */
function filtered(list, params) {
  return list.filter((row) => [...params.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'or', 'and'].includes(k)) return true;
    if (!(k in row)) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((s) => s.replace(/"/g, '')).includes(String(row[k]));
    if (v.startsWith('is.null')) return row[k] == null;
    return true;
  }));
}

async function supabase(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') return respond(route, {});
  const path = url.pathname;
  if (path === '/auth/v1/token')
    return respond(route, { access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user });
  if (path === '/auth/v1/user') return respond(route, user);
  if (path === '/auth/v1/logout') return respond(route, {});
  if (path.startsWith('/auth/v1/factors')) return respond(route, { all: [], totp: [], phone: [] });
  // A clinic without a signing provider yet: the documents tab asks for this.
  if (path === '/functions/v1/signature-session/state') return respond(route, { configured: false, active: false, expiresAt: null });
  if (path.startsWith('/functions/')) return respond(route, { error: 'Operação externa bloqueada no ensaio' }, 503);
  if (path.startsWith('/storage/')) return respond(route, []);
  const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const table = path.replace('/rest/v1/', '');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity;
  const rows = (list) => {
    const out = filtered(list, url.searchParams);
    return respond(route, single ? (out[0] ?? null) : out.slice(offset, offset + limit));
  };
  if (request.method() !== 'GET' && !table.startsWith('rpc/')) return respond(route, single ? {} : []);
  if (table === 'user_settings') return rows([state.settings]);
  if (table in state) return rows(state[table]);
  if (table === 'rpc/update_user_settings') return respond(route, null);
  if (table === 'rpc/clinic_access') return respond(route, { kind: 'clinical', active: true, admin: false, actorId: doctorId, clinic: null, doctors: [], staff: [] });
  if (table === 'rpc/workspace_directory') return respond(route, { patients: state.patients, counts: { total: state.patients.length, new: 1, returns: 2 } });
  if (table === 'rpc/list_patient_chat_turns') return respond(route, []);
  // Empty but valid answers for overviews the screens read (no grants in the synthetic world).
  if (table === 'rpc/protocol_sharing_overview' || table === 'rpc/sharing_overview') return respond(route, { grants: [], received: [], sources: [], doctors: [] });
  if (table === 'rpc/get_integration_status') return respond(route, { google: { connected: false } });
  unknown.set(`${request.method()} ${table}`, (unknown.get(`${request.method()} ${table}`) ?? 0) + 1);
  return single ? respond(route, null) : rows([]);
}

/** Automatic findings on the current page. */
async function inspect(page, width) {
  return page.evaluate((w) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      || (el.getAttribute('aria-labelledby') ? (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || '').trim() : '');
    const short = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}`;
    const out = { overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, brokenText: [], unnamedControls: [], unlabelledFields: [], imagesWithoutAlt: [], pastViewport: [] };
    const text = document.body.innerText;
    for (const m of text.matchAll(/[^\n]{0,30}\b(undefined|NaN|Invalid Date)\b[^\n]{0,30}|[^\n]{0,30}\[object Object\][^\n]{0,30}/g)) out.brokenText.push(m[0].trim());
    for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"]')) {
      if (visible(el) && !name(el) && !el.querySelector('img[alt]:not([alt=""])')) out.unnamedControls.push(short(el));
    }
    for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
      if (!visible(el)) continue;
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.getAttribute('title');
      if (!labelled) out.unlabelledFields.push(`${short(el)}${el.getAttribute('placeholder') ? ` (placeholder "${el.getAttribute('placeholder')}")` : ''}`);
    }
    for (const img of document.querySelectorAll('img')) if (visible(img) && !img.hasAttribute('alt')) out.imagesWithoutAlt.push(img.getAttribute('src')?.slice(0, 60) ?? '');
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('[data-radix-popper-content-wrapper]')) continue;
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && getComputedStyle(el).position !== 'fixed') {
        let scroller = el.parentElement;
        let clipped = false;
        while (scroller && scroller !== document.body) {
          const s = getComputedStyle(scroller);
          if (/(auto|scroll|hidden)/.test(s.overflowX)) { clipped = true; break; }
          scroller = scroller.parentElement;
        }
        if (!clipped) out.pastViewport.push(`${short(el)}: "${(el.textContent || '').trim().slice(0, 25)}" right=${Math.round(r.right)}`);
      }
    }
    for (const k of ['brokenText', 'unnamedControls', 'unlabelledFields', 'imagesWithoutAlt', 'pastViewport']) out[k] = [...new Set(out[k])].slice(0, 15);
    return out;
  }, width);
}

const ROUTES = [
  ['inicio', '/'],
  ['prontuario', `/?patient=${pid(1)}`],
  ['prontuario-novo', `/?patient=${pid(2)}`],
  ['pacientes', '/gerenciar-pacientes'],
  ['agenda', '/agenda'],
  ['modelos', '/modelos'],
  ['conhecimento', '/conhecimento'],
  ['assistente', '/assistente'],
  ['compartilhamento', '/compartilhamento'],
  ['trabalho', '/trabalho'],
  ['seguranca', '/seguranca'],
  ['privacidade', '/privacidade'],
  ['sobre', '/sobre'],
  ['aviso', '/aviso-de-privacidade'],
  ['inexistente', '/rota-inexistente'],
];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;

const probe = http.createServer();
await new Promise((ready) => probe.listen(0, '127.0.0.1', ready));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve(process.env.CORTEX_BROWSER_ARTIFACTS || `docs/reviews/${new Date().toISOString().slice(0, 10)}/app-audit`);
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
const report = { synthetic: true, routes: {}, unansweredCalls: {} };
try {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try { ready = (await fetch(origin + '/auth')).ok; } catch {}
    if (!ready) await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error(logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const VIEWPORTS = [['largo', { width: 1920, height: 1080 }], ['desktop', { width: 1280, height: 900 }], ['celular', { width: 375, height: 812 }]]
    .filter(([label]) => !process.env.AUDIT_VIEWPORTS || process.env.AUDIT_VIEWPORTS.split(',').includes(label));
  for (const [label, viewport] of VIEWPORTS) {
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 'supabase.synthetic.invalid') return supabase(route);
      return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('dialog', (d) => d.dismiss());
    // Logged out first: the sign-in page itself.
    await page.goto(origin + '/auth');
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(artifacts, `${label}-auth.png`), fullPage: true });
    report.routes[`${label} /auth`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
    await page.getByLabel(/e-?mail/i).fill(user.email);
    await page.getByLabel(/^senha$/i).fill('synthetic-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Configurações' }).first()).toBeVisible({ timeout: 15000 });
    for (const [name, path] of ROUTES) {
      if (only && !only.includes(path)) continue;
      await page.goto(origin + path);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(artifacts, `${label}-${name}.png`), fullPage: true });
      report.routes[`${label} ${path}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
    }
    // Interactions: the patient's full profile (history, documents, files).
    if (!only) {
      await page.goto(origin + `/?patient=${pid(1)}`);
      await page.waitForTimeout(1200);
      const open = viewport.width >= 1728
        ? page.getByRole('button', { name: /Perfil Completo/i }).first()
        : page.getByRole('button', { name: /^Perfil$/ }).first();
      if (await open.count()) {
        await open.click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: resolve(artifacts, `${label}-perfil.png`), fullPage: true });
        report.routes[`${label} perfil do paciente`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        for (const [tab, file] of [[/^Histórico/, 'perfil-historico'], [/^Documentos/, 'perfil-documentos']]) {
          const button = page.getByRole('tab', { name: tab }).first();
          if (!(await button.count())) { report.routes[`${label} ${file}`] = { missing: 'tab not found' }; continue; }
          await button.click();
          await page.waitForTimeout(900);
          await page.screenshot({ path: resolve(artifacts, `${label}-${file}.png`), fullPage: true });
          report.routes[`${label} ${file}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        }
      } else {
        report.routes[`${label} perfil do paciente`] = { missing: 'profile button not found' };
      }
    }
    await context.close();
  }
  report.unansweredCalls = Object.fromEntries(unknown);
  await writeFile(resolve(artifacts, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ failure: String(error?.message ?? error).split('\n')[0], unknown: Object.fromEntries(unknown), logs: logs.slice(-1500) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  app.kill();
}
