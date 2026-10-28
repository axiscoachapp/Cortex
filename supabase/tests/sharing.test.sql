begin;
insert into auth.users(id,email) values
 ('70000000-0000-4000-8000-000000000001','sharing-owner@example.invalid'),
 ('70000000-0000-4000-8000-000000000002','sharing-recipient@example.invalid'),
 ('70000000-0000-4000-8000-000000000003','sharing-outsider@example.invalid');
insert into public.patients(id,user_id,name,age,last_visit,status) values
 ('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','Synthetic shared',40,'2026-10-28','novo'),
 ('71000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001','Synthetic private',41,'2026-10-28','novo');
insert into public.consultations(patient_id,user_id,soap_note) values('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','Original approved note');
insert into public.patient_files(id,patient_id,user_id,file_name,storage_path) values('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','synthetic.pdf','patients/70000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000001/synthetic.pdf');
insert into public.clinical_work_items(user_id,patient_id,kind,title,content,status,details) values
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','observation','Shared observation','Physician-entered measurement','open','{"date":"2026-10-28","value":"120","unit":"mmHg","source":"Consultation observation"}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','pregnancy','Shared pregnancy','Physician confirmed episode','open','{"date":"2027-04-02","source":"Confirmed ultrasound"}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','medication','Shared medication','Approved physician instructions','approved','{"date":"2026-10-28","state":"active","source":"Reconciled by physician"}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','instruction','Shared instructions','Approved patient instructions','approved','{}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','intake','Shared approved intake','Approved physician-entered intake','approved','{}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','task','PRIVATE task','Private workflow task','done','{}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','draft','PRIVATE draft','Private unfinished encounter','draft','{}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','medication','PRIVATE medication','Unapproved reconciliation','open','{"date":"2026-10-28","state":"changed"}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','instruction','PRIVATE instructions','Unapproved instructions','draft','{}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','intake','PRIVATE intake','Unapproved intake','open','{}'),
 ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','observation','PRIVATE other patient','Another patient observation','open','{"date":"2026-10-28","value":"1","unit":"cm"}');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select set_config('test.clinic_id',public.create_clinic('Synthetic clinic')::text,true);
select public.invite_clinic_doctor(current_setting('test.clinic_id')::uuid,'sharing-recipient@example.invalid');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select public.respond_clinic_invitation(current_setting('test.clinic_id')::uuid,true);
do $$ begin
  assert (select count(*) from public.patients)=0,'Membership reveals private charts';
  begin perform public.get_shared_patient_chart('71000000-0000-4000-8000-000000000001'); raise exception 'Membership bypassed grant'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select set_config('test.share_id',public.grant_patient_share('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','read')::text,true);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
do $$ declare chart jsonb; begin
  chart:=public.get_shared_patient_chart('71000000-0000-4000-8000-000000000001');
  assert chart->'patient'->>'name'='Synthetic shared','Shared chart unavailable';
  assert chart->'consultations'->0->>'soap_note'='Original approved note','Source note missing';
  assert (select count(*) from public.consultations)=0,'Legacy owner RLS widened';
  assert (select count(*) from public.clinical_work_items)=0,'Owner structured history RLS widened';
  assert jsonb_array_length(chart->'structured_history')=5,'Shared structured history missing or private draft/task leaked';
  assert chart->>'structured_history_count'='5','Structured history count incorrect';
  assert not exists(select 1 from jsonb_array_elements(chart->'structured_history') entry where entry->>'title' like 'PRIVATE%'),'Private work leaked through shared chart';
  assert not exists(select 1 from jsonb_array_elements(chart->'structured_history') entry where entry->>'author_user_id'<>'70000000-0000-4000-8000-000000000001'),'Structured author attribution incorrect';
  assert jsonb_array_length(public.get_shared_patient_chart('71000000-0000-4000-8000-000000000001',2)->'structured_history')=2,'Structured history limit not bounded';
  begin perform public.get_shared_patient_chart('71000000-0000-4000-8000-000000000002'); raise exception 'Private patient exposed'; exception when insufficient_privilege then null; end;
  begin perform public.append_shared_chart_entry('71000000-0000-4000-8000-000000000001',1,'encounter','Unauthorised'); raise exception 'Read grant wrote entry'; exception when insufficient_privilege then null; end;
  begin perform public.revoke_patient_share(current_setting('test.share_id')::uuid); raise exception 'Recipient reshared/revoked'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  begin perform public.authorize_shared_file('70000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001',true); raise exception 'Read permission implied download'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000003',true);
do $$ begin
  begin perform public.get_shared_patient_chart('71000000-0000-4000-8000-000000000001'); raise exception 'Outsider chart access'; exception when insufficient_privilege then null; end;
  begin perform public.invite_clinic_doctor(current_setting('test.clinic_id')::uuid,'sharing-outsider@example.invalid'); raise exception 'Outsider invited member'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select public.grant_patient_share('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','contribute',true);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select public.append_shared_chart_entry('71000000-0000-4000-8000-000000000001',2,'addendum','Attributable contribution','73000000-0000-4000-8000-000000000001');
select public.append_shared_chart_entry('71000000-0000-4000-8000-000000000001',2,'addendum','Attributable contribution','73000000-0000-4000-8000-000000000001');
do $$ begin
  begin update public.shared_chart_entries set content='overwrite'; raise exception 'Entry mutable'; exception when insufficient_privilege then null; end;
  begin perform public.append_shared_chart_entry('71000000-0000-4000-8000-000000000001',1,'encounter','Stale'); raise exception 'Stale authorization accepted'; exception when serialization_failure then null; end;
  begin perform public.append_shared_chart_entry('71000000-0000-4000-8000-000000000001',null,'encounter','Missing version'); raise exception 'Missing authorization revision accepted'; exception when serialization_failure then null; end;
  begin perform public.append_shared_chart_entry('71000000-0000-4000-8000-000000000001',2,'addendum','Different content','73000000-0000-4000-8000-000000000001'); raise exception 'Request ID content overwritten'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
  assert (select author_user_id=actor_user_id and author_user_id='70000000-0000-4000-8000-000000000002' and owner_user_id='70000000-0000-4000-8000-000000000001' from public.shared_chart_entries),'Author/actor/owner collapsed';
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.authorize_shared_file('70000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001',true);
do $$ begin
  begin perform public.assert_deletion_scope('70000000-0000-4000-8000-000000000001'); raise exception 'Shared owner custody erased'; exception when sqlstate 'P4091' then null; end;
  begin perform public.assert_deletion_scope('70000000-0000-4000-8000-000000000002'); raise exception 'Contributor custody erased'; exception when sqlstate 'P4091' then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select public.revoke_patient_share(current_setting('test.share_id')::uuid);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.get_shared_patient_chart('71000000-0000-4000-8000-000000000001'); raise exception 'Revoked chart access'; exception when insufficient_privilege then null; end;
  begin perform public.append_shared_chart_entry('71000000-0000-4000-8000-000000000001',2,'encounter','Delayed stale job'); raise exception 'Revoked delayed write'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  begin perform public.authorize_shared_file('70000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001',true); raise exception 'Revoked file download'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select public.grant_patient_share('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','contribute');
reset role;
update public.patient_shares set expires_at=now()-interval '1 minute' where id=current_setting('test.share_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.check_shared_patient_access('71000000-0000-4000-8000-000000000001'); raise exception 'Expired chart access'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select public.grant_patient_share('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','contribute');
select public.offboard_clinic_doctor(current_setting('test.clinic_id')::uuid,'70000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
do $$ begin
  assert jsonb_array_length(public.sharing_overview()->'received')=0,'Inactive member retains chart';
  begin perform public.get_shared_patient_chart('71000000-0000-4000-8000-000000000001'); raise exception 'Offboarded chart access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.shared_chart_entries)=1,'Offboarding deleted contribution';
  assert exists(select 1 from public.chart_access_audit where action='file_delivery_authorized'),'Download audit missing';
end $$;
do $$ begin
  begin delete from auth.users where id='70000000-0000-4000-8000-000000000002'; raise exception 'Direct account delete erased custody'; exception when sqlstate 'P4091' then null; end;
end $$;
rollback;
