-- Historical invalid intervals may be cancelled without rewriting history.
-- Keep every existing identity, authority, calendar and audit guard below.
create or replace function public.guard_reception_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare slot_changed boolean; changed boolean; legacy_cancellation boolean:=false;
begin
 if tg_op='DELETE' then
  if old.clinic_id is not null or exists(select 1 from public.reception_audit where resource_id=old.id) then
   raise exception 'Cancele o agendamento para preservar seu histórico' using errcode='42501';
  end if;
  return old;
 end if;
 if new.start_time is null or new.end_time is null or not isfinite(new.start_time) or not isfinite(new.end_time) or new.end_time<=new.start_time then
  if tg_op='UPDATE' then
   -- queue_calendar_sync runs before this guard. Its metadata is allowed, but
   -- no business field other than cancellation status may change. A NULL
   -- status is deliberately not inferred to be an unfinished appointment.
   legacy_cancellation:=new.status='cancelado' and old.status in ('agendado','confirmado','cancelado')
    and (new.start_time,new.end_time) is not distinct from (old.start_time,old.end_time)
    and (to_jsonb(new)-array['status','revision','updated_by','google_event_id','google_sync_claim','google_sync_error','google_sync_lease_until','google_sync_revision','google_sync_status','reminder_sent'])
     is not distinct from (to_jsonb(old)-array['status','revision','updated_by','google_event_id','google_sync_claim','google_sync_error','google_sync_lease_until','google_sync_revision','google_sync_status','reminder_sent']);
  end if;
  if legacy_cancellation is not true then raise exception 'Intervalo de horário inválido' using errcode='22023'; end if;
 end if;
 if tg_op='UPDATE' then
  if (new.id,new.user_id) is distinct from (old.id,old.user_id) then raise exception 'Identidade e médico do agendamento são imutáveis' using errcode='42501'; end if;
  if (new.clinic_id,new.contact_id,new.reception_case_id,new.created_by) is distinct from (old.clinic_id,old.contact_id,old.reception_case_id,old.created_by) then raise exception 'Vínculo e autoria do agendamento são imutáveis' using errcode='42501'; end if;
  slot_changed:=(new.user_id,new.start_time,new.end_time) is distinct from (old.user_id,old.start_time,old.end_time)
   or (old.status='cancelado' and new.status is distinct from 'cancelado');
  changed:=(to_jsonb(new)-array['revision','updated_by','google_event_id','google_sync_claim','google_sync_error','google_sync_lease_until','google_sync_revision','google_sync_status','reminder_sent'])
   is distinct from (to_jsonb(old)-array['revision','updated_by','google_event_id','google_sync_claim','google_sync_error','google_sync_lease_until','google_sync_revision','google_sync_status','reminder_sent']);
  new.revision:=old.revision+case when changed then 1 else 0 end;
  new.updated_by:=case when changed then auth.uid() else old.updated_by end;
  if slot_changed or new.status is distinct from old.status then new.reminder_sent:=false; end if;
 else slot_changed:=true;changed:=true;new.revision:=1;new.created_by:=auth.uid();new.updated_by:=auth.uid(); end if;
 if new.clinic_id is not null then
  if not exists(select 1 from public.patient_contact_links where clinic_id=new.clinic_id and contact_id=new.contact_id and patient_id=new.patient_id and doctor_user_id=new.user_id) then raise exception 'Confirme o beneficiário nesta agenda' using errcode='42501'; end if;
  if new.reception_case_id is not null and not exists(select 1 from public.reception_cases where id=new.reception_case_id and clinic_id=new.clinic_id and contact_id=new.contact_id and (tg_op<>'INSERT' or doctor_user_id is null or doctor_user_id=new.user_id)) then raise exception 'Encaminhe o atendimento para o médico escolhido antes de agendar' using errcode='42501'; end if;
  if slot_changed and auth.role() is not distinct from 'service_role' then raise exception 'Reserva exige confirmação humana autenticada' using errcode='42501'; end if;
 end if;
 if slot_changed then
  perform public.lock_reception_calendar(new.user_id);
  if new.status is distinct from 'cancelado' and (exists(select 1 from public.appointments a where a.user_id=new.user_id and a.id<>new.id and a.status is distinct from 'cancelado' and a.start_time<new.end_time and a.end_time>new.start_time)
   or exists(select 1 from public.reception_schedule_blocks b where b.doctor_user_id=new.user_id and b.active and b.start_time<new.end_time and b.end_time>new.start_time)) then
   raise exception 'Horário ocupado ou bloqueado. Escolha outro intervalo.' using errcode='23P01';
  end if;
 end if;
 if new.clinic_id is not null and changed then
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
  values(new.clinic_id,auth.uid(),case when tg_op='INSERT' then 'appointment_created' else 'appointment_updated' end,new.id,
   jsonb_build_object('doctorId',new.user_id,'revision',new.revision,'startTime',new.start_time,'endTime',new.end_time,'status',new.status,'origin',coalesce(auth.role(),'database')));
 end if;
 return new;
end $$;
