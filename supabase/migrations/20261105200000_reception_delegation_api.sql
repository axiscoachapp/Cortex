-- Existing accounts only: authenticated facade over the reviewed private writers.
begin;
create index reception_delegation_clinic_page on cortex_private.reception_delegation_requests(clinic_id,created_at desc,id desc);
create index reception_delegation_doctor_page on cortex_private.reception_delegation_requests(doctor_user_id,created_at desc,id desc);

create function public.reception_delegation_requests(p_clinic uuid default null,p_after timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;result jsonb;
begin
 actor:=cortex_private.reception_delegation_actor(p_clinic);
 if p_limit is null or p_limit<1 or p_limit>100 or (p_after is null)<>(p_after_id is null) then
  raise exception 'Invalid delegation page' using errcode='22023';end if;
 perform 1 from auth.users where id=actor for share nowait;
 if not found then raise exception 'Delegation actor unavailable' using errcode='42501';end if;
 if p_clinic is null then
  -- A role/status change cannot leave an old RR membership snapshot readable.
  perform 1 from public.clinic_members where user_id=actor and status='active' order by clinic_id for share nowait;
 end if;
 with candidates as (
  select r.* from cortex_private.reception_delegation_requests r
  where ((p_clinic is not null and r.clinic_id=p_clinic)
   or (p_clinic is null and r.doctor_user_id=actor and exists(
    select 1 from public.clinic_members m where m.clinic_id=r.clinic_id and m.user_id=actor and m.status='active')))
   and (p_after is null or (r.created_at,r.id)<(p_after,p_after_id))
  order by r.created_at desc,r.id desc limit p_limit+1
 ), page as (select * from candidates order by created_at desc,id desc limit p_limit), items as (
  select r.created_at,r.id,jsonb_build_object(
   'id',r.id,'clinicId',r.clinic_id,'clinicName',c.name,
   'staffId',r.staff_user_id,'staffName',s.name,
   'doctorId',r.doctor_user_id,'doctorName',coalesce(nullif(trim(u.doctor_name),''),'Profissional'),
   'state',r.state,'revision',r.revision,'capabilityVersion',r.capability_version,'createdAt',r.created_at,
   'effective',r.state='approved' and cortex_private.reception_delegation_eligible(r.clinic_id,r.staff_user_id,r.doctor_user_id)
    and public.reception_actor_allowed(r.clinic_id,r.doctor_user_id,r.staff_user_id) and exists(
     select 1 from public.staff_doctor_scopes d where d.delegation_request_id=r.id and d.clinic_id=r.clinic_id and d.staff_user_id=r.staff_user_id and d.doctor_user_id=r.doctor_user_id),
   'canDecide',r.state='pending' and r.doctor_user_id=actor and cortex_private.reception_delegation_eligible(r.clinic_id,r.staff_user_id,r.doctor_user_id),
   'canCancel',r.state='pending' and p_clinic is not null,
   'canRevoke',r.state='approved' and (p_clinic is not null or r.doctor_user_id=actor)
  ) as item from page r join public.clinics c on c.id=r.clinic_id
  join public.clinic_staff_members s on s.clinic_id=r.clinic_id and s.user_id=r.staff_user_id
  left join public.user_settings u on u.user_id=r.doctor_user_id
 ) select jsonb_build_object('canManage',p_clinic is not null,
  'items',coalesce((select jsonb_agg(item order by created_at desc,id desc) from items),'[]'::jsonb),
  'nextCursor',case when (select count(*) from candidates)>p_limit then
   (select jsonb_build_object('createdAt',created_at,'id',id) from page order by created_at,id limit 1) else null end) into result;
 return result;
exception when lock_not_available then raise exception 'Delegation authority busy; refresh the list' using errcode='40001';
end $$;

create function public.reception_request_delegation(p_clinic uuid,p_staff uuid,p_doctor uuid,p_operation uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 return cortex_private.request_reception_delegation(p_clinic,p_staff,p_doctor,p_operation);
exception when unique_violation then raise exception 'Delegation changed; refresh the list' using errcode='40001';
end $$;
create function public.reception_decide_delegation(p_request uuid,p_revision integer,p_decision text,p_operation uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select cortex_private.decide_reception_delegation(p_request,p_revision,p_decision,p_operation);
$$;
create function public.reception_cancel_delegation(p_request uuid,p_revision integer,p_operation uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select cortex_private.cancel_reception_delegation(p_request,p_revision,p_operation);
$$;
create function public.reception_revoke_delegation(p_request uuid,p_revision integer,p_operation uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select cortex_private.revoke_reception_delegation(p_request,p_revision,p_operation);
$$;
-- Supabase defaults also grant these roles directly; revoke every default.
revoke all on function public.reception_delegation_requests(uuid,timestamptz,uuid,integer),
 public.reception_request_delegation(uuid,uuid,uuid,uuid),public.reception_decide_delegation(uuid,integer,text,uuid),
 public.reception_cancel_delegation(uuid,integer,uuid),public.reception_revoke_delegation(uuid,integer,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.reception_delegation_requests(uuid,timestamptz,uuid,integer),
 public.reception_request_delegation(uuid,uuid,uuid,uuid),public.reception_decide_delegation(uuid,integer,text,uuid),
 public.reception_cancel_delegation(uuid,integer,uuid),public.reception_revoke_delegation(uuid,integer,uuid) to authenticated;
commit;
