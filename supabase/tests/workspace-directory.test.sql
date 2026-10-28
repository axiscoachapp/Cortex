begin;
insert into auth.users(id,email) values('c0000000-0000-4000-8000-000000000001','directory-owner@example.invalid'),('c0000000-0000-4000-8000-000000000002','directory-other@example.invalid');
insert into public.patients(id,user_id,name,age,last_visit,status,phone,email,clinical_notes)
 select ('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c0000000-0000-4000-8000-000000000001','Synthetic '||lpad(n::text,3,'0'),null,null,'novo','0000000000','synthetic@example.invalid','Must not transfer chart text'
 from generate_series(1,250)n;
insert into public.patients(user_id,name,age,last_visit,status) values('c0000000-0000-4000-8000-000000000002','Foreign private patient',null,null,'novo');
insert into public.appointments(user_id,patient_id,title,start_time,end_time,status)
 select 'c0000000-0000-4000-8000-000000000001',id,'Synthetic appointment',now(),now()+interval '30 minutes','agendado' from public.patients where user_id='c0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
 result:=public.workspace_directory(1);
 assert result->'counts'->>'total'='250','Counts incorrectly reflect first page';
 assert jsonb_array_length(result->'patients')<=206,'Directory response unbounded';
 assert not exists(select 1 from jsonb_array_elements(result->'patients')p where p ? 'clinical_notes'),'Full chart leaked into directory';
 assert not exists(select 1 from jsonb_array_elements(result->'patients')p where p->>'name'='Foreign private patient'),'Foreign directory row exposed';
 assert (result->'patients'->0) ? 'phone','Reminder contact omitted';
end $$;
rollback;
