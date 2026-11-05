-- Fresh administrative review for the existing, revisioned withdrawal writer.
-- Existing list DTOs and all permission writers stay unchanged.
begin;
create function public.reception_delegation_withdrawal(p_request uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;r cortex_private.reception_delegation_requests;result jsonb;
begin
 actor:=cortex_private.reception_delegation_actor(null);
 select * into r from cortex_private.reception_delegation_requests where id=p_request for share nowait;
 if not found then raise exception 'Approval unavailable' using errcode='42501';end if;
 actor:=cortex_private.reception_delegation_actor(r.clinic_id);
 perform 1 from auth.users where id=actor for share nowait;
 if not found then raise exception 'Approval unavailable' using errcode='42501';end if;
 perform 1 from public.clinic_staff_members where clinic_id=r.clinic_id and user_id=r.staff_user_id for share nowait;
 if not found or r.state<>'approved' or r.capability_version<>'clinic_reception_v1'
  or not cortex_private.reception_delegation_eligible(r.clinic_id,r.staff_user_id,r.doctor_user_id)
  or not exists(select 1 from public.staff_doctor_scopes s where s.delegation_request_id=r.id
   and s.clinic_id=r.clinic_id and s.staff_user_id=r.staff_user_id and s.doctor_user_id=r.doctor_user_id) then
  raise exception 'Approval unavailable' using errcode='42501';
 end if;
 select jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'capabilityVersion',r.capability_version,
  'clinicId',r.clinic_id,'clinicName',c.name,'staffId',r.staff_user_id,'staffName',s.name,
  'doctorId',r.doctor_user_id,'doctorName',coalesce(nullif(trim(u.doctor_name),''),'Profissional')) into result
 from public.clinics c join public.clinic_staff_members s on s.clinic_id=c.id and s.user_id=r.staff_user_id
 left join public.user_settings u on u.user_id=r.doctor_user_id where c.id=r.clinic_id;
 return result;
exception when lock_not_available then raise exception 'Approval authority busy; refresh the review' using errcode='40001';
end $$;
revoke all on function public.reception_delegation_withdrawal(uuid) from public,anon,authenticated,service_role;
grant execute on function public.reception_delegation_withdrawal(uuid) to authenticated;
commit;
