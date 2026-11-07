// Wiring of the WhatsApp handlers to Supabase, the Graph API and the caller's verified identity.
// Logic and tests live in whatsappHandlers.ts and whatsapp.ts; this file only connects.
// Configuration (Edge secrets): WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_TOKEN_KEYS
// ("k1:<base64 32 bytes>", same format as SIGNATURE_TOKEN_KEYS) and optionally WHATSAPP_GRAPH_VERSION.
// Without them the webhook answers 503 and connecting is refused.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { AuthError, authResponse, requireUser } from './auth.ts';
import { fetchWithDeadline } from './http.ts';
import { parseKeyList } from './psc.ts';
import { DEFAULT_GRAPH_VERSION, graphClient } from './whatsapp.ts';
import type { AutomationRow, AutomationRunRow, BotSessionRow, Caller, FlowRow, ChannelRow, ConversationRow, MessageRow, TemplateRow, WhatsAppDeps, WhatsAppStore } from './whatsappHandlers.ts';
const AUTOMATION_COLUMNS = 'id, clinic_id, name, enabled, trigger, offset_minutes, template_name, template_language, params, link_url, doctor_ids, appointment_types, revision, updated_at';

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  Vary: 'Origin',
};

const CONVERSATION_COLUMNS = 'id, clinic_id, wa_id, user_id, profile_name, contact_id, case_id, queue, status, assigned_to, assigned_at, opened_at, first_response_at, closed_at, last_inbound_at, last_message_at, last_message_preview, unread_count, opted_out_at, revision';
const MESSAGE_COLUMNS = 'id, clinic_id, conversation_id, direction, wamid, kind, body, media, template, status, error, sent_by, provider_at, created_at';
const CHANNEL_COLUMNS = 'id, clinic_id, phone_number_id, waba_id, display_phone, verified_name, quality_rating, status, token_sealed, last_error, connected_at';

function keys() {
  const raw = Deno.env.get('WHATSAPP_TOKEN_KEYS') ?? '';
  if (!raw) return null;
  try { return parseKeyList(raw); } catch { return null; }
}

export function whatsappDeps(): WhatsAppDeps {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { global: { fetch: fetchWithDeadline } });
  const fail = (what: string) => { throw new Error(`Banco indisponível (${what})`); };

  // Current opt-in of each listed phone (both forms of the Brazilian ninth digit).
  const variants = (wa: string) => /^55[1-9][0-9][6-9][0-9]{7}$/.test(wa) ? [wa, `${wa.slice(0, 4)}9${wa.slice(4)}`]
    : /^55[1-9][0-9]9[6-9][0-9]{7}$/.test(wa) ? [wa, `${wa.slice(0, 4)}${wa.slice(5)}`] : [wa];
  async function withConsent(clinicId: string, rows: ConversationRow[]): Promise<ConversationRow[]> {
    const phones = [...new Set(rows.flatMap((r) => (r.wa_id ? variants(r.wa_id) : [])))];
    if (!phones.length) return rows.map((r) => ({ ...r, consented: false }));
    const { data, error } = await service.from('whatsapp_opt_ins').select('wa_id').eq('clinic_id', clinicId).is('revoked_at', null).in('wa_id', phones);
    if (error) fail('consentimentos');
    const ok = new Set((data ?? []).map((d) => d.wa_id as string));
    return rows.map((r) => ({ ...r, consented: !!r.wa_id && variants(r.wa_id).some((v) => ok.has(v)) }));
  }

  const store: WhatsAppStore = {
    async channelForClinic(clinicId) {
      const { data, error } = await service.from('whatsapp_channels').select(CHANNEL_COLUMNS).eq('clinic_id', clinicId).maybeSingle();
      if (error) fail('canal');
      return (data as ChannelRow | null) ?? null;
    },
    async channelByPhoneNumberId(id) {
      const { data, error } = await service.from('whatsapp_channels').select(CHANNEL_COLUMNS).eq('phone_number_id', id).maybeSingle();
      if (error) fail('canal');
      return (data as ChannelRow | null) ?? null;
    },
    async saveChannel(row) {
      const { error } = await service.from('whatsapp_channels').upsert({ ...row, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'clinic_id' });
      if (error) fail('salvar canal');
    },
    async disconnect(clinicId) {
      const { error } = await service.from('whatsapp_channels').update({ status: 'disconnected', token_sealed: null, updated_at: new Date().toISOString() }).eq('clinic_id', clinicId);
      if (error) fail('desconectar');
    },
    async replaceTemplates(channelId, rows: TemplateRow[]) {
      const del = await service.from('whatsapp_templates').delete().eq('channel_id', channelId);
      if (del.error) fail('modelos');
      if (rows.length) {
        const { error } = await service.from('whatsapp_templates').insert(rows.map((r) => ({ ...r, channel_id: channelId, synced_at: new Date().toISOString() })));
        if (error) fail('modelos');
      }
    },
    async templates(channelId) {
      const { data, error } = await service.from('whatsapp_templates').select('name, language, category, status, body, param_count').eq('channel_id', channelId).order('name');
      if (error) fail('modelos');
      return (data ?? []) as TemplateRow[];
    },
    async conversations({ clinicId, filter, actor, search, before, limit }) {
      let q = service.from('whatsapp_conversations').select(CONVERSATION_COLUMNS).eq('clinic_id', clinicId);
      if (filter === 'closed') q = q.eq('status', 'closed');
      else {
        q = q.eq('status', 'open');
        if (filter === 'unassigned') q = q.is('assigned_to', null);
        if (filter === 'mine') q = q.eq('assigned_to', actor);
      }
      if (search) {
        const digits = search.replace(/\D/g, '');
        const safe = search.replace(/[%_,()\\]/g, ' ').trim();
        q = digits.length >= 4 ? q.like('wa_id', `%${digits}%`) : safe ? q.ilike('profile_name', `%${safe}%`) : q;
      }
      if (before) q = q.or(`last_message_at.lt."${before.at}",and(last_message_at.eq."${before.at}",id.lt.${before.id})`);
      const { data, error } = await q.order('last_message_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
      if (error) fail('conversas');
      return withConsent(clinicId, (data ?? []) as ConversationRow[]);
    },
    async conversation(clinicId, id) {
      const { data, error } = await service.from('whatsapp_conversations').select(CONVERSATION_COLUMNS).eq('clinic_id', clinicId).eq('id', id).maybeSingle();
      if (error) fail('conversa');
      return data ? (await withConsent(clinicId, [data as ConversationRow]))[0] : null;
    },
    async messages({ clinicId, conversationId, before, limit }) {
      let q = service.from('whatsapp_messages').select(MESSAGE_COLUMNS).eq('clinic_id', clinicId).eq('conversation_id', conversationId);
      if (before) q = q.or(`created_at.lt."${before.at}",and(created_at.eq."${before.at}",id.lt.${before.id})`);
      const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
      if (error) fail('mensagens');
      return (data ?? []) as MessageRow[];
    },
    async message(clinicId, id) {
      const { data, error } = await service.from('whatsapp_messages').select(MESSAGE_COLUMNS).eq('clinic_id', clinicId).eq('id', id).maybeSingle();
      if (error) fail('mensagem');
      return (data as MessageRow | null) ?? null;
    },
    async lastInboundWamid(clinicId, conversationId) {
      const { data, error } = await service.from('whatsapp_messages').select('wamid').eq('clinic_id', clinicId).eq('conversation_id', conversationId)
        .eq('direction', 'in').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) fail('mensagem');
      return (data?.wamid as string | undefined) ?? null;
    },
    async automations(clinicId) {
      const { data, error } = await service.from('whatsapp_automations').select(AUTOMATION_COLUMNS).eq('clinic_id', clinicId).order('created_at');
      if (error) fail('automações');
      return (data ?? []) as AutomationRow[];
    },
    async automationsByIds(ids) {
      if (!ids.length) return [];
      const { data, error } = await service.from('whatsapp_automations').select(AUTOMATION_COLUMNS).in('id', ids).eq('enabled', true);
      if (error) fail('automações');
      return (data ?? []) as AutomationRow[];
    },
    async deleteAutomation(clinicId, id) {
      const { data, error } = await service.from('whatsapp_automations').delete().eq('clinic_id', clinicId).eq('id', id).select('id');
      if (error) fail('automações');
      return (data ?? []).length === 1;
    },
    async conversationById(id) {
      const { data, error } = await service.from('whatsapp_conversations').select(CONVERSATION_COLUMNS).eq('id', id).maybeSingle();
      if (error) fail('conversa');
      return (data as ConversationRow | null) ?? null;
    },
    async flowForClinic(clinicId) {
      const { data, error } = await service.from('whatsapp_flows')
        .select('clinic_id, enabled, definition, hours, after_hours_text, handoff_text, default_queue, revision, updated_at').eq('clinic_id', clinicId).maybeSingle();
      if (error) fail('fluxo');
      return (data as FlowRow | null) ?? null;
    },
    async botSession(conversationId) {
      const { data, error } = await service.from('whatsapp_bot_sessions')
        .select('conversation_id, flow_revision, node, attempts, path, status, outcome, revision, started_at, updated_at').eq('conversation_id', conversationId).maybeSingle();
      if (error) fail('robô');
      return (data as BotSessionRow | null) ?? null;
    },
    async automationRuns(clinicId, limit) {
      const { data, error } = await service.from('whatsapp_automation_runs')
        .select('id, automation_id, appointment_id, appointment_start, status, reason, reply, replied_at, created_at')
        .eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(limit);
      if (error) fail('envios');
      return (data ?? []) as AutomationRunRow[];
    },
  };

  return {
    corsHeaders,
    config: {
      appSecret: Deno.env.get('WHATSAPP_APP_SECRET') ?? '',
      verifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '',
      keys: keys(),
      webhookUrl: `${url}/functions/v1/whatsapp-webhook`,
      cronSecret: Deno.env.get('WHATSAPP_CRON_SECRET') ?? '',
    },
    async authorize(req): Promise<Caller> {
      // requireUser verifies the bearer with Auth and demands aal2 when the account has a verified factor.
      const { userId } = await requireUser(req, { allowReception: true });
      const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' }, fetch: fetchWithDeadline },
      });
      const { data, error } = await user.rpc('clinic_access');
      if (error) throw new AuthError('Não foi possível verificar seu acesso à clínica.', 503);
      const access = data as { kind?: string; active?: boolean; admin?: boolean; clinic?: { id?: string } | null; actorId?: string } | null;
      const clinicId = access?.clinic?.id;
      if (!access || !clinicId || access.actorId !== userId) throw new AuthError('Sua conta não está vinculada a uma clínica.', 403);
      const reception = access.kind === 'reception' && access.active === true;
      const admin = access.admin === true;
      if (!reception && !admin && access.kind !== 'clinical') throw new AuthError('Sem acesso à clínica.', 403);
      return { userId, clinicId, admin, reception };
    },
    authFailure: (error) => (error instanceof AuthError ? authResponse(error, corsHeaders) : null),
    rpc: async (name, args) => {
      const { data, error } = await service.rpc(name, args);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data;
    },
    store,
    graph: graphClient((input, init) => fetchWithDeadline(input, init, 30_000, 25 * 1024 * 1024), Deno.env.get('WHATSAPP_GRAPH_VERSION') || DEFAULT_GRAPH_VERSION),
    log: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
    now: () => new Date(),
  };
}

export type { MessageRow };
