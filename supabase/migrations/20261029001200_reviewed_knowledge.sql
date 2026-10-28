-- Original protocol text is immutable. Only explicitly reviewed, completely
-- indexed versions participate in retrieval. Existing sources await review.
alter table public.knowledge_documents
  add column source_text text,
  add column source_reference text,
  add column source_version text,
  add column supersedes_document_id uuid,
  add column review_status text not null default 'pending' check(review_status in ('pending','approved','retired')),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid,
  add column reviewer_name text,
  add column index_revision integer not null default 0,
  add column indexed_at timestamptz,
  add column index_started_at timestamptz,
  add column embedding_model text;
alter table public.knowledge_documents drop constraint if exists knowledge_documents_status_check;
alter table public.knowledge_documents add constraint knowledge_documents_status_check check(status in ('draft','processing','ready','error'));
alter table public.knowledge_documents add constraint knowledge_version_owner_fk foreign key(supersedes_document_id,user_id) references public.knowledge_documents(id,user_id) deferrable initially deferred;
create unique index knowledge_single_successor on public.knowledge_documents(supersedes_document_id) where supersedes_document_id is not null;
create table public.knowledge_review_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null,
  actor_name text not null,
  action text not null check(action in ('approved','retired','superseded')),
  created_at timestamptz not null default now(),
  foreign key(document_id,user_id) references public.knowledge_documents(id,user_id) on delete cascade
);
alter table public.knowledge_review_events enable row level security;
create policy knowledge_review_owner on public.knowledge_review_events for select to authenticated using(user_id=auth.uid());
revoke all on public.knowledge_review_events from anon,authenticated;
grant select on public.knowledge_review_events to authenticated;
revoke insert,update,delete on public.knowledge_documents from anon,authenticated;

create function public.immutable_knowledge_source() returns trigger language plpgsql set search_path='' as $$
begin
  if new.source_text is distinct from old.source_text or new.source_reference is distinct from old.source_reference
    or new.source_version is distinct from old.source_version or new.title is distinct from old.title
    or new.user_id is distinct from old.user_id or new.supersedes_document_id is distinct from old.supersedes_document_id then
    raise exception 'Create a new source version instead of changing its original text' using errcode='42501';
  end if;
  return new;
end $$;
create trigger immutable_knowledge_source before update on public.knowledge_documents for each row execute function public.immutable_knowledge_source();
revoke all on function public.immutable_knowledge_source() from public;

create function public.create_knowledge_source(p_title text,p_text text,p_reference text,p_version text,p_supersedes_document_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_id uuid; v_previous public.knowledge_documents;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform public.assert_session_assurance();
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,123));
  if exists(select 1 from public.account_deletion_requests where user_id=v_actor) then raise exception 'Account unavailable' using errcode='42501'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 200 or p_text is null or length(trim(p_text)) not between 20 and 60000
    or p_reference is null or length(trim(p_reference)) not between 1 and 2000 or p_version is null or length(trim(p_version)) not between 1 and 80 then raise exception 'Título, fonte, versão e texto são obrigatórios. Texto: 20 a 60.000 caracteres.' using errcode='22023'; end if;
  if p_supersedes_document_id is not null then
    select * into v_previous from public.knowledge_documents where id=p_supersedes_document_id and user_id=v_actor;
    if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
    if v_previous.source_version=trim(p_version) then raise exception 'Informe uma versão diferente da anterior' using errcode='22023'; end if;
    if exists(select 1 from public.knowledge_documents where supersedes_document_id=p_supersedes_document_id) then raise exception 'Esta fonte já possui uma versão posterior. Abra a versão mais recente para continuar.' using errcode='22023'; end if;
  end if;
  insert into public.knowledge_documents(user_id,title,source_type,char_count,status,source_text,source_reference,source_version,supersedes_document_id)
  values(v_actor,trim(p_title),'text',length(trim(p_text)),'draft',trim(p_text),trim(p_reference),trim(p_version),p_supersedes_document_id) returning id into v_id;
  return v_id;
end $$;
create function public.review_knowledge_source(p_document_id uuid,p_approve boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_doc public.knowledge_documents; v_name text;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform public.assert_session_assurance();
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,123));
  if exists(select 1 from public.account_deletion_requests where user_id=v_actor) then raise exception 'Account unavailable' using errcode='42501'; end if;
  select * into v_doc from public.knowledge_documents where id=p_document_id and user_id=v_actor for update;
  if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
  if p_approve is null then raise exception 'Review decision required' using errcode='22023'; end if;
  if p_approve and (v_doc.source_text is null or length(v_doc.source_text)<20 or nullif(trim(v_doc.source_reference),'') is null or nullif(trim(v_doc.source_version),'') is null) then raise exception 'O original desta fonte não foi preservado. Crie uma nova versão com o texto original antes de aprovar.' using errcode='22023'; end if;
  select coalesce(nullif(s.doctor_name,''),u.email,'Médico') into v_name from auth.users u left join public.user_settings s on s.user_id=u.id where u.id=v_actor;
  update public.knowledge_documents set review_status=case when p_approve then 'approved' else 'retired' end,reviewed_at=now(),reviewed_by=v_actor,reviewer_name=v_name where id=p_document_id;
  insert into public.knowledge_review_events(document_id,user_id,actor_user_id,actor_name,action) values(p_document_id,v_actor,v_actor,v_name,case when p_approve then 'approved' else 'retired' end);
  return true;
end $$;
create function public.begin_knowledge_index(p_user_id uuid,p_document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_doc public.knowledge_documents;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  if exists(select 1 from public.account_deletion_requests where user_id=p_user_id) then raise exception 'Account unavailable' using errcode='42501'; end if;
  select * into v_doc from public.knowledge_documents where id=p_document_id and user_id=p_user_id for update;
  if not found or v_doc.review_status<>'approved' or v_doc.source_text is null then raise exception 'Revise e aprove a fonte antes da indexação' using errcode='42501'; end if;
  if v_doc.status='processing' and v_doc.index_started_at>now()-interval '10 minutes' then raise exception 'Indexação já em andamento. Aguarde antes de tentar novamente.' using errcode='40001'; end if;
  update public.knowledge_documents set status='processing',index_revision=index_revision+1,index_started_at=now() where id=p_document_id returning * into v_doc;
  return jsonb_build_object('source_text',v_doc.source_text,'index_revision',v_doc.index_revision);
end $$;
create function public.finish_knowledge_index(p_user_id uuid,p_document_id uuid,p_index_revision integer,p_chunks jsonb,p_failed boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare v_doc public.knowledge_documents; v_chunk jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  select * into v_doc from public.knowledge_documents where id=p_document_id and user_id=p_user_id for update;
  if not found or v_doc.index_revision is distinct from p_index_revision then raise exception 'Indexação substituída ou indisponível' using errcode='40001'; end if;
  if p_failed then update public.knowledge_documents set status='error' where id=p_document_id; return true; end if;
  if v_doc.review_status<>'approved' or exists(select 1 from public.account_deletion_requests where user_id=p_user_id) then raise exception 'Revisão retirada durante a indexação' using errcode='42501'; end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) not between 1 and 60 then raise exception 'Trechos de indexação inválidos' using errcode='22023'; end if;
  for v_chunk in select jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(v_chunk->'embedding') is distinct from 'array' or jsonb_array_length(v_chunk->'embedding')<>768 or length(coalesce(v_chunk->>'content',''))=0 then raise exception 'Embedding inválido' using errcode='22023'; end if;
  end loop;
  delete from public.knowledge_chunks where document_id=p_document_id and user_id=p_user_id;
  insert into public.knowledge_chunks(document_id,user_id,content,embedding) select p_document_id,p_user_id,x->>'content',(x->>'embedding')::public.vector from jsonb_array_elements(p_chunks) x;
  update public.knowledge_documents set status='ready',indexed_at=now(),embedding_model='gemini-embedding-001' where id=p_document_id;
  if v_doc.supersedes_document_id is not null then
    update public.knowledge_documents set review_status='retired' where id=v_doc.supersedes_document_id and user_id=p_user_id;
    insert into public.knowledge_review_events(document_id,user_id,actor_user_id,actor_name,action) values(v_doc.supersedes_document_id,p_user_id,p_user_id,coalesce(v_doc.reviewer_name,'Médico'),'superseded');
  end if;
  return true;
end $$;

create or replace function public.match_knowledge(p_user_id uuid,query_embedding public.vector(768),match_count integer default 5)
returns table(content text,similarity float,document_id uuid) language sql stable set search_path='' as $$
 select c.content,1-(c.embedding operator(public.<=>) query_embedding),c.document_id
 from public.knowledge_chunks c join public.knowledge_documents d on d.id=c.document_id and d.user_id=c.user_id
 where c.user_id=p_user_id and c.embedding is not null and d.status='ready' and d.review_status='approved' and d.embedding_model='gemini-embedding-001'
 order by c.embedding operator(public.<=>) query_embedding limit least(greatest(match_count,1),20)
$$;
revoke all on function public.create_knowledge_source(text,text,text,text,uuid),public.review_knowledge_source(uuid,boolean),public.begin_knowledge_index(uuid,uuid),public.finish_knowledge_index(uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.create_knowledge_source(text,text,text,text,uuid),public.review_knowledge_source(uuid,boolean) to authenticated;
grant execute on function public.begin_knowledge_index(uuid,uuid),public.finish_knowledge_index(uuid,uuid,integer,jsonb,boolean) to service_role;
