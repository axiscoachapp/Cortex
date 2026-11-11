-- Billing corrections after the fact (improvement plan, round 2, items B8, C10 and finding 12).
-- Owner: Claude. Contract: docs/product/faturamento/CONTRATO.md.
--
-- Additive on 20261107120000_billing.sql:
-- 1. createCharge is idempotent: the client sends one request id per dialog opening (a lost reply
--    followed by a retry returns the first charge), and an appointment cannot hold two charges of
--    the same procedure that are not cancelled (two receptionists, or a retry without the id).
-- 2. billing_events: who corrected what (charge edits, re-presented and written-off guides,
--    regenerated XML, a batch marked as sent by mistake). Same access model as the other billing
--    tables: RLS on, service_role only; billing-api authorizes every action.
-- 3. A denied guide can be presented again (back to open, keeping its guide number) or written
--    off (the loss is accepted and stays in the reports as glosa).
-- 4. A draft batch can drop its stored XML so the next download is built from the corrected data,
--    and a batch marked as sent by mistake goes back to draft while no statement was recorded.

alter table public.billing_charges
  add column client_request_id uuid,
  add column written_off_at timestamptz,
  add column written_off_by uuid references auth.users(id) on delete set null;

create unique index billing_charges_request on public.billing_charges (clinic_id, client_request_id) where client_request_id is not null;

-- Fails loudly instead of silently picking which duplicate survives: resolve by hand, then re-run.
do $$ begin
  if exists (select 1 from public.billing_charges where appointment_id is not null and status <> 'cancelled'
             group by clinic_id, appointment_id, table_code, procedure_code having count(*) > 1) then
    raise exception 'billing_charges holds duplicate charges of one procedure for one appointment; cancel the extra ones before this migration';
  end if;
end $$;
create unique index billing_charges_appointment_item on public.billing_charges (clinic_id, appointment_id, table_code, procedure_code)
  where appointment_id is not null and status <> 'cancelled';

-- When the plan's statement was first recorded for a batch. Reopening a statement does not clear
-- it: the plan has already answered, so the batch was certainly received.
alter table public.billing_batches add column first_settled_at timestamptz;
update public.billing_batches set first_settled_at = coalesce(updated_at, now()) where status = 'closed' or payment_date is not null
  or exists (select 1 from public.billing_payments p where p.batch_id = billing_batches.id);
create function public.billing_batch_mark_settled() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'closed' then new.first_settled_at := coalesce(old.first_settled_at, now()); end if;
  return new;
end $$;
revoke all on function public.billing_batch_mark_settled() from public, anon, authenticated;
create trigger billing_batch_mark_settled before update of status on public.billing_batches
  for each row execute function public.billing_batch_mark_settled();

create table public.billing_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  charge_id uuid references public.billing_charges(id) on delete restrict,
  -- No foreign key: a draft batch that is undone is deleted, and its history stays.
  batch_id uuid,
  action text not null check (action in ('charge_edit', 'charge_represent', 'charge_write_off', 'batch_xml_cleared', 'batch_unsent')),
  actor uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(charge_id, batch_id) >= 1)
);
create index billing_events_charge on public.billing_events (clinic_id, charge_id) where charge_id is not null;
create index billing_events_batch on public.billing_events (clinic_id, batch_id) where batch_id is not null;
alter table public.billing_events enable row level security;
revoke all on public.billing_events from public, anon, authenticated;
grant select, insert on public.billing_events to service_role;

-- Corrects an open, unpaid charge (wrong card, code, value or date). Only the listed fields change;
-- the event keeps the previous and new value of each changed field (the authorization password only
-- as "changed"). Admin, or reception scoped to the charge's doctor.
create function public.billing_charge_edit(p_clinic uuid, p_actor uuid, p_charge uuid, p_revision integer, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.billing_charges; n public.billing_charges; role text; patch jsonb; changed jsonb;
  allowed constant text[] := array['patient_name', 'payer_id', 'card_number', 'newborn', 'guide_type', 'table_code', 'procedure_code', 'description',
    'quantity', 'unit_amount', 'amount', 'service_date', 'consultation_type', 'authorization_number', 'authorization_password', 'authorization_date',
    'authorization_valid_until', 'notes'];
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if jsonb_typeof(p_row) is distinct from 'object' then raise exception 'Correção inválida' using errcode = '22023'; end if;
  select * into c from public.billing_charges where clinic_id = p_clinic and id = p_charge for update;
  if not found then raise exception 'Cobrança não encontrada' using errcode = 'P0002'; end if;
  role := public.billing_role(p_clinic, p_actor);
  if role not in ('admin', 'reception') or not public.billing_doctor_ok(p_clinic, c.doctor_id, p_actor) then
    raise exception 'Sem permissão para esta cobrança' using errcode = '42501';
  end if;
  if c.revision is distinct from p_revision then raise exception 'A cobrança mudou; atualize' using errcode = '40001'; end if;
  if c.status <> 'open' or c.paid_amount > 0 then
    raise exception 'Só uma cobrança em aberto e sem pagamento pode ser corrigida' using errcode = '55000';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into patch from jsonb_each(p_row) where key = any (allowed);
  n := jsonb_populate_record(c, patch);
  update public.billing_charges set patient_name = n.patient_name, payer_id = n.payer_id, card_number = n.card_number, newborn = n.newborn,
    guide_type = n.guide_type, table_code = n.table_code, procedure_code = n.procedure_code, description = n.description, quantity = n.quantity,
    unit_amount = n.unit_amount, amount = n.amount, service_date = n.service_date, consultation_type = n.consultation_type,
    authorization_number = n.authorization_number, authorization_password = n.authorization_password, authorization_date = n.authorization_date,
    authorization_valid_until = n.authorization_valid_until, notes = n.notes, revision = revision + 1, updated_at = now()
  where id = c.id returning * into n;
  select coalesce(jsonb_object_agg(k, case when k = 'authorization_password' then '"alterada"'::jsonb
      else jsonb_build_object('from', to_jsonb(c) -> k, 'to', to_jsonb(n) -> k) end), '{}'::jsonb) into changed
  from jsonb_object_keys(patch) k where to_jsonb(c) -> k is distinct from to_jsonb(n) -> k;
  if changed <> '{}'::jsonb then
    insert into public.billing_events (clinic_id, charge_id, action, actor, detail) values (p_clinic, c.id, 'charge_edit', p_actor, changed);
  end if;
  return to_jsonb(n);
end $$;

-- Presents a denied guide again: it goes back to open, out of its old batch, keeping its guide
-- number, so it can enter a new batch. The old denial is kept in the event. Admin only.
create function public.billing_charge_represent(p_clinic uuid, p_actor uuid, p_charge uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.billing_charges;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração reapresenta guias' using errcode = '42501'; end if;
  select * into c from public.billing_charges where clinic_id = p_clinic and id = p_charge for update;
  if not found then raise exception 'Cobrança não encontrada' using errcode = 'P0002'; end if;
  if c.revision is distinct from p_revision then raise exception 'A cobrança mudou; atualize' using errcode = '40001'; end if;
  if c.status <> 'denied' or c.written_off_at is not null then
    raise exception 'Só uma guia glosada e sem baixa pode ser reapresentada' using errcode = '55000';
  end if;
  insert into public.billing_events (clinic_id, charge_id, batch_id, action, actor, detail)
  values (p_clinic, c.id, c.batch_id, 'charge_represent', p_actor, jsonb_build_object('guideNumber', c.guide_number, 'deniedAmount', c.denied_amount,
    'denialCode', c.denial_code, 'denialNote', c.denial_note));
  update public.billing_charges set status = 'open', batch_id = null, paid_amount = 0, denied_amount = 0, denial_code = null, denial_note = null,
    revision = revision + 1, updated_at = now() where id = c.id returning * into c;
  return to_jsonb(c);
end $$;

-- Accepts the denial of a guide (dar baixa): the charge stays denied, counted as glosa in the
-- reports, and leaves the list of things to act on. Admin only.
create function public.billing_charge_write_off(p_clinic uuid, p_actor uuid, p_charge uuid, p_revision integer, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.billing_charges;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração dá baixa em glosas' using errcode = '42501'; end if;
  select * into c from public.billing_charges where clinic_id = p_clinic and id = p_charge for update;
  if not found then raise exception 'Cobrança não encontrada' using errcode = 'P0002'; end if;
  if c.revision is distinct from p_revision then raise exception 'A cobrança mudou; atualize' using errcode = '40001'; end if;
  if c.status <> 'denied' or c.written_off_at is not null then
    raise exception 'Só uma guia glosada e sem baixa recebe baixa' using errcode = '55000';
  end if;
  update public.billing_charges set written_off_at = now(), written_off_by = p_actor, revision = revision + 1, updated_at = now()
  where id = c.id returning * into c;
  insert into public.billing_events (clinic_id, charge_id, batch_id, action, actor, detail)
  values (p_clinic, c.id, c.batch_id, 'charge_write_off', p_actor, jsonb_build_object('deniedAmount', c.denied_amount, 'denialCode', c.denial_code,
    'note', left(coalesce(trim(p_note), ''), 300)));
  return to_jsonb(c);
end $$;

-- Drops the XML stored for a draft batch, so the next download is built from the corrected data.
-- Admin only; the event keeps the hash of the discarded file.
create function public.billing_batch_clear_xml(p_clinic uuid, p_actor uuid, p_batch uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.billing_batches;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração altera lotes' using errcode = '42501'; end if;
  select * into b from public.billing_batches where clinic_id = p_clinic and id = p_batch for update;
  if not found then raise exception 'Lote não encontrado' using errcode = 'P0002'; end if;
  if b.revision is distinct from p_revision then raise exception 'O lote mudou; atualize' using errcode = '40001'; end if;
  if b.status <> 'draft' then raise exception 'O XML só é gerado de novo antes do envio' using errcode = '55000'; end if;
  if b.xml_hash is null then raise exception 'Este lote ainda não tem XML gerado' using errcode = '55000'; end if;
  insert into public.billing_events (clinic_id, batch_id, action, actor, detail)
  values (p_clinic, b.id, 'batch_xml_cleared', p_actor, jsonb_build_object('xmlHash', b.xml_hash, 'generatedAt', b.generated_at));
  update public.billing_batches set xml_hash = null, xml_payload = null, generated_at = null, revision = revision + 1, updated_at = now()
  where id = b.id returning * into b;
  return to_jsonb(b) - 'xml_payload';
end $$;

-- Takes back a batch marked as sent by mistake: back to draft, guides back to "Em lote". Refused
-- once the plan's statement was recorded for it, even if it was later reopened. The stored XML stays.
create function public.billing_batch_unsend(p_clinic uuid, p_actor uuid, p_batch uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.billing_batches;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração altera lotes' using errcode = '42501'; end if;
  select * into b from public.billing_batches where clinic_id = p_clinic and id = p_batch for update;
  if not found then raise exception 'Lote não encontrado' using errcode = 'P0002'; end if;
  if b.revision is distinct from p_revision then raise exception 'O lote mudou; atualize' using errcode = '40001'; end if;
  if b.status <> 'sent' or b.first_settled_at is not null
     or exists (select 1 from public.billing_payments where clinic_id = p_clinic and batch_id = b.id) then
    raise exception 'Só um lote enviado e ainda sem retorno do convênio volta a não enviado' using errcode = '55000';
  end if;
  insert into public.billing_events (clinic_id, batch_id, action, actor, detail)
  values (p_clinic, b.id, 'batch_unsent', p_actor, jsonb_build_object('sentAt', b.sent_at, 'protocol', b.protocol));
  update public.billing_charges set status = 'batched', revision = revision + 1, updated_at = now() where batch_id = b.id and status = 'sent';
  update public.billing_batches set status = 'draft', sent_at = null, protocol = null, revision = revision + 1, updated_at = now()
  where id = b.id returning * into b;
  return to_jsonb(b) - 'xml_payload';
end $$;

do $$ declare f text; begin
  foreach f in array array['public.billing_charge_edit(uuid,uuid,uuid,integer,jsonb)', 'public.billing_charge_represent(uuid,uuid,uuid,integer)',
    'public.billing_charge_write_off(uuid,uuid,uuid,integer,text)', 'public.billing_batch_clear_xml(uuid,uuid,uuid,integer)',
    'public.billing_batch_unsend(uuid,uuid,uuid,integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
