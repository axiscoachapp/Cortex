-- Separate administrative projection; existing readers and writers stay intact.
begin;
create function public.reception_contact_links(p_clinic uuid,p_contact uuid,p_after uuid default null,p_limit integer default 50) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;result jsonb;
begin
 actor:=cortex_private.reception_delegation_actor(p_clinic);
 if p_clinic is null then raise exception 'Clinic administration required' using errcode='42501';end if;
 perform 1 from auth.users where id=actor for share nowait;
 if not found then raise exception 'Administrative actor unavailable' using errcode='42501';end if;
 perform 1 from public.clinic_contacts where id=p_contact and clinic_id=p_clinic for share nowait;
 if not found then raise exception 'Contact unavailable' using errcode='42501';end if;
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Invalid link page size' using errcode='22023';end if;
 if p_after is not null and not exists(select 1 from public.patient_contact_links where clinic_id=p_clinic and contact_id=p_contact and patient_id=p_after) then
  raise exception 'Invalid contact link cursor' using errcode='22023';end if;
 with candidates as (
  select l.*,p.name,p.date_of_birth,p.archived_at,p.deletion_requested_at from public.patient_contact_links l
  join public.patients p on p.id=l.patient_id and p.user_id=l.doctor_user_id
  where l.clinic_id=p_clinic and l.contact_id=p_contact and (p_after is null or l.patient_id>p_after)
  order by l.patient_id limit p_limit+1
 ), page as (select * from candidates order by patient_id limit p_limit), items as (
  select l.patient_id,jsonb_build_object('contactId',l.contact_id,'patientId',l.patient_id,'doctorId',l.doctor_user_id,
   'patientName',l.name,'dateOfBirth',l.date_of_birth,'doctorName',coalesce(nullif(trim(s.doctor_name),''),'Médico'),
   'relationship',l.relationship,'revision',l.revision,'active',true,
   'patientAvailable',l.archived_at is null and l.deletion_requested_at is null,
   'doctorActive',exists(select 1 from public.clinic_members m where m.clinic_id=l.clinic_id and m.user_id=l.doctor_user_id and m.status='active')
    and not exists(select 1 from public.account_deletion_requests where user_id=l.doctor_user_id)) as item
  from page l left join public.user_settings s on s.user_id=l.doctor_user_id
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(item order by patient_id) from items),'[]'::jsonb),
  'nextCursor',case when (select count(*) from candidates)>p_limit then (select patient_id from page order by patient_id desc limit 1) else null end) into result;
 return result;
exception when lock_not_available then raise exception 'Contact authority busy; refresh the list' using errcode='40001';
end $$;
revoke all on function public.reception_contact_links(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.reception_contact_links(uuid,uuid,uuid,integer) to authenticated;
commit;
