-- Synthetic account/patient custody, marker lifecycle, and actual cascades.
begin;
create function pg_temp.refused(command text,states text[]) returns boolean language plpgsql as $$
begin
 execute command;
 raise exception 'Statement unexpectedly succeeded' using errcode='PT001';
exception when sqlstate 'PT001' then return false;
when others then if sqlstate=any(states) then return true;end if;raise;
end $$;
insert into auth.users(id,email) values
 ('b9100000-0000-4000-8000-000000000001','barrier-admin@example.invalid'),
 ('b9100000-0000-4000-8000-000000000002','barrier-owner@example.invalid'),
 ('b9100000-0000-4000-8000-000000000003','barrier-author@example.invalid'),
 ('b9100000-0000-4000-8000-000000000004','barrier-actor@example.invalid'),
 ('b9100000-0000-4000-8000-000000000005','barrier-solo@example.invalid'),
 ('b9100000-0000-4000-8000-000000000006','barrier-patient-owner@example.invalid'),
 ('b9100000-0000-4000-8000-000000000007','barrier-deleting@example.invalid');
insert into public.clinics(id,name,created_by) values('b9200000-0000-4000-8000-000000000001','Clínica sintética barreira','b9100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','admin','active'),
 ('b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000006','doctor','active');
insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values('b9300000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','Contato sintético','b9100000-0000-4000-8000-000000000001',gen_random_uuid());
insert into public.patients(id,user_id,name,status) values
 ('b9500000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000002','Pessoa sintética compartilhada','novo'),
 ('b9500000-0000-4000-8000-000000000002','b9100000-0000-4000-8000-000000000005','Pessoa sintética particular','novo'),
 ('b9500000-0000-4000-8000-000000000003','b9100000-0000-4000-8000-000000000006','Pessoa sintética em exclusão','novo');
insert into public.shared_chart_entries(patient_id,owner_user_id,author_user_id,actor_user_id,author_name,entry_type,content)
 values('b9500000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000002','b9100000-0000-4000-8000-000000000003','b9100000-0000-4000-8000-000000000004','Autor sintético','addendum','Conteúdo sintético');
insert into public.account_deletion_requests(user_id,requested_at) values('b9100000-0000-4000-8000-000000000007','2001-01-01T00:00Z');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b9100000-0000-4000-8000-000000000005',true);
-- BEFORE stamps the actual actor, replacing supplied references to deleting user 7.
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,created_by,updated_by) values('b9600000-0000-4000-8000-000000000001',auth.uid(),'b9500000-0000-4000-8000-000000000002','Agenda particular sintética','2099-12-03T12:00Z','2099-12-03T12:30Z','b9100000-0000-4000-8000-000000000007','b9100000-0000-4000-8000-000000000007');
do $$ begin
 assert (select created_by=auth.uid() and updated_by=auth.uid() from public.appointments where id='b9600000-0000-4000-8000-000000000001'),'Final actor stamps were not used';
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
insert into public.account_deletion_requests(user_id) values('b9100000-0000-4000-8000-000000000005');
-- Observe actual INSERT + UPDATE order on the real upsert, immediately before
-- the real shared precheck. This test trigger disappears with the transaction.
create temporary table custody_probe(operation text,revision bigint);
create function pg_temp.observe_custody_epoch() returns trigger language plpgsql as $$
begin
 insert into pg_temp.custody_probe select tg_op,revision from cortex_private.custody_epoch;
 return new;
end $$;
create trigger s_custody_probe before insert or update on public.account_deletion_requests for each row execute function pg_temp.observe_custody_epoch();
select set_config('test.custody_epoch_before',(select revision::text from cortex_private.custody_epoch),true);
-- Repeated intent remains a valid resumable job.
insert into public.account_deletion_requests(user_id) values('b9100000-0000-4000-8000-000000000007') on conflict(user_id) do update set user_id=excluded.user_id,requested_at=excluded.requested_at;
do $$ declare names text[];begin
 select array_agg(tgname::text order by tgname) into names from pg_trigger where tgrelid='public.account_deletion_requests'::regclass and not tgisinternal;
 assert array_position(names,'lock_account_deletion')<array_position(names,'reception_custody_epoch')
  and array_position(names,'reception_custody_epoch')<array_position(names,'s_custody_probe')
  and array_position(names,'s_custody_probe')<array_position(names,'shared_custody_deletion_intent'),'Actual marker trigger order differs';
 assert (select array_agg(operation order by revision) from pg_temp.custody_probe)=array['INSERT','UPDATE'],'Upsert did not traverse both BEFORE paths';
 assert (select min(revision) from pg_temp.custody_probe)=current_setting('test.custody_epoch_before')::bigint+1
  and (select max(revision) from pg_temp.custody_probe)=current_setting('test.custody_epoch_before')::bigint+2,'Epoch was not advanced before each precheck';
 assert (select requested_at='2001-01-01T00:00Z'::timestamptz from public.account_deletion_requests where user_id='b9100000-0000-4000-8000-000000000007'),'Retry changed original intent date';
end $$;
drop trigger s_custody_probe on public.account_deletion_requests;
update public.patients set deletion_requested_at=now() where id='b9500000-0000-4000-8000-000000000003';
do $$ declare failures text[]:='{}'; r record;begin
 for r in select * from (values
 ('shared-actor-preflight',$q$select public.assert_deletion_scope('b9100000-0000-4000-8000-000000000004',null)$q$,array['P4091']),
 ('marker-delete',$q$delete from public.account_deletion_requests where user_id='b9100000-0000-4000-8000-000000000007'$q$,array['55000']),
 ('marker-retarget',$q$update public.account_deletion_requests set user_id='b9100000-0000-4000-8000-000000000006' where user_id='b9100000-0000-4000-8000-000000000007'$q$,array['55000']),
 ('actor-after-intent',$q$insert into public.clinic_contacts(clinic_id,name,created_by,request_id) values('b9200000-0000-4000-8000-000000000001','Outro contato sintético','b9100000-0000-4000-8000-000000000007',gen_random_uuid())$q$,array['55000']),
 ('audit-after-intent',$q$insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values('b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','synthetic_audit','b9600000-0000-4000-8000-000000000001')$q$,array['55000']),
 ('booking-after-intent',$q$insert into public.reception_booking_requests(clinic_id,actor_user_id,request_id,payload,appointment_id) values('b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001',gen_random_uuid(),'{}','b9600000-0000-4000-8000-000000000001')$q$,array['55000']),
 ('shared-actor-after-intent',$q$insert into public.shared_chart_entries(patient_id,owner_user_id,author_user_id,actor_user_id,author_name,entry_type,content) values('b9500000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000002','b9100000-0000-4000-8000-000000000003','b9100000-0000-4000-8000-000000000007','Autor sintético','addendum','Conteúdo sintético')$q$,array['55000']),
 ('patient-link-after-intent',$q$insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values('b9200000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000003','b9100000-0000-4000-8000-000000000006','self','b9100000-0000-4000-8000-000000000001')$q$,array['55000']),
 ('patient-intent-clear',$q$update public.patients set deletion_requested_at=null where id='b9500000-0000-4000-8000-000000000003'$q$,array['55000'])
 ) x(name,command,states) loop
  if not pg_temp.refused(r.command,r.states) then failures:=array_append(failures,r.name);end if;
 end loop;
 assert cardinality(failures)=0,'Custody barrier regression: '||array_to_string(failures,', ');
end $$;
-- Exercise SET NULL/cascade with a real private patient appointment, not just no-patient agenda.
delete from auth.users where id='b9100000-0000-4000-8000-000000000005';
delete from public.patients where id='b9500000-0000-4000-8000-000000000003';
do $$ begin
 assert not exists(select 1 from public.appointments where id='b9600000-0000-4000-8000-000000000001'),'Own calendar cascade failed';
 assert not exists(select 1 from public.account_deletion_requests where user_id='b9100000-0000-4000-8000-000000000005'),'Account intent did not cascade';
 assert (select count(*) from public.shared_chart_entries where actor_user_id='b9100000-0000-4000-8000-000000000004')=1,'Foreign clinical history changed';
 assert not has_table_privilege('service_role','public.account_deletion_requests','truncate'),'Marker truncate bypass';
 assert not has_schema_privilege('authenticated','cortex_private','usage') and not has_schema_privilege('service_role','cortex_private','usage'),'Epoch exposed to client';
end $$;
rollback;
