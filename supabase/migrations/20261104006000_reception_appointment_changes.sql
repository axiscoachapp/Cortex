-- T29: check availability before calendar lookup; align with direct owner edits
-- without introducing a blocking cycle against clinical completion (account -> row).
create or replace function public.reception_change_appointment(p_clinic uuid,p_appointment uuid,p_revision integer,p_action text,p_start timestamptz default null,p_end timestamptz default null) returns integer
language plpgsql security definer set search_path='' as $$
declare a public.appointments; actor uuid; result integer;
begin
 perform public.assert_session_assurance();
 select * into a from public.appointments where id=p_appointment;
 if a.id is null or (a.clinic_id is not null and a.clinic_id<>p_clinic) then raise exception 'Agendamento indisponível' using errcode='42501'; end if;
 actor:=public.assert_reception_scope(p_clinic,a.user_id);
 select * into a from public.appointments where id=p_appointment for update;
 if a.id is null or (a.clinic_id is not null and a.clinic_id<>p_clinic) then raise exception 'Agendamento indisponível' using errcode='42501'; end if;
 perform public.assert_reception_scope(p_clinic,a.user_id);
 if a.revision is distinct from p_revision then raise exception 'O agendamento mudou. Atualize a agenda antes de confirmar.' using errcode='40001'; end if;
 -- Completion paths still hold the owner's account lock before touching the
 -- appointment. Never wait for it while holding this row: abort and preserve
 -- the caller's draft instead. The existing version helper is then reentrant.
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
