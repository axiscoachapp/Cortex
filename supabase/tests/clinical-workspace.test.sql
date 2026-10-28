begin;
insert into auth.users(id,email) values('a0000000-0000-4000-8000-000000000001','manual-owner@example.invalid'),('a0000000-0000-4000-8000-000000000002','manual-other@example.invalid');
insert into public.patients(id,user_id,name,age,last_visit,status) values('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Synthetic manual patient',null,null,'novo');
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,status) values
('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Synthetic morning',now(),now()+interval '30 minutes','agendado'),
('a2000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Synthetic later',now()+interval '2 hours',now()+interval '3 hours','agendado');
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
insert into public.clinical_work_items(id,user_id,patient_id,kind,title,content,details,status) values
('a3000000-0000-4000-8000-000000000001',auth.uid(),'a1000000-0000-4000-8000-000000000001','draft','Reviewed encounter','Exactly reviewed physician text','{"appointmentId":"a2000000-0000-4000-8000-000000000001"}','draft');
do $$ begin
  begin perform public.finalize_manual_encounter('a3000000-0000-4000-8000-000000000001',9);raise exception 'Stale draft approved';exception when serialization_failure then null;end;
end $$;
select public.finalize_manual_encounter('a3000000-0000-4000-8000-000000000001',0);
select public.finalize_manual_encounter('a3000000-0000-4000-8000-000000000001',0);
do $$ begin
  assert (select count(*) from public.consultations where patient_id='a1000000-0000-4000-8000-000000000001')=1,'Duplicate manual encounter';
  assert (select soap_note from public.consultations where patient_id='a1000000-0000-4000-8000-000000000001')='Exactly reviewed physician text','Reviewed text changed';
  assert (select status from public.appointments where id='a2000000-0000-4000-8000-000000000001')='realizado','Linked visit not completed';
  assert (select status from public.appointments where id='a2000000-0000-4000-8000-000000000002')='agendado','Unrelated visit completed';
  begin update public.clinical_work_items set content='Changed final' where id='a3000000-0000-4000-8000-000000000001';raise exception 'Final text mutable';exception when raise_exception then if sqlerrm='Final text mutable' then raise;end if;end;
  begin update public.clinical_work_items set status='draft' where id='a3000000-0000-4000-8000-000000000001';raise exception 'Final status can be downgraded to unlock edits';exception when raise_exception then if sqlerrm='Final status can be downgraded to unlock edits' then raise;end if;end;
  assert exists(select 1 from public.clinical_work_revisions where item_id='a3000000-0000-4000-8000-000000000001' and snapshot->>'status'='draft'),'Manual prior version not retained';
  begin
    insert into public.clinical_work_items(user_id,patient_id,kind,title,content,status) values(auth.uid(),'a1000000-0000-4000-8000-000000000001','draft','Forged completion','Text','done');
    raise exception 'Client bypassed manual finalization';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.clinical_work_items(user_id,patient_id,kind,title,details) values(auth.uid(),'a1000000-0000-4000-8000-000000000001','observation','Invalid measurement','{"value":"62","unit":"kg","date":"2026-02-31"}');
    raise exception 'Invalid clinical date accepted';
  exception when check_violation then null; end;
end $$;
insert into public.clinical_work_items(id,user_id,patient_id,kind,title,details) values
 ('a3000000-0000-4000-8000-000000000003',auth.uid(),'a1000000-0000-4000-8000-000000000001','observation','Peso','{"value":"60","unit":"kg","date":"2026-10-28"}');
update public.clinical_work_items set details='{"value":"62","unit":"kg","date":"2026-10-28"}' where id='a3000000-0000-4000-8000-000000000003';
insert into public.clinical_work_items(id,user_id,patient_id,kind,title,content,status) values
 ('a3000000-0000-4000-8000-000000000004',auth.uid(),'a1000000-0000-4000-8000-000000000001','instruction','Orientações','Texto aprovado imutável','approved');
insert into public.clinical_work_items(user_id,patient_id,kind,title,content,details,status) values
 (auth.uid(),'a1000000-0000-4000-8000-000000000001','instruction','Orientações nova versão','Novo texto em revisão','{"previousVersionId":"a3000000-0000-4000-8000-000000000004","versionNumber":"2"}','draft');
do $$ begin
 assert exists(select 1 from public.clinical_work_revisions where item_id='a3000000-0000-4000-8000-000000000003' and snapshot->'details'->>'value'='60'),'Observation correction destroyed original value';
 begin update public.clinical_work_items set status='draft' where id='a3000000-0000-4000-8000-000000000004';raise exception 'Approved instruction unlocked';exception when raise_exception then if sqlerrm='Approved instruction unlocked' then raise;end if;end;
 assert (select content from public.clinical_work_items where id='a3000000-0000-4000-8000-000000000004')='Texto aprovado imutável','Version creation changed approved text';
end $$;
select public.update_user_settings('{"specialty":"urologia"}');
select public.update_user_settings('{"specialty":"prenatal"}');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
do $$ begin
  assert (select count(*) from public.clinical_work_items)=0,'Foreign work exposed';
  begin insert into public.clinical_work_items(user_id,patient_id,kind,title) values(auth.uid(),'a1000000-0000-4000-8000-000000000001','task','Foreign task');raise exception 'Foreign patient relationship accepted';exception when insufficient_privilege then null;end;
  begin perform public.finalize_manual_encounter('a3000000-0000-4000-8000-000000000001',0);raise exception 'Foreign draft approved';exception when raise_exception then if sqlerrm='Foreign draft approved' then raise;end if;end;
end $$;
rollback;
