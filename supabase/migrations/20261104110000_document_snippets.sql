-- S3 MVP: the doctor's own prescription templates ("modelos de receita").
-- Separate from document_templates, which structures the AI note.
-- Owner: Claude (prescription/documents domain), reserved in coordination/ESTADO.md.
--
-- Rules:
-- - private to the owner; no clinic sharing yet;
-- - reads through RLS, writes only through the RPCs below, with the session,
--   clinical-actor and account-deletion guards;
-- - only 'approved' templates may fill a prescription. Imported templates
--   ('imported_unreviewed') become approved only when the doctor saves them;
-- - the regulatory class is not stored: generate-prescription decides it from
--   the medication names at issuance;
-- - rows go with the owner (on delete cascade); no restrictive actor FKs.

create table public.document_snippets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'receita' check (kind in ('receita')),
  name text not null check (length(name) between 1 and 120 and name = trim(name) and name !~ '[[:cntrl:]]'),
  items jsonb not null default '[]'::jsonb,
  review_status text not null default 'approved' check (review_status in ('approved', 'imported_unreviewed', 'archived')),
  source text not null default 'cortex' check (source in ('cortex', 'personalmed')),
  source_ref text check (source_ref is null or length(source_ref) between 1 and 120),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index document_snippets_owner on public.document_snippets(owner_user_id, review_status, name);

-- 1 to 15 items (the prescription limit), each {name, dosage, instructions}.
create function public.valid_snippet_items(p_items jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_items) = 'array'
    and jsonb_array_length(p_items) between 1 and 15
    and not exists (
      select 1 from jsonb_array_elements(p_items) item
      where jsonb_typeof(item) <> 'object'
        or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'dosage', 'instructions'))
        or jsonb_typeof(item->'name') is distinct from 'string'
        or length(trim(item->>'name')) not between 1 and 200
        or (item ? 'dosage' and (jsonb_typeof(item->'dosage') <> 'string' or length(item->>'dosage') > 200))
        or (item ? 'instructions' and (jsonb_typeof(item->'instructions') <> 'string' or length(item->>'instructions') > 1000))
    );
$$;
revoke all on function public.valid_snippet_items(jsonb) from public, anon;
grant execute on function public.valid_snippet_items(jsonb) to authenticated, service_role;

alter table public.document_snippets
  add constraint document_snippets_items_valid check (public.valid_snippet_items(items));

alter table public.document_snippets enable row level security;
revoke all on public.document_snippets from public, anon, authenticated;
grant select on public.document_snippets to authenticated;
grant all on public.document_snippets to service_role;
create policy snippets_owner_read on public.document_snippets for select to authenticated
  using (owner_user_id = auth.uid());
-- Same restrictive layers as the other clinical tables.
create policy clinical_identity on public.document_snippets as restrictive for all to authenticated
  using (public.clinical_session_allowed()) with check (public.clinical_session_allowed());
create policy session_assurance on public.document_snippets as restrictive for all to authenticated
  using (public.session_assurance_ok()) with check (public.session_assurance_ok());

-- Shared preamble of every write: who, which session, and no account deletion
-- in progress. The advisory key is the one account deletion takes.
create function public.document_snippet_writer() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform public.assert_clinical_actor();
  perform public.assert_session_assurance();
  if v_user is null then raise exception 'Não autorizado' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 123));
  if exists (select 1 from public.account_deletion_requests where user_id = v_user) then
    raise exception 'Exclusão de conta em andamento' using errcode = '55000';
  end if;
  return v_user;
end $$;
revoke all on function public.document_snippet_writer() from public, anon, authenticated;

-- Create (p_id null) or update an own template. Saving is the explicit review:
-- the result is always 'approved'. p_expected_revision guards stale editors.
create function public.save_document_snippet(p_id uuid, p_expected_revision integer, p_name text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.document_snippet_writer();
  v_name text := trim(coalesce(p_name, ''));
  v_row public.document_snippets;
begin
  if length(v_name) not between 1 and 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Informe um nome de até 120 caracteres para o modelo' using errcode = '22023';
  end if;
  if p_items is null or not public.valid_snippet_items(p_items) then
    raise exception 'O modelo precisa de 1 a 15 medicamentos, cada um com nome' using errcode = '22023';
  end if;
  if p_id is null then
    if (select count(*) from public.document_snippets where owner_user_id = v_user and review_status <> 'archived') >= 2000 then
      raise exception 'Limite de modelos atingido; arquive os que não usa' using errcode = '54000';
    end if;
    insert into public.document_snippets(owner_user_id, name, items)
    values (v_user, v_name, p_items) returning * into v_row;
  else
    select * into v_row from public.document_snippets where id = p_id and owner_user_id = v_user for update;
    if not found or v_row.review_status = 'archived' then
      raise exception 'Modelo não encontrado' using errcode = 'P0002';
    end if;
    if p_expected_revision is distinct from v_row.revision then
      raise exception 'O modelo foi alterado em outra sessão; abra de novo' using errcode = '40001';
    end if;
    update public.document_snippets
       set name = v_name, items = p_items, review_status = 'approved', revision = revision + 1, updated_at = now()
     where id = p_id returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision);
end $$;
revoke all on function public.save_document_snippet(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.save_document_snippet(uuid, integer, text, jsonb) to authenticated;

create function public.archive_document_snippet(p_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.document_snippet_writer(); v_row public.document_snippets;
begin
  select * into v_row from public.document_snippets where id = p_id and owner_user_id = v_user for update;
  if not found or v_row.review_status = 'archived' then
    raise exception 'Modelo não encontrado' using errcode = 'P0002';
  end if;
  if p_expected_revision is distinct from v_row.revision then
    raise exception 'O modelo foi alterado em outra sessão; abra de novo' using errcode = '40001';
  end if;
  update public.document_snippets
     set review_status = 'archived', revision = revision + 1, updated_at = now()
   where id = p_id;
end $$;
revoke all on function public.archive_document_snippet(uuid, integer) from public, anon;
grant execute on function public.archive_document_snippet(uuid, integer) to authenticated;
