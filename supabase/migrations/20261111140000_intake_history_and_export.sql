-- Owner: Claude (round two, pre-consulta-conta). Review 2026-11-10, security findings 3 and 4.
-- Contracts: docs/product/pre-consulta/CONTRATO.md, docs/product/whatsapp/CONTRATO.md.
--
-- 1. Pre-consultation answers are never destroyed. Every submission is appended to
--    public.intake_submissions (no update; a delete only as the cascade of its request). A new
--    submission no longer resets the doctor's review: each review records which submission it
--    covered, and intake_changed_since_review() tells the reviewer that the answers changed after it.
--    The reception's review no longer locks the form, so the patient corrects through the same link;
--    the reception sees the change the same way.
-- 2. The LGPD export manifest gains the owner-keyed tables added after 29/10: document_snippets,
--    intake_requests (without the link nonce and hash) with their submission history, and the
--    doctor's signature evidence (cortex_private.prescription_signatures).

-- ---------------------------------------------------------------- 1. submission history

create table public.intake_submissions (
  request_id uuid not null references public.intake_requests(id) on delete cascade,
  submission integer not null check (submission between 1 and 20),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  form_revision integer not null check (form_revision >= 1),
  registration jsonb not null check (jsonb_typeof(registration) = 'array' and length(registration::text) <= 60000),
  health jsonb not null check (jsonb_typeof(health) = 'array' and length(health::text) <= 120000),
  whatsapp_consent boolean not null,
  privacy_version text not null check (privacy_version ~ '^[a-z0-9._-]{1,40}$'),
  submitted_at timestamptz not null default now(),
  primary key (request_id, submission)
);

alter table public.intake_submissions enable row level security;
revoke all on public.intake_submissions from public, anon, authenticated, service_role;
grant select, insert on public.intake_submissions to service_role;

-- Append-only, also for the owner: a row leaves only when its request is deleted (the cascade of an
-- appointment or account deletion runs after the request row is gone).
create function public.intake_submissions_append_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then raise exception 'O histórico da pré-consulta não pode ser alterado' using errcode = '42501'; end if;
  if exists (select 1 from public.intake_requests r where r.id = old.request_id) then
    raise exception 'O histórico da pré-consulta não pode ser apagado' using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function public.intake_submissions_append_only() from public, anon, authenticated;
create trigger intake_submissions_append_only before update or delete on public.intake_submissions
  for each row execute function public.intake_submissions_append_only();

alter table public.intake_requests
  add column registration_reviewed_submission integer check (registration_reviewed_submission between 1 and 20),
  add column health_reviewed_submission integer check (health_reviewed_submission between 1 and 20);

-- Existing answers become the latest history entry; existing reviews covered them.
insert into public.intake_submissions (request_id, submission, clinic_id, form_revision, registration, health, whatsapp_consent, privacy_version, submitted_at)
select r.id, r.submissions, r.clinic_id, r.form_revision, r.registration, r.health, coalesce(r.whatsapp_consent, false),
  coalesce(r.privacy_version, 'v1'), coalesce(r.answered_at, r.updated_at)
from public.intake_requests r
where r.submissions >= 1 and r.registration is not null and r.health is not null
on conflict do nothing;
update public.intake_requests set
  registration_reviewed_submission = case when registration_reviewed_at is not null and submissions >= 1 then submissions end,
  health_reviewed_submission = case when health_reviewed_at is not null and submissions >= 1 then submissions end
where registration_reviewed_at is not null or health_reviewed_at is not null;

-- Whether a reviewed part has different answers now than in the submission its review covered.
create function public.intake_changed_since_review(r public.intake_requests, p_part text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_part = 'registration' then r.registration_reviewed_submission is not null and r.registration_reviewed_submission < r.submissions
      and (select s.registration from public.intake_submissions s where s.request_id = r.id and s.submission = r.registration_reviewed_submission)
        is distinct from r.registration
    when p_part = 'health' then r.health_reviewed_submission is not null and r.health_reviewed_submission < r.submissions
      and (select s.health from public.intake_submissions s where s.request_id = r.id and s.submission = r.health_reviewed_submission)
        is distinct from r.health
    else false end;
$$;
revoke all on function public.intake_changed_since_review(public.intake_requests, text) from public, anon, authenticated;
grant execute on function public.intake_changed_since_review(public.intake_requests, text) to service_role;

-- Public page: there is no "reviewed" state any more; an answered form stays correctable until it closes.
create or replace function public.intake_public_open(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.intake_requests; a public.appointments; v_clinic text; v_doctor text; state text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into r from public.intake_requests where token_hash = p_token_hash for update;
  if not found then return null; end if;
  select * into a from public.appointments where id = r.appointment_id;
  state := case
    when not public.intake_request_open(r, a) then 'closed'
    when r.status = 'answered' then 'answered'
    else 'open' end;
  if r.opened_at is null then update public.intake_requests set opened_at = now() where id = r.id; end if;
  select c.name into v_clinic from public.clinics c where c.id = r.clinic_id;
  select nullif(trim(u.doctor_name), '') into v_doctor from public.user_settings u where u.user_id = r.doctor_id;
  return jsonb_build_object('state', state, 'clinicName', coalesce(v_clinic, ''), 'doctorName', coalesce(v_doctor, ''),
    'start', a.start_time, 'form', case when state in ('open', 'answered') then r.form end, 'answeredAt', r.answered_at,
    'formRevision', r.form_revision);
end $$;

-- Stores a validated submission (validated by the Edge Function against the same snapshot) and appends
-- it to the history. Review marks are kept: the reviewer sees that the answers changed after the review.
-- At most 20 submissions, while the link is open. The WhatsApp consent rule is unchanged.
create or replace function public.intake_public_submit(p_token_hash text, p_form_revision integer, p_registration jsonb, p_health jsonb,
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
  if not public.intake_request_open(r, a) then
    raise exception 'Este formulário já foi encerrado' using errcode = '55000';
  end if;
  if r.form_revision is distinct from p_form_revision then raise exception 'O formulário mudou; recarregue a página' using errcode = '40001'; end if;
  if r.submissions >= 20 then raise exception 'Limite de envios atingido' using errcode = '54000'; end if;
  update public.intake_requests set registration = p_registration, health = p_health, whatsapp_consent = coalesce(p_whatsapp_consent, false),
    privacy_version = p_privacy_version, status = 'answered', answered_at = now(), submissions = submissions + 1,
    revision = revision + 1, updated_at = now()
  where id = r.id returning * into r;
  insert into public.intake_submissions (request_id, submission, clinic_id, form_revision, registration, health, whatsapp_consent, privacy_version, submitted_at)
  values (r.id, r.submissions, r.clinic_id, r.form_revision, p_registration, p_health, coalesce(p_whatsapp_consent, false), p_privacy_version, r.answered_at);
  if coalesce(p_whatsapp_consent, false) and a.contact_id is not null then
    select c.phone_normalized into phone from public.clinic_contacts c where c.clinic_id = r.clinic_id and c.id = a.contact_id;
    wa := public.whatsapp_safe_phone(phone);
    -- Never over an opt-out: one recorded in whatsapp_opt_ins, or only on a conversation (SAIR before any opt-in).
    if wa is not null and not exists (select 1 from public.whatsapp_opt_ins o where o.clinic_id = r.clinic_id
        and o.wa_id = any (public.whatsapp_phone_variants(wa)))
      and not exists (select 1 from public.whatsapp_conversations w where w.clinic_id = r.clinic_id and w.opted_out_at is not null
        and (w.wa_id = any (public.whatsapp_phone_variants(wa)) or w.linked_wa_id = any (public.whatsapp_phone_variants(wa)))) then
      insert into public.whatsapp_opt_ins (clinic_id, wa_id, source, text_version) values (r.clinic_id, wa, 'paciente', 'pre-consulta-' || p_privacy_version)
      on conflict (clinic_id, wa_id) do nothing;
    end if;
  end if;
  return jsonb_build_object('answeredAt', r.answered_at, 'submissions', r.submissions);
end $$;

-- Review marks now record the submission they covered.
create or replace function public.intake_review(p_clinic uuid, p_request uuid, p_actor uuid, p_part text, p_revision integer) returns jsonb
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
    update public.intake_requests set health_reviewed_at = now(), health_reviewed_by = p_actor, health_reviewed_submission = submissions,
      revision = revision + 1, updated_at = now()
    where id = r.id returning * into r;
  else
    if not public.intake_scope_ok(p_clinic, r.doctor_id, p_actor) then raise exception 'Sem permissão para esta agenda' using errcode = '42501'; end if;
    update public.intake_requests set registration_reviewed_at = now(), registration_reviewed_by = p_actor,
      registration_reviewed_submission = submissions, revision = revision + 1, updated_at = now()
    where id = r.id returning * into r;
  end if;
  return jsonb_build_object('revision', r.revision, 'registrationReviewedAt', r.registration_reviewed_at, 'healthReviewedAt', r.health_reviewed_at);
end $$;

-- The list says when answers changed after a review. The health flag is computed only for the
-- appointment's doctor (for anyone else it would reveal that health answers changed).
create or replace function public.intake_list(p_clinic uuid, p_actor uuid, p_from timestamptz, p_to timestamptz) returns jsonb
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
      'healthReviewedAt', r.health_reviewed_at, 'revision', r.revision,
      'registrationChangedAfterReview', case when r.id is not null then public.intake_changed_since_review(r, 'registration') end,
      'healthChangedAfterReview', case when r.id is not null and p_actor = a.user_id then public.intake_changed_since_review(r, 'health') end) x
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

-- ---------------------------------------------------------------- 2. LGPD export

-- Same technique as 20261103000100: extend the live definition before its final RETURN, keeping
-- every existing table, the snapshot semantics (STABLE) and the ACLs.
do $$ declare definition text; marker text := 'RETURN jsonb_build_object(''tables'',tables,''files'',files);'; begin
  select pg_get_functiondef('public.build_data_export_manifest(uuid)'::regprocedure) into definition;
  if position(marker in definition) = 0 then raise exception 'Export contract changed; review the 2026-11-11 export extension'; end if;
  if position('intake_submissions' in definition) > 0 then raise exception 'Export extension already applied'; end if;
  definition := replace(definition, marker, $insert$
    -- 2026-11-11: owner-keyed tables added after 29/10 (review 2026-11-10, security finding 4).
    SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO rows FROM (SELECT to_jsonb(s) v FROM public.document_snippets s WHERE s.owner_user_id=p_user_id) x;
    tables:=tables||jsonb_build_object('document_snippets',rows);
    -- The link nonce and hash are credentials of a link, not data of the person.
    SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO rows FROM (SELECT to_jsonb(r)-'token_hash'-'link_nonce' v FROM public.intake_requests r WHERE r.doctor_id=p_user_id) x;
    tables:=tables||jsonb_build_object('intake_requests',rows);
    SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO rows FROM (SELECT to_jsonb(s) v FROM public.intake_submissions s
      JOIN public.intake_requests r ON r.id=s.request_id WHERE r.doctor_id=p_user_id) x;
    tables:=tables||jsonb_build_object('intake_submissions',rows);
    SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO rows FROM (SELECT to_jsonb(s) v FROM cortex_private.prescription_signatures s WHERE s.user_id=p_user_id) x;
    tables:=tables||jsonb_build_object('prescription_signatures',rows);
    RETURN jsonb_build_object('tables',tables,'files',files);
  $insert$);
  execute definition;
end $$;
