-- WhatsApp Business Platform (Cloud API) for the clinic reception. Owner: Claude (C4), review: Codex (K6).
-- Contract: docs/product/whatsapp/CONTRATO.md.
--
-- Access model (v1): these tables have RLS enabled and no policy for anon/authenticated. Only the
-- whatsapp-webhook and whatsapp-api Edge Functions reach them, with the service role, after
-- authorizing the caller through clinic_access() and assert_session_assurance(). The functions
-- below are executable by service_role only. Nothing here writes to reception_cases or
-- clinic_contacts: a conversation only points at them, and the link is set by a person.

create table public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references public.clinics(id) on delete restrict,
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id text not null check (waba_id ~ '^[0-9]{5,30}$'),
  display_phone text not null default '' check (length(display_phone) <= 40),
  verified_name text not null default '' check (length(verified_name) <= 200),
  quality_rating text check (quality_rating is null or length(quality_rating) <= 20),
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  -- Sealed access token {v,keyId,nonce,ciphertext} (AES-GCM, key list WHATSAPP_TOKEN_KEYS, AAD bound
  -- to channel and clinic). Null after disconnection.
  token_sealed jsonb check (token_sealed is null or (jsonb_typeof(token_sealed) = 'object' and token_sealed ? 'ciphertext')),
  last_error text check (last_error is null or length(last_error) <= 500),
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'connected' or token_sealed is not null)
);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  channel_id uuid not null references public.whatsapp_channels(id) on delete restrict,
  -- Phone (wa_id) and business-scoped user id (BSUID, "BR.123…"): Meta may omit the phone for
  -- people who use a WhatsApp username, so either one identifies the conversation.
  wa_id text check (wa_id is null or wa_id ~ '^[0-9]{8,15}$'),
  user_id text check (user_id is null or user_id ~ '^[A-Z]{2}\.[A-Za-z0-9.]{1,160}$'),
  profile_name text not null default '' check (length(profile_name) <= 200),
  -- Phone delivered together with this conversation's BSUID while another conversation holds it:
  -- not merged, but consent and opt-out follow the person through it.
  linked_wa_id text check (linked_wa_id is null or linked_wa_id ~ '^[0-9]{8,15}$'),
  contact_id uuid,
  case_id uuid,
  queue text not null default 'geral' check (queue ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  status text not null default 'open' check (status in ('open', 'closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  opened_at timestamptz not null default now(),
  first_response_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  last_inbound_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '' check (length(last_message_preview) <= 160),
  unread_count integer not null default 0 check (unread_count between 0 and 100000),
  opted_out_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  unique (channel_id, wa_id),
  unique (channel_id, user_id),
  unique (clinic_id, id),
  check (wa_id is not null or user_id is not null),
  foreign key (clinic_id, contact_id) references public.clinic_contacts(clinic_id, id) on delete set null (contact_id),
  foreign key (clinic_id, case_id) references public.reception_cases(clinic_id, id) on delete set null (case_id),
  check (status <> 'closed' or closed_at is not null),
  check ((assigned_to is null) = (assigned_at is null))
);
-- When the owner's account is deleted, the foreign key sets assigned_to to null; this keeps the pair
-- (assigned_to, assigned_at) consistent so the deletion is not refused by the check above.
create function public.whatsapp_conversation_assignment_pair() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.assigned_to is null then new.assigned_at := null; end if;
  return new;
end $$;
create trigger whatsapp_conversation_assignment_pair before update of assigned_to on public.whatsapp_conversations
  for each row execute function public.whatsapp_conversation_assignment_pair();

create index whatsapp_conversations_inbox on public.whatsapp_conversations (clinic_id, status, last_message_at desc, id desc);
create index whatsapp_conversations_assignee on public.whatsapp_conversations (clinic_id, assigned_to, status);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  conversation_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  wamid text unique check (wamid is null or length(wamid) between 8 and 256),
  kind text not null check (kind in ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts',
    'interactive', 'button', 'reaction', 'template', 'system', 'unsupported')),
  body text not null default '' check (length(body) <= 4096),
  context_wamid text check (context_wamid is null or length(context_wamid) between 8 and 256),
  media jsonb check (media is null or jsonb_typeof(media) = 'object'),
  template jsonb check (template is null or jsonb_typeof(template) = 'object'),
  status text not null check (status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed', 'unknown')),
  error text check (error is null or length(error) <= 500),
  -- Phone or business-scoped id the outbound message was addressed to (fixed at reservation).
  recipient text check (recipient is null or length(recipient) <= 180),
  sent_by uuid references auth.users(id) on delete set null,
  request_id uuid,
  provider_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (clinic_id, conversation_id) references public.whatsapp_conversations(clinic_id, id) on delete cascade,
  unique (clinic_id, sent_by, request_id),
  check ((direction = 'in') = (status = 'received')),
  check (direction = 'in' or request_id is not null)
);
create index whatsapp_messages_conversation on public.whatsapp_messages (conversation_id, created_at desc, id desc);

-- Raw webhook deliveries. Persisted before the 200 so a crash never loses an event; the payload is
-- erased once processed (only the hash stays for de-duplication).
create table public.whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  payload_sha256 text not null unique check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text check (last_error is null or length(last_error) <= 500)
);

create table public.whatsapp_templates (
  channel_id uuid not null references public.whatsapp_channels(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]+$' and length(name) <= 512),
  language text not null check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  category text not null default '' check (length(category) <= 40),
  status text not null default '' check (length(status) <= 40),
  body text not null default '' check (length(body) <= 4096),
  param_count integer not null default 0 check (param_count between 0 and 100),
  synced_at timestamptz not null default now(),
  primary key (channel_id, name, language)
);

-- Permission to start conversations with a person (WhatsApp Business Messaging Policy). Automatic
-- messages go only to people with a current record here. "SAIR" revokes it; "VOLTAR" renews it.
create table public.whatsapp_opt_ins (
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  wa_id text not null check (wa_id ~ '^[0-9]{8,15}$'),
  source text not null check (source in ('recepcao', 'paciente', 'cadastro')),
  text_version text not null default 'v1' check (length(text_version) between 1 and 40),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (clinic_id, wa_id)
);

alter table public.whatsapp_opt_ins enable row level security;
alter table public.whatsapp_channels enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_webhook_events enable row level security;
alter table public.whatsapp_templates enable row level security;
revoke all on public.whatsapp_channels, public.whatsapp_conversations, public.whatsapp_messages,
  public.whatsapp_webhook_events, public.whatsapp_templates, public.whatsapp_opt_ins from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_channels, public.whatsapp_conversations, public.whatsapp_messages,
  public.whatsapp_webhook_events, public.whatsapp_templates, public.whatsapp_opt_ins to service_role;
grant usage on sequence public.whatsapp_webhook_events_id_seq to service_role;

-- Brazilian mobile numbers may arrive with or without the ninth digit; both forms identify one person.
create function public.whatsapp_phone_variants(p_wa_id text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_wa_id ~ '^55[1-9][0-9][6-9][0-9]{7}$' then array[p_wa_id, substr(p_wa_id, 1, 4) || '9' || substr(p_wa_id, 5)]
    when p_wa_id ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' then array[p_wa_id, substr(p_wa_id, 1, 4) || substr(p_wa_id, 6)]
    else array[p_wa_id] end
$$;

create function public.whatsapp_record_event(p_sha text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.whatsapp_webhook_events;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  insert into public.whatsapp_webhook_events (payload_sha256, payload) values (p_sha, p_payload)
  on conflict (payload_sha256) do nothing returning * into e;
  if found then return jsonb_build_object('new', true, 'processed', false); end if;
  update public.whatsapp_webhook_events set attempts = attempts + 1,
    payload = case when processed_at is null then coalesce(payload, p_payload) else payload end
  where payload_sha256 = p_sha returning * into e;
  return jsonb_build_object('new', false, 'processed', e.processed_at is not null);
end $$;

create function public.whatsapp_finish_event(p_sha text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_error is null then
    update public.whatsapp_webhook_events set processed_at = now(), payload = null, last_error = null where payload_sha256 = p_sha;
  else
    update public.whatsapp_webhook_events set last_error = left(p_error, 500) where payload_sha256 = p_sha;
  end if;
end $$;

-- One inbound message. Idempotent by wamid; reopens a closed conversation; matches a clinic contact
-- by phone only when exactly one contact has it (never creates contacts or cases). A quick reply to
-- an automated message is recorded on that automation run (the agenda decides what it means: K3).
create function public.whatsapp_ingest_inbound(p_phone_number_id text, p_wa_id text, p_user_id text, p_profile_name text,
  p_wamid text, p_kind text, p_body text, p_media jsonb, p_context_wamid text, p_provider_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ch public.whatsapp_channels; conv public.whatsapp_conversations; matched uuid; n integer;
  preview text; keyword text; opt text := null;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_wa_id is null and p_user_id is null then raise exception 'Remetente sem identificação' using errcode = '22023'; end if;
  select * into ch from public.whatsapp_channels where phone_number_id = p_phone_number_id;
  if not found then return jsonb_build_object('ignored', 'unknown_channel'); end if;
  if exists (select 1 from public.whatsapp_messages where wamid = p_wamid) then return jsonb_build_object('duplicate', true); end if;
  -- Serialize deliveries of the same person on this channel.
  perform pg_advisory_xact_lock(hashtextextended('whatsapp:' || ch.id::text || ':' || coalesce(p_user_id, p_wa_id), 0));
  if exists (select 1 from public.whatsapp_messages where wamid = p_wamid) then return jsonb_build_object('duplicate', true); end if;
  select * into conv from public.whatsapp_conversations
  where channel_id = ch.id and ((p_user_id is not null and user_id = p_user_id) or (p_wa_id is not null and wa_id = p_wa_id))
  order by (user_id = p_user_id) desc nulls last limit 1 for update;
  if not found then
    insert into public.whatsapp_conversations (clinic_id, channel_id, wa_id, user_id, profile_name)
    values (ch.clinic_id, ch.id, p_wa_id, p_user_id, left(coalesce(p_profile_name, ''), 200)) returning * into conv;
  end if;
  insert into public.whatsapp_messages (clinic_id, conversation_id, direction, wamid, kind, body, media, context_wamid, status, provider_at)
  values (conv.clinic_id, conv.id, 'in', p_wamid, p_kind, left(coalesce(p_body, ''), 4096), p_media, p_context_wamid, 'received', p_provider_at);

  keyword := upper(trim(coalesce(p_body, '')));
  if p_kind in ('text', 'button', 'interactive') and keyword in ('SAIR', 'PARAR', 'STOP', 'CANCELAR LEMBRETES', 'NÃO QUERO RECEBER') then opt := 'out';
  elsif p_kind in ('text', 'button', 'interactive') and keyword in ('VOLTAR', 'RECEBER LEMBRETES') then opt := 'in'; end if;
  if p_context_wamid is not null and p_kind in ('button', 'interactive') then
    update public.whatsapp_automation_runs r set reply = left(coalesce(p_body, ''), 200), replied_at = now(), updated_at = now()
    from public.whatsapp_messages m where m.wamid = p_context_wamid and m.clinic_id = conv.clinic_id and m.conversation_id = conv.id
      and r.message_id = m.id;
  end if;

  if conv.contact_id is null and coalesce(p_wa_id, conv.wa_id) is not null then
    select count(*), min(c.id::text)::uuid into n, matched from public.clinic_contacts c
    where c.clinic_id = conv.clinic_id and c.phone_normalized = any (public.whatsapp_phone_variants(coalesce(p_wa_id, conv.wa_id)));
    if n <> 1 then matched := null; end if;
  end if;
  preview := left(case when coalesce(p_body, '') <> '' then p_body else '[' || p_kind || ']' end, 160);
  update public.whatsapp_conversations set
    -- Copy a missing key only when no other conversation of the channel already holds it: two
    -- conversations of one person are left for review instead of a silent merge or a 23505 loop.
    wa_id = case when wa_id is null and p_wa_id is not null and not exists (select 1 from public.whatsapp_conversations o
      where o.channel_id = conv.channel_id and o.wa_id = p_wa_id and o.id <> conv.id) then p_wa_id else wa_id end,
    user_id = case when user_id is null and p_user_id is not null and not exists (select 1 from public.whatsapp_conversations o
      where o.channel_id = conv.channel_id and o.user_id = p_user_id and o.id <> conv.id) then p_user_id else user_id end,
    linked_wa_id = case when p_wa_id is not null and coalesce(wa_id, '') <> p_wa_id and exists (select 1 from public.whatsapp_conversations o
      where o.channel_id = conv.channel_id and o.wa_id = p_wa_id and o.id <> conv.id) then p_wa_id else linked_wa_id end,
    profile_name = case when coalesce(p_profile_name, '') <> '' then left(p_profile_name, 200) else profile_name end,
    contact_id = coalesce(contact_id, matched),
    last_inbound_at = greatest(coalesce(last_inbound_at, '-infinity'), coalesce(p_provider_at, now())),
    last_message_at = greatest(last_message_at, coalesce(p_provider_at, now())),
    last_message_preview = preview,
    unread_count = least(unread_count + 1, 100000),
    status = 'open',
    opened_at = case when status = 'closed' then now() else opened_at end,
    first_response_at = case when status = 'closed' then null else first_response_at end,
    closed_at = case when status = 'closed' then null else closed_at end,
    closed_by = case when status = 'closed' then null else closed_by end,
    opted_out_at = case when opt = 'out' then now() when opt = 'in' then null else opted_out_at end,
    revision = revision + 1
  where id = conv.id;
  if opt = 'out' then
    -- Revoke for every phone known for this person, including a phone held by a split conversation.
    update public.whatsapp_opt_ins set revoked_at = now() where clinic_id = conv.clinic_id and revoked_at is null
      and (wa_id = any (public.whatsapp_phone_variants(coalesce(p_wa_id, conv.wa_id, '')))
        or wa_id = any (public.whatsapp_phone_variants(coalesce((select linked_wa_id from public.whatsapp_conversations where id = conv.id), p_wa_id, ''))));
    update public.whatsapp_conversations o set opted_out_at = coalesce(o.opted_out_at, now()), revision = o.revision + 1
    where o.channel_id = conv.channel_id and o.id <> conv.id
      and o.wa_id = any (public.whatsapp_phone_variants(coalesce((select linked_wa_id from public.whatsapp_conversations where id = conv.id), p_wa_id, '')));
  elsif opt = 'in' and coalesce(p_wa_id, conv.wa_id) is not null then
    insert into public.whatsapp_opt_ins (clinic_id, wa_id, source) values (conv.clinic_id, coalesce(p_wa_id, conv.wa_id), 'paciente')
    on conflict (clinic_id, wa_id) do update set revoked_at = null, source = 'paciente', recorded_at = now(), recorded_by = null;
  end if;
  return jsonb_build_object('conversationId', conv.id, 'duplicate', false, 'optOut', opt);
end $$;

-- The person changed phone number or business-scoped id (Meta "system" messages). The conversation
-- follows them; the phone itself is never written into the message text.
create function public.whatsapp_identity_change(p_phone_number_id text, p_wamid text, p_previous_user_id text, p_user_id text,
  p_wa_id text, p_kind text, p_provider_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ch public.whatsapp_channels; conv public.whatsapp_conversations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into ch from public.whatsapp_channels where phone_number_id = p_phone_number_id;
  if not found or p_previous_user_id is null or exists (select 1 from public.whatsapp_messages where wamid = p_wamid) then return false; end if;
  select * into conv from public.whatsapp_conversations where channel_id = ch.id and user_id = p_previous_user_id for update;
  if not found then return false; end if;
  if not exists (select 1 from public.whatsapp_conversations where channel_id = ch.id and id <> conv.id
      and ((p_user_id is not null and user_id = p_user_id) or (p_wa_id is not null and wa_id = p_wa_id))) then
    update public.whatsapp_conversations set user_id = coalesce(p_user_id, user_id),
      wa_id = case when p_kind = 'user_changed_number' then p_wa_id else wa_id end,
      contact_id = case when p_kind = 'user_changed_number' then null else contact_id end,
      revision = revision + 1 where id = conv.id;
  end if;
  insert into public.whatsapp_messages (clinic_id, conversation_id, direction, wamid, kind, body, status, provider_at)
  values (conv.clinic_id, conv.id, 'in', p_wamid, 'system',
    case when p_kind = 'user_changed_number' then 'O contato trocou de número no WhatsApp. Confira o cadastro antes de responder.'
      else 'O identificador do contato no WhatsApp mudou.' end, 'received', p_provider_at);
  return true;
end $$;

-- Delivery receipts only move forward (sent < delivered < read); failed is final unless a later
-- receipt proves delivery.
create function public.whatsapp_apply_status(p_phone_number_id text, p_wamid text, p_status text, p_at timestamptz, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare m public.whatsapp_messages; rank_old int; rank_new int;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_status not in ('sent', 'delivered', 'read', 'failed') then return false; end if;
  select msg.* into m from public.whatsapp_messages msg join public.whatsapp_conversations c on c.id = msg.conversation_id
    join public.whatsapp_channels ch on ch.id = c.channel_id
  where msg.wamid = p_wamid and msg.direction = 'out' and ch.phone_number_id = p_phone_number_id for update of msg;
  if not found then return false; end if;
  rank_old := array_position(array['pending', 'failed', 'sent', 'delivered', 'read'], m.status);
  rank_new := array_position(array['pending', 'failed', 'sent', 'delivered', 'read'], p_status);
  if p_status = 'failed' and m.status in ('pending', 'sent') then
    update public.whatsapp_messages set status = 'failed', error = left(coalesce(p_error, 'Falha na entrega'), 500) where id = m.id;
    return true;
  end if;
  if rank_new > rank_old then
    update public.whatsapp_messages set status = p_status, error = null where id = m.id;
    return true;
  end if;
  return false;
end $$;

-- Outbound, step 1: reserve the message under the caller's request id. Free text only inside the
-- 24-hour customer service window; templates only for people who did not opt out. The recipient is
-- read here, under the conversation lock, and returned: the caller sends to exactly this address.
create function public.whatsapp_begin_outbound(p_clinic uuid, p_conversation uuid, p_actor uuid, p_request uuid,
  p_kind text, p_body text, p_template jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conv public.whatsapp_conversations; existing public.whatsapp_messages; m public.whatsapp_messages; recipient text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_kind not in ('text', 'template') or p_request is null or p_actor is null then
    raise exception 'Mensagem inválida' using errcode = '22023';
  end if;
  select * into existing from public.whatsapp_messages where clinic_id = p_clinic and sent_by = p_actor and request_id = p_request;
  if found then
    -- A replay must be the same message; another content under the same request id is refused.
    if existing.conversation_id <> p_conversation or existing.kind <> p_kind or existing.body <> left(coalesce(p_body, ''), 4096)
       or existing.template is distinct from p_template then
      raise exception 'Este pedido já foi usado para outra mensagem' using errcode = '22023';
    end if;
    return jsonb_build_object('messageId', existing.id, 'state', 'existing', 'status', existing.status, 'wamid', existing.wamid);
  end if;
  select * into conv from public.whatsapp_conversations where id = p_conversation and clinic_id = p_clinic for update;
  if not found then raise exception 'Conversa indisponível' using errcode = '42501'; end if;
  if p_kind = 'text' and (conv.last_inbound_at is null or conv.last_inbound_at <= now() - interval '24 hours') then
    raise exception 'Janela de 24 horas encerrada' using errcode = 'P0W01';
  end if;
  if p_kind = 'template' and conv.opted_out_at is not null then
    raise exception 'Contato pediu para não receber mensagens' using errcode = 'P0W02';
  end if;
  recipient := coalesce(conv.wa_id, conv.user_id);
  insert into public.whatsapp_messages (clinic_id, conversation_id, direction, kind, body, template, status, sent_by, request_id, recipient)
  values (p_clinic, p_conversation, 'out', p_kind, left(coalesce(p_body, ''), 4096), p_template, 'pending', p_actor, p_request, recipient)
  returning * into m;
  return jsonb_build_object('messageId', m.id, 'state', 'new', 'status', m.status, 'wamid', null,
    'to', conv.wa_id, 'recipient', case when conv.wa_id is null then conv.user_id end);
end $$;

-- Outbound, step 2: record what the Cloud API answered. p_unknown: the request may have reached Meta
-- but no answer came back (network failure, 5xx). The message stays "unknown" for a person to check;
-- it is never retried automatically, because a retry could duplicate the message.
create function public.whatsapp_finish_outbound(p_message uuid, p_wamid text, p_error text, p_unknown boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.whatsapp_messages;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into m from public.whatsapp_messages where id = p_message and direction = 'out' for update;
  if not found or m.status <> 'pending' then return; end if;
  if p_wamid is not null then
    update public.whatsapp_messages set wamid = p_wamid, status = 'sent', provider_at = now() where id = m.id;
    update public.whatsapp_conversations set
      last_message_at = now(),
      last_message_preview = left(case when m.kind = 'template' then '[modelo] ' || coalesce(m.template->>'name', '') else m.body end, 160),
      -- Only a person answering counts as the first response and clears the unread badge.
      first_response_at = case when m.sent_by is not null then coalesce(first_response_at, now()) else first_response_at end,
      unread_count = case when m.sent_by is not null then 0 else unread_count end,
      revision = revision + 1
    where id = m.conversation_id;
    update public.whatsapp_automation_runs set status = 'sent', updated_at = now() where message_id = m.id and status = 'pending';
  elsif coalesce(p_unknown, false) then
    update public.whatsapp_messages set status = 'unknown', error = left(coalesce(p_error, 'Envio não confirmado pelo WhatsApp'), 500) where id = m.id;
    update public.whatsapp_automation_runs set status = 'unknown', reason = left(coalesce(p_error, 'Envio não confirmado pelo WhatsApp'), 300),
      updated_at = now() where message_id = m.id and status = 'pending';
  else
    update public.whatsapp_messages set status = 'failed', error = left(coalesce(p_error, 'Falha no envio'), 500) where id = m.id;
    update public.whatsapp_automation_runs set status = 'failed', reason = left(coalesce(p_error, 'Falha no envio'), 300), updated_at = now()
    where message_id = m.id and status = 'pending';
  end if;
end $$;

-- Reception actions on a conversation. p_actor was authorized by the Edge Function for p_clinic.
create function public.whatsapp_conversation_action(p_clinic uuid, p_conversation uuid, p_actor uuid, p_revision integer,
  p_action text, p_target uuid, p_queue text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conv public.whatsapp_conversations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into conv from public.whatsapp_conversations where id = p_conversation and clinic_id = p_clinic for update;
  if not found then raise exception 'Conversa indisponível' using errcode = '42501'; end if;
  if p_action <> 'mark_read' and p_revision is distinct from conv.revision then
    raise exception 'A conversa mudou; atualize antes de continuar' using errcode = '40001';
  end if;
  if p_action = 'assign' then
    if p_target is null or not (
      exists (select 1 from public.clinic_staff_members where clinic_id = p_clinic and user_id = p_target and active)
      or exists (select 1 from public.clinic_members where clinic_id = p_clinic and user_id = p_target and role = 'admin' and status = 'active'))
    then raise exception 'Pessoa indisponível para atendimento' using errcode = '22023'; end if;
    update public.whatsapp_conversations set assigned_to = p_target, assigned_at = now(), status = 'open',
      closed_at = null, closed_by = null, revision = revision + 1 where id = conv.id;
  elsif p_action = 'unassign' then
    update public.whatsapp_conversations set assigned_to = null, assigned_at = null, revision = revision + 1 where id = conv.id;
  elsif p_action = 'close' then
    update public.whatsapp_conversations set status = 'closed', closed_at = now(), closed_by = p_actor, unread_count = 0,
      revision = revision + 1 where id = conv.id;
  elsif p_action = 'reopen' then
    update public.whatsapp_conversations set status = 'open', opened_at = now(), first_response_at = null, closed_at = null,
      closed_by = null, revision = revision + 1 where id = conv.id and status = 'closed';
  elsif p_action = 'mark_read' then
    update public.whatsapp_conversations set unread_count = 0 where id = conv.id;
  elsif p_action = 'link_contact' then
    if p_target is not null and not exists (select 1 from public.clinic_contacts where clinic_id = p_clinic and id = p_target) then
      raise exception 'Contato indisponível' using errcode = '22023';
    end if;
    update public.whatsapp_conversations set contact_id = p_target, revision = revision + 1 where id = conv.id;
  elsif p_action = 'link_case' then
    if p_target is not null and not exists (select 1 from public.reception_cases where clinic_id = p_clinic and id = p_target) then
      raise exception 'Atendimento indisponível' using errcode = '22023';
    end if;
    update public.whatsapp_conversations set case_id = p_target, revision = revision + 1 where id = conv.id;
  elsif p_action = 'record_opt_in' then
    if conv.wa_id is null then raise exception 'Sem telefone para registrar o consentimento' using errcode = '22023'; end if;
    insert into public.whatsapp_opt_ins (clinic_id, wa_id, source, recorded_by) values (p_clinic, conv.wa_id, 'recepcao', p_actor)
    on conflict (clinic_id, wa_id) do update set revoked_at = null, source = 'recepcao', recorded_by = p_actor, recorded_at = now();
    update public.whatsapp_conversations set opted_out_at = null, revision = revision + 1 where id = conv.id;
  elsif p_action = 'revoke_opt_in' then
    update public.whatsapp_opt_ins set revoked_at = now() where clinic_id = p_clinic and revoked_at is null
      and wa_id = any (public.whatsapp_phone_variants(coalesce(conv.wa_id, '')));
    update public.whatsapp_conversations set opted_out_at = coalesce(opted_out_at, now()), revision = revision + 1 where id = conv.id;
  elsif p_action = 'set_queue' then
    if p_queue is null or p_queue !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then raise exception 'Fila inválida' using errcode = '22023'; end if;
    update public.whatsapp_conversations set queue = p_queue, revision = revision + 1 where id = conv.id;
  else
    raise exception 'Ação desconhecida' using errcode = '22023';
  end if;
  select * into conv from public.whatsapp_conversations where id = p_conversation;
  return jsonb_build_object('revision', conv.revision, 'status', conv.status, 'assignedTo', conv.assigned_to);
end $$;

revoke all on function public.whatsapp_phone_variants(text) from public, anon, authenticated;
revoke all on function public.whatsapp_record_event(text, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_finish_event(text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_ingest_inbound(text, text, text, text, text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.whatsapp_identity_change(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.whatsapp_apply_status(text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.whatsapp_begin_outbound(uuid, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_finish_outbound(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.whatsapp_conversation_action(uuid, uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_phone_variants(text) to service_role;
grant execute on function public.whatsapp_record_event(text, jsonb) to service_role;
grant execute on function public.whatsapp_finish_event(text, text) to service_role;
grant execute on function public.whatsapp_ingest_inbound(text, text, text, text, text, text, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.whatsapp_identity_change(text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.whatsapp_apply_status(text, text, text, timestamptz, text) to service_role;
grant execute on function public.whatsapp_begin_outbound(uuid, uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.whatsapp_finish_outbound(uuid, text, text, boolean) to service_role;
grant execute on function public.whatsapp_conversation_action(uuid, uuid, uuid, integer, text, uuid, text) to service_role;

-- ---------------------------------------------------------------- agenda automations
-- Rules the clinic admin configures in Settings: send an approved template N minutes before an
-- appointment starts or after it ends (e.g. 48 h before, pre-visit link, post-visit message).
-- The whatsapp-automations function runs every few minutes (pg_cron) and sends at most once per
-- rule, appointment and start time, so a rescheduled appointment gets a new reminder.

create table public.whatsapp_automations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 80),
  enabled boolean not null default false,
  trigger text not null check (trigger in ('before_start', 'after_end')),
  offset_minutes integer not null check (offset_minutes between 0 and 20160),
  template_name text not null check (template_name ~ '^[a-z0-9_]+$' and length(template_name) <= 512),
  template_language text not null check (template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  -- One entry per template field {{n}}: {"source": "paciente_primeiro_nome" | "data" | "hora" | "dia_semana" |
  -- "medico" | "clinica" | "link" | "texto", "text": "..."}.
  params jsonb not null default '[]' check (jsonb_typeof(params) = 'array' and jsonb_array_length(params) <= 20),
  link_url text check (link_url is null or (link_url ~ '^https://[^\s]+$' and length(link_url) <= 500)),
  doctor_ids uuid[] check (doctor_ids is null or cardinality(doctor_ids) between 1 and 100),
  appointment_types text[] check (appointment_types is null or cardinality(appointment_types) between 1 and 20),
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whatsapp_automations_clinic on public.whatsapp_automations (clinic_id) where enabled;

create table public.whatsapp_automation_runs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  automation_id uuid not null references public.whatsapp_automations(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  appointment_start timestamptz not null,
  status text not null check (status in ('pending', 'sent', 'failed', 'skipped', 'unknown')),
  reason text check (reason is null or length(reason) <= 300),
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  reply text check (reply is null or length(reply) <= 200),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, appointment_id, appointment_start)
);
create index whatsapp_automation_runs_recent on public.whatsapp_automation_runs (clinic_id, created_at desc);
create index whatsapp_automation_runs_message on public.whatsapp_automation_runs (message_id) where message_id is not null;

alter table public.whatsapp_automations enable row level security;
alter table public.whatsapp_automation_runs enable row level security;
revoke all on public.whatsapp_automations, public.whatsapp_automation_runs from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_automations, public.whatsapp_automation_runs to service_role;

-- Digits of a phone that WhatsApp can address, or null (never raises, unlike normalize_reception_phone).
create function public.whatsapp_safe_phone(p_raw text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d is null or length(d) < 10 or length(d) > 15 then null
    when trim(p_raw) not like '+%' and length(d) in (10, 11) then '55' || d
    else d end
  from (select nullif(regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g'), '') as d) x
$$;

-- Appointments of the clinic agenda whose automation time has come (within the last 14 hours, so
-- quiet hours delay rather than drop a message). Only appointments that belong to the clinic
-- (appointments.clinic_id), never a doctor's private agenda, and only the reception contact's phone:
-- the private patient record is not read. `consented`: the person has a recorded opt-in.
create function public.whatsapp_automation_candidates(p_now timestamptz, p_limit integer) returns table (
  automation_id uuid, clinic_id uuid, appointment_id uuid, appointment_start timestamptz, appointment_end timestamptz,
  doctor_id uuid, patient_name text, phone text, doctor_name text, clinic_name text, opted_out boolean, consented boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.clinic_id, ap.id, ap.start_time, ap.end_time, ap.user_id,
    coalesce(nullif(trim(ct.name), ''), '') as patient_name,
    ct.phone_normalized as phone,
    coalesce(nullif(trim(us.doctor_name), ''), '') as doctor_name,
    cl.name,
    exists (select 1 from public.whatsapp_conversations c where c.channel_id = ch.id and c.opted_out_at is not null
      and c.wa_id = any (public.whatsapp_phone_variants(coalesce(ct.phone_normalized, '')))) as opted_out,
    exists (select 1 from public.whatsapp_opt_ins o where o.clinic_id = a.clinic_id and o.revoked_at is null
      and o.wa_id = any (public.whatsapp_phone_variants(coalesce(ct.phone_normalized, '')))) as consented
  from public.whatsapp_automations a
  join public.whatsapp_channels ch on ch.clinic_id = a.clinic_id and ch.status = 'connected'
  join public.clinics cl on cl.id = a.clinic_id
  join public.appointments ap on ap.clinic_id = a.clinic_id
  left join public.clinic_contacts ct on ct.clinic_id = ap.clinic_id and ct.id = ap.contact_id
  left join public.user_settings us on us.user_id = ap.user_id
  where a.enabled
    and (a.doctor_ids is null or ap.user_id = any (a.doctor_ids))
    and (a.appointment_types is null or ap.type = any (a.appointment_types))
    and exists (select 1 from public.patient_contact_links l where l.clinic_id = ap.clinic_id and l.contact_id = ap.contact_id
      and l.patient_id = ap.patient_id and l.doctor_user_id = ap.user_id and l.active)
    and (
      (a.trigger = 'before_start' and ap.status in ('agendado', 'confirmado') and ap.start_time > p_now + interval '1 hour'
        and ap.start_time - make_interval(mins => a.offset_minutes) between p_now - interval '14 hours' and p_now)
      or (a.trigger = 'after_end' and ap.status = 'realizado'
        and ap.end_time + make_interval(mins => a.offset_minutes) between p_now - interval '14 hours' and p_now))
    and not exists (select 1 from public.whatsapp_automation_runs r
      where r.automation_id = a.id and r.appointment_id = ap.id and r.appointment_start = ap.start_time)
  order by ap.start_time
  limit greatest(1, least(p_limit, 500))
$$;

-- Claims one run. Returns null when another worker already did. Everything the candidate list said
-- is checked again here, under locks: the appointment still belongs to the clinic, is still due and
-- not cancelled, the phone is still the contact's, the person consented and did not opt out. When
-- something changed the run is recorded as skipped with the reason. For a sendable run it also
-- prepares the conversation (created closed, so it only enters the reception queue when the person
-- replies) and the pending outbound message.
create function public.whatsapp_automation_begin(p_automation uuid, p_rule_revision integer, p_appointment uuid, p_start timestamptz,
  p_wa_id text, p_skip_reason text, p_body text, p_template jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.whatsapp_automations; ch public.whatsapp_channels; conv public.whatsapp_conversations; ap public.appointments;
  phone text; reason text := p_skip_reason; run_id uuid; msg_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into a from public.whatsapp_automations where id = p_automation and enabled for share;
  -- A rule edited after the selection: nothing is claimed; the next run uses the current rule.
  if not found or a.revision is distinct from p_rule_revision then return null; end if;
  select * into ap from public.appointments where id = p_appointment for share;
  -- No longer matching the rule's filters or not due yet: not claimed (it may become eligible again).
  if found and ap.clinic_id = a.clinic_id and (
      (a.doctor_ids is not null and not (ap.user_id = any (a.doctor_ids)))
      or (a.appointment_types is not null and not (coalesce(ap.type, '') = any (a.appointment_types)))
      or (a.trigger = 'before_start' and ap.start_time - make_interval(mins => a.offset_minutes) > now())
      or (a.trigger = 'after_end' and ap.end_time + make_interval(mins => a.offset_minutes) > now())) then
    return null;
  end if;
  if reason is null then
    if not found or ap.clinic_id is distinct from a.clinic_id then reason := 'A consulta não está mais na agenda da clínica.';
    elsif ap.start_time <> p_start then reason := 'A consulta mudou de horário.';
    elsif a.trigger = 'before_start' and ap.status not in ('agendado', 'confirmado') then reason := 'A consulta não está mais agendada.';
    elsif a.trigger = 'after_end' and ap.status <> 'realizado' then reason := 'A consulta não foi marcada como realizada.';
    else
      begin
        if not cortex_private.reception_link_is_active(ap.clinic_id, ap.contact_id, ap.patient_id, ap.user_id) then
          reason := 'O vínculo do contato com o paciente está suspenso.';
        end if;
      exception when sqlstate '40001' then
        return null; -- link being edited right now: try again on the next run
      end;
    end if;
    if reason is null then
      -- Snapshot of the recipient until the reservation commits. NOWAIT: a contact being corrected right
      -- now is not waited for (no lock cycle); nothing is claimed and the next run reads the new phone.
      begin
        select c.phone_normalized into phone from public.clinic_contacts c where c.clinic_id = a.clinic_id and c.id = ap.contact_id
        for share nowait;
      exception when lock_not_available then
        return null;
      end;
      if phone is null or p_wa_id is null or not (p_wa_id = any (public.whatsapp_phone_variants(phone))) then
        reason := 'O telefone do contato mudou ou não é válido.';
      elsif not exists (select 1 from public.whatsapp_opt_ins o where o.clinic_id = a.clinic_id and o.revoked_at is null
          and o.wa_id = any (public.whatsapp_phone_variants(p_wa_id))) then
        reason := 'Sem consentimento registrado para mensagens pelo WhatsApp.';
      end if;
    end if;
  end if;
  select * into ch from public.whatsapp_channels where clinic_id = a.clinic_id and status = 'connected';
  if reason is null and not found then reason := 'O WhatsApp da clínica está desconectado.'; end if;
  if reason is null then
    perform pg_advisory_xact_lock(hashtextextended('whatsapp:' || ch.id::text || ':' || p_wa_id, 0));
    select * into conv from public.whatsapp_conversations where channel_id = ch.id and wa_id = any (public.whatsapp_phone_variants(p_wa_id))
    order by (wa_id = p_wa_id) desc limit 1 for update;
    if found and conv.opted_out_at is not null then reason := 'O contato pediu para não receber mensagens.'; end if;
  end if;
  insert into public.whatsapp_automation_runs (clinic_id, automation_id, appointment_id, appointment_start, status, reason)
  values (a.clinic_id, a.id, p_appointment, p_start, case when reason is null then 'pending' else 'skipped' end, left(reason, 300))
  on conflict (automation_id, appointment_id, appointment_start) do nothing returning id into run_id;
  if run_id is null then return null; end if;
  if reason is not null then return jsonb_build_object('runId', run_id, 'skipped', true, 'reason', reason); end if;
  if conv.id is null then
    insert into public.whatsapp_conversations (clinic_id, channel_id, wa_id, status, closed_at)
    values (a.clinic_id, ch.id, p_wa_id, 'closed', now()) returning * into conv;
  end if;
  insert into public.whatsapp_messages (clinic_id, conversation_id, direction, kind, body, template, status, request_id, recipient)
  values (a.clinic_id, conv.id, 'out', 'template', left(coalesce(p_body, ''), 4096), p_template, 'pending', run_id, conv.wa_id)
  returning id into msg_id;
  update public.whatsapp_automation_runs set message_id = msg_id, updated_at = now() where id = run_id;
  return jsonb_build_object('runId', run_id, 'messageId', msg_id, 'conversationId', conv.id, 'to', conv.wa_id, 'skipped', false);
end $$;

-- Marks a run whose preparation failed (bad phone, disconnected channel) so it is not retried forever.
create function public.whatsapp_automation_fail(p_automation uuid, p_appointment uuid, p_start timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.whatsapp_automations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into a from public.whatsapp_automations where id = p_automation;
  if not found then return; end if;
  insert into public.whatsapp_automation_runs (clinic_id, automation_id, appointment_id, appointment_start, status, reason)
  values (a.clinic_id, a.id, p_appointment, p_start, 'failed', left(coalesce(p_reason, 'Falha'), 300))
  on conflict (automation_id, appointment_id, appointment_start) do nothing;
end $$;

-- Admin edits of a rule (authorized by the Edge Function); revision guards concurrent edits.
create function public.whatsapp_automation_save(p_clinic uuid, p_actor uuid, p_id uuid, p_revision integer, p_rule jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.whatsapp_automations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.whatsapp_automations (clinic_id, name, enabled, trigger, offset_minutes, template_name, template_language, params,
      link_url, doctor_ids, appointment_types, created_by, updated_by)
    values (p_clinic, p_rule->>'name', coalesce((p_rule->>'enabled')::boolean, false), p_rule->>'trigger', (p_rule->>'offsetMinutes')::integer,
      p_rule->>'templateName', p_rule->>'templateLanguage', coalesce(p_rule->'params', '[]'), nullif(p_rule->>'linkUrl', ''),
      case when jsonb_typeof(p_rule->'doctorIds') = 'array' then array(select jsonb_array_elements_text(p_rule->'doctorIds'))::uuid[] end,
      case when jsonb_typeof(p_rule->'appointmentTypes') = 'array' then array(select jsonb_array_elements_text(p_rule->'appointmentTypes')) end,
      p_actor, p_actor) returning * into r;
  else
    update public.whatsapp_automations set name = p_rule->>'name', enabled = coalesce((p_rule->>'enabled')::boolean, false),
      trigger = p_rule->>'trigger', offset_minutes = (p_rule->>'offsetMinutes')::integer, template_name = p_rule->>'templateName',
      template_language = p_rule->>'templateLanguage', params = coalesce(p_rule->'params', '[]'), link_url = nullif(p_rule->>'linkUrl', ''),
      doctor_ids = case when jsonb_typeof(p_rule->'doctorIds') = 'array' then array(select jsonb_array_elements_text(p_rule->'doctorIds'))::uuid[] end,
      appointment_types = case when jsonb_typeof(p_rule->'appointmentTypes') = 'array' then array(select jsonb_array_elements_text(p_rule->'appointmentTypes')) end,
      updated_by = p_actor, updated_at = now(), revision = revision + 1
    where id = p_id and clinic_id = p_clinic and revision = p_revision returning * into r;
    if not found then raise exception 'A regra mudou; atualize antes de salvar' using errcode = '40001'; end if;
  end if;
  if r.doctor_ids is not null and exists (select 1 from unnest(r.doctor_ids) d
      where not exists (select 1 from public.clinic_members where clinic_id = p_clinic and user_id = d and status = 'active')) then
    raise exception 'Médico não pertence à clínica' using errcode = '22023';
  end if;
  return jsonb_build_object('id', r.id, 'revision', r.revision);
end $$;

revoke all on function public.whatsapp_safe_phone(text) from public, anon, authenticated;
revoke all on function public.whatsapp_automation_candidates(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.whatsapp_automation_begin(uuid, integer, uuid, timestamptz, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_automation_fail(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.whatsapp_automation_save(uuid, uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_safe_phone(text) to service_role;
grant execute on function public.whatsapp_automation_candidates(timestamptz, integer) to service_role;
grant execute on function public.whatsapp_automation_begin(uuid, integer, uuid, timestamptz, text, text, text, jsonb) to service_role;
grant execute on function public.whatsapp_automation_fail(uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.whatsapp_automation_save(uuid, uuid, uuid, integer, jsonb) to service_role;
