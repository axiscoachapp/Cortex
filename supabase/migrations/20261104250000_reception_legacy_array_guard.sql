-- Transitional protection: an active legacy array cannot withdraw a bound
-- physician approval. General legacy reconciliation/provisioning is separate.
begin;
set transaction isolation level read committed;
set local lock_timeout='2s';
lock table public.clinic_staff_members,public.staff_doctor_scopes,
 cortex_private.reception_delegation_requests in share row exclusive mode nowait;

-- Preserve the function OID, ACL and all earlier validation/deletion rules.
-- Fence after the staff UPDATE/its AFTER guards, retaining the existing row
-- order for lifecycle RPCs. NOWAIT accounts prevent inverse waits with a
-- request-first physician decision; old RR snapshots abort on the epoch write.
do $patch$ declare definition text;
 staff_checked text:='if not found then raise exception ''Integrante indisponível'' using errcode=''42501''; end if;';
 old_delete text:='delete from public.staff_doctor_scopes where clinic_id=p_clinic and staff_user_id=p_staff and (not p_active or not(doctor_user_id=any(p_doctors)));';
 new_delete text:='delete from public.staff_doctor_scopes where clinic_id=p_clinic and staff_user_id=p_staff and (not p_active or (delegation_request_id is null and not(doctor_user_id=any(p_doctors))));';
begin
 definition:=pg_get_functiondef('public.set_reception_scopes(uuid,uuid,uuid[],boolean)'::regprocedure);
 if array_length(string_to_array(definition,staff_checked),1) is distinct from 2
  or array_length(string_to_array(definition,old_delete),1) is distinct from 2 then
  raise exception 'Unexpected legacy scope setter definition';
 end if;
 definition:=replace(definition,staff_checked,staff_checked||$guard$
 perform cortex_private.touch_custody_epoch(array[p_staff]);
 if p_active and exists(select 1 from public.staff_doctor_scopes
  where clinic_id=p_clinic and staff_user_id=p_staff and delegation_request_id is not null
  and not(doctor_user_id=any(p_doctors))) then
  raise exception 'Approved delegation requires explicit withdrawal' using errcode='40001';
 end if;
 $guard$);
 execute replace(definition,old_delete,new_delete);
end $patch$;
commit;
