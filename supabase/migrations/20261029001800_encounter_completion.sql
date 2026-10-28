-- The consultation is already durable. Metadata and its one linked appointment
-- are repaired together on every successful retry before source cleanup.
create function public.complete_consultation_metadata(p_user_id uuid,p_patient_id uuid,p_consultation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare visit public.consultations; patient public.patients; next_date date; next_status text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
 select * into patient from public.patients where id=p_patient_id and user_id=p_user_id and deletion_requested_at is null for update;
 if not found or exists(select 1 from public.account_deletion_requests where user_id=p_user_id) then raise exception 'Patient unavailable' using errcode='42501'; end if;
 select * into visit from public.consultations where id=p_consultation_id and patient_id=p_patient_id and user_id=p_user_id;
 if not found then raise exception 'Saved encounter unavailable' using errcode='42501'; end if;
 next_date:=greatest(patient.last_visit,(visit.created_at at time zone 'America/Sao_Paulo')::date);
 next_status:=case when exists(select 1 from public.consultation_drafts where patient_id=p_patient_id and user_id=p_user_id and id<>visit.id) then patient.status else 'retorno' end;
 if patient.last_visit is distinct from next_date or patient.status is distinct from next_status then
  update public.patients set last_visit=next_date,status=next_status where id=patient.id;
 end if;
 if visit.appointment_id is not null then
  update public.appointments set status='realizado' where id=visit.appointment_id and patient_id=p_patient_id and user_id=p_user_id and status in ('agendado','confirmado');
 end if;
 return true;
end;
$$;
revoke all on function public.complete_consultation_metadata(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_consultation_metadata(uuid,uuid,uuid) to service_role;
