begin;
insert into auth.users(id,email) values('e0000000-0000-4000-8000-000000000001','chat-owner@example.invalid'),('e0000000-0000-4000-8000-000000000002','chat-other@example.invalid');
insert into public.patients(id,user_id,name,status,age) values('e1000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','Synthetic chat patient','novo',0);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
  result:=public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Question to preserve');
  assert result->>'state'='started','Turn not claimed';
  result:=public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Question to preserve');
  assert result->>'state'='pending','Concurrent retry could repeat paid generation';
  assert public.finish_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','{"message":"Exact preserved answer","sources":[],"credits":3}');
  result:=public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Question to preserve');
  assert result->>'state'='complete' and result#>>'{response,message}'='Exact preserved answer' and result#>>'{response,credits}'='0','Ambiguous successful retry not recovered without charge';
  begin
    perform public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Different question');
    raise exception 'Turn identity reused for different content';
  exception when unique_violation then null; end;
  begin
    perform public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','Foreign request');
    raise exception 'Foreign conversation created';
  exception when insufficient_privilege then null; end;
  assert public.build_data_export_manifest('e0000000-0000-4000-8000-000000000001')#>>'{tables,patient_chat_turns,0,question}'='Question to preserve','Conversation omitted from consistent export';
  perform public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000009','Prepaid retry');
  assert public.finish_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000009',null,p_retryable=>true);
  result:=public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000009','Prepaid retry');
  assert result->>'state'='started','Prepaid failure could not be retried';
  assert public.finish_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000009',null);
  result:=public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000009','Prepaid retry');
  assert result->>'state'='failed','Same ID reopened after possible paid work';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
  result:=public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001');
  assert exists(select 1 from jsonb_array_elements(result) row where row->'response'->>'message'='Exact preserved answer'),'Own conversation not recovered';
  begin perform * from public.patient_chat_turns; raise exception 'Raw conversation storage exposed'; exception when insufficient_privilege then null; end;
  begin perform public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',gen_random_uuid(),'Forged assistant turn'); raise exception 'Client could forge assistant provenance'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001'); raise exception 'Foreign conversation leaked'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
select set_config('test.chat_protocol',public.create_knowledge_source('Chat protocol','Synthetic original protocol source for conversation tests.','Synthetic society','v1')::text,true);
select public.review_knowledge_source(current_setting('test.chat_protocol')::uuid,true);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_knowledge_index('e0000000-0000-4000-8000-000000000001',current_setting('test.chat_protocol')::uuid);
select public.finish_knowledge_index('e0000000-0000-4000-8000-000000000001',current_setting('test.chat_protocol')::uuid,1,jsonb_build_array(jsonb_build_object('content','Synthetic protocol excerpt','embedding',('[1,'||repeat('0,',766)||'0]')::jsonb)));
do $$ declare revision integer; reply jsonb; begin
  select review_revision into revision from public.knowledge_documents where id=current_setting('test.chat_protocol')::uuid;
  reply:=jsonb_build_object('message','PROTOCOL_DERIVED_SECRET','sources',jsonb_build_array(jsonb_build_object('id',current_setting('test.chat_protocol'),'type','knowledge','label','Protocol','date','2026-11-03','excerpt','SECRET_EXCERPT','authorizationRevision',0,'sourceReviewRevision',revision)));
  perform public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','Protocol question');
  assert public.finish_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002',reply);
  assert position('PROTOCOL_DERIVED_SECRET' in (public.build_data_export_manifest('e0000000-0000-4000-8000-000000000001')#>'{tables,patient_chat_turns}')::text)=0,'Export snapshot retained grant-dependent text';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
do $$ begin
  assert position('PROTOCOL_DERIVED_SECRET' in public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001')::text)>0,'Currently authorized source response missing';
end $$;
select public.review_knowledge_source(current_setting('test.chat_protocol')::uuid,false);
do $$ begin
  assert position('PROTOCOL_DERIVED_SECRET' in public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001')::text)=0,'Retired source revived through conversation history';
  assert position('SECRET_EXCERPT' in public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001')::text)=0,'Retired source excerpt leaked';
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  -- Page through more rows than one application page, including equal timestamps.
  insert into public.patient_chat_turns(id,user_id,patient_id,question,status)
    select ('e3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Synthetic question '||n,'failed' from generate_series(1,120)n;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
do $$ declare page1 jsonb; page2 jsonb; page3 jsonb; begin
  page1:=public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001',null,50);
  page2:=public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001',(page1->49->>'id')::uuid,50);
  page3:=public.list_patient_chat_turns('e1000000-0000-4000-8000-000000000001',(page2->49->>'id')::uuid,50);
  assert jsonb_array_length(page1)+jsonb_array_length(page2)+jsonb_array_length(page3)=123,'Keyset pagination lost or repeated turns';
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
update public.patients set deletion_requested_at=now() where id='e1000000-0000-4000-8000-000000000001';
do $$ begin
  begin perform public.begin_patient_chat_turn('e0000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',gen_random_uuid(),'Late write'); raise exception 'Chat bypassed deletion intent'; exception when insufficient_privilege then null; end;
end $$;
rollback;
