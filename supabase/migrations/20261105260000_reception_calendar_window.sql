-- Recover invalid historical intervals by their known, finite start in the
-- selected half-open window. Scope/origin filters and result caps stay shared.
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
  where (
   (a.end_time>p_start and a.start_time<p_end)
   or (isfinite(a.start_time) and a.start_time>=p_start and a.start_time<p_end and a.status is not null
    and (not isfinite(a.end_time) or a.end_time<=a.start_time))
  ) and (a.clinic_id=p_clinic or (a.clinic_id is null and a.user_id=auth.uid()))
  and (p_doctor is null or a.user_id=p_doctor) and public.reception_scope_ok(p_clinic,a.user_id)
  order by a.start_time,a.id limit 1001) page;
 if jsonb_array_length(items)>1000 then raise exception 'Muitos agendamentos. Reduza o período ou filtre um médico.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'doctorId',doctor_user_id,'startTime',start_time,'endTime',end_time,'reason',reason,'revision',revision) order by start_time,id),'[]') into blocks
 from public.reception_schedule_blocks where clinic_id=p_clinic and active and start_time<p_end and end_time>p_start and (p_doctor is null or doctor_user_id=p_doctor) and public.reception_scope_ok(p_clinic,doctor_user_id);
 return jsonb_build_object('items',items,'blocks',blocks);
end $$;
commit;
