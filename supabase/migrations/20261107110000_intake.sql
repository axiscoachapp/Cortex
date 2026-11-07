-- Pre-consultation form ("pré-consulta própria", P1). Owner: Claude; review: Codex.
-- Contract: docs/product/pre-consulta/CONTRATO.md.
--
-- - One form per clinic (admin), validated by the Edge Function (_shared/intakeForm.ts).
-- - One request per clinic-agenda appointment. The link token is HMAC(INTAKE_LINK_SECRET, id|nonce),
--   computed by the Edge Function; only its SHA-256 is stored here, so the database alone cannot
--   rebuild a link. A new nonce revokes the old link.
-- - The public page never reads stored answers back. Registration answers are for the reception;
--   health answers only for the appointment's doctor (checked by the Edge Function).
-- - Same access model as the WhatsApp tables: RLS on, no grant to anon/authenticated, functions for
--   service_role only. Scope rules reuse public.reception_actor_allowed (Codex, T28) unchanged.

create table public.intake_forms (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  enabled boolean not null default false,
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and length(definition::text) <= 100000),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.intake_requests (
  id uuid primary key,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  doctor_id uuid not null,
  appointment_start timestamptz not null,
  link_nonce text not null check (link_nonce ~ '^[A-Za-z0-9_-]{22,64}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  form_revision integer not null check (form_revision >= 1),
  form jsonb not null check (jsonb_typeof(form) = 'object' and length(form::text) <= 100000),
  status text not null default 'pending' check (status in ('pending', 'answered', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  opened_at timestamptz,
  answered_at timestamptz,
  submissions integer not null default 0 check (submissions between 0 and 20),
  registration jsonb check (registration is null or (jsonb_typeof(registration) = 'array' and length(registration::text) <= 60000)),
  health jsonb check (health is null or (jsonb_typeof(health) = 'array' and length(health::text) <= 120000)),
  whatsapp_consent boolean,
  privacy_version text check (privacy_version is null or privacy_version ~ '^[a-z0-9._-]{1,40}$'),
  registration_reviewed_at timestamptz,
  registration_reviewed_by uuid references auth.users(id) on delete set null,
  health_reviewed_at timestamptz,
  health_reviewed_by uuid references auth.users(id) on delete set null,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  check ((status = 'answered') = (answered_at is not null and registration is not null and health is not null) or status = 'closed')
);
create index intake_requests_clinic_start on public.intake_requests (clinic_id, appointment_start);

alter table public.intake_forms enable row level security;
alter table public.intake_requests enable row level security;
revoke all on public.intake_forms, public.intake_requests from public, anon, authenticated;
grant select, insert, update, delete on public.intake_forms, public.intake_requests to service_role;

-- Admin edits of the form, with a revision guard (revision 0 = first save).
create function public.intake_form_save(p_clinic uuid, p_actor uuid, p_revision integer, p_enabled boolean, p_definition jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.intake_forms;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_revision is null or p_revision = 0 then
    insert into public.intake_forms (clinic_id, enabled, definition, updated_by) values (p_clinic, coalesce(p_enabled, false), p_definition, p_actor)
    on conflict (clinic_id) do nothing returning * into f;
  else
    update public.intake_forms set enabled = coalesce(p_enabled, false), definition = p_definition, updated_by = p_actor, updated_at = now(),
      revision = revision + 1
    where clinic_id = p_clinic and revision = p_revision returning * into f;
  end if;
  if f.clinic_id is null then raise exception 'O formulário mudou; atualize antes de salvar' using errcode = '40001'; end if;
  return jsonb_build_object('revision', f.revision, 'updatedAt', f.updated_at);
end $$;

-- Who may see the reception part of an appointment's request: exactly the reception agenda rule
-- for that doctor (the doctor themself, or reception staff scoped to the doctor). An admin does not
-- see another doctor's agenda implicitly (T28), and does not see its pre-consultations either.
create function public.intake_scope_ok(p_clinic uuid, p_doctor uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.role() = 'service_role' and p_doctor is not null and coalesce(public.reception_actor_allowed(p_clinic, p_doctor, p_actor), false);
$$;

-- Creates the request of a clinic appointment, or returns the existing one (id and nonce let the
-- Edge Function rebuild the same link). The appointment must belong to the clinic agenda, not be
-- cancelled, and not have ended; the clinic form must be enabled. A rescheduled appointment keeps
-- its link and moves the deadline. p_actor null = the agenda automation.
create function public.intake_request_ensure(p_clinic uuid, p_appointment uuid, p_actor uuid, p_id uuid, p_nonce text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appointments; f public.intake_forms; r public.intake_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into a from public.appointments where id = p_appointment for share;
  if not found or a.clinic_id is distinct from p_clinic then raise exception 'Agendamento não encontrado' using errcode = 'P0002'; end if;
  if p_actor is not null and not public.intake_scope_ok(p_clinic, a.user_id, p_actor) then
    raise exception 'Sem permissão para esta agenda' using errcode = '42501';
  end if;
  if coalesce(a.status, 'agendado') not in ('agendado', 'confirmado') or greatest(a.end_time, a.start_time) <= now() then
    raise exception 'O agendamento não aceita pré-consulta' using errcode = '22023';
  end if;
  select * into f from public.intake_forms where clinic_id = p_clinic;
  if not found or not f.enabled then raise exception 'A pré-consulta não está ativa nesta clínica' using errcode = '55000'; end if;
  select * into r from public.intake_requests where appointment_id = p_appointment for update;
  if not found then
    insert into public.intake_requests (id, clinic_id, appointment_id, doctor_id, appointment_start, link_nonce, token_hash, form_revision, form,
      created_by, expires_at)
    values (p_id, p_clinic, p_appointment, a.user_id, a.start_time, p_nonce, p_token_hash, f.revision, f.definition, p_actor,
      greatest(a.end_time, a.start_time) + interval '2 hours')
    on conflict (appointment_id) do nothing returning * into r;
    if r.id is null then select * into r from public.intake_requests where appointment_id = p_appointment; end if;
  elsif r.appointment_start is distinct from a.start_time or r.doctor_id is distinct from a.user_id then
    update public.intake_requests set appointment_start = a.start_time, doctor_id = a.user_id,
      expires_at = greatest(a.end_time, a.start_time) + interval '2 hours', revision = revision + 1, updated_at = now()
    where id = r.id returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'nonce', r.link_nonce, 'status', r.status, 'expiresAt', r.expires_at, 'created', r.id = p_id);
end $$;

-- New nonce and hash: the old link stops working at once. Answers already sent are kept.
create function public.intake_request_rotate(p_clinic uuid, p_request uuid, p_actor uuid, p_nonce text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.intake_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into r from public.intake_requests where id = p_request and clinic_id = p_clinic for update;
  if not found then raise exception 'Pré-consulta não encontrada' using errcode = 'P0002'; end if;
  if not public.intake_scope_ok(p_clinic, r.doctor_id, p_actor) then raise exception 'Sem permissão para esta agenda' using errcode = '42501'; end if;
  update public.intake_requests set link_nonce = p_nonce, token_hash = p_token_hash, revision = revision + 1, updated_at = now()
  where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'nonce', r.link_nonce, 'status', r.status, 'expiresAt', r.expires_at);
end $$;

-- What the public page may show: clinic, doctor's display name, date and the form. Never answers,
-- never the patient's name or contact. Records the first opening.
create function public.intake_public_open(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.intake_requests; a public.appointments; v_clinic text; v_doctor text; state text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into r from public.intake_requests where token_hash = p_token_hash for update;
  if not found then return null; end if;
  select * into a from public.appointments where id = r.appointment_id;
  state := case
    when r.status = 'closed' or r.expires_at <= now() or coalesce(a.status, 'agendado') not in ('agendado', 'confirmado') then 'closed'
    when r.registration_reviewed_at is not null then 'reviewed'
    when r.status = 'answered' then 'answered'
    else 'open' end;
  if r.opened_at is null then update public.intake_requests set opened_at = now() where id = r.id; end if;
  select c.name into v_clinic from public.clinics c where c.id = r.clinic_id;
  select nullif(trim(u.doctor_name), '') into v_doctor from public.user_settings u where u.user_id = r.doctor_id;
  return jsonb_build_object('state', state, 'clinicName', coalesce(v_clinic, ''), 'doctorName', coalesce(v_doctor, ''),
    'start', a.start_time, 'form', case when state in ('open', 'answered') then r.form end, 'answeredAt', r.answered_at,
    'formRevision', r.form_revision);
end $$;

-- Stores the validated answers (validated by the Edge Function against the same snapshot,
-- p_form_revision guards a form snapshot that changed in between). Resubmission replaces the
-- previous answers until the reception reviewed the registration part; at most 20 submissions.
-- A WhatsApp consent is recorded for the contact's phone on file (never a phone typed in the
-- form), and never overrides an earlier opt-out.
create function public.intake_public_submit(p_token_hash text, p_form_revision integer, p_registration jsonb, p_health jsonb,
  p_whatsapp_consent boolean, p_privacy_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.intake_requests; a public.appointments; phone text; wa text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Link inválido' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_registration) <> 'array' or jsonb_typeof(p_health) <> 'array' or p_privacy_version is null then
    raise exception 'Respostas inválidas' using errcode = '22023';
  end if;
  select * into r from public.intake_requests where token_hash = p_token_hash for update;
  if not found then raise exception 'Link inválido' using errcode = 'P0002'; end if;
  select * into a from public.appointments where id = r.appointment_id;
  if r.status = 'closed' or r.expires_at <= now() or coalesce(a.status, 'agendado') not in ('agendado', 'confirmado') then
    raise exception 'Este formulário já foi encerrado' using errcode = '55000';
  end if;
  if r.registration_reviewed_at is not null then raise exception 'A recepção já conferiu as respostas' using errcode = '55000'; end if;
  if r.form_revision is distinct from p_form_revision then raise exception 'O formulário mudou; recarregue a página' using errcode = '40001'; end if;
  if r.submissions >= 20 then raise exception 'Limite de envios atingido' using errcode = '54000'; end if;
  update public.intake_requests set registration = p_registration, health = p_health, whatsapp_consent = coalesce(p_whatsapp_consent, false),
    privacy_version = p_privacy_version, status = 'answered', answered_at = now(), submissions = submissions + 1,
    health_reviewed_at = null, health_reviewed_by = null, revision = revision + 1, updated_at = now()
  where id = r.id returning * into r;
  if coalesce(p_whatsapp_consent, false) and a.contact_id is not null then
    select c.phone_normalized into phone from public.clinic_contacts c where c.clinic_id = r.clinic_id and c.id = a.contact_id;
    wa := public.whatsapp_safe_phone(phone);
    if wa is not null and not exists (select 1 from public.whatsapp_opt_ins o where o.clinic_id = r.clinic_id
        and o.wa_id = any (public.whatsapp_phone_variants(wa))) then
      insert into public.whatsapp_opt_ins (clinic_id, wa_id, source, text_version) values (r.clinic_id, wa, 'paciente', 'pre-consulta-' || p_privacy_version)
      on conflict (clinic_id, wa_id) do nothing;
    end if;
  end if;
  return jsonb_build_object('answeredAt', r.answered_at, 'submissions', r.submissions);
end $$;

-- Review marks (reception: registration; doctor: health), with the request revision as CAS.
create function public.intake_review(p_clinic uuid, p_request uuid, p_actor uuid, p_part text, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.intake_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_part not in ('registration', 'health') then raise exception 'Parte inválida' using errcode = '22023'; end if;
  select * into r from public.intake_requests where id = p_request and clinic_id = p_clinic for update;
  if not found then raise exception 'Pré-consulta não encontrada' using errcode = 'P0002'; end if;
  if r.revision is distinct from p_revision then raise exception 'As respostas mudaram; atualize antes de conferir' using errcode = '40001'; end if;
  if r.status <> 'answered' then raise exception 'Ainda não há respostas para conferir' using errcode = '55000'; end if;
  if p_part = 'health' then
    if p_actor is distinct from r.doctor_id or not exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic
        and m.user_id = p_actor and m.status = 'active') then
      raise exception 'Só o médico da consulta lê esta parte' using errcode = '42501';
    end if;
    update public.intake_requests set health_reviewed_at = now(), health_reviewed_by = p_actor, revision = revision + 1, updated_at = now()
    where id = r.id returning * into r;
  else
    if not public.intake_scope_ok(p_clinic, r.doctor_id, p_actor) then raise exception 'Sem permissão para esta agenda' using errcode = '42501'; end if;
    update public.intake_requests set registration_reviewed_at = now(), registration_reviewed_by = p_actor, revision = revision + 1, updated_at = now()
    where id = r.id returning * into r;
  end if;
  return jsonb_build_object('revision', r.revision, 'registrationReviewedAt', r.registration_reviewed_at, 'healthReviewedAt', r.health_reviewed_at);
end $$;

-- Clinic-agenda appointments of a window (up to 15 days) that the actor may see, with the state
-- of their pre-consultation. Names come from the reception contact, never from the private chart.
create function public.intake_list(p_clinic uuid, p_actor uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare items jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to <= p_from or p_to - p_from > interval '15 days' then
    raise exception 'Escolha um período de até 15 dias' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(x order by x->>'start', x->>'appointmentId'), '[]') into items from (
    select jsonb_build_object('appointmentId', a.id, 'doctorId', a.user_id,
      'doctorName', coalesce(nullif(trim(us.doctor_name), ''), 'Médico'), 'start', a.start_time, 'end', a.end_time,
      'appointmentStatus', coalesce(a.status, 'agendado'), 'contactId', a.contact_id, 'contactName', ct.name,
      'requestId', r.id, 'state', case when r.id is null then 'none' when r.status = 'answered' then 'answered' else r.status end,
      'openedAt', r.opened_at, 'answeredAt', r.answered_at, 'registrationReviewedAt', r.registration_reviewed_at,
      'healthReviewedAt', r.health_reviewed_at, 'revision', r.revision) x
    from public.appointments a
    left join public.clinic_contacts ct on ct.clinic_id = a.clinic_id and ct.id = a.contact_id
    left join public.user_settings us on us.user_id = a.user_id
    left join public.intake_requests r on r.appointment_id = a.id
    where a.clinic_id = p_clinic and a.start_time >= p_from and a.start_time < p_to
      and public.intake_scope_ok(p_clinic, a.user_id, p_actor)
    order by a.start_time, a.id limit 501) page(x);
  if jsonb_array_length(items) > 500 then raise exception 'Muitos agendamentos; reduza o período' using errcode = '22023'; end if;
  return items;
end $$;

revoke all on function public.intake_list(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.intake_list(uuid, uuid, timestamptz, timestamptz) to service_role;

revoke all on function public.intake_form_save(uuid, uuid, integer, boolean, jsonb), public.intake_scope_ok(uuid, uuid, uuid),
  public.intake_request_ensure(uuid, uuid, uuid, uuid, text, text), public.intake_request_rotate(uuid, uuid, uuid, text, text),
  public.intake_public_open(text), public.intake_public_submit(text, integer, jsonb, jsonb, boolean, text),
  public.intake_review(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.intake_form_save(uuid, uuid, integer, boolean, jsonb), public.intake_scope_ok(uuid, uuid, uuid),
  public.intake_request_ensure(uuid, uuid, uuid, uuid, text, text), public.intake_request_rotate(uuid, uuid, uuid, text, text),
  public.intake_public_open(text), public.intake_public_submit(text, integer, jsonb, jsonb, boolean, text),
  public.intake_review(uuid, uuid, uuid, text, integer)
  to service_role;
