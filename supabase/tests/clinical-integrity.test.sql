begin;
insert into auth.users(id,email) values ('91000000-0000-4000-8000-000000000001','clinical-integrity@example.invalid');
insert into public.patients(id,user_id,name,age,last_visit,status) values
 ('91000000-0000-4000-8000-000000000011','91000000-0000-4000-8000-000000000001','Pessoa sintética',null,null,'novo');
insert into public.patient_files(id,patient_id,user_id,file_name,storage_path,mime_type,size_bytes) values
 ('91000000-0000-4000-8000-000000000021','91000000-0000-4000-8000-000000000011','91000000-0000-4000-8000-000000000001','Fonte sintética','patients/91000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000011/source.pdf','application/pdf',1);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.save_document_review('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000021','Resumo não revisado','Proposta não revisada');
do $$ begin
 assert (select coalesce(clinical_notes,'')='' from public.patients where id='91000000-0000-4000-8000-000000000011'),'AI analysis silently changed the chart';
 assert (select ai_review_status='pending' and ai_profile_proposal='Proposta não revisada' from public.patient_files where id='91000000-0000-4000-8000-000000000021'),'Pending source proposal missing';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin
  perform public.review_document_proposal('91000000-0000-4000-8000-000000000021',99,'Texto aprovado',true);
  raise exception 'Stale acceptance succeeded';
 exception when serialization_failure then null; end;
 assert (select ai_review_status='pending' from public.patient_files where id='91000000-0000-4000-8000-000000000021'),'Conflict consumed proposal';
end $$;
select public.review_document_proposal('91000000-0000-4000-8000-000000000021',0,'Texto corrigido e aprovado',true);
do $$ begin
 assert (select clinical_notes like '%Texto corrigido e aprovado%' and clinical_notes not like '%Proposta não revisada%' from public.patients where id='91000000-0000-4000-8000-000000000011'),'Accepted exact text not preserved';
 assert (select ai_review_status='accepted' from public.patient_files where id='91000000-0000-4000-8000-000000000021'),'Acceptance state missing';
end $$;
reset role;
insert into public.consultations(id,user_id,patient_id,soap_note,created_at)
 select gen_random_uuid(),'91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000011','Rotina sintética',now() - n * interval '1 day' from generate_series(1,20) n;
insert into public.consultations(id,user_id,patient_id,soap_note,created_at) values
 ('91000000-0000-4000-8000-000000000031','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000011',repeat('Contexto sintético ',1000)||'Resultado PSA sintético antigo',now()-interval '1 year');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare result jsonb; begin
 result:=public.retrieve_patient_context('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000011','PSA');
 -- 20261111100000: the relevant old encounter is kept (ranked by any matching word), the list is
 -- ordered by date, the four most recent always come whole, and the rest is announced as an index.
 assert exists(select 1 from jsonb_array_elements(result->'consultations') c where c->>'id'='91000000-0000-4000-8000-000000000031'
   and c->>'soap_note' like '%PSA%' and (c->>'truncated')::boolean),'Relevant old encounter excluded by recency, or its matched evidence lost outside the beginning of the note';
 assert result->'consultations'->-1->>'id'='91000000-0000-4000-8000-000000000031','Consultations not ordered most recent first';
 assert jsonb_array_length(result->'consultations')=12 and jsonb_array_length(result->'index')=9,'Selected plus indexed consultations do not cover the chart';
 assert (select bool_and(c->>'soap_note'='Rotina sintética' and not (c->>'truncated')::boolean) from jsonb_array_elements(result->'consultations') c
   where c->>'id'<>'91000000-0000-4000-8000-000000000031'),'A short note was cut or marked as truncated';
 assert (result->'coverage'->>'consultationsTotal')::integer=21,'Total search coverage not exposed';
 assert (result->'coverage'->>'limited')::boolean,'Bounded excerpts presented as complete chart';
 -- A natural question (several words, not all present in one note) still finds the encounter.
 result:=public.retrieve_patient_context('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000011','Qual foi o resultado do PSA no ano passado?');
 assert exists(select 1 from jsonb_array_elements(result->'consultations') c where c->>'id'='91000000-0000-4000-8000-000000000031'),'A multi-word question lost the matching encounter';
 -- Only stop words: no query, the most recent ones come and nothing fails.
 result:=public.retrieve_patient_context('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000011','e o que foi?');
 assert jsonb_array_length(result->'consultations')=12,'Question without search terms returned nothing';
end $$;
rollback;
