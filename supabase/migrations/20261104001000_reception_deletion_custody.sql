-- Keep every administrative FK before the first external cleanup. An owner's
-- unaudited private appointment disappears with that owner and is not custody
-- of another person's calendar merely because its actor columns are populated.
create or replace function public.assert_deletion_scope(p_user_id uuid,p_patient_id uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null then raise exception 'Missing deletion owner' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
 if exists(select 1 from public.patient_contact_links where doctor_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id))
 or exists(select 1 from public.appointments a where a.user_id=p_user_id and (p_patient_id is null or a.patient_id=p_patient_id)
  and (a.clinic_id is not null or exists(select 1 from public.reception_audit where resource_id=a.id)
   or exists(select 1 from public.reception_booking_requests where appointment_id=a.id)))
 or (p_patient_id is null and (
  exists(select 1 from public.clinic_staff_members where user_id=p_user_id)
  or exists(select 1 from public.staff_doctor_scopes where doctor_user_id=p_user_id or staff_user_id=p_user_id)
  or exists(select 1 from public.clinic_contacts where created_by=p_user_id)
  or exists(select 1 from public.patient_contact_links where confirmed_by=p_user_id or updated_by=p_user_id)
  or exists(select 1 from public.reception_cases where doctor_user_id=p_user_id or created_by=p_user_id or assigned_to=p_user_id)
  or exists(select 1 from public.reception_case_notes where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_case_drafts where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_audit where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_booking_requests where actor_user_id=p_user_id)
  or exists(select 1 from public.reception_schedule_blocks where doctor_user_id=p_user_id or created_by=p_user_id)
  or exists(select 1 from public.appointments where user_id<>p_user_id and (created_by=p_user_id or updated_by=p_user_id)))) then
  raise exception 'Administrative custody must be resolved before deletion' using errcode='P4092';
 end if;
 if exists(select 1 from public.patient_shares where (owner_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id)) or (p_patient_id is null and recipient_user_id=p_user_id))
 or (p_patient_id is null and exists(select 1 from public.clinics where created_by=p_user_id))
 or exists(select 1 from public.shared_chart_entries where (owner_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id)) or (p_patient_id is null and author_user_id=p_user_id)) then
  raise exception 'Shared chart custody must be resolved before deletion' using errcode='P4091';
 end if;
 return public.assert_deletion_scope_legacy(p_user_id,p_patient_id);
end $$;
revoke all on function public.assert_deletion_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_deletion_scope(uuid,uuid) to service_role;

-- This predicate is also rechecked after membership locks by every reception RPC.
create or replace function public.reception_actor_allowed(p_clinic uuid,p_doctor uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_actor is not null and not exists(select 1 from public.account_deletion_requests where user_id=p_actor)
 and (p_doctor is null or (not exists(select 1 from public.account_deletion_requests where user_id=p_doctor)
  and exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_doctor and status='active')))
 and (exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and role='admin' and status='active')
 or (exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and status='active' and user_id=p_doctor)
 or exists(select 1 from public.clinic_staff_members s join public.staff_doctor_scopes d on d.clinic_id=s.clinic_id and d.staff_user_id=s.user_id
  join public.clinic_members m on m.clinic_id=d.clinic_id and m.user_id=d.doctor_user_id and m.status='active'
  where s.clinic_id=p_clinic and s.user_id=p_actor and s.active and (p_doctor is null or d.doctor_user_id=p_doctor))));
$$;

-- Staff management enters scope checking without a doctor. Validate each target
-- here too, before changing existing scopes or writing administrative history.
create or replace function public.set_reception_scopes(p_clinic uuid,p_staff uuid,p_doctors uuid[],p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_active is null or p_doctors is null or cardinality(p_doctors)>50 or array_position(p_doctors,null) is not null then raise exception 'Selecione agendas válidas' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_doctors) d where not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=d and status='active')
  or exists(select 1 from public.account_deletion_requests where user_id=d)) then raise exception 'Médico indisponível na clínica' using errcode='42501'; end if;
 update public.clinic_staff_members set active=p_active where user_id=p_staff and clinic_id=p_clinic;
 if not found then raise exception 'Integrante indisponível' using errcode='42501'; end if;
 delete from public.staff_doctor_scopes where clinic_id=p_clinic and staff_user_id=p_staff and (not p_active or not(doctor_user_id=any(p_doctors)));
 if p_active then insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) select p_clinic,p_staff,d from unnest(p_doctors) d group by d on conflict do nothing; end if;
end $$;
revoke all on function public.set_reception_scopes(uuid,uuid,uuid[],boolean) from public,anon,authenticated;
