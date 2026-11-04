-- T28/2b/1: NULL is not evidence of clinic ownership, even with a clinic contact.
-- Keep the clinician's own unassigned agenda; never delegate that exception.
begin;
set local lock_timeout='2s';
create or replace function public.reception_appointments(p_clinic uuid,p_start timestamptz,p_end timestamptz,p_doctor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; blocks jsonb;
begin
 if not coalesce(public.reception_scope_ok(p_clinic,p_doctor),false) then raise exception 'Agenda não delegada' using errcode='42501'; end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start or p_end-p_start>interval '42 days' then raise exception 'Selecione um período de até 42 dias' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page."startTime",page.id),'[]') into items from (
  select a.id,a.user_id as "doctorId",a.patient_id as "patientId",a.contact_id as "contactId",a.reception_case_id as "caseId",
   coalesce(p.name,'Horário reservado') as "patientName",a.start_time as "startTime",a.end_time as "endTime",coalesce(a.type,'retorno') as type,
   coalesce(a.status,'agendado') as status,a.revision,a.checked_in_at as "checkedInAt",a.google_sync_status as "googleSyncStatus"
  from public.appointments a left join public.patients p on p.id=a.patient_id and p.user_id=a.user_id
  where a.end_time>p_start and a.start_time<p_end and (a.clinic_id=p_clinic or (a.clinic_id is null and a.user_id=auth.uid()))
  and (p_doctor is null or a.user_id=p_doctor) and public.reception_scope_ok(p_clinic,a.user_id)
  order by a.start_time,a.id limit 1001) page;
 if jsonb_array_length(items)>1000 then raise exception 'Muitos agendamentos. Reduza o período ou filtre um médico.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'doctorId',doctor_user_id,'startTime',start_time,'endTime',end_time,'reason',reason,'revision',revision) order by start_time,id),'[]') into blocks
 from public.reception_schedule_blocks where clinic_id=p_clinic and active and start_time<p_end and end_time>p_start and (p_doctor is null or doctor_user_id=p_doctor) and public.reception_scope_ok(p_clinic,doctor_user_id);
 return jsonb_build_object('items',items,'blocks',blocks);
end $$;
revoke all on function public.reception_appointments(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reception_appointments(uuid,timestamptz,timestamptz,uuid) to authenticated;

create or replace function public.reception_change_appointment(p_clinic uuid,p_appointment uuid,p_revision integer,p_action text,p_start timestamptz default null,p_end timestamptz default null) returns integer
language plpgsql security definer set search_path='' as $$
declare a public.appointments; actor uuid; result integer;
begin
 perform public.assert_session_assurance();
 select * into a from public.appointments where id=p_appointment;
 if a.id is null or p_clinic is null or not coalesce(a.clinic_id=p_clinic or (a.clinic_id is null and a.user_id=auth.uid()),false) then raise exception 'Agendamento indisponível' using errcode='42501'; end if;
 actor:=public.assert_reception_scope(p_clinic,a.user_id);
 select * into a from public.appointments where id=p_appointment for update;
 if a.id is null or p_clinic is null or not coalesce(a.clinic_id=p_clinic or (a.clinic_id is null and a.user_id=auth.uid()),false) then raise exception 'Agendamento indisponível' using errcode='42501'; end if;
 perform public.assert_reception_scope(p_clinic,a.user_id);
 if a.revision is distinct from p_revision then raise exception 'O agendamento mudou. Atualize a agenda antes de confirmar.' using errcode='40001'; end if;
 -- Preserve T29's nonblocking account acquisition after the row/CAS.
 if not pg_try_advisory_xact_lock(hashtextextended(a.user_id::text,123)) then
  raise exception 'Agenda em alteração. Atualize antes de confirmar novamente.' using errcode='40001';
 end if;
 perform public.lock_reception_calendar(a.user_id);
 if p_action='reschedule' then
  if a.status in ('cancelado','realizado') or p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '12 hours' then raise exception 'Remarcação inválida' using errcode='22023'; end if;
  update public.appointments set start_time=p_start,end_time=p_end,status='agendado',checked_in_at=null where id=a.id returning revision into result;
 elsif p_action='cancel' then
  if a.status='realizado' then raise exception 'Atendimento realizado não pode ser cancelado nesta agenda' using errcode='22023'; end if;
  update public.appointments set status='cancelado' where id=a.id returning revision into result;
 elsif p_action='confirm' then
  if a.status not in ('agendado','confirmado') then raise exception 'Confirmação indisponível' using errcode='22023'; end if;
  update public.appointments set status='confirmado' where id=a.id returning revision into result;
 elsif p_action='check_in' then
  if a.status in ('cancelado','realizado') then raise exception 'Chegada indisponível' using errcode='22023'; end if;
  update public.appointments set checked_in_at=coalesce(checked_in_at,now()) where id=a.id returning revision into result;
 elsif p_action='undo_check_in' then
  if a.status='realizado' then raise exception 'Atendimento já realizado' using errcode='22023'; end if;
  update public.appointments set checked_in_at=null where id=a.id returning revision into result;
 else raise exception 'Ação de agenda inválida' using errcode='22023'; end if;
 if a.clinic_id is null then insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
 values(p_clinic,actor,'appointment_'||p_action,a.id,jsonb_build_object('revision',result,'previousStart',a.start_time,'previousEnd',a.end_time)); end if;
 return result;
end $$;
revoke all on function public.reception_change_appointment(uuid,uuid,integer,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.reception_change_appointment(uuid,uuid,integer,text,timestamptz,timestamptz) to authenticated;
commit;
