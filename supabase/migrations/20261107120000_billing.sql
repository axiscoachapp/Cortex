-- Billing (P2): health-plan billing in the TISS standard (ANS, XML 4.03.00) and basic finance.
-- Owner: Claude; review: Codex. Contract: docs/product/faturamento/CONTRATO.md.
--
-- Same access model as the WhatsApp and pre-consultation tables: RLS on, no grant to anon or
-- authenticated; the billing-api Edge Function authorizes every action (clinic admin, reception
-- scoped to the doctor, or the doctor for their own production) and writes with service_role.
-- Operations that must be atomic (batches, guide numbers, settlements, payments) are functions.
-- Nothing here touches Codex tables; appointments and contacts are only read.

create table public.billing_settings (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  legal_name text not null default '' check (length(legal_name) <= 120),
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  -- CNES of the clinic; 9999999 when it has none (TISS rule).
  cnes text not null default '9999999' check (cnes ~ '^[0-9]{7}$'),
  next_guide_number bigint not null default 1 check (next_guide_number >= 1),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Health plans (operadoras) the clinic bills.
create table public.billing_payers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 80),
  ans_registry text not null check (ans_registry ~ '^[0-9]{6}$'),
  provider_code text not null check (provider_code ~ '^[0-9A-Za-z]{1,20}$'),
  tiss_version text not null default '4.03.00' check (tiss_version in ('4.03.00', '4.02.00', '4.01.00')),
  -- Text encoding used for the MD5 of the batch (the standard says ISO-8859-1; some portals use UTF-8).
  hash_encoding text not null default 'latin1' check (hash_encoding in ('latin1', 'utf8')),
  zip_required boolean not null default false,
  submission_days integer check (submission_days is null or submission_days between 1 and 365),
  payment_days integer check (payment_days is null or payment_days between 1 and 365),
  active boolean not null default true,
  notes text not null default '' check (length(notes) <= 1000),
  -- Batch numbers are never reused, not even after a draft is undone (the file may have reached the portal).
  next_batch_number integer not null default 1 check (next_batch_number >= 1),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);
create unique index billing_payers_name on public.billing_payers (clinic_id, lower(name)) where active;

-- Prices by plan (payer null = private patient), by TUSS code.
create table public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  payer_id uuid,
  table_code text not null default '22' check (table_code in ('00', '18', '19', '20', '22', '90', '98')),
  procedure_code text not null check (procedure_code ~ '^[0-9A-Za-z]{1,10}$'),
  description text not null check (length(trim(description)) between 2 and 150),
  guide_type text not null check (guide_type in ('consulta', 'sadt')),
  amount numeric(12, 2) not null check (amount >= 0 and amount <= 1000000),
  active boolean not null default true,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  foreign key (clinic_id, payer_id) references public.billing_payers(clinic_id, id) on delete cascade
);
create unique index billing_prices_code on public.billing_prices (clinic_id, coalesce(payer_id, '00000000-0000-0000-0000-000000000000'), table_code, procedure_code);

-- TISS identity of each doctor (council, UF as IBGE code, CBO) and the share for the payout report.
create table public.billing_professionals (
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  user_id uuid not null,
  tiss_name text not null check (length(trim(tiss_name)) between 2 and 70),
  council text not null default '06' check (council ~ '^[0-9]{2}$'),
  council_number text not null check (council_number ~ '^[0-9]{1,15}$'),
  council_uf text not null default '41' check (council_uf ~ '^[0-9]{2}$'),
  cbo text not null check (cbo ~ '^[0-9]{6}$'),
  share_percent numeric(5, 2) check (share_percent is null or share_percent between 0 and 100),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

-- A patient's plan card, kept to prefill the next charges.
create table public.billing_coverages (
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  contact_id uuid not null,
  payer_id uuid not null,
  card_number text not null check (card_number ~ '^[0-9A-Za-z .-]{1,30}$'),
  card_valid_until date,
  plan text not null default '' check (length(plan) <= 60),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, contact_id, payer_id),
  foreign key (clinic_id, contact_id) references public.clinic_contacts(clinic_id, id) on delete cascade,
  foreign key (clinic_id, payer_id) references public.billing_payers(clinic_id, id) on delete cascade
);

-- Batches (lotes) sent to one plan.
create table public.billing_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  payer_id uuid not null,
  number integer not null check (number >= 1),
  guide_type text not null check (guide_type in ('consulta', 'sadt')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'closed')),
  total_amount numeric(14, 2) not null default 0,
  paid_amount numeric(14, 2) not null default 0,
  denied_amount numeric(14, 2) not null default 0,
  xml_hash text check (xml_hash is null or xml_hash ~ '^[0-9a-f]{32}$'),
  -- The XML as generated (ISO-8859-1 text), kept so a sent batch is downloaded again unchanged.
  xml_payload text check (xml_payload is null or length(xml_payload) <= 3000000),
  generated_at timestamptz,
  sent_at date,
  protocol text check (protocol is null or length(protocol) <= 40),
  payment_date date,
  nfse_number text check (nfse_number is null or length(nfse_number) <= 30),
  notes text not null default '' check (length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  unique (clinic_id, payer_id, number),
  unique (clinic_id, id),
  foreign key (clinic_id, payer_id) references public.billing_payers(clinic_id, id) on delete restrict
);

-- Charges: one billable item of an appointment (or a manual one), private or by plan.
create table public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  doctor_id uuid not null,
  contact_id uuid,
  patient_name text not null check (length(trim(patient_name)) between 1 and 200),
  payer_id uuid,
  card_number text check (card_number is null or card_number ~ '^[0-9A-Za-z .-]{1,30}$'),
  newborn boolean not null default false,
  guide_type text not null check (guide_type in ('consulta', 'sadt', 'particular')),
  table_code text not null default '22' check (table_code in ('00', '18', '19', '20', '22', '90', '98')),
  procedure_code text not null check (procedure_code ~ '^[0-9A-Za-z]{1,10}$'),
  description text not null check (length(trim(description)) between 2 and 150),
  quantity integer not null default 1 check (quantity between 1 and 99),
  unit_amount numeric(12, 2) not null check (unit_amount >= 0 and unit_amount <= 1000000),
  amount numeric(12, 2) not null check (amount >= 0),
  service_date date not null,
  consultation_type text check (consultation_type is null or consultation_type in ('1', '2', '3', '4')),
  -- Authorization from the plan (SP/SADT and some consultations).
  authorization_number text check (authorization_number is null or authorization_number ~ '^[0-9A-Za-z-]{1,20}$'),
  authorization_password text check (authorization_password is null or authorization_password ~ '^[0-9A-Za-z-]{1,20}$'),
  authorization_date date,
  authorization_valid_until date,
  status text not null default 'open' check (status in ('open', 'batched', 'sent', 'paid', 'partial', 'denied', 'cancelled')),
  guide_number bigint,
  batch_id uuid,
  paid_amount numeric(12, 2) not null default 0 check (paid_amount >= 0),
  denied_amount numeric(12, 2) not null default 0 check (denied_amount >= 0),
  denial_code text check (denial_code is null or denial_code ~ '^[0-9]{1,4}$'),
  denial_note text check (denial_note is null or length(denial_note) <= 300),
  notes text not null default '' check (length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  check ((guide_type = 'particular') = (payer_id is null)),
  check (guide_type = 'particular' or card_number is not null),
  check (amount = round(unit_amount * quantity, 2)),
  foreign key (clinic_id, payer_id) references public.billing_payers(clinic_id, id) on delete restrict,
  foreign key (clinic_id, batch_id) references public.billing_batches(clinic_id, id) on delete set null (batch_id)
);
create index billing_charges_clinic_date on public.billing_charges (clinic_id, service_date);
create index billing_charges_batch on public.billing_charges (batch_id) where batch_id is not null;
create index billing_charges_open on public.billing_charges (clinic_id, payer_id, guide_type) where status = 'open';

-- Money received: a private charge, or a batch settlement.
create table public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  charge_id uuid references public.billing_charges(id) on delete restrict,
  batch_id uuid,
  method text not null check (method in ('pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia', 'convenio')),
  amount numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  received_on date not null,
  notes text not null default '' check (length(notes) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  check (num_nonnulls(charge_id, batch_id) = 1),
  foreign key (clinic_id, batch_id) references public.billing_batches(clinic_id, id) on delete restrict
);
create index billing_payments_day on public.billing_payments (clinic_id, received_on);

-- Expenses (contas a pagar).
create table public.billing_expenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  description text not null check (length(trim(description)) between 2 and 150),
  category text not null default 'outros' check (category ~ '^[a-z_]{2,30}$'),
  amount numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  due_on date not null,
  paid_on date,
  method text check (method is null or method in ('pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia')),
  notes text not null default '' check (length(notes) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  check ((paid_on is null) = (method is null))
);
create index billing_expenses_due on public.billing_expenses (clinic_id, due_on);

do $$ declare t text; begin
  foreach t in array array['billing_settings', 'billing_payers', 'billing_prices', 'billing_professionals', 'billing_coverages',
    'billing_batches', 'billing_charges', 'billing_payments', 'billing_expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Who the actor is for billing in this clinic: 'admin', 'reception' (active staff), 'doctor' (active member) or null.
create function public.billing_role(p_clinic uuid, p_actor uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when auth.role() is distinct from 'service_role' or p_actor is null
      or exists (select 1 from public.account_deletion_requests where user_id = p_actor) then null
    when exists (select 1 from public.clinic_members where clinic_id = p_clinic and user_id = p_actor and role = 'admin' and status = 'active') then 'admin'
    when exists (select 1 from public.clinic_staff_members where clinic_id = p_clinic and user_id = p_actor and active) then 'reception'
    when exists (select 1 from public.clinic_members where clinic_id = p_clinic and user_id = p_actor and status = 'active') then 'doctor'
    else null end;
$$;

-- Whether the actor may see and work on the charges of a doctor: an admin (all), the doctor
-- themself, or reception staff scoped to that doctor (the reception agenda rule).
create function public.billing_doctor_ok(p_clinic uuid, p_doctor uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.role() = 'service_role' and p_doctor is not null and (
    public.billing_role(p_clinic, p_actor) = 'admin'
    or coalesce(public.reception_actor_allowed(p_clinic, p_doctor, p_actor), false));
$$;

-- Doctors whose charges the actor sees: every active member for an admin, oneself for a doctor,
-- the scoped doctors for reception staff.
create function public.billing_visible_doctors(p_clinic uuid, p_actor uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.user_id order by m.user_id), '{}') from public.clinic_members m
  where auth.role() = 'service_role' and m.clinic_id = p_clinic and m.status = 'active'
    and public.billing_doctor_ok(p_clinic, m.user_id, p_actor);
$$;

-- Creates a batch from open charges of one plan and guide type (at most 100, TISS rule), numbering
-- the guides from billing_settings.next_guide_number and the batch per plan. Admin only.
create function public.billing_batch_create(p_clinic uuid, p_actor uuid, p_payer uuid, p_guide_type text, p_charges uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.billing_batches; n integer; next_guide bigint; c record; total numeric := 0; i integer := 0; fresh integer := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração cria lotes' using errcode = '42501'; end if;
  if p_guide_type not in ('consulta', 'sadt') or p_charges is null or cardinality(p_charges) = 0 or cardinality(p_charges) > 100
     or cardinality(p_charges) <> (select count(distinct x) from unnest(p_charges) x) then
    raise exception 'Escolha de 1 a 100 cobranças diferentes' using errcode = '22023';
  end if;
  select next_batch_number into n from public.billing_payers where clinic_id = p_clinic and id = p_payer and active for update;
  if not found then raise exception 'Convênio não encontrado' using errcode = 'P0002'; end if;
  insert into public.billing_settings (clinic_id) values (p_clinic) on conflict (clinic_id) do nothing;
  select next_guide_number into next_guide from public.billing_settings where clinic_id = p_clinic for update;
  if (select count(*) from public.billing_charges where id = any (p_charges) and clinic_id = p_clinic and payer_id = p_payer
      and guide_type = p_guide_type and status = 'open') <> cardinality(p_charges) then
    raise exception 'Alguma cobrança mudou, não é deste convênio ou não está em aberto' using errcode = '40001';
  end if;
  perform 1 from public.billing_charges where id = any (p_charges) for update;
  if exists (select 1 from public.billing_charges where id = any (p_charges) and status <> 'open') then
    raise exception 'Alguma cobrança mudou; atualize a lista' using errcode = '40001';
  end if;
  update public.billing_payers set next_batch_number = n + 1 where clinic_id = p_clinic and id = p_payer;
  insert into public.billing_batches (clinic_id, payer_id, number, guide_type, created_by) values (p_clinic, p_payer, n, p_guide_type, p_actor)
  returning * into b;
  -- A charge keeps the guide number it got in an undone batch; only new ones consume numbers.
  for c in select id, amount, guide_number from public.billing_charges where id = any (p_charges) order by service_date, created_at, id loop
    update public.billing_charges set status = 'batched', batch_id = b.id, guide_number = coalesce(c.guide_number, next_guide + fresh),
      revision = revision + 1, updated_at = now() where id = c.id;
    if c.guide_number is null then fresh := fresh + 1; end if;
    i := i + 1;
    total := total + c.amount;
  end loop;
  update public.billing_settings set next_guide_number = next_guide + fresh, updated_at = now() where clinic_id = p_clinic;
  update public.billing_batches set total_amount = total where id = b.id returning * into b;
  return jsonb_build_object('id', b.id, 'number', b.number, 'total', b.total_amount, 'guides', i, 'revision', b.revision);
end $$;

-- Undoes a draft batch: its charges go back to open (they keep their guide numbers).
create function public.billing_batch_cancel(p_clinic uuid, p_actor uuid, p_batch uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.billing_batches;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração altera lotes' using errcode = '42501'; end if;
  select * into b from public.billing_batches where clinic_id = p_clinic and id = p_batch for update;
  if not found then raise exception 'Lote não encontrado' using errcode = 'P0002'; end if;
  if b.revision is distinct from p_revision then raise exception 'O lote mudou; atualize' using errcode = '40001'; end if;
  if b.status <> 'draft' then raise exception 'Só um lote ainda não enviado pode ser desfeito' using errcode = '55000'; end if;
  update public.billing_charges set status = 'open', batch_id = null, revision = revision + 1, updated_at = now() where batch_id = b.id;
  delete from public.billing_batches where id = b.id;
  return jsonb_build_object('deleted', true);
end $$;

-- Records the XML generated for a draft batch (hash), and marks it sent with the portal protocol.
create function public.billing_batch_update(p_clinic uuid, p_actor uuid, p_batch uuid, p_revision integer, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.billing_batches;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração altera lotes' using errcode = '42501'; end if;
  select * into b from public.billing_batches where clinic_id = p_clinic and id = p_batch for update;
  if not found then raise exception 'Lote não encontrado' using errcode = 'P0002'; end if;
  if b.revision is distinct from p_revision then raise exception 'O lote mudou; atualize' using errcode = '40001'; end if;
  if p_patch ? 'xmlHash' then
    if b.status <> 'draft' then raise exception 'O XML só é gerado antes do envio' using errcode = '55000'; end if;
    update public.billing_batches set xml_hash = p_patch->>'xmlHash', xml_payload = p_patch->>'xml', generated_at = now() where id = b.id;
  end if;
  if p_patch ? 'sentAt' then
    if b.status <> 'draft' or b.xml_hash is null and not (p_patch ? 'xmlHash') then
      raise exception 'Gere o XML antes de marcar o lote como enviado' using errcode = '55000';
    end if;
    update public.billing_batches set status = 'sent', sent_at = (p_patch->>'sentAt')::date, protocol = nullif(trim(p_patch->>'protocol'), '') where id = b.id;
    update public.billing_charges set status = 'sent', revision = revision + 1, updated_at = now() where batch_id = b.id and status = 'batched';
  end if;
  -- Only the fields present change; an empty NFS-e number clears it.
  if p_patch ? 'nfseNumber' then
    update public.billing_batches set nfse_number = nullif(trim(p_patch->>'nfseNumber'), '') where id = b.id;
  end if;
  if p_patch ? 'notes' then
    update public.billing_batches set notes = left(coalesce(p_patch->>'notes', ''), 1000) where id = b.id;
  end if;
  update public.billing_batches set revision = revision + 1, updated_at = now() where id = b.id returning * into b;
  return to_jsonb(b);
end $$;

-- Settles a sent batch from the plan's statement (demonstrativo): paid and denied per charge, with the
-- denial code (TUSS table 38). Records one payment for the total received and closes the batch.
create function public.billing_batch_settle(p_clinic uuid, p_actor uuid, p_batch uuid, p_revision integer, p_payment_date date, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.billing_batches; item jsonb; c public.billing_charges; paid numeric; denied numeric; total_paid numeric := 0; total_denied numeric := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração lança o retorno do convênio' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or p_payment_date is null then raise exception 'Retorno inválido' using errcode = '22023'; end if;
  select * into b from public.billing_batches where clinic_id = p_clinic and id = p_batch for update;
  if not found then raise exception 'Lote não encontrado' using errcode = 'P0002'; end if;
  if b.revision is distinct from p_revision then raise exception 'O lote mudou; atualize' using errcode = '40001'; end if;
  if b.status <> 'sent' then raise exception 'Só um lote enviado recebe o retorno do convênio' using errcode = '55000'; end if;
  if jsonb_array_length(p_items) <> (select count(*) from public.billing_charges where batch_id = b.id)
     or jsonb_array_length(p_items) <> (select count(distinct e->>'chargeId') from jsonb_array_elements(p_items) e) then
    raise exception 'Informe o retorno de cada guia do lote, uma vez' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    select * into c from public.billing_charges where id = (item->>'chargeId')::uuid and batch_id = b.id for update;
    if not found then raise exception 'Guia fora do lote' using errcode = '22023'; end if;
    paid := round(coalesce((item->>'paid')::numeric, 0), 2);
    denied := round(c.amount - paid, 2);
    if paid < 0 or paid > c.amount then raise exception 'Valor pago maior que o cobrado na guia %', c.guide_number using errcode = '22023'; end if;
    if denied > 0 and coalesce(item->>'denialCode', '') !~ '^[0-9]{1,4}$' then
      raise exception 'Informe o código da glosa da guia %', c.guide_number using errcode = '22023';
    end if;
    update public.billing_charges set paid_amount = paid, denied_amount = denied,
      denial_code = case when denied > 0 then item->>'denialCode' end, denial_note = case when denied > 0 then left(item->>'denialNote', 300) end,
      status = case when denied = 0 then 'paid' when paid = 0 then 'denied' else 'partial' end, revision = revision + 1, updated_at = now()
    where id = c.id;
    total_paid := total_paid + paid;
    total_denied := total_denied + denied;
  end loop;
  if total_paid > 0 then
    insert into public.billing_payments (clinic_id, batch_id, method, amount, received_on, created_by)
    values (p_clinic, b.id, 'convenio', total_paid, p_payment_date, p_actor);
  end if;
  update public.billing_batches set status = 'closed', paid_amount = total_paid, denied_amount = total_denied, payment_date = p_payment_date,
    revision = revision + 1, updated_at = now() where id = b.id returning * into b;
  return jsonb_build_object('paid', total_paid, 'denied', total_denied, 'revision', b.revision);
end $$;

-- Reopens a settled batch to correct the plan's statement (a typo in a paid amount): the charges go
-- back to 'sent' with paid/denied cleared, the batch payment is marked cancelled (kept for audit), and
-- the batch can be settled again. Admin only.
create function public.billing_batch_reopen(p_clinic uuid, p_actor uuid, p_batch uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.billing_batches;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração corrige o retorno do convênio' using errcode = '42501'; end if;
  select * into b from public.billing_batches where clinic_id = p_clinic and id = p_batch for update;
  if not found then raise exception 'Lote não encontrado' using errcode = 'P0002'; end if;
  if b.revision is distinct from p_revision then raise exception 'O lote mudou; atualize' using errcode = '40001'; end if;
  if b.status <> 'closed' then raise exception 'Só um lote com retorno lançado pode ser reaberto' using errcode = '55000'; end if;
  update public.billing_charges set status = 'sent', paid_amount = 0, denied_amount = 0, denial_code = null, denial_note = null,
    revision = revision + 1, updated_at = now() where batch_id = b.id;
  update public.billing_payments set cancelled_at = now(), cancelled_by = p_actor where batch_id = b.id and cancelled_at is null;
  update public.billing_batches set status = 'sent', paid_amount = 0, denied_amount = 0, payment_date = null, revision = revision + 1, updated_at = now()
  where id = b.id returning * into b;
  return jsonb_build_object('status', b.status, 'revision', b.revision);
end $$;

-- Payment of a private charge (one or more installments up to the amount). Admin or scoped reception.
create function public.billing_charge_pay(p_clinic uuid, p_actor uuid, p_charge uuid, p_revision integer, p_amount numeric, p_method text,
  p_received_on date, p_notes text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.billing_charges; total numeric; role text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into c from public.billing_charges where clinic_id = p_clinic and id = p_charge for update;
  if not found then raise exception 'Cobrança não encontrada' using errcode = 'P0002'; end if;
  role := public.billing_role(p_clinic, p_actor);
  if role not in ('admin', 'reception') or not public.billing_doctor_ok(p_clinic, c.doctor_id, p_actor) then
    raise exception 'Sem permissão para esta cobrança' using errcode = '42501';
  end if;
  if c.revision is distinct from p_revision then raise exception 'A cobrança mudou; atualize' using errcode = '40001'; end if;
  if c.guide_type <> 'particular' then raise exception 'Cobrança de convênio recebe pelo retorno do lote' using errcode = '55000'; end if;
  if c.status not in ('open', 'partial') then raise exception 'Esta cobrança não está em aberto' using errcode = '55000'; end if;
  if p_method not in ('pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia') or p_received_on is null
     or p_amount is null or p_amount <= 0 or round(p_amount, 2) > c.amount - c.paid_amount then
    raise exception 'Valor ou forma de pagamento inválidos' using errcode = '22023';
  end if;
  insert into public.billing_payments (clinic_id, charge_id, method, amount, received_on, notes, created_by)
  values (p_clinic, c.id, p_method, round(p_amount, 2), p_received_on, left(coalesce(p_notes, ''), 300), p_actor);
  total := c.paid_amount + round(p_amount, 2);
  update public.billing_charges set paid_amount = total, status = case when total >= amount then 'paid' else 'partial' end,
    revision = revision + 1, updated_at = now() where id = c.id returning * into c;
  return jsonb_build_object('status', c.status, 'paidAmount', c.paid_amount, 'revision', c.revision);
end $$;

-- Cancels a private payment (wrong entry): the charge goes back to open or partial. Admin only.
create function public.billing_payment_cancel(p_clinic uuid, p_actor uuid, p_payment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.billing_payments; c public.billing_charges;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if public.billing_role(p_clinic, p_actor) is distinct from 'admin' then raise exception 'Só a administração estorna pagamentos' using errcode = '42501'; end if;
  select * into p from public.billing_payments where clinic_id = p_clinic and id = p_payment for update;
  if not found or p.cancelled_at is not null then raise exception 'Pagamento não encontrado' using errcode = 'P0002'; end if;
  if p.charge_id is null then raise exception 'O recebimento de lote se corrige no lote' using errcode = '55000'; end if;
  select * into c from public.billing_charges where id = p.charge_id for update;
  update public.billing_payments set cancelled_at = now(), cancelled_by = p_actor where id = p.id;
  update public.billing_charges set paid_amount = paid_amount - p.amount,
    status = case when paid_amount - p.amount <= 0 then 'open' else 'partial' end, revision = revision + 1, updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('status', c.status, 'paidAmount', c.paid_amount);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.billing_role(uuid,uuid)', 'public.billing_doctor_ok(uuid,uuid,uuid)', 'public.billing_visible_doctors(uuid,uuid)',
    'public.billing_batch_create(uuid,uuid,uuid,text,uuid[])', 'public.billing_batch_cancel(uuid,uuid,uuid,integer)',
    'public.billing_batch_update(uuid,uuid,uuid,integer,jsonb)', 'public.billing_batch_settle(uuid,uuid,uuid,integer,date,jsonb)',
    'public.billing_batch_reopen(uuid,uuid,uuid,integer)',
    'public.billing_charge_pay(uuid,uuid,uuid,integer,numeric,text,date,text)', 'public.billing_payment_cancel(uuid,uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
