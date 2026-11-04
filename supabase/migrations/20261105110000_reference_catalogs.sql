-- Reference catalogs (contract: docs/prescriptions/CATALOGOS_E_MANIPULADOS.md):
-- TUSS table 22 (ANS), CID-10 (DATASUS), CMED presentations (Anvisa, never
-- prices) and DCB (Anvisa). Public reference data, no patient data. Read by
-- any signed-in user, like medication_catalog; written only by the service
-- role (refresh-reference-catalogs). Also lets prescription templates keep
-- compounded formulas (manipulados).
begin;
set local lock_timeout='2s';
create extension if not exists pg_trgm;

create table public.exam_catalog(
 code text primary key check(code ~ '^[0-9]{8}$'),
 name text not null check(length(name) between 1 and 500),
 exam_group text not null check(exam_group in ('laboratorio','imagem','medicina_nuclear','patologia','diagnostico','outro')),
 valid_from date,
 valid_to date,
 refreshed_at timestamptz not null default now()
);
create index exam_catalog_name_trgm on public.exam_catalog using gin(name gin_trgm_ops);
create index exam_catalog_group on public.exam_catalog(exam_group);

create table public.cid10_catalog(
 code text primary key check(code ~ '^[A-Z][0-9]{2}(\.[0-9])?$'),
 description text not null check(length(description) between 1 and 500),
 short_description text check(length(short_description)<=200),
 sex text check(sex in ('F','M')),
 kind text not null check(kind in ('categoria','subcategoria')),
 refreshed_at timestamptz not null default now()
);
create index cid10_catalog_description_trgm on public.cid10_catalog using gin(description gin_trgm_ops);

create table public.medication_presentations(
 ggrem text primary key check(ggrem ~ '^[0-9]{6,20}$'),
 registration text check(registration ~ '^[0-9]{0,15}$'),
 registration9 text check(registration9 ~ '^[0-9]{0,9}$'),
 substance text check(length(substance)<=2000),
 laboratory text check(length(laboratory)<=300),
 product text not null check(length(product) between 1 and 300),
 presentation text check(length(presentation)<=500),
 therapeutic_class text check(length(therapeutic_class)<=300),
 product_type text check(length(product_type)<=100),
 tarja text check(length(tarja)<=100),
 eans text[] not null default '{}',
 hospital_only boolean not null default false,
 refreshed_at timestamptz not null default now()
);
create index medication_presentations_registration on public.medication_presentations(registration9);
create index medication_presentations_product_trgm on public.medication_presentations using gin(product gin_trgm_ops);
create index medication_presentations_substance_trgm on public.medication_presentations using gin(substance gin_trgm_ops);

-- The official list repeats ten numbers, so (number, name) is the key.
create table public.dcb_catalog(
 dcb_number integer not null check(dcb_number>0),
 name text not null check(length(name) between 1 and 300),
 cas text check(length(cas)<=100),
 classification text check(length(classification)<=20),
 refreshed_at timestamptz not null default now(),
 primary key(dcb_number,name)
);
create index dcb_catalog_name_trgm on public.dcb_catalog using gin(name gin_trgm_ops);

-- What was loaded, from where and when (shown in the app as the source date).
create table public.reference_catalog_versions(
 source text primary key check(source in ('tuss','cid10','cmed','dcb')),
 source_url text not null check(source_url ~ '^https?://'),
 rows_loaded integer not null check(rows_loaded>=0),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 refreshed_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['exam_catalog','cid10_catalog','medication_presentations','dcb_catalog','reference_catalog_versions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy "Authenticated read reference" on public.%I for select to authenticated using (true)',t);
 end loop;
end $$;

-- Prescription templates may keep a compounded formula per item (same shape
-- and limits as formulaError in _shared/regulatedMedications.ts).
create function public.valid_snippet_formula(p_formula jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(p_formula)='object'
  and not exists(select 1 from jsonb_object_keys(p_formula) k where k not in ('components','vehicle','form','quantity'))
  and jsonb_typeof(p_formula->'components')='array'
  and jsonb_array_length(p_formula->'components') between 1 and 12
  and not exists(
   select 1 from jsonb_array_elements(p_formula->'components') c
   where jsonb_typeof(c)<>'object'
    or exists(select 1 from jsonb_object_keys(c) k where k not in ('substance','amount'))
    or jsonb_typeof(c->'substance') is distinct from 'string' or length(trim(c->>'substance')) not between 1 and 120
    or jsonb_typeof(c->'amount') is distinct from 'string' or length(trim(c->>'amount')) not between 1 and 40 or c->>'amount' !~ '[0-9]')
  and (not p_formula ? 'vehicle' or (jsonb_typeof(p_formula->'vehicle')='string' and length(p_formula->>'vehicle')<=80))
  and jsonb_typeof(p_formula->'form')='string' and length(trim(p_formula->>'form')) between 1 and 40
  and jsonb_typeof(p_formula->'quantity')='string' and length(trim(p_formula->>'quantity')) between 1 and 40 and p_formula->>'quantity' ~ '[0-9]';
$$;

-- Same contract as 20261104110000 plus the optional 'formula' key.
create or replace function public.valid_snippet_items(p_items jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_items) = 'array'
    and jsonb_array_length(p_items) between 1 and 15
    and not exists (
      select 1 from jsonb_array_elements(p_items) item
      where jsonb_typeof(item) <> 'object'
        or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'dosage', 'instructions', 'formula'))
        or jsonb_typeof(item->'name') is distinct from 'string'
        or length(trim(item->>'name')) not between 1 and 200
        or (item ? 'dosage' and (jsonb_typeof(item->'dosage') <> 'string' or length(item->>'dosage') > 200))
        or (item ? 'instructions' and (jsonb_typeof(item->'instructions') <> 'string' or length(item->>'instructions') > 1000))
        or (item ? 'formula' and not public.valid_snippet_formula(item->'formula'))
    );
$$;
revoke all on function public.valid_snippet_formula(jsonb) from public, anon;
grant execute on function public.valid_snippet_formula(jsonb) to authenticated, service_role;
commit;
