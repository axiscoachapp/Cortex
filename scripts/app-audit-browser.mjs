// General UI/UX audit of the doctor screens and public pages, with a fully
// synthetic backend: the app runs on a local Vite server and every Supabase
// call is answered inside the browser (invented doctor, patients, visits and
// documents). Nothing reaches a hosted project; no real credential is used.
//
//   node scripts/app-audit-browser.mjs [--only /route,/route]
//
// For each route, at 1920x1080, 1280x900 and 375x812: a screenshot and
// automatic findings (page/console errors, sideways scroll, broken text,
// unnamed controls, unlabelled fields, images without alt, elements past the
// viewport). Output: CORTEX_BROWSER_ARTIFACTS or docs/reviews/<today>/app-audit/.
//
// Options (environment):
//   AUDIT_WORKSPACE_ROLE=doctor|admin|reception, AUDIT_CLINIC_ADMIN=1
//   AUDIT_VIEWPORTS=largo,desktop,...      keep only these labels
//   AUDIT_LAPTOPS=1                         add laptop sizes: laptop 1366x768,
//                                           hd 1536x864, notebook 1280x800
//   AUDIT_EXTRA_VIEWPORTS=1440x900,...      add sizes (label = w1440x900)
//   AUDIT_CASE_CLAIMED=1                    the opened reception case is already the person's
//   AUDIT_FULL_PAGE=0                       capture only the first screen (fold).
//     Below the desktop frame (SHELL_BREAKPOINT) subpages scroll inside
//     .clinic-subpage-shell, so a "full page" capture is only the first
//     screen there anyway; this script then also saves a `-full` capture
//     with the inner scroller expanded.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SHELL_BREAKPOINT } from '../src/lib/interfaceScale.ts';

const WORKSPACE_ROLE = process.env.AUDIT_WORKSPACE_ROLE;
if (WORKSPACE_ROLE && !['admin', 'doctor', 'reception'].includes(WORKSPACE_ROLE)) throw new Error('Invalid synthetic workspace role');

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
    user_id: doctorId, specialty: 'ginecologia', daily_credit_limit: 1500, live_copilot_enabled: process.env.AUDIT_SETTINGS_LEGACY_COPILOT === '1',
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
  if (path === '/functions/v1/whatsapp-api' && request.postDataJSON?.()?.action === 'media')
    // Synthetic received photo: a 1x1 PNG, answered as the server does (bytes, attachment).
    return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'image/png', 'Content-Disposition': 'attachment' },
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  if (path === '/functions/v1/whatsapp-api') return respond(route, whatsappAnswer(request.postDataJSON?.() ?? {}));
  if (path === '/functions/v1/intake-api') return respond(route, intakeAnswer(request.postDataJSON?.() ?? {}));
  if (path === '/functions/v1/intake-public') return respond(route, intakePublicAnswer(request.postDataJSON?.() ?? {}));
  if (path === '/functions/v1/billing-api') return respond(route, billingAnswer(request.postDataJSON?.() ?? {}));
  if (process.env.AUDIT_OPENAI_MIGRATION === '1' && path === '/functions/v1/chat-assistant')
    return respond(route, { message: 'Resposta sintética para revisão médica.', safety: { status: 'not_assessed' }, coverage: { limited: true, knowledge: 'unavailable' }, sources: [] });
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
  if (table === 'patient_files' || table === 'usage_daily') return rows([]);
  if (table === 'rpc/reception_contact') return respond(route, { id: 'd5190000-0000-4000-8000-000000000001', clinicId: 'd5120000-0000-4000-8000-000000000001',
    name: 'Contato Sintético 1', phone: '+5541999990001', beneficiaries: [{ id: pid(1), name: 'Paciente Sintética 1', dateOfBirth: null, doctorId, relationship: 'self' }] });
  if (table === 'rpc/reception_staff_permissions') return respond(route, { items: [
    { doctorId, doctorName: 'Dra. Ana Exemplo', effective: true, source: 'physician_approval', requestId: 'd51a0000-0000-4000-8000-000000000001' }], nextCursor: null });
  if (table === 'rpc/reception_team_doctors') return respond(route, [{ id: doctorId, name: 'Dra. Ana Exemplo', specialty: 'ginecologia' }, { id: 'd5110000-0000-4000-8000-0000000000b2', name: 'Dr. Bruno Exemplo', specialty: 'ginecologia' }]);
  if (table === 'rpc/reception_delegation_requests') return respond(route, { canManage: CLINIC_ADMIN || WORKSPACE_ROLE === 'admin', items: [], nextCursor: null });
  if (table === 'rpc/reception_contacts') return respond(route, { items: [
    { id: 'd5190000-0000-4000-8000-000000000001', name: 'Contato Sintético 1', phone: '+5541999990001', createdAt: day(-1) },
    { id: 'd5190000-0000-4000-8000-000000000002', name: 'Contato Sintético 2', phone: '+5541999990002', createdAt: day(-2) },
  ], nextCursor: null });
  if (table === 'rpc/reception_appointments') return respond(route, { items: [
    { id: 'd5180000-0000-4000-8000-000000000003', doctorId, patientId: pid(1), contactId: 'd5190000-0000-4000-8000-000000000001', caseId: null,
      patientName: 'Paciente Sintética 1', startTime: day(0, 9), endTime: day(0, 9, 30), type: 'retorno', status: 'agendado', revision: 1, checkedInAt: null, googleSyncStatus: 'failed' },
  ], blocks: [{ id: 'd5180000-0000-4000-8000-000000000004', doctorId, startTime: day(0, 12), endTime: day(0, 13), reason: 'Intervalo sintético', revision: 1 }] });
  if (table === 'rpc/reception_queue') return respond(route, { items: [
    { id: 'd5180000-0000-4000-8000-000000000001', subject: 'Organizar primeira consulta', kind: 'first_consult', status: 'new', revision: 1,
      contactId: 'd5190000-0000-4000-8000-000000000001', contactName: 'Contato Sintético 1', phone: '+5541999990001', doctorId, assignedTo: null, assigneeName: null, createdAt: day(0) },
    { id: 'd5180000-0000-4000-8000-000000000002', subject: 'Confirmar disponibilidade para retorno', kind: 'return', status: 'waiting_patient', revision: 1,
      contactId: 'd5190000-0000-4000-8000-000000000002', contactName: 'Contato Sintético 2', phone: '+5541999990002', doctorId, assignedTo: doctorId, assigneeName: 'Atendente Sintética', createdAt: day(0) },
    ...[3, 4, 5].map(n => ({ id: `d5180000-0000-4000-8000-00000000001${n}`, subject: `Demanda sintética ${n}`, kind: 'return', status: 'new', revision: 1,
      contactId: 'd5190000-0000-4000-8000-000000000001', contactName: `Contato Sintético ${n}`, phone: '+5541999990001', doctorId, assignedTo: null, assigneeName: null, createdAt: day(0) })),
  ], nextCursor: null });
  if (table === 'rpc/reception_case') return respond(route, {
    id: 'd5180000-0000-4000-8000-000000000001', clinicId: 'd5120000-0000-4000-8000-000000000001', contactId: 'd5190000-0000-4000-8000-000000000001',
    contactName: 'Contato Sintético 1', phone: '+5541999990001', doctorId, subject: 'Organizar primeira consulta', kind: 'first_consult', status: CASE_CLAIMED ? 'assigned' : 'new',
    assignedTo: CASE_CLAIMED ? doctorId : null, revision: 1, createdAt: day(0), beneficiaries: [], eligibleAssignees: [{ id: doctorId, name: 'Atendente Sintética' }],
    notes: [{ id: 'd5180000-0000-4000-8000-000000000021', body: 'Nota sintética de acompanhamento.', actorId: doctorId, actorName: 'Atendente Sintética', createdAt: day(0) }],
    noteCount: 1, draft: { body: '', revision: 0 } });
  if (table === 'rpc/clinic_access')
    return respond(route, CLINIC_ADMIN || WORKSPACE_ROLE
      ? { kind: WORKSPACE_ROLE === 'reception' ? 'reception' : 'clinical', active: true, admin: WORKSPACE_ROLE ? WORKSPACE_ROLE === 'admin' : true, actorId: doctorId, clinic: { id: 'd5120000-0000-4000-8000-000000000001', name: 'Clínica Sintética' },
          doctors: [{ id: doctorId, name: 'Dra. Ana Exemplo', specialty: 'ginecologia' }],
          staff: [{ id: 'd51b0000-0000-4000-8000-000000000001', name: 'Secretária Sintética', active: true, doctorIds: [doctorId] }] }
      : { kind: 'clinical', active: true, admin: false, actorId: doctorId, clinic: null, doctors: [], staff: [] });
  if (table === 'rpc/workspace_directory') return respond(route, { patients: state.patients, counts: { total: state.patients.length, new: 1, returns: 2 } });
  if (table === 'rpc/list_patient_chat_turns' || table === 'consultation_drafts') return respond(route, []);
  // Empty but valid answers for overviews the screens read (no grants in the synthetic world).
  if (table === 'rpc/protocol_sharing_overview' || table === 'rpc/sharing_overview') return respond(route, { grants: [], received: [], sources: [], doctors: [] });
  if (table === 'rpc/get_integration_status') return respond(route, { google: { connected: false } });
  unknown.set(`${request.method()} ${table}`, (unknown.get(`${request.method()} ${table}`) ?? 0) + 1);
  return single ? respond(route, null) : rows([]);
}

// Settings audit (AUDIT_CLINIC_ADMIN=1): the doctor administers a synthetic clinic with a connected WhatsApp number.
const CLINIC_ADMIN = process.env.AUDIT_CLINIC_ADMIN === '1';
// AUDIT_CASE_CLAIMED=1: the opened reception case is already with the person (the state after "Assumir").
const CASE_CLAIMED = process.env.AUDIT_CASE_CLAIMED === '1';
const waConv = (n, over) => ({
  id: `d5160000-0000-4000-8000-00000000000${n}`, waId: `55419999900${n}0`, profileName: `Contato Sintético ${n}`, contactId: null, caseId: null,
  queue: n === 1 ? 'agendamento' : 'geral', status: 'open', assignedTo: null, assignedAt: null, openedAt: day(-1), firstResponseAt: null, closedAt: null,
  lastInboundAt: day(0, 8, 40), windowOpenUntil: null, lastMessageAt: day(0, 8, 40), lastMessagePreview: 'Mensagem sintética', unreadCount: 0, optedOut: false, consented: true, revision: 3, ...over,
});
const waMsg = (n, direction, body, status, at, over) => ({
  id: `d5170000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, direction, kind: 'text', body, media: null, template: null, status, error: null,
  sentBy: direction === 'out' ? doctorId : null, at, ...over,
});
const waState = {
  conversations: [
    waConv(1, { contactId: 'd5190000-0000-4000-8000-000000000001', caseId: 'd5180000-0000-4000-8000-000000000001', assignedTo: doctorId, assignedAt: day(0, 8, 45), firstResponseAt: day(0, 8, 50), windowOpenUntil: day(1, 8, 40), unreadCount: 1,
      lastMessagePreview: 'Pode ser na quinta de manhã? Tenho exame na quarta.' }),
    waConv(2, { lastInboundAt: day(-3, 10, 0), lastMessageAt: day(-3, 10, 0), unreadCount: 2, lastMessagePreview: 'Queria remarcar a consulta da semana que vem.' }),
  ],
  messages: {
    'd5160000-0000-4000-8000-000000000001': [
      waMsg(1, 'in', 'Bom dia! Queria marcar um retorno com a Dra. Ana.', 'received', day(0, 8, 30)),
      waMsg(2, 'out', 'Bom dia! Temos horário na quarta às 14h ou na quinta às 9h. Qual prefere?', 'read', day(0, 8, 50)),
      waMsg(3, 'in', 'Pode ser na quinta de manhã? Tenho exame na quarta.', 'received', day(0, 8, 55)),
      waMsg(5, 'in', '', 'received', day(0, 8, 56), { kind: 'image', media: { mime: 'image/png', filename: null, voice: false } }),
      waMsg(6, 'in', '', 'received', day(0, 8, 57), { kind: 'document', media: { mime: 'application/pdf', filename: 'pedido-de-exame.pdf', voice: false } }),
      waMsg(4, 'out', 'Mensagem sintética que o WhatsApp recusou.', 'failed', day(0, 8, 58), { error: 'Synthetic failure' }),
    ],
    'd5160000-0000-4000-8000-000000000002': [
      waMsg(11, 'in', 'Queria remarcar a consulta da semana que vem.', 'received', day(-3, 10, 0)),
    ],
  },
};
function whatsappAnswer(body) {
  const template = { name: 'lembrete_consulta', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', body: 'Olá {{1}}, sua consulta é {{2}} às {{3}}. Responda Confirmar ou Remarcar.', paramCount: 3 };
  switch (body.action) {
    case 'conversations': return { conversations: waState.conversations.filter((c) => body.filter === 'mine' ? c.assignedTo === doctorId
      : body.filter === 'unassigned' ? c.assignedTo === null : body.filter === 'closed' ? false : true), nextBefore: null };
    case 'messages': {
      const conversation = waState.conversations.find((c) => c.id === body.conversationId);
      // Newest first, as the server lists them.
      return conversation ? { conversation, messages: [...(waState.messages[conversation.id] ?? [])].reverse(), nextBefore: null } : { error: 'Conversa não encontrada', code: 'not_found' };
    }
    case 'botSession': return { session: null };
    case 'send': {
      const conversation = waState.conversations.find((c) => c.id === body.conversationId);
      const id = `d5170000-0000-4000-8000-0000000001${String((waState.messages[conversation.id] ?? []).length).padStart(2, '0')}`;
      waState.messages[conversation.id] = [...(waState.messages[conversation.id] ?? []),
        { id, direction: 'out', kind: body.template ? 'template' : 'text', body: body.text ?? 'Modelo sintético enviado.', media: null,
          template: body.template ? { name: body.template.name, language: body.template.language } : null, status: 'sent', error: null, sentBy: doctorId, at: now() }];
      return { messageId: id, status: 'sent', duplicate: false };
    }
    case 'act': {
      const conversation = waState.conversations.find((c) => c.id === body.conversationId);
      if (!conversation) return { error: 'Conversa não encontrada', code: 'not_found' };
      if (body.operation === 'mark_read') conversation.unreadCount = 0;
      return { revision: conversation.revision, status: conversation.status, assignedTo: conversation.assignedTo };
    }
    case 'dashboard': return { schemaVersion: 1, asOf: now(), window: { from: body.from, to: body.to, timeZone: 'America/Sao_Paulo' }, coverage: 'latest_cycle_only',
      cohort: { incomingCycles: 0, withHumanSend: 0, withoutHumanSend: 0, medianFirstHumanSendSeconds: null, closedWithoutHumanSend: 0 },
      openNow: { total: 0, unassigned: 0, assignedToIneligible: 0, owners: { items: [], nextBefore: null } }, unavailable: { abandonment: 'no_explicit_event', appointments: 'scoped_source_required' } };
    case 'state': {
      const canManage = WORKSPACE_ROLE ? WORKSPACE_ROLE === 'admin' : CLINIC_ADMIN;
      return { serverReady: true, connected: true, status: 'connected', displayPhone: '+55 41 3000-0000', verifiedName: 'Clínica Sintética', quality: 'GREEN',
        connectedAt: day(-3), canManage, canUseInbox: true,
        ...(canManage ? { lastError: null, webhookUrl: `${SUPABASE}/functions/v1/whatsapp-webhook`, phoneNumberId: '200000000001', wabaId: '1000000001' } : {}) };
    }
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
    case 'state': return { role: WORKSPACE_ROLE === 'doctor' || WORKSPACE_ROLE === 'reception' ? WORKSPACE_ROLE : 'admin', userId: doctorId, settings: { legalName: 'CLINICA SINTETICA LTDA', cnpj: null, cnes: '9999999', nextGuideNumber: 7, revision: 1 },
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
        patientName: 'Paciente Sintético 1', consultationType: '1', attendance: 'checked_in', coverages: [{ payerId: BILL_PAYER, cardNumber: '0000 1111 2222', cardValidUntil: null, plan: '' }], intake: null },
      { appointmentId: 'd5150000-0000-4000-8000-000000000012', doctorId, start: day(-1, 10), type: 'retorno', contactId: null,
        patientName: 'Paciente com nome bem comprido para conferir o corte em telas estreitas', consultationType: '2', attendance: 'done', coverages: [], intake: null }] };
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
  ['recepcao', '/recepcao'],
  ['recepcao-conversas', '/recepcao?view=conversations'],
  ['recepcao-caso', '/recepcao?case=d5180000-0000-4000-8000-000000000001'],
  ['recepcao-conversas', '/recepcao?view=conversations'],
  ['recepcao-agenda', '/recepcao/agenda'],
  ['recepcao-contatos', '/recepcao/contatos'],
  ['recepcao-painel', '/recepcao/painel'],
  ['recepcao-equipe', '/recepcao/equipe'],
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
  ['config-preferencias', '/configuracoes?secao=perfil'],
  ['config-implantacao', '/configuracoes?secao=implantacao'],
  ['config-compartilhamento', '/configuracoes?secao=usuarios'],
  ['config-sobre', '/configuracoes?secao=sobre'],
  ['config-whatsapp', '/configuracoes?secao=whatsapp'],
  ['config-pre-consulta', '/configuracoes?secao=pre-consulta'],
  ['pre-consultas', '/pre-consultas'],
  ['recepcao-pre-consultas', '/recepcao/pre-consultas'],
  ['recepcao-financeiro', '/recepcao/financeiro'],
  ['pre-consulta-paciente', `/pre-consulta/${'A'.repeat(43)}`],
  ['financeiro', '/financeiro'],
  ['config-conexoes', '/configuracoes?secao=conexoes'],
  ['config-permissoes', '/configuracoes?secao=permissoes'],
  ['config-equipe', '/configuracoes?secao=equipe'],
  ['config-seguranca', '/configuracoes?secao=seguranca'],
  ['delegacoes', '/permissoes-recepcao'],
  ['google-retorno-sem-codigo', '/google-oauth-callback'],
  ['assinatura-retorno-sem-codigo', '/assinatura/retorno'],
];
const FULL_PAGE = process.env.AUDIT_FULL_PAGE !== '0';
// Below the desktop frame a subpage scrolls inside .clinic-subpage-shell (the
// bottom tab bar is fixed); expand it for one capture, then restore it.
async function fullCapture(page, path) {
  const expanded = await page.evaluate(() => {
    const shell = document.querySelector('.clinic-subpage-shell');
    if (!shell || shell.scrollHeight <= shell.clientHeight + 1) return false;
    shell.dataset.auditStyle = shell.getAttribute('style') ?? '';
    shell.style.height = 'auto'; shell.style.overflow = 'visible';
    return true;
  });
  if (!expanded) return;
  await page.screenshot({ path, fullPage: true });
  await page.evaluate(() => {
    const shell = document.querySelector('.clinic-subpage-shell');
    if (shell) { shell.setAttribute('style', shell.dataset.auditStyle ?? ''); delete shell.dataset.auditStyle; }
  });
}
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
const report = { synthetic: true, role: WORKSPACE_ROLE || (CLINIC_ADMIN ? 'admin' : 'standalone'), routes: {}, unansweredCalls: {}, receptionPrivateReads: [] };
try {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try { ready = (await fetch(origin + '/auth')).ok; } catch {}
    if (!ready) await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error(logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const VIEWPORTS = [['largo', { width: 1920, height: 1080 }], ['desktop', { width: 1280, height: 900 }], ['celular', { width: 375, height: 812 }], ...(process.env.AUDIT_COMPACT === '1' ? [['compacto', { width: 320, height: 812 }]] : []),
    ...(process.env.AUDIT_LAPTOPS === '1' ? [['laptop', { width: 1366, height: 768 }], ['hd', { width: 1536, height: 864 }], ['notebook', { width: 1280, height: 800 }]] : []),
    ...(process.env.AUDIT_EXTRA_VIEWPORTS ? process.env.AUDIT_EXTRA_VIEWPORTS.split(',').map(size => { const [width, height] = size.split('x').map(Number); return [`w${width}x${height}`, { width, height }]; }) : [])]
    .filter(([label]) => !process.env.AUDIT_VIEWPORTS || process.env.AUDIT_VIEWPORTS.split(',').includes(label));
  for (const [label, viewport] of VIEWPORTS) {
    if (process.env.AUDIT_SHORT === '1') viewport.height = label === 'largo' ? 768 : 667;
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 'supabase.synthetic.invalid') {
        const pathname = new URL(route.request().url()).pathname;
        if (WORKSPACE_ROLE === 'reception' && /^\/rest\/v1\/(patients|consultations|consultation_drafts|patient_chat_turns|rpc\/workspace_directory|rpc\/list_patient_chat_turns)(?:\?|$)/.test(pathname)) {
          report.receptionPrivateReads.push(pathname);
          throw new Error('Reception mounted a private clinical reader');
        }
        return supabase(route);
      }
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
    await page.screenshot({ path: resolve(artifacts, `${label}-auth.png`), fullPage: FULL_PAGE });
    report.routes[`${label} /auth`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
    await page.getByLabel(/e-?mail/i).fill(user.email);
    await page.getByLabel(/^senha$/i).fill('synthetic-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: WORKSPACE_ROLE === 'reception' ? 'Novo atendimento' : 'Configurações' }).first()).toBeVisible({ timeout: 15000 });
    for (const [name, path] of ROUTES) {
      if (only && !only.includes(path)) continue;
      await page.goto(origin + path);
      // A cold dev server compiles lazy routes on first visit; wait for the loading screen to go.
      await page.getByText('Carregando...', { exact: true }).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(artifacts, `${label}-${name}.png`), fullPage: FULL_PAGE });
      if (FULL_PAGE && viewport.width < SHELL_BREAKPOINT) await fullCapture(page, resolve(artifacts, `${label}-${name}-full.png`));
      report.routes[`${label} ${path}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
      if (process.env.AUDIT_OPENAI_MIGRATION === '1' && path === '/assistente') {
        await page.getByRole('textbox', { name: 'Escreva sua pergunta' }).fill('Pergunta sintética sobre o contexto disponível');
        await page.getByRole('button', { name: 'Enviar pergunta', exact: true }).click();
        await expect(page.getByText('Resposta sintética para revisão médica.', { exact: true })).toBeVisible();
        await expect(page.getByText(/Nenhum protocolo da Base de Conhecimento foi consultado/)).toBeVisible();
        await page.screenshot({ path: resolve(artifacts, `${label}-openai-coverage.png`), fullPage: FULL_PAGE });
        report.routes[`${label} OpenAI coverage`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
      }
      if (process.env.AUDIT_UI_CONSISTENCY === '1' && /^\/(configuracoes|agenda|gerenciar-pacientes|modelos|conhecimento|assistente|compartilhamento|seguranca|privacidade|permissoes-recepcao|pre-consultas|financeiro|recepcao)(?:[/?]|$)/.test(path)) {
        await expect(page.getByRole('main')).toHaveCount(1);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        if (viewport.width >= SHELL_BREAKPOINT) {
          const sidebar = page.getByRole('complementary', { name: 'Navegação do ambiente' });
          await expect(sidebar).toBeVisible();
          await expect(sidebar.getByRole('link', { name: 'Configurações', exact: true })).toBeInViewport();
          await expect(sidebar.getByRole('button', { name: 'Sair', exact: true })).toBeInViewport();
        } else await expect(page.getByRole('navigation', { name: 'Navegação principal', exact: true })).toBeVisible();
        if (viewport.width < 360) {
          const area = page.getByRole('button', { name: 'Alternar área de trabalho', exact: true });
          if (await area.count()) {
            const a = await area.boundingBox(), b = await page.getByRole('button', { name: 'Sair', exact: true }).boundingBox();
            if (!a || !b || Math.abs(a.y + a.height / 2 - b.y - b.height / 2) > 1) throw new Error('Compact workspace header wrapped to two rows');
          }
        }
        if (path === '/seguranca') {
          const add = page.getByRole('button', { name: 'Adicionar autenticador', exact: true });
          await add.scrollIntoViewIfNeeded();
          await expect(add).toBeInViewport();
          const contained = await add.evaluate(button => {
            const bounds = button.getBoundingClientRect(), card = button.closest('section').getBoundingClientRect();
            return bounds.left >= card.left && bounds.right <= card.right;
          });
          if (!contained) throw new Error('Authenticator action exceeds its card');
          await page.screenshot({ path: resolve(artifacts, `${label}-seguranca-acao.png`), fullPage: FULL_PAGE });
        }
      }
      if (process.env.AUDIT_MANAGED_SETTINGS === '1' && path.startsWith('/configuracoes')) {
        await expect(page.getByLabel('Especialidade', { exact: true })).toHaveCount(0);
        await expect(page.getByLabel('Nome completo do médico', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('switch', { name: 'Copiloto ao vivo', exact: true })).toHaveCount(0);
        await expect(page.getByLabel('Token de acesso (usuário do sistema)', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Conectar número', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Desconectar', exact: true })).toHaveCount(0);
        if (path === '/configuracoes?secao=implantacao') {
          await expect(page.getByText('Desativado', { exact: true })).toBeVisible();
          if (WORKSPACE_ROLE === 'reception') await expect(page.getByRole('heading', { name: 'Seu cadastro profissional' })).toHaveCount(0);
          else await expect(page.getByRole('heading', { name: 'Seu cadastro profissional' })).toBeVisible();
        }
        if (path === '/configuracoes') {
          await page.goto(origin + '/configuracoes?origin=audit');
          await page.getByLabel('Acessar seção').selectOption('implantacao');
          await expect(page.getByRole('region', { name: 'Dados da implantação' })).toBeVisible();
          if (new URL(page.url()).searchParams.get('origin') !== 'audit') throw new Error('Settings navigation lost context parameters');
          await page.screenshot({ path: resolve(artifacts, `${label}-config-navegacao.png`), fullPage: FULL_PAGE });
          report.routes[`${label} configurações navegação`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        }
      }
      if (WORKSPACE_ROLE && ['/financeiro', '/recepcao/financeiro'].includes(path)) {
        const tabs = await page.getByRole('tab').allTextContents();
        const expected = WORKSPACE_ROLE === 'doctor' ? ['Cobranças', 'Relatórios'] : WORKSPACE_ROLE === 'reception' ? ['A faturar', 'Cobranças', 'Caixa'] : ['A faturar', 'Cobranças', 'Lotes', 'Caixa', 'Relatórios', 'Cadastros'];
        if (JSON.stringify(tabs) !== JSON.stringify(expected)) throw new Error('Financial tabs differ from synthetic server role');
      }
      if (process.env.AUDIT_WORKSPACE_INTERACTIONS === '1' && ['/', '/recepcao', '/recepcao/financeiro'].includes(path)) {
        const snapshot = async name => {
          await page.screenshot({ path: resolve(artifacts, `${label}-${name}.png`), fullPage: FULL_PAGE });
          report.routes[`${label} ${name}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        };
        const area = page.getByRole('button', { name: 'Alternar área de trabalho' }).first();
        if (await area.isVisible()) {
          await area.click();
          const choices = await page.getByRole('menuitem').allTextContents();
          const expected = WORKSPACE_ROLE === 'reception' ? ['Recepção', 'Financeiro'] : WORKSPACE_ROLE === 'doctor' ? ['Consultório', 'Financeiro'] : ['Consultório', 'Recepção', 'Financeiro'];
          if (choices.length !== expected.length || expected.some((name, index) => !choices[index].startsWith(name))) throw new Error(`Workspace choices differ for ${WORKSPACE_ROLE || 'admin'}`);
          await snapshot(`${name}-areas`);
          await page.keyboard.press('Escape');
        }
        if (path === '/' && viewport.width < SHELL_BREAKPOINT && WORKSPACE_ROLE !== 'reception') {
          await page.getByRole('button', { name: 'Menu', exact: true }).click();
          const settings = page.getByRole('button', { name: 'Configurações', exact: true }).first();
          await settings.scrollIntoViewIfNeeded();
          await expect(settings).toBeInViewport();
          await snapshot('inicio-menu-curto');
          await page.getByRole('button', { name: 'Início', exact: true }).last().click();
        }
        if (path === '/' && WORKSPACE_ROLE !== 'reception') {
          await page.getByRole('button', { name: 'Nova Consulta', exact: true }).first().click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await snapshot('inicio-consulta-existente');
          await page.getByRole('button', { name: 'Novo Paciente', exact: true }).click();
          await snapshot('inicio-consulta-novo');
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        if (path === '/recepcao') {
          await expect(page.getByRole('button', { name: 'Sair', exact: true }).first()).toBeVisible();
          if (viewport.width < SHELL_BREAKPOINT) {
            await page.getByRole('button', { name: 'Mais páginas' }).click();
            await snapshot('recepcao-mais');
            await page.keyboard.press('Escape');
          }
        }
      }
      // Doctor's documents: composer, clinical-list editor, profile, patient search, templates.
      if (process.env.AUDIT_DOCTOR_DOCUMENTS === '1' && [`/?patient=${pid(1)}`, '/gerenciar-pacientes', '/modelos'].includes(path)) {
        const snap = async (name) => {
          await page.waitForTimeout(600);
          await page.screenshot({ path: resolve(artifacts, `${label}-${name}.png`), fullPage: FULL_PAGE });
          report.routes[`${label} ${name}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        };
        const reload = async () => { await page.goto(origin + path); await page.waitForTimeout(1200); };
        if (path === '/gerenciar-pacientes') {
          await page.getByRole('searchbox', { name: 'Buscar pacientes' }).fill('zzzz');
          await snap('pacientes-busca-vazia');
          await page.getByRole('searchbox', { name: 'Buscar pacientes' }).fill('');
          await page.getByRole('button', { name: /^Ações para / }).first().click();
          await snap('pacientes-menu');
          await page.keyboard.press('Escape');
        }
        if (path === '/modelos') {
          await page.getByRole('button', { name: /nas evoluções$/ }).first().click();
          await snap('modelos-em-uso');
        }
        if (path === `/?patient=${pid(1)}`) {
          const closeDialog = async () => {
            await page.keyboard.press('Escape');
            await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
          };
          // On the phone the "Perfil" tab opens the full profile over the patient panel.
          if (viewport.width < SHELL_BREAKPOINT) await page.getByRole('button', { name: 'Perfil', exact: true }).last().click();
          else await page.getByRole('button', { name: /Perfil Completo/ }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await snap('perfil');
          await closeDialog();
          await page.getByRole('button', { name: 'Editar alergias' }).click();
          await expect(page.getByRole('dialog', { name: 'Editar alergias' })).toBeVisible();
          await snap('alergias-dialogo');
          await closeDialog();
          await reload();
          await page.getByRole('button', { name: /Receita \/ atestado/ }).first().click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await snap('composer');
          await page.getByLabel('Buscar medicamento na base Anvisa').fill('zzzz');
          await page.waitForTimeout(900);
          await snap('composer-busca-vazia');
          await page.getByRole('button', { name: /manualmente$/ }).first().click();
          await snap('composer-manual');
          // Leave the composer clean so the next route can load.
          await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).first().click();
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        }
      }
      // Finance: every tab, and the dialogs that carry forms.
      if (['/financeiro', '/recepcao/financeiro'].includes(path) && WORKSPACE_ROLE === 'doctor') {
        for (const [tab, name] of [['Cobranças', 'cobrancas'], ['Relatórios', 'relatorios']]) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          await expect(page.getByRole('button', { name: /^(Receber de|Nova cobrança avulsa)/ })).toHaveCount(0);
          await page.screenshot({ path: resolve(artifacts, `${label}-financeiro-${name}.png`), fullPage: FULL_PAGE });
          report.routes[`${label} financeiro ${name}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        }
      }
      if (['/financeiro', '/recepcao/financeiro'].includes(path) && WORKSPACE_ROLE !== 'doctor') {
        const snap = async (name) => {
          await page.waitForTimeout(700);
          await page.screenshot({ path: resolve(artifacts, `${label}-financeiro-${name}.png`), fullPage: FULL_PAGE });
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
        if (WORKSPACE_ROLE !== 'reception' && await tab('Lotes')) {
          await snap('lotes');
          const settle = page.getByRole('button', { name: /^Lançar o retorno/ }).first();
          if (await settle.count()) { await settle.click(); await snap('retorno-dialogo'); await close(); }
        }
        if (await tab('Caixa')) {
          await snap('caixa');
          const add = page.getByRole('button', { name: 'Nova despesa' });
          if (await add.count()) { await add.click(); await snap('despesa-dialogo'); await close(); }
        }
        if (WORKSPACE_ROLE !== 'reception' && await tab('Relatórios')) await snap('relatorios');
        if (WORKSPACE_ROLE !== 'reception' && await tab('Cadastros')) {
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
          await page.screenshot({ path: resolve(artifacts, `${label}-pre-consulta-respostas.png`), fullPage: FULL_PAGE });
          const box = await page.getByRole('dialog').boundingBox();
          report.routes[`${label} pre-consulta respostas`] = { ...(await inspect(page, viewport.width)), dialog: box && { left: Math.round(box.x), right: Math.round(box.x + box.width), viewport: viewport.width },
            pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
          await page.keyboard.press('Escape');
        } else report.routes[`${label} pre-consulta respostas`] = { missing: 'answers button not found' };
      }
      if (path === '/recepcao?view=conversations') {
        for (const [n, name] of [[1, 'janela-aberta'], [2, 'janela-fechada']]) {
          const item = page.getByRole('button', { name: new RegExp(`Contato Sintético ${n}`) }).first();
          if (!(await item.count())) { report.routes[`${label} conversa ${name}`] = { missing: 'conversation not listed' }; continue; }
          await item.click();
          await page.waitForTimeout(900);
          await page.screenshot({ path: resolve(artifacts, `${label}-conversa-${name}.png`), fullPage: true });
          report.routes[`${label} conversa ${name}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        }
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
    // AUDIT_CONSULTATION=1: consultation-screen states (patient panel from the
    // safety row, last note, recording dialog, Início with the way back).
    if (process.env.AUDIT_CONSULTATION === '1') {
      const shot = async (name) => {
        await page.waitForTimeout(700);
        await page.screenshot({ path: resolve(artifacts, `${label}-${name}.png`), fullPage: FULL_PAGE });
        report.routes[`${label} ${name}`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
      };
      await page.goto(origin + `/?patient=${pid(1)}`);
      await expect(page.getByRole('heading', { name: 'Paciente Sintética 1', exact: true }).first()).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: 'Ver evolução', exact: true }).click();
      await shot('consulta-ultima-evolucao');
      await page.getByRole('button', { name: 'Gravar consulta', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Gravar consulta' })).toBeVisible();
      await shot('consulta-gravar-dialogo');
      await page.keyboard.press('Escape');
      if (viewport.width < SHELL_BREAKPOINT) {
        await page.getByRole('button', { name: /Abrir painel do paciente/ }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await shot('consulta-painel-paciente');
        await page.getByRole('button', { name: 'Consulta', exact: true }).click();
      }
      await page.getByRole('button', { name: /^Início$/ }).first().click();
      await expect(page.getByRole('button', { name: 'Voltar à consulta de Paciente Sintética 1' }).first()).toBeVisible();
      await shot('consulta-inicio-voltar');
    }
    // Interactions: the patient's full profile (history, documents, files).
    if (!only) {
      await page.goto(origin + `/?patient=${pid(1)}`);
      await page.waitForTimeout(1200);
      // On the phone the Perfil tab shows the patient panel; the full profile opens from it.
      if (viewport.width < SHELL_BREAKPOINT) await page.getByRole('button', { name: /^Perfil$/ }).first().click().catch(() => {});
      const open = page.getByRole('button', { name: /Perfil Completo/i }).first();
      if (await open.count()) {
        await open.click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: resolve(artifacts, `${label}-perfil.png`), fullPage: FULL_PAGE });
        report.routes[`${label} perfil do paciente`] = { ...(await inspect(page, viewport.width)), pageErrors: pageErrors.splice(0), consoleErrors: consoleErrors.splice(0) };
        for (const [tab, file] of [[/^Histórico/, 'perfil-historico'], [/^Documentos/, 'perfil-documentos']]) {
          const button = page.getByRole('tab', { name: tab }).first();
          if (!(await button.count())) { report.routes[`${label} ${file}`] = { missing: 'tab not found' }; continue; }
          await button.click();
          await page.waitForTimeout(900);
          await page.screenshot({ path: resolve(artifacts, `${label}-${file}.png`), fullPage: FULL_PAGE });
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
