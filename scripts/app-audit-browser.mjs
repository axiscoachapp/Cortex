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
  if (path === '/functions/v1/whatsapp-api') return respond(route, whatsappAnswer(request.postDataJSON?.() ?? {}));
  if (path === '/functions/v1/intake-api') return respond(route, intakeAnswer(request.postDataJSON?.() ?? {}));
  if (path === '/functions/v1/intake-public') return respond(route, intakePublicAnswer(request.postDataJSON?.() ?? {}));
  if (path === '/functions/v1/billing-api') return respond(route, billingAnswer(request.postDataJSON?.() ?? {}));
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
  if (table === 'rpc/clinic_access')
    return respond(route, CLINIC_ADMIN
      ? { kind: 'clinical', active: true, admin: true, actorId: doctorId, clinic: { id: 'd5120000-0000-4000-8000-000000000001', name: 'Clínica Sintética' },
          doctors: [{ id: doctorId, name: 'Dra. Ana Exemplo', specialty: 'ginecologia' }], staff: [] }
      : { kind: 'clinical', active: true, admin: false, actorId: doctorId, clinic: null, doctors: [], staff: [] });
  if (table === 'rpc/workspace_directory') return respond(route, { patients: state.patients, counts: { total: state.patients.length, new: 1, returns: 2 } });
  if (table === 'rpc/list_patient_chat_turns') return respond(route, []);
  // Empty but valid answers for overviews the screens read (no grants in the synthetic world).
  if (table === 'rpc/protocol_sharing_overview' || table === 'rpc/sharing_overview') return respond(route, { grants: [], received: [], sources: [], doctors: [] });
  if (table === 'rpc/get_integration_status') return respond(route, { google: { connected: false } });
  unknown.set(`${request.method()} ${table}`, (unknown.get(`${request.method()} ${table}`) ?? 0) + 1);
  return single ? respond(route, null) : rows([]);
}

// Settings audit (AUDIT_CLINIC_ADMIN=1): the doctor administers a synthetic clinic with a connected WhatsApp number.
const CLINIC_ADMIN = process.env.AUDIT_CLINIC_ADMIN === '1';
function whatsappAnswer(body) {
  const template = { name: 'lembrete_consulta', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body: 'Olá {{1}}, sua consulta é {{2}} às {{3}}. Responda Confirmar ou Remarcar.', paramCount: 3 };
  switch (body.action) {
    case 'state': return { serverReady: true, connected: true, status: 'connected', displayPhone: '+55 41 3000-0000', verifiedName: 'Clínica Sintética', quality: 'GREEN',
      connectedAt: day(-3), canManage: true, canUseInbox: true, lastError: null, webhookUrl: `${SUPABASE}/functions/v1/whatsapp-webhook`, phoneNumberId: '200000000001', wabaId: '1000000001' };
    case 'templates': return { templates: [template, { ...template, name: 'pre_consulta_link', status: 'PENDING', body: 'Olá {{1}}, antes da consulta acesse {{2}}.', paramCount: 2 }] };
    case 'automations': return {
      automations: [{ id: 'd5130000-0000-4000-8000-000000000001', name: 'Lembrete 48 h antes', enabled: true, trigger: 'before_start', offsetMinutes: 2880, templateName: 'lembrete_consulta',
        templateLanguage: 'pt_BR', params: [{ source: 'paciente_primeiro_nome' }, { source: 'data' }, { source: 'hora' }], linkUrl: null, doctorIds: null, appointmentTypes: null, revision: 1, updatedAt: day(-1) }],
      runs: [{ id: 'd5140000-0000-4000-8000-000000000001', automationId: 'd5130000-0000-4000-8000-000000000001', appointmentId: 'd5150000-0000-4000-8000-000000000001',
        appointmentStart: day(2), status: 'sent', reason: null, reply: 'Confirmar', repliedAt: day(0), at: day(0) },
        { id: 'd5140000-0000-4000-8000-000000000002', automationId: 'd5130000-0000-4000-8000-000000000001', appointmentId: 'd5150000-0000-4000-8000-000000000002',
        appointmentStart: day(2), status: 'skipped', reason: 'Sem telefone válido no cadastro.', reply: null, repliedAt: null, at: day(0) }],
      sources: {}, quietHours: { start: 8, end: 20 } };
    case 'flow': return { enabled: true, revision: 2, updatedAt: day(-1), starter: false, defaultQueue: 'geral', hours: { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'] },
      afterHoursText: 'Estamos fora do horário; respondemos a partir das 8h.', handoffText: 'Obrigado! Uma pessoa da recepção vai continuar por aqui.',
      definition: { start: 'inicio', nodes: {
        inicio: { title: 'Boas-vindas', text: 'Olá! Você está falando com a Clínica Sintética. Como podemos ajudar?', options: [
          { label: 'Marcar ou remarcar', goto: 'medico' }, { label: 'Resultado de exame', goto: 'queue:resultados' },
          { label: 'Endereço e horários', goto: 'info' }, { label: 'Falar com a recepção', goto: 'queue:geral' }] },
        medico: { title: 'Escolha do médico', text: 'Com qual médico você quer marcar?', options: [
          { label: 'Dra. Ana Exemplo', goto: 'queue:agendamento' }, { label: 'Ainda não sei', goto: 'queue:agendamento' }] },
        info: { title: 'Endereço e horários', text: 'Rua Exemplo, 100. Segunda a sexta, 8h às 18h.', options: [], then: 'close' } } } };
    default: return { error: 'Operação externa bloqueada no ensaio', code: 'server' };
  }
}

// Pre-consultation (synthetic): the starter form, three appointments and one answered request.
const INTAKE_FORM = { intro: 'Para agilizar o seu atendimento na Clínica Sintética, responda estas perguntas antes da consulta. Leva cerca de 5 minutos.',
  thanks: 'Obrigado! Recebemos suas respostas.', sections: [
    { id: 'dados', title: 'Seus dados', audience: 'registration', questions: [
      { id: 'nome', label: 'Nome completo', type: 'text', required: true, field: 'name' },
      { id: 'nascimento', label: 'Data de nascimento', type: 'date', required: true, field: 'birth_date' },
      { id: 'cpf', label: 'CPF', type: 'cpf', required: true, field: 'cpf' }] },
    { id: 'convenio', title: 'Convênio', audience: 'registration', questions: [
      { id: 'tipo_atendimento', label: 'A consulta é particular ou pelo convênio?', type: 'choice', required: true, options: ['Particular', 'Convênio'], field: 'insurance_type' },
      { id: 'carteirinha', label: 'Número da carteirinha', type: 'text', required: true, field: 'insurance_card', showIf: { question: 'tipo_atendimento', equals: 'Convênio' } }] },
    { id: 'saude', title: 'Sobre a consulta', audience: 'health', questions: [
      { id: 'motivo', label: 'Qual o motivo da consulta?', type: 'textarea', required: true },
      { id: 'condicoes', label: 'Tem alguma destas condições?', type: 'multi', options: ['Pressão alta', 'Diabetes', 'Asma', 'Nenhuma destas'] },
      { id: 'gestacoes', label: 'Quantas gestações já teve?', type: 'number', help: 'Deixe em branco se não se aplica.' }] }] };
function intakeAnswer(body) {
  const item = (n, over) => ({ appointmentId: `d5150000-0000-4000-8000-00000000000${n}`, doctorId: doctorId, doctorName: 'Dra. Ana Exemplo', start: day(n), end: day(n),
    appointmentStatus: 'agendado', contactId: null, contactName: `Paciente Sintético ${n}`, requestId: null, state: 'none', openedAt: null, answeredAt: null,
    registrationReviewedAt: null, healthReviewedAt: null, revision: null, ...over });
  switch (body.action) {
    case 'state': return { ready: true, canEditForm: true, enabled: true };
    case 'form': return { starter: false, revision: 2, enabled: true, form: INTAKE_FORM, updatedAt: day(-1) };
    case 'list': return { items: [
      item(1, { requestId: 'd5160000-0000-4000-8000-000000000001', state: 'answered', openedAt: day(0), answeredAt: day(0), revision: 3 }),
      item(2, { requestId: 'd5160000-0000-4000-8000-000000000002', state: 'pending', openedAt: day(0), revision: 1 }),
      item(3, { contactName: 'Paciente com nome bem comprido para conferir o corte em telas estreitas' }),
      item(4, { appointmentStatus: 'cancelado' })] };
    case 'response': return { request: { id: 'd5160000-0000-4000-8000-000000000001', state: 'answered', revision: 3, openedAt: day(0), answeredAt: day(0), submissions: 1,
      expiresAt: day(2), whatsappConsent: true, registrationReviewedAt: null, healthReviewedAt: null, healthVisible: true,
      registration: [{ id: 'nome', label: 'Nome completo', value: 'Paciente Sintético 1', field: 'name' }, { id: 'tipo_atendimento', label: 'A consulta é particular ou pelo convênio?', value: 'Convênio', field: 'insurance_type' },
        { id: 'carteirinha', label: 'Número da carteirinha', value: '0000 1111 2222 3333', field: 'insurance_card' }],
      health: [{ id: 'motivo', label: 'Qual o motivo da consulta?', value: 'Consulta de rotina (texto sintético).' }, { id: 'condicoes', label: 'Tem alguma destas condições?', value: ['Asma'] }] } };
    default: return { error: 'Operação externa bloqueada no ensaio', code: 'server' };
  }
}
function intakePublicAnswer(body) {
  if (body.action === 'open') return { state: 'open', clinicName: 'Clínica Sintética', doctorName: 'Dra. Ana Exemplo', start: day(2), form: INTAKE_FORM, formRevision: 2, answeredAt: null, privacyVersion: 'v1' };
  return { error: 'Operação externa bloqueada no ensaio', code: 'server' };
}

// Finance (synthetic): one plan, prices, charges in every state, a sent batch, cash and a report.
const BILL_PAYER = 'd5170000-0000-4000-8000-000000000001';
const billDate = (offset) => day(offset).slice(0, 10);
function billCharge(n, over) {
  return { id: `d5180000-0000-4000-8000-00000000000${n}`, appointmentId: null, doctorId, contactId: null, patientName: `Paciente Sintético ${n}`, payerId: BILL_PAYER,
    cardNumber: '0000 1111 2222', newborn: false, guideType: 'consulta', tableCode: '22', procedureCode: '10101012', description: 'Consulta em consultório',
    quantity: 1, unitAmount: 150, amount: 150, serviceDate: billDate(-n), consultationType: '1', authorization: { number: null, password: null, date: null, validUntil: null },
    status: 'open', guideNumber: null, batchId: null, paidAmount: 0, deniedAmount: 0, denialCode: null, denialNote: null, notes: '', revision: 1, ...over };
}
function billingAnswer(body) {
  const sentBatch = { id: 'd5190000-0000-4000-8000-000000000001', payerId: BILL_PAYER, number: 3, guideType: 'consulta', status: 'sent', totalAmount: 300, paidAmount: 0,
    deniedAmount: 0, xmlHash: 'a'.repeat(32), generatedAt: day(-1), sentAt: billDate(-1), protocol: 'PROTOCOLO-0001', paymentDate: null, nfseNumber: null, notes: '', revision: 3, createdAt: day(-2) };
  switch (body.action) {
    case 'state': return { role: 'admin', userId: doctorId, settings: { legalName: 'CLINICA SINTETICA LTDA', cnpj: null, cnes: '9999999', nextGuideNumber: 7, revision: 1 },
      payers: [{ id: BILL_PAYER, name: 'Operadora Sintética de Saúde', ansRegistry: '999999', providerCode: '123456', tissVersion: '4.03.00', hashEncoding: 'latin1',
        zipRequired: false, submissionDays: 30, paymentDays: 60, active: true, notes: '', revision: 1 }],
      doctors: [{ id: doctorId, name: 'Dra. Ana Exemplo', crm: '00000', crmUf: 'PR' }],
      professionals: [{ userId: doctorId, tissName: 'ANA EXEMPLO', council: '06', councilNumber: '00000', councilUf: '41', cbo: '225250', sharePercent: 60, revision: 1 }] };
    case 'prices': return { prices: [
      { id: 'd51a0000-0000-4000-8000-000000000001', payerId: BILL_PAYER, tableCode: '22', procedureCode: '10101012', description: 'Consulta em consultório', guideType: 'consulta', amount: 150, active: true, revision: 1 },
      { id: 'd51a0000-0000-4000-8000-000000000002', payerId: BILL_PAYER, tableCode: '22', procedureCode: '41301102', description: 'Colposcopia (cérvice uterina e vagina)', guideType: 'sadt', amount: 80, active: true, revision: 1 },
      { id: 'd51a0000-0000-4000-8000-000000000003', payerId: null, tableCode: '00', procedureCode: '10101012', description: 'Consulta particular', guideType: 'consulta', amount: 350, active: true, revision: 1 }] };
    case 'toBill': return { items: [
      { appointmentId: 'd5150000-0000-4000-8000-000000000011', doctorId, start: day(-1, 9), type: 'novo', contactId: 'd51b0000-0000-4000-8000-000000000001',
        patientName: 'Paciente Sintético 1', consultationType: '1', coverages: [{ payerId: BILL_PAYER, cardNumber: '0000 1111 2222', cardValidUntil: null, plan: '' }], intake: null },
      { appointmentId: 'd5150000-0000-4000-8000-000000000012', doctorId, start: day(-1, 10), type: 'retorno', contactId: null,
        patientName: 'Paciente com nome bem comprido para conferir o corte em telas estreitas', consultationType: '2', coverages: [], intake: null }] };
    case 'charges': return { charges: [
      billCharge(1, {}), billCharge(2, { status: 'sent', guideNumber: 5, batchId: sentBatch.id }),
      billCharge(3, { status: 'partial', guideNumber: 4, paidAmount: 100, deniedAmount: 50, denialCode: '1705', denialNote: 'Valor acima da tabela' }),
      billCharge(4, { payerId: null, cardNumber: null, guideType: 'particular', tableCode: '00', unitAmount: 350, amount: 350, description: 'Consulta particular', status: 'partial', paidAmount: 100 })] };
    case 'openForBatch': return { charges: [billCharge(1, {}), billCharge(5, {})] };
    case 'batches': return { batches: [sentBatch, { ...sentBatch, id: 'd5190000-0000-4000-8000-000000000002', number: 4, status: 'draft', xmlHash: null, sentAt: null, protocol: null, totalAmount: 150 },
      { ...sentBatch, id: 'd5190000-0000-4000-8000-000000000003', number: 2, status: 'closed', paidAmount: 250, deniedAmount: 50, paymentDate: billDate(-3) }] };
    case 'batchCharges': return { charges: [billCharge(2, { status: 'sent', guideNumber: 5 }), billCharge(6, { status: 'sent', guideNumber: 6 })] };
    case 'cash': return {
      payments: [{ id: 'd51c0000-0000-4000-8000-000000000001', chargeId: 'd5180000-0000-4000-8000-000000000004', batchId: null, method: 'pix', amount: 100, receivedOn: billDate(0), notes: 'sinal', patientName: 'Paciente Sintético com nome comprido para conferir o corte', description: 'Consulta particular' },
        { id: 'd51c0000-0000-4000-8000-000000000002', chargeId: null, batchId: sentBatch.id, method: 'convenio', amount: 250, receivedOn: billDate(-1), notes: '', patientName: null, description: null }],
      expenses: [{ id: 'd51d0000-0000-4000-8000-000000000001', description: 'Aluguel da sala (sintético)', category: 'aluguel', amount: 3200, dueOn: billDate(0), paidOn: billDate(0), method: 'boleto', notes: '', revision: 1 },
        { id: 'd51d0000-0000-4000-8000-000000000002', description: 'Material de consultório', category: 'material', amount: 480.5, dueOn: billDate(2), paidOn: null, method: null, notes: '', revision: 1 }] };
    case 'report': return { totals: { count: 4, charged: 800, paid: 450, denied: 50, open: 300 },
      doctors: [{ doctorId, count: 4, charged: 800, paid: 450, denied: 50, open: 300, sharePercent: 60, payout: 270 }],
      payers: [{ payerId: BILL_PAYER, name: 'Operadora Sintética de Saúde', count: 3, charged: 450, paid: 350, denied: 50, open: 50 },
        { payerId: null, name: 'Particular', count: 1, charged: 350, paid: 100, denied: 0, open: 250 }],
      denials: [{ code: '1705', count: 1, amount: 50 }] };
    default: return { error: 'Operação externa bloqueada no ensaio', code: 'server' };
  }
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
      // Native controls hidden from assistive technology (the select Radix mirrors inside a form) are not fields.
      if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
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
  ['configuracoes', '/configuracoes'],
  ['config-whatsapp', '/configuracoes?secao=whatsapp'],
  ['config-pre-consulta', '/configuracoes?secao=pre-consulta'],
  ['pre-consultas', '/pre-consultas'],
  ['pre-consulta-paciente', `/pre-consulta/${'A'.repeat(43)}`],
  ['financeiro', '/financeiro'],
  ['config-conexoes', '/configuracoes?secao=conexoes'],
  ['config-permissoes', '/configuracoes?secao=permissoes'],
  ['config-equipe', '/configuracoes?secao=equipe'],
  ['config-seguranca', '/configuracoes?secao=seguranca'],
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
      // A cold dev server compiles lazy routes on first visit; wait for the loading screen to go.
      await page.getByText('Carregando...', { exact: true }).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(artifacts, `${label}-${name}.png`), fullPage: true });
      report.routes[`${label} ${path}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
      // Finance: every tab, and the dialogs that carry forms.
      if (path === '/financeiro') {
        const snap = async (name) => {
          await page.waitForTimeout(700);
          await page.screenshot({ path: resolve(artifacts, `${label}-financeiro-${name}.png`), fullPage: true });
          const dialog = page.getByRole('dialog');
          const box = (await dialog.count()) ? await dialog.first().boundingBox() : null;
          report.routes[`${label} financeiro ${name}`] = { ...(await inspect(page, viewport.width)),
            ...(box ? { dialog: { left: Math.round(box.x), right: Math.round(box.x + box.width), viewport: viewport.width } } : {}),
            pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        };
        // Escape closes a dialog; wait until it is gone, or the page behind stays hidden from the queries.
        const close = async () => {
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(300);
        };
        const tab = async (name) => {
          const t = page.getByRole('tab', { name, exact: true });
          if (!(await t.count())) { report.routes[`${label} financeiro ${name}`] = { missing: 'tab not found' }; return false; }
          await t.click();
          return true;
        };
        const cobrar = page.getByRole('button', { name: /^Cobrar o atendimento/ }).first();
        if (await cobrar.count()) {
          await cobrar.click();
          await page.getByRole('dialog').waitFor({ timeout: 5000 }).catch(() => {});
          await snap('cobranca-dialogo');
          await close();
        } else report.routes[`${label} financeiro cobranca-dialogo`] = { missing: 'charge button not found' };
        if (await tab('Cobranças')) {
          await snap('cobrancas');
          const receive = page.getByRole('button', { name: /^Receber de/ }).first();
          if (await receive.count()) { await receive.click(); await snap('receber-dialogo'); await close(); }
        }
        if (await tab('Lotes')) {
          await snap('lotes');
          const settle = page.getByRole('button', { name: /^Lançar o retorno/ }).first();
          if (await settle.count()) { await settle.click(); await snap('retorno-dialogo'); await close(); }
        }
        if (await tab('Caixa')) {
          await snap('caixa');
          const add = page.getByRole('button', { name: 'Nova despesa' });
          if (await add.count()) { await add.click(); await snap('despesa-dialogo'); await close(); }
        }
        if (await tab('Relatórios')) await snap('relatorios');
        if (await tab('Cadastros')) {
          await snap('cadastros');
          const pro = page.getByRole('button', { name: /^Editar os dados de faturamento/ }).first();
          if (await pro.count()) { await pro.click(); await snap('medico-dialogo'); await close(); }
          const payer = page.getByRole('button', { name: /^Editar Operadora/ }).first();
          if (await payer.count()) { await payer.click(); await snap('convenio-dialogo'); await close(); }
        }
      }
      // Pre-consultation answers dialog (reception list).
      if (path === '/pre-consultas') {
        const view = page.getByRole('button', { name: 'Ver respostas' }).first();
        if (await view.count()) {
          await view.click();
          await page.getByRole('dialog').waitFor({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(600);
          await page.screenshot({ path: resolve(artifacts, `${label}-pre-consulta-respostas.png`), fullPage: true });
          const box = await page.getByRole('dialog').boundingBox();
          report.routes[`${label} pre-consulta respostas`] = { ...(await inspect(page, viewport.width)), dialog: box && { left: Math.round(box.x), right: Math.round(box.x + box.width), viewport: viewport.width },
            pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
          await page.keyboard.press('Escape');
        } else report.routes[`${label} pre-consulta respostas`] = { missing: 'answers button not found' };
      }
      // Menu bot: the editor and a local simulated conversation (nothing is sent).
      if (CLINIC_ADMIN && path === '/configuracoes?secao=whatsapp') {
        const editor = page.locator('div.rounded-xl', { has: page.getByText('Robô de atendimento', { exact: true }) }).first();
        if (await editor.count()) {
          await editor.scrollIntoViewIfNeeded();
          await editor.screenshot({ path: resolve(artifacts, `${label}-robo-editor.png`) });
          const sim = page.getByLabel('Simulador do robô');
          await sim.getByLabel('Mensagem do paciente (simulação)').fill('Oi');
          await sim.getByRole('button', { name: 'Enviar na simulação' }).click();
          await sim.getByRole('button', { name: 'Marcar ou remarcar' }).first().click();
          await sim.getByRole('button', { name: 'Dra. Ana Exemplo' }).first().click();
          await sim.scrollIntoViewIfNeeded();
          await sim.screenshot({ path: resolve(artifacts, `${label}-robo-simulador.png`) });
          report.routes[`${label} robo simulador`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        } else report.routes[`${label} robo simulador`] = { missing: 'bot editor not found' };
      }
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
