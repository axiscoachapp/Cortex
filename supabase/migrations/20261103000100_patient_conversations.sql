-- Private conversational drafts, distinct from finalized clinical records.
create table public.patient_chat_turns (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  question text not null check(length(trim(question)) between 1 and 4000),
  response jsonb,
  usage_receipt jsonb,
  status text not null default 'pending' check(status in ('pending','complete','failed','retryable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,patient_id,id),
  foreign key(patient_id,user_id) references public.patients(id,user_id) on delete cascade,
  check((status='complete' and response is not null and response ?& array['message','sources'] and jsonb_typeof(response)='object' and jsonb_typeof(response->'message')='string'
    and length(response->>'message') between 1 and 20000 and jsonb_typeof(response->'sources')='array' and octet_length(response::text)<=131072)
    or (status in ('pending','failed','retryable') and response is null))
);
create index patient_chat_order on public.patient_chat_turns(user_id,patient_id,created_at desc,id desc);
alter table public.patient_chat_turns enable row level security;
-- All data access uses actor-checked RPCs; clients cannot forge assistant provenance.
revoke all on public.patient_chat_turns from public,anon,authenticated;
grant all on public.patient_chat_turns to service_role;

-- Shared internal authorization predicate: caller wrappers retain their role checks.
create function public.protocol_sources_allowed(p_actor_user_id uuid,p_sources jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare s jsonb; d public.knowledge_documents; g public.protocol_shares; grant_revision integer;
begin
  if p_actor_user_id is null or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources)>20 then return false; end if;
  if exists(select 1 from public.account_deletion_requests where user_id=p_actor_user_id) then return false; end if;
  for s in select jsonb_array_elements(p_sources) loop
    if not (s ?& array['document_id','source_review_revision','authorization_revision']) then return false; end if;
    select * into d from public.knowledge_documents where id=(s->>'document_id')::uuid and review_status='approved' and status='ready' and source_text is not null;
    if not found or d.review_revision is distinct from (s->>'source_review_revision')::integer then return false; end if;
    if d.user_id=p_actor_user_id then grant_revision:=0;
    else
      select * into g from public.active_protocol_grant(d.id,p_actor_user_id);
      if g.id is null then return false; end if;
      grant_revision:=g.revision;
    end if;
    if grant_revision is distinct from (s->>'authorization_revision')::integer then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.protocol_sources_allowed(uuid,jsonb) from public,anon,authenticated;

create or replace function public.authorize_protocol_sources(p_actor_user_id uuid,p_sources jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  return public.protocol_sources_allowed(p_actor_user_id,p_sources);
end $$;
revoke all on function public.authorize_protocol_sources(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_protocol_sources(uuid,jsonb) to service_role;

create function public.chat_response_for_actor(p_actor uuid,p_response jsonb,p_export boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare refs jsonb; hidden jsonb:=jsonb_build_object('message','Esta resposta depende de fontes cujo acesso deve ser confirmado. O texto e os trechos foram ocultados. Consulte fontes atualmente autorizadas.','sources','[]'::jsonb,'redacted',true,'credits',0);
begin
  if p_response is null then return null; end if;
  if jsonb_typeof(p_response->'sources') is distinct from 'array' then return hidden; end if;
  select coalesce(jsonb_agg(jsonb_build_object('document_id',s->>'id','authorization_revision',s->'authorizationRevision','source_review_revision',s->'sourceReviewRevision')),'[]')
    into refs from jsonb_array_elements(p_response->'sources') s where s->>'type' in ('knowledge','protocol');
  -- Export snapshots can outlive a grant. Never copy protocol-derived content into them.
  if jsonb_array_length(refs)>0 and (p_export or not public.protocol_sources_allowed(p_actor,refs)) then return hidden; end if;
  return p_response;
end $$;
revoke all on function public.chat_response_for_actor(uuid,jsonb,boolean) from public,anon,authenticated;

create function public.assert_chat_patient(p_user uuid,p_patient uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,123));
  if exists(select 1 from public.account_deletion_requests where user_id=p_user) or not exists(
    select 1 from public.patients where id=p_patient and user_id=p_user and deletion_requested_at is null and archived_at is null
  ) then raise exception 'Paciente indisponível' using errcode='42501'; end if;
end $$;
revoke all on function public.assert_chat_patient(uuid,uuid) from public,anon,authenticated;

create function public.begin_patient_chat_turn(p_user_id uuid,p_patient_id uuid,p_turn_id uuid,p_question text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.patient_chat_turns;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform public.assert_chat_patient(p_user_id,p_patient_id);
  if p_turn_id is null or length(trim(p_question)) not between 1 and 4000 then raise exception 'Pergunta inválida' using errcode='22023'; end if;
  select * into t from public.patient_chat_turns where user_id=p_user_id and patient_id=p_patient_id and id=p_turn_id for update;
  if found then
    if t.question is distinct from p_question then raise exception 'Identificador de pergunta já utilizado' using errcode='23505'; end if;
    if t.status='complete' then return jsonb_build_object('state','complete','usageReceipt',t.usage_receipt,'response',public.chat_response_for_actor(p_user_id,t.response)||jsonb_build_object('credits',0,'cached',true)); end if;
    if t.status='failed' then return jsonb_build_object('state','failed'); end if;
    if t.status='pending' then
      if t.updated_at<now()-interval '5 minutes' then
        update public.patient_chat_turns set status='failed',updated_at=now() where user_id=p_user_id and patient_id=p_patient_id and id=p_turn_id;
        return jsonb_build_object('state','failed');
      end if;
      return jsonb_build_object('state','pending');
    end if;
    update public.patient_chat_turns set status='pending',updated_at=now() where user_id=p_user_id and patient_id=p_patient_id and id=p_turn_id;
  else
    insert into public.patient_chat_turns(id,user_id,patient_id,question) values(p_turn_id,p_user_id,p_patient_id,p_question);
  end if;
  return jsonb_build_object('state','started');
end $$;

create function public.finish_patient_chat_turn(p_user_id uuid,p_patient_id uuid,p_turn_id uuid,p_response jsonb,p_usage_receipt jsonb default null,p_retryable boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  perform public.assert_chat_patient(p_user_id,p_patient_id);
  if p_usage_receipt is not null and (jsonb_typeof(p_usage_receipt) is distinct from 'object' or not (p_usage_receipt ?& array['reservationId','credits'])) then raise exception 'Recibo de consumo inválido' using errcode='22023'; end if;
  update public.patient_chat_turns set response=p_response,usage_receipt=case when p_response is null then null else p_usage_receipt end,status=case when p_response is not null then 'complete' when p_retryable then 'retryable' else 'failed' end,updated_at=now()
    where user_id=p_user_id and patient_id=p_patient_id and id=p_turn_id and status='pending';
  return found;
end $$;
revoke all on function public.begin_patient_chat_turn(uuid,uuid,uuid,text),public.finish_patient_chat_turn(uuid,uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.begin_patient_chat_turn(uuid,uuid,uuid,text),public.finish_patient_chat_turn(uuid,uuid,uuid,jsonb,jsonb,boolean) to service_role;

create function public.list_patient_chat_turns(p_patient_id uuid,p_before uuid default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); cursor_time timestamptz; result jsonb; limit_rows integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.assert_session_assurance();
  perform public.assert_chat_patient(actor,p_patient_id);
  if p_before is not null then
    select created_at into cursor_time from public.patient_chat_turns where user_id=actor and patient_id=p_patient_id and id=p_before;
    if not found then raise exception 'Página indisponível' using errcode='22023'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'question',t.question,'response',public.chat_response_for_actor(actor,t.response),
    'status',t.status,'createdAt',t.created_at,'updatedAt',t.updated_at) order by t.created_at desc,t.id desc),'[]') into result
    from (select * from public.patient_chat_turns where user_id=actor and patient_id=p_patient_id
      and (p_before is null or (created_at,id)<(cursor_time,p_before)) order by created_at desc,id desc limit limit_rows) t;
  return result;
end $$;
revoke all on function public.list_patient_chat_turns(uuid,uuid,integer) from public,anon;
grant execute on function public.list_patient_chat_turns(uuid,uuid,integer) to authenticated;

-- Preserve all existing snapshot semantics and ACLs while including chat drafts.
do $$ declare definition text; marker text:='RETURN jsonb_build_object(''tables'',tables,''files'',files);'; begin
  select pg_get_functiondef('public.build_data_export_manifest(uuid)'::regprocedure) into definition;
  if position(marker in definition)=0 then raise exception 'Export contract changed; review the chat export extension'; end if;
  definition:=replace(definition,marker,$insert$
    SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('response',public.chat_response_for_actor(p_user_id,c.response,true)) ORDER BY c.created_at,c.id),'[]')
      INTO rows FROM public.patient_chat_turns c WHERE c.user_id=p_user_id;
    tables:=tables||jsonb_build_object('patient_chat_turns',rows);
    RETURN jsonb_build_object('tables',tables,'files',files);
  $insert$);
  execute definition;
end $$;
