begin;
insert into auth.users(id,email) values
 ('81000000-0000-4000-8000-000000000001','protocol-owner@example.invalid'),
 ('81000000-0000-4000-8000-000000000002','protocol-outsider@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select set_config('test.protocol_id',public.create_knowledge_source('Synthetic protocol','Preserved original synthetic protocol content.','Synthetic source','v1')::text,true);
do $$ begin
  begin update public.knowledge_documents set source_text='silent replacement'; raise exception 'Client changed original'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
do $$ begin
  assert (select count(*) from public.knowledge_documents)=0,'Foreign source exposed';
  begin perform public.review_knowledge_source(current_setting('test.protocol_id')::uuid,true); raise exception 'Foreign review accepted'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  begin perform public.begin_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.protocol_id')::uuid); raise exception 'Unreviewed indexing accepted'; exception when insufficient_privilege then null; end;
  begin update public.knowledge_documents set source_text='Service replacement' where id=current_setting('test.protocol_id')::uuid; raise exception 'Original mutable through service'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.vector',('[1,'||repeat('0,',766)||'0]'),true);
insert into public.knowledge_chunks(document_id,user_id,content,embedding) values(current_setting('test.protocol_id')::uuid,'81000000-0000-4000-8000-000000000001','Unreviewed chunk',current_setting('test.vector')::public.vector);
do $$ begin
  assert (select count(*) from public.match_knowledge('81000000-0000-4000-8000-000000000001',current_setting('test.vector')::public.vector))=0,'Unreviewed text used by assistant';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select public.review_knowledge_source(current_setting('test.protocol_id')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.protocol_id')::uuid);
select public.finish_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.protocol_id')::uuid,1,jsonb_build_array(jsonb_build_object('content','Preserved original synthetic protocol content.','embedding',current_setting('test.vector')::jsonb)));
do $$ begin
  assert (select count(*) from public.match_knowledge('81000000-0000-4000-8000-000000000001',current_setting('test.vector')::public.vector))=1,'Reviewed ready source unavailable';
  assert (select reviewed_by='81000000-0000-4000-8000-000000000001' and reviewed_at is not null from public.knowledge_documents where id=current_setting('test.protocol_id')::uuid),'Review identity/date absent';
  assert (select count(*) from public.knowledge_chunks where document_id=current_setting('test.protocol_id')::uuid)=1,'Retry duplicated old chunks';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select public.review_knowledge_source(current_setting('test.protocol_id')::uuid,false);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  assert (select count(*) from public.match_knowledge('81000000-0000-4000-8000-000000000001',current_setting('test.vector')::public.vector))=0,'Retired source remains retrievable';
  assert (select source_text from public.knowledge_documents where id=current_setting('test.protocol_id')::uuid)='Preserved original synthetic protocol content.','Retirement lost original';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('test.next_protocol_id',public.create_knowledge_source('Synthetic protocol','Next preserved synthetic protocol version.','Synthetic source','v2',current_setting('test.protocol_id')::uuid)::text,true);
select public.review_knowledge_source(current_setting('test.next_protocol_id')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.next_protocol_id')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select public.review_knowledge_source(current_setting('test.next_protocol_id')::uuid,false);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  begin perform public.finish_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.next_protocol_id')::uuid,1,jsonb_build_array(jsonb_build_object('content','Next preserved synthetic protocol version.','embedding',current_setting('test.vector')::jsonb))); raise exception 'Late index restored retired source'; exception when insufficient_privilege then null; end;
end $$;
select public.finish_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.next_protocol_id')::uuid,1,'[]'::jsonb,true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select public.review_knowledge_source(current_setting('test.next_protocol_id')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.next_protocol_id')::uuid);
do $$ begin
  begin perform public.finish_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.next_protocol_id')::uuid,1,'[]'::jsonb,true); raise exception 'Stale retry lease accepted'; exception when serialization_failure then null; end;
end $$;
select public.finish_knowledge_index('81000000-0000-4000-8000-000000000001',current_setting('test.next_protocol_id')::uuid,2,jsonb_build_array(jsonb_build_object('content','Next preserved synthetic protocol version.','embedding',current_setting('test.vector')::jsonb)));
do $$ begin
  assert (select review_status from public.knowledge_documents where id=current_setting('test.protocol_id')::uuid)='retired','Superseded source active';
  assert (select count(*) from public.knowledge_review_events where user_id='81000000-0000-4000-8000-000000000001')=6,'Review audit missing';
  assert (select count(*) from public.match_knowledge('81000000-0000-4000-8000-000000000001',current_setting('test.vector')::public.vector))=1,'Version replacement did not produce one active source';
end $$;
reset role;
rollback;
