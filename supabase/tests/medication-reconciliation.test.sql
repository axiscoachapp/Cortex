begin;
insert into auth.users(id,email) values ('94000000-0000-4000-8000-000000000001','medication-owner@example.invalid');
insert into public.patients(id,user_id,name,status,medications) values
 ('94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','Pessoa sintética','novo','[{"name":"Medicamento A","dosage":"dose anterior","instructions":"Anterior","startedAt":"2026-01-01"},{"name":"Medicamento B","dosage":"preservada","instructions":"Preservada"}]');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
insert into public.clinical_work_items(id,user_id,patient_id,kind,title,content,details) values
 ('94000000-0000-4000-8000-000000000021',auth.uid(),'94000000-0000-4000-8000-000000000011','medication',' medicamento a ','Instrução exata revisada','{"dosage":"dose revisada","state":"changed","date":"2026-10-28"}');
do $$ begin
 begin perform public.approve_medication_reconciliation('94000000-0000-4000-8000-000000000021',null,0);raise exception 'Null source revision accepted';exception when serialization_failure then null;end;
 begin perform public.approve_medication_reconciliation('94000000-0000-4000-8000-000000000021',0,99);raise exception 'Stale patient accepted';exception when serialization_failure then null;end;
end $$;
select public.approve_medication_reconciliation('94000000-0000-4000-8000-000000000021',0,0);
select public.approve_medication_reconciliation('94000000-0000-4000-8000-000000000021',0,0);
do $$ begin
 assert (select revision=1 and jsonb_array_length(medications)=2 and medications->0->>'dosage'='dose revisada' and medications->0->>'instructions'='Instrução exata revisada' and medications->0->>'startedAt'='2026-01-01' and medications->1->>'dosage'='preservada' from public.patients where id='94000000-0000-4000-8000-000000000011'),'Reconciliation changed unrelated medication or ignored exact dose/instructions/start date';
 begin update public.clinical_work_items set status='open' where id='94000000-0000-4000-8000-000000000021';raise exception 'Approved medication unlocked';exception when raise_exception then if sqlerrm='Approved medication unlocked' then raise;end if;end;
end $$;
insert into public.clinical_work_items(id,user_id,patient_id,kind,title,content,details) values
 ('94000000-0000-4000-8000-000000000022',auth.uid(),'94000000-0000-4000-8000-000000000011','medication','Medicamento A','Suspensão explicitamente revisada','{"state":"stopped","date":"2026-10-28","previousVersionId":"94000000-0000-4000-8000-000000000021"}');
select public.approve_medication_reconciliation('94000000-0000-4000-8000-000000000022',0,1);
do $$ begin
 assert (select jsonb_array_length(medications)=1 and medications->0->>'name'='Medicamento B' from public.patients where id='94000000-0000-4000-8000-000000000011'),'Stopping medication failed or removed another medicine';
 assert (select count(*)=2 from public.clinical_work_items where status='approved'),'Lifecycle entries lost';
end $$;
rollback;
