-- Protocol access is independent of patient grants and is pinned to one
-- immutable reviewed source version. A new version starts private.
alter table public.knowledge_documents add column review_revision integer not null default 0;
create function public.bump_protocol_review_revision() returns trigger language plpgsql set search_path='' as $$
begin
  if new.review_status is distinct from old.review_status or new.reviewed_at is distinct from old.reviewed_at then new.review_revision:=old.review_revision+1; end if;
  return new;
end $$;
create trigger protocol_review_revision before update of review_status,reviewed_at on public.knowledge_documents for each row execute function public.bump_protocol_review_revision();
revoke all on function public.bump_protocol_review_revision() from public;
create table public.protocol_shares (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  revision integer not null default 1,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id,recipient_user_id),
  check(owner_user_id<>recipient_user_id),
  foreign key(document_id,owner_user_id) references public.knowledge_documents(id,user_id) on delete cascade
);
alter table public.protocol_shares enable row level security;
revoke all on public.protocol_shares from anon,authenticated;
create policy session_assurance on public.protocol_shares as restrictive for all to authenticated using(public.session_assurance_ok()) with check(public.session_assurance_ok());
create index protocol_shares_recipient on public.protocol_shares(recipient_user_id,document_id);

create function public.active_protocol_grant(p_document_id uuid,p_actor_user_id uuid) returns public.protocol_shares language sql stable security definer set search_path='' as $$
 select s from public.protocol_shares s
 join public.knowledge_documents d on d.id=s.document_id and d.user_id=s.owner_user_id and d.review_status='approved' and d.status='ready' and d.source_text is not null
 join public.clinic_members o on o.clinic_id=s.clinic_id and o.user_id=s.owner_user_id and o.status='active'
 join public.clinic_members r on r.clinic_id=s.clinic_id and r.user_id=s.recipient_user_id and r.status='active'
 where s.document_id=p_document_id and s.recipient_user_id=p_actor_user_id and s.revoked_at is null
 and not exists(select 1 from public.account_deletion_requests where user_id in (s.owner_user_id,s.recipient_user_id))
$$;
revoke all on function public.active_protocol_grant(uuid,uuid) from public,anon,authenticated;

create function public.grant_protocol_share(p_document_id uuid,p_recipient_user_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_clinic uuid; v_id uuid;
begin
  if p_recipient_user_id=v_actor or p_recipient_user_id is null then raise exception 'Selecione outro médico' using errcode='22023'; end if;
  perform 1 from public.knowledge_documents where id=p_document_id and user_id=v_actor and review_status='approved' and status='ready' and source_text is not null for update;
  if not found then raise exception 'A fonte precisa estar revisada e indexada antes de compartilhar' using errcode='42501'; end if;
  select o.clinic_id into v_clinic from public.clinic_members o join public.clinic_members r on r.clinic_id=o.clinic_id
    where o.user_id=v_actor and r.user_id=p_recipient_user_id and o.status='active' and r.status='active' limit 1 for share of o,r;
  if v_clinic is null then raise exception 'Ambos os médicos precisam estar ativos na mesma clínica' using errcode='42501'; end if;
  insert into public.protocol_shares(document_id,owner_user_id,recipient_user_id,clinic_id) values(p_document_id,v_actor,p_recipient_user_id,v_clinic)
    on conflict(document_id,recipient_user_id) do update set revoked_at=null,revision=public.protocol_shares.revision+1,updated_at=now() returning id into v_id;
  return v_id;
end $$;
create function public.revoke_protocol_share(p_share_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor();
begin
  update public.protocol_shares set revoked_at=now(),revision=revision+1,updated_at=now() where id=p_share_id and owner_user_id=v_actor;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  return true;
end $$;
create function public.protocol_sharing_overview(p_document_id uuid default null,p_search text default '',p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_limit integer:=least(greatest(p_limit,1),500); v_search text:=left(coalesce(p_search,''),200);
begin
  if p_document_id is not null and not exists(select 1 from public.knowledge_documents where id=p_document_id and user_id=v_actor) then raise exception 'Source unavailable' using errcode='42501'; end if;
  return jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(us.doctor_name,''),u.email,'Médico'))) from public.clinic_members m join auth.users u on u.id=m.user_id left join public.user_settings us on us.user_id=m.user_id where m.status='active' and m.user_id<>v_actor and exists(select 1 from public.clinic_members me where me.clinic_id=m.clinic_id and me.user_id=v_actor and me.status='active')),'[]'::jsonb),
    'received',coalesce((select jsonb_agg(to_jsonb(q)) from (
      select d.id,d.title,d.source_version,d.reviewed_at,coalesce(d.reviewer_name,nullif(us.doctor_name,''),'Médico responsável') as source_author,s.revision as authorization_revision
      from public.protocol_shares s join public.knowledge_documents d on d.id=s.document_id left join public.user_settings us on us.user_id=d.user_id
      where p_document_id is null and s.recipient_user_id=v_actor and (public.active_protocol_grant(d.id,v_actor)).id is not null and position(lower(v_search) in lower(d.title))>0
      order by d.title,d.id limit v_limit
    ) q),'[]'::jsonb),
    'received_count',(select count(*) from public.protocol_shares s join public.knowledge_documents d on d.id=s.document_id where p_document_id is null and s.recipient_user_id=v_actor and (public.active_protocol_grant(d.id,v_actor)).id is not null and position(lower(v_search) in lower(d.title))>0),
    'granted',coalesce((select jsonb_agg(to_jsonb(q)) from (
      select s.id,s.recipient_user_id,coalesce(nullif(us.doctor_name,''),u.email,'Médico') as recipient_name,s.revoked_at
      from public.protocol_shares s join auth.users u on u.id=s.recipient_user_id left join public.user_settings us on us.user_id=s.recipient_user_id
      where s.document_id=p_document_id and s.owner_user_id=v_actor order by s.created_at,s.id limit 500
    ) q),'[]'::jsonb)
  );
end $$;
create function public.check_shared_protocol_access(p_document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_share public.protocol_shares; v_doc public.knowledge_documents;
begin
  select * into v_doc from public.knowledge_documents where id=p_document_id and review_status='approved' and status='ready' and source_text is not null;
  if not found then raise exception 'Fonte indisponível ou retirada' using errcode='42501'; end if;
  if v_doc.user_id=v_actor then return jsonb_build_object('authorization_revision',0,'source_review_revision',v_doc.review_revision,'review_revision',v_doc.review_revision); end if;
  select * into v_share from public.active_protocol_grant(p_document_id,v_actor);
  if v_share.id is null then raise exception 'Fonte indisponível ou acesso revogado' using errcode='42501'; end if;
  return jsonb_build_object('authorization_revision',v_share.revision,'source_review_revision',v_doc.review_revision,'review_revision',v_doc.review_revision);
end $$;
create function public.get_shared_protocol(p_document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_share public.protocol_shares; v_final public.protocol_shares; v_source jsonb;
begin
  select * into v_share from public.active_protocol_grant(p_document_id,v_actor);
  if v_share.id is null then raise exception 'Fonte indisponível ou acesso revogado' using errcode='42501'; end if;
  select jsonb_build_object('id',d.id,'title',d.title,'source_text',d.source_text,'source_reference',d.source_reference,'source_version',d.source_version,'reviewed_at',d.reviewed_at,'source_author',coalesce(d.reviewer_name,nullif(us.doctor_name,''),'Médico responsável'),'authorization_revision',v_share.revision,'source_review_revision',d.review_revision)
    into v_source from public.knowledge_documents d left join public.user_settings us on us.user_id=d.user_id where d.id=p_document_id;
  select * into v_final from public.active_protocol_grant(p_document_id,v_actor);
  if v_final.id is null or v_final.revision is distinct from v_share.revision then raise exception 'Permissões alteradas durante a leitura' using errcode='42501'; end if;
  return v_source;
end $$;

create function public.revoke_retired_protocol_shares() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.review_status<>'approved' then update public.protocol_shares set revoked_at=now(),revision=revision+1,updated_at=now() where document_id=new.id and revoked_at is null; end if;
  return new;
end $$;
create trigger protocol_retired_access after update of review_status on public.knowledge_documents for each row execute function public.revoke_retired_protocol_shares();
create function public.revoke_offboarded_protocol_shares() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'active' then update public.protocol_shares set revoked_at=now(),revision=revision+1,updated_at=now() where clinic_id=new.clinic_id and (owner_user_id=new.user_id or recipient_user_id=new.user_id) and revoked_at is null; end if;
  return new;
end $$;
create trigger protocol_member_offboard after update of status on public.clinic_members for each row execute function public.revoke_offboarded_protocol_shares();
revoke all on function public.revoke_retired_protocol_shares(),public.revoke_offboarded_protocol_shares() from public;

-- SECURITY DEFINER is required for explicitly shared sources because their
-- tables remain owner-only. The actor check is mandatory before any data read.
drop function public.match_knowledge(uuid,public.vector,integer);
create function public.match_knowledge(p_user_id uuid,query_embedding public.vector(768),match_count integer default 5)
returns table(content text,similarity float,document_id uuid,source_title text,source_reference text,source_version text,source_author text,source_owner_user_id uuid,reviewed_at timestamptz,authorization_revision integer,source_review_revision integer)
language sql stable security definer set search_path='' as $$
 with allowed_documents as materialized (
   select d.*,coalesce(d.reviewer_name,nullif(us.doctor_name,''),'Médico responsável') as author_name,case when d.user_id=p_user_id then 0 else (public.active_protocol_grant(d.id,p_user_id)).revision end as grant_revision
   from public.knowledge_documents d left join public.user_settings us on us.user_id=d.user_id
   where (auth.role()='service_role' or (auth.role()='authenticated' and auth.uid()=p_user_id and public.session_assurance_ok()))
     and not exists(select 1 from public.account_deletion_requests where user_id=p_user_id)
     and d.review_status='approved' and d.status='ready' and d.source_text is not null and d.embedding_model='gemini-embedding-001'
     and (d.user_id=p_user_id or (public.active_protocol_grant(d.id,p_user_id)).id is not null)
 )
 select c.content,1-(c.embedding operator(public.<=>) query_embedding),c.document_id,d.title,d.source_reference,d.source_version,d.author_name,d.user_id,d.reviewed_at,d.grant_revision,d.review_revision
 from public.knowledge_chunks c join allowed_documents d on d.id=c.document_id and d.user_id=c.user_id
 where c.embedding is not null order by c.embedding operator(public.<=>) query_embedding limit least(greatest(match_count,1),20)
$$;
revoke all on function public.match_knowledge(uuid,public.vector,integer) from public,anon;
grant execute on function public.match_knowledge(uuid,public.vector,integer) to authenticated,service_role;
-- A copied RAG result is not a continuing authorization. Revalidate the exact
-- grant revision before provider use and again before delivering derived text.
create function public.authorize_protocol_sources(p_actor_user_id uuid,p_sources jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare v_source jsonb; v_doc public.knowledge_documents; v_grant public.protocol_shares; v_revision integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_actor_user_id is null or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources)>20 then return false; end if;
  if exists(select 1 from public.account_deletion_requests where user_id=p_actor_user_id) then return false; end if;
  for v_source in select jsonb_array_elements(p_sources) loop
    select * into v_doc from public.knowledge_documents where id=(v_source->>'document_id')::uuid and review_status='approved' and status='ready' and source_text is not null;
    if not found then return false; end if;
    if v_doc.review_revision is distinct from (v_source->>'source_review_revision')::integer then return false; end if;
    if v_doc.user_id=p_actor_user_id then v_revision:=0;
    else
      select * into v_grant from public.active_protocol_grant(v_doc.id,p_actor_user_id);
      if v_grant.id is null then return false; end if;
      v_revision:=v_grant.revision;
    end if;
    if v_revision is distinct from (v_source->>'authorization_revision')::integer then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.authorize_protocol_sources(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_protocol_sources(uuid,jsonb) to service_role;
revoke all on function public.grant_protocol_share(uuid,uuid),public.revoke_protocol_share(uuid),public.protocol_sharing_overview(uuid,text,integer),public.check_shared_protocol_access(uuid),public.get_shared_protocol(uuid) from public,anon;
grant execute on function public.grant_protocol_share(uuid,uuid),public.revoke_protocol_share(uuid),public.protocol_sharing_overview(uuid,text,integer),public.check_shared_protocol_access(uuid),public.get_shared_protocol(uuid) to authenticated;
