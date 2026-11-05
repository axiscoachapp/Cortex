-- Administrative projection only; never infer consent or rewrite a grant.
begin;
create function public.reception_staff_permissions(p_clinic uuid,p_staff uuid,p_after uuid default null,p_limit integer default 50) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;result jsonb;
begin
 actor:=cortex_private.reception_delegation_actor(p_clinic);
 if p_clinic is null then raise exception 'Clinic administration required' using errcode='42501';end if;
 if p_staff is null or p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid access page' using errcode='22023';end if;
 perform 1 from auth.users where id=actor for share nowait;
 if not found then raise exception 'Delegation actor unavailable' using errcode='42501';end if;
 perform 1 from public.clinic_staff_members where clinic_id=p_clinic and user_id=p_staff for share nowait;
 if not found then raise exception 'Staff unavailable' using errcode='42501';end if;
 with candidates as (
  select d.* from public.staff_doctor_scopes d
  where d.clinic_id=p_clinic and d.staff_user_id=p_staff and (p_after is null or d.doctor_user_id>p_after)
  order by d.doctor_user_id limit p_limit+1
 ), page as (select * from candidates order by doctor_user_id limit p_limit), items as (
  select d.doctor_user_id,jsonb_build_object(
   'doctorId',d.doctor_user_id,'doctorName',coalesce(nullif(trim(u.doctor_name),''),'Profissional'),
   'source',case when d.delegation_request_id is null then 'legacy' when r.id is not null then 'physician_approval' else 'unverified' end,
   'requestId',r.id,'effective',public.reception_actor_allowed(p_clinic,d.doctor_user_id,p_staff)
  ) as item from page d left join public.user_settings u on u.user_id=d.doctor_user_id
  left join cortex_private.reception_delegation_requests r on r.id=d.delegation_request_id
   and r.clinic_id=d.clinic_id and r.staff_user_id=d.staff_user_id and r.doctor_user_id=d.doctor_user_id
   and r.state='approved' and r.capability_version='clinic_reception_v1'
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(item order by doctor_user_id) from items),'[]'::jsonb),
  'nextCursor',case when (select count(*) from candidates)>p_limit then (select doctor_user_id from page order by doctor_user_id desc limit 1) else null end) into result;
 return result;
exception when lock_not_available then raise exception 'Access authority busy; refresh the list' using errcode='40001';
end $$;
revoke all on function public.reception_staff_permissions(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.reception_staff_permissions(uuid,uuid,uuid,integer) to authenticated;
commit;
