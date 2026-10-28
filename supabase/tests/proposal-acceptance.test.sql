begin;
insert into auth.users(id,email) values
 ('92000000-0000-4000-8000-000000000001','proposal-owner@example.invalid'),('92000000-0000-4000-8000-000000000002','proposal-outsider@example.invalid');
insert into public.patients(id,user_id,name,age,last_visit,status,medical_history) values
 ('92000000-0000-4000-8000-000000000011','92000000-0000-4000-8000-000000000001','Pessoa sintética',null,null,'novo','Histórico existente');
insert into public.consultations(id,user_id,patient_id,soap_note,history_proposals) values
 ('92000000-0000-4000-8000-000000000021','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011','SOAP aprovado','{"sourceConsultationId":"92000000-0000-4000-8000-000000000021","medicalHistory":["Sugestão não aprovada"],"socialAnamnesis":[]}');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  perform public.review_history_proposal('92000000-0000-4000-8000-000000000021',0,0,'Tentativa de estranho','',true);
  raise exception 'Outsider accepted a proposal';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin
  perform public.review_history_proposal('92000000-0000-4000-8000-000000000021',99,0,'Texto corrigido','',true);
  raise exception 'Stale patient accepted a proposal';
 exception when serialization_failure then null; end;
 begin
  perform public.review_history_proposal('92000000-0000-4000-8000-000000000021',0,99,'Texto corrigido','',true);
  raise exception 'Stale source accepted a proposal';
 exception when serialization_failure then null; end;
end $$;
select public.review_history_proposal('92000000-0000-4000-8000-000000000021',0,0,'Texto corrigido','',true);
select public.review_history_proposal('92000000-0000-4000-8000-000000000021',0,0,'Texto corrigido','',true);
do $$ begin
 assert (select revision=1 and medical_history like 'Histórico existente%Texto corrigido' and medical_history not like '%Sugestão não aprovada%' from public.patients where id='92000000-0000-4000-8000-000000000011'),'Exact accepted text or idempotence violated';
 assert (select (history_proposals->'review'->>'accepted')::boolean from public.consultations where id='92000000-0000-4000-8000-000000000021'),'Decision receipt missing';
 begin
  perform public.review_history_proposal('92000000-0000-4000-8000-000000000021',1,1,'Texto diferente','',true);
  raise exception 'Conflicting replay changed accepted text';
 exception when serialization_failure then null; end;
end $$;
reset role;
insert into public.patient_files(id,user_id,patient_id,file_name,storage_path,ai_summary,ai_profile_proposal) values
 ('92000000-0000-4000-8000-000000000031','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011','Fonte rejeitada','patients/92000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000011/rejected.pdf','FATO REJEITADO NÃO USAR','FATO REJEITADO NÃO USAR');
set local role authenticated;
select public.review_document_proposal('92000000-0000-4000-8000-000000000031',1,'',false);
select public.review_document_proposal('92000000-0000-4000-8000-000000000031',1,'',false);
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare context jsonb; begin
 context:=public.retrieve_patient_context('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011','FATO');
 assert (context->'documents'->0->>'ai_summary')='','Rejected AI claims leaked into assistant context';
 assert (select coalesce(clinical_notes,'')='' from public.patients where id='92000000-0000-4000-8000-000000000011'),'Rejection changed clinical notes';
end $$;
rollback;
