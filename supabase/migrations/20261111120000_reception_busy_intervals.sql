-- Owner: Claude (rec-agenda, improvement plan round 2, item C21).
-- What: reception_busy_intervals returns anonymous busy periods (doctor, start,
-- end) for the doctors in the caller's reception scope: the appointments and
-- blocks that occupy the doctor's slot under the booking conflict rule but are
-- not part of reception_appointments for this caller (the doctor's own agenda
-- without a clinic, another clinic's appointments and blocks).
-- Why: the team agenda showed those slots as free and the booking failed with
-- "Horário ocupado ou bloqueado" and no explanation.
-- Privacy: the projection is only doctorId/startTime/endTime. Overlapping and
-- touching periods of the same doctor are merged and clipped to the window, so
-- neither the number of hidden appointments nor anything outside the requested
-- window is revealed. No id, title, patient, contact, notes, status or reason.
-- Scope, window and result limits match reception_appointments.
-- No begin/commit here: the migration runner (and sqltest --with-pending) owns the transaction.
create or replace function public.reception_busy_intervals(p_clinic uuid,p_start timestamptz,p_end timestamptz,p_doctor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare scoped_doctors uuid[]; result jsonb;
begin
 if not coalesce(public.reception_scope_ok(p_clinic,p_doctor),false) then raise exception 'Agenda não delegada' using errcode='42501'; end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start or p_end-p_start>interval '42 days' then raise exception 'Selecione um período de até 42 dias' using errcode='22023'; end if;
 select coalesce(array_agg(m.user_id order by m.user_id),'{}'::uuid[]) into scoped_doctors
 from public.clinic_members m where m.clinic_id=p_clinic and m.status='active'
 and (p_doctor is null or m.user_id=p_doctor) and public.reception_scope_ok(p_clinic,m.user_id);
 with hidden as (
  -- Same occupancy rule as guard_reception_appointment; minus what
  -- reception_appointments already shows to this caller.
  select a.user_id as doctor,greatest(a.start_time,p_start) as s,least(a.end_time,p_end) as e
  from public.appointments a
  where a.user_id=any(scoped_doctors) and a.status is distinct from 'cancelado'
   and isfinite(a.start_time) and isfinite(a.end_time) and a.end_time>a.start_time
   and a.start_time<p_end and a.end_time>p_start
   and a.clinic_id is distinct from p_clinic and not (a.clinic_id is null and a.user_id=auth.uid())
  union all
  select b.doctor_user_id,greatest(b.start_time,p_start),least(b.end_time,p_end)
  from public.reception_schedule_blocks b
  where b.doctor_user_id=any(scoped_doctors) and b.active and b.clinic_id<>p_clinic
   and b.start_time<p_end and b.end_time>p_start
 ), ordered as (
  select doctor,s,e,max(e) over (partition by doctor order by s,e rows between unbounded preceding and 1 preceding) as previous_end from hidden
 ), grouped as (
  select doctor,s,e,sum(case when previous_end is null or s>previous_end then 1 else 0 end) over (partition by doctor order by s,e rows unbounded preceding) as island from ordered
 ), merged as (
  select doctor,min(s) as s,max(e) as e from grouped group by doctor,island order by min(s),doctor limit 1001
 )
 select coalesce(jsonb_agg(jsonb_build_object('doctorId',doctor,'startTime',s,'endTime',e) order by s,doctor),'[]') into result from merged;
 if jsonb_array_length(result)>1000 then raise exception 'Muitos horários ocupados. Reduza o período ou filtre um médico.' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function public.reception_busy_intervals(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reception_busy_intervals(uuid,timestamptz,timestamptz,uuid) to authenticated;
