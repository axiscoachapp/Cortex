-- WhatsApp menu bot ("robô de fluxo") for the clinic reception. Owner: Claude (C4), review: Codex (K6).
-- Contract: docs/product/whatsapp/CONTRATO.md, section "Robô de fluxo". Same access model as
-- 20261106100000: RLS on, no policy for anon/authenticated, functions for service_role only.
-- The bot answers inside the 24-hour window opened by the patient, only routes (no health questions,
-- no booking) and stops as soon as a person takes the conversation.

create table public.whatsapp_flows (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  enabled boolean not null default false,
  -- {start, nodes: {id: {title, text, options: [{label, goto}], then}}}; validated by the Edge Function.
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and length(definition::text) <= 200000),
  -- {"0".."6": ["HH:MM","HH:MM"]} in São Paulo time; empty = always open.
  hours jsonb not null default '{}' check (jsonb_typeof(hours) = 'object'),
  after_hours_text text not null default '' check (length(after_hours_text) <= 1024),
  handoff_text text not null check (length(trim(handoff_text)) between 1 and 1024),
  default_queue text not null default 'geral' check (default_queue ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- One bot cycle per conversation (the latest). A new cycle starts when the conversation is reopened.
create table public.whatsapp_bot_sessions (
  conversation_id uuid primary key,
  clinic_id uuid not null,
  flow_revision integer not null check (flow_revision >= 1),
  node text not null check (node ~ '^[a-z0-9_-]{1,40}$'),
  attempts integer not null default 0 check (attempts between 0 and 10),
  path jsonb not null default '[]' check (jsonb_typeof(path) = 'array' and jsonb_array_length(path) <= 20),
  status text not null check (status in ('active', 'handed_off', 'closed', 'human', 'error')),
  outcome text check (outcome is null or length(outcome) <= 80),
  revision integer not null default 1 check (revision >= 1),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, conversation_id) references public.whatsapp_conversations(clinic_id, id) on delete cascade
);

alter table public.whatsapp_messages add column bot boolean not null default false;
alter table public.whatsapp_messages add constraint whatsapp_messages_bot_outbound check (not bot or (direction = 'out' and sent_by is null));

alter table public.whatsapp_flows enable row level security;
alter table public.whatsapp_bot_sessions enable row level security;
revoke all on public.whatsapp_flows, public.whatsapp_bot_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_flows, public.whatsapp_bot_sessions to service_role;

-- Admin edits of the flow (authorized by the Edge Function); revision guards concurrent edits.
create function public.whatsapp_flow_save(p_clinic uuid, p_actor uuid, p_revision integer, p_flow jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.whatsapp_flows;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_revision is null or p_revision = 0 then
    insert into public.whatsapp_flows (clinic_id, enabled, definition, hours, after_hours_text, handoff_text, default_queue, updated_by)
    values (p_clinic, coalesce((p_flow->>'enabled')::boolean, false), p_flow->'definition', coalesce(p_flow->'hours', '{}'),
      coalesce(p_flow->>'afterHoursText', ''), p_flow->>'handoffText', coalesce(p_flow->>'defaultQueue', 'geral'), p_actor)
    on conflict (clinic_id) do nothing returning * into f;
    if not found then raise exception 'O fluxo mudou; atualize antes de salvar' using errcode = '40001'; end if;
  else
    update public.whatsapp_flows set enabled = coalesce((p_flow->>'enabled')::boolean, false), definition = p_flow->'definition',
      hours = coalesce(p_flow->'hours', '{}'), after_hours_text = coalesce(p_flow->>'afterHoursText', ''), handoff_text = p_flow->>'handoffText',
      default_queue = coalesce(p_flow->>'defaultQueue', 'geral'), updated_by = p_actor, updated_at = now(), revision = revision + 1
    where clinic_id = p_clinic and revision = p_revision returning * into f;
    if not found then raise exception 'O fluxo mudou; atualize antes de salvar' using errcode = '40001'; end if;
  end if;
  return jsonb_build_object('revision', f.revision, 'updatedAt', f.updated_at);
end $$;

-- One bot step, atomically: checks that the conversation is still the bot's (open, nobody assigned,
-- no person answered since the cycle began, the trigger is the latest inbound message), compares the
-- session revision, updates the session, applies the hand-off queue or the closing, and reserves the
-- outbound messages (pending, bot = true). The caller sends them in order and records each outcome
-- with whatsapp_finish_outbound. Returns applied = false when anything changed.
create function public.whatsapp_bot_apply(p_conversation uuid, p_trigger_wamid text, p_session_revision integer, p_new_cycle boolean,
  p_flow_revision integer, p_node text, p_attempts integer, p_path jsonb, p_status text, p_outcome text, p_queue text, p_close boolean,
  p_messages jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conv public.whatsapp_conversations; s public.whatsapp_bot_sessions; f public.whatsapp_flows; trigger_at timestamptz;
  item jsonb; ids uuid[] := '{}'; mid uuid; next_revision integer; has_session boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_status not in ('active', 'handed_off', 'closed', 'human', 'error') or jsonb_typeof(coalesce(p_messages, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_messages, '[]')) > 3 or (p_queue is not null and p_queue !~ '^[a-z0-9][a-z0-9_-]{0,39}$')
     or exists (select 1 from jsonb_array_elements(coalesce(p_messages, '[]')) e where jsonb_typeof(e) <> 'object' or e->>'kind' is null
       or e->>'kind' not in ('text', 'interactive')) then
    raise exception 'Passo do robô inválido' using errcode = '22023';
  end if;
  select * into conv from public.whatsapp_conversations where id = p_conversation for update;
  if not found then return jsonb_build_object('applied', false, 'reason', 'conversation'); end if;
  select * into f from public.whatsapp_flows where clinic_id = conv.clinic_id;
  select * into s from public.whatsapp_bot_sessions where conversation_id = conv.id for update;
  has_session := found;
  -- Ending a cycle (human/error) needs no other check than the revision.
  if p_status in ('human', 'error') then
    if not has_session or s.revision is distinct from p_session_revision then return jsonb_build_object('applied', false, 'reason', 'revision'); end if;
    update public.whatsapp_bot_sessions set status = p_status, outcome = left(p_outcome, 80), revision = revision + 1, updated_at = now()
    where conversation_id = conv.id returning revision into next_revision;
    return jsonb_build_object('applied', true, 'revision', next_revision, 'messageIds', '[]'::jsonb);
  end if;
  if f.clinic_id is null or not f.enabled or f.revision is distinct from p_flow_revision then
    return jsonb_build_object('applied', false, 'reason', 'flow');
  end if;
  if conv.status <> 'open' or conv.assigned_to is not null then return jsonb_build_object('applied', false, 'reason', 'taken'); end if;
  select created_at into trigger_at from public.whatsapp_messages where wamid = p_trigger_wamid and conversation_id = conv.id and direction = 'in';
  if trigger_at is null or exists (select 1 from public.whatsapp_messages m where m.conversation_id = conv.id and m.direction = 'in'
      and (m.created_at > trigger_at or (m.created_at = trigger_at and m.wamid > p_trigger_wamid))) then
    return jsonb_build_object('applied', false, 'reason', 'stale');
  end if;
  if p_new_cycle then
    if has_session and s.revision is distinct from p_session_revision then return jsonb_build_object('applied', false, 'reason', 'revision'); end if;
  else
    if not has_session or s.status <> 'active' or s.revision is distinct from p_session_revision then
      return jsonb_build_object('applied', false, 'reason', 'revision');
    end if;
  end if;
  -- A person who answered since the conversation was (re)opened owns it, for a first cycle, a restart
  -- (new flow revision or idle) and a running cycle alike. Answers from before the current opening
  -- (a reopened conversation) do not count. Checked under the conversation lock, as the human writer.
  if exists (select 1 from public.whatsapp_messages m where m.conversation_id = conv.id and m.direction = 'out' and m.sent_by is not null
      and m.created_at >= conv.opened_at) then
    if has_session and s.status = 'active' then
      update public.whatsapp_bot_sessions set status = 'human', revision = revision + 1, updated_at = now() where conversation_id = conv.id;
    end if;
    return jsonb_build_object('applied', false, 'reason', 'taken');
  end if;
  -- Free-form and interactive messages only inside the 24-hour window, the same rule as the human
  -- writer (P0W01). Refused without any effect: session, queue, closing and messages stay as they are.
  if conv.last_inbound_at is null or conv.last_inbound_at <= now() - interval '24 hours' then
    return jsonb_build_object('applied', false, 'reason', 'window');
  end if;
  if not has_session then
    insert into public.whatsapp_bot_sessions (conversation_id, clinic_id, flow_revision, node, attempts, path, status, outcome)
    values (conv.id, conv.clinic_id, p_flow_revision, p_node, p_attempts, coalesce(p_path, '[]'), p_status, left(p_outcome, 80))
    returning revision into next_revision;
  else
    update public.whatsapp_bot_sessions set flow_revision = p_flow_revision, node = p_node, attempts = p_attempts, path = coalesce(p_path, '[]'),
      status = p_status, outcome = left(p_outcome, 80), revision = revision + 1, updated_at = now(),
      started_at = case when p_new_cycle then now() else started_at end
    where conversation_id = conv.id returning revision into next_revision;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_messages, '[]')) loop
    insert into public.whatsapp_messages (clinic_id, conversation_id, direction, kind, body, status, request_id, recipient, bot)
    values (conv.clinic_id, conv.id, 'out', item->>'kind', left(coalesce(item->>'body', ''), 4096), 'pending', gen_random_uuid(),
      coalesce(conv.wa_id, conv.user_id), true)
    returning id into mid;
    ids := ids || mid;
  end loop;
  if p_queue is not null then
    update public.whatsapp_conversations set queue = p_queue, revision = revision + 1 where id = conv.id;
  end if;
  if p_close then
    update public.whatsapp_conversations set status = 'closed', closed_at = now(), closed_by = null, unread_count = 0, revision = revision + 1
    where id = conv.id;
  end if;
  return jsonb_build_object('applied', true, 'revision', next_revision, 'messageIds', to_jsonb(ids),
    'to', conv.wa_id, 'recipient', case when conv.wa_id is null then conv.user_id end);
end $$;

revoke all on function public.whatsapp_flow_save(uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_bot_apply(uuid, text, integer, boolean, integer, text, integer, jsonb, text, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.whatsapp_flow_save(uuid, uuid, integer, jsonb) to service_role;
grant execute on function public.whatsapp_bot_apply(uuid, text, integer, boolean, integer, text, integer, jsonb, text, text, text, boolean, jsonb)
  to service_role;
