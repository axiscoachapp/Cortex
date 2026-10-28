begin;
insert into auth.users(id,email) values ('95000000-0000-4000-8000-000000000001','completion-owner@example.invalid');
insert into public.patients(id,user_id,name,status) values ('95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000001','Pessoa sintética','novo');
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time) values
 ('95000000-0000-4000-8000-000000000021','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','Vínculo explícito',now(),now()+interval '1 hour'),
 ('95000000-0000-4000-8000-000000000022','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','Outro atendimento',now()+interval '2 hours',now()+interval '3 hours');
insert into public.consultations(id,user_id,patient_id,appointment_id,soap_note,created_at) values
 ('95000000-0000-4000-8000-000000000031','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000021','Texto já salvo','2026-10-29T01:00:00Z');
create function pg_temp.fail_metadata_write() returns trigger language plpgsql as $$ begin raise exception 'Synthetic metadata outage'; end $$;
create trigger test_metadata_outage before update on public.patients for each row execute function pg_temp.fail_metadata_write();
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
 begin
  perform public.complete_consultation_metadata('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000031');
  raise exception 'Outage was silently ignored';
 exception when raise_exception then if sqlerrm<>'Synthetic metadata outage' then raise; end if; end;
 assert (select count(*)=1 from public.consultations where id='95000000-0000-4000-8000-000000000031'),'Metadata failure lost durable approved note';
 assert (select last_visit is null from public.patients where id='95000000-0000-4000-8000-000000000011'),'Failed metadata partially updated patient';
 assert (select status='agendado' from public.appointments where id='95000000-0000-4000-8000-000000000021'),'Failed metadata partially completed appointment';
end $$;
reset role;
drop trigger test_metadata_outage on public.patients;
set local role service_role;
select public.complete_consultation_metadata('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000031');
select public.complete_consultation_metadata('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000031');
do $$ begin
 assert (select last_visit='2026-10-28' and status='retorno' and revision=1 from public.patients where id='95000000-0000-4000-8000-000000000011'),'Retry failed clinic-date repair or changed patient twice';
 assert (select status='realizado' from public.appointments where id='95000000-0000-4000-8000-000000000021'),'Linked appointment not repaired';
 assert (select status='agendado' from public.appointments where id='95000000-0000-4000-8000-000000000022'),'Unrelated appointment completed';
end $$;
insert into public.consultations(id,user_id,patient_id,soap_note,created_at) values
 ('95000000-0000-4000-8000-000000000032','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','Registro mais recente','2026-10-30T12:00:00Z');
select public.complete_consultation_metadata('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000032');
select public.complete_consultation_metadata('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000011','95000000-0000-4000-8000-000000000031');
do $$ begin assert (select last_visit='2026-10-30' and revision=2 from public.patients where id='95000000-0000-4000-8000-000000000011'),'Old retry regressed latest visit'; end $$;
rollback;
