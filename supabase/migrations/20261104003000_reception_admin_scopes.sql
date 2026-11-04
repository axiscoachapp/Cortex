-- T28/1: management is not a delegation to another clinician's agenda.
create or replace function public.reception_actor_allowed(p_clinic uuid,p_doctor uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_actor is not null and not exists(select 1 from public.account_deletion_requests where user_id=p_actor)
 and (p_doctor is null or (not exists(select 1 from public.account_deletion_requests where user_id=p_doctor)
  and exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_doctor and status='active')))
 and ((p_doctor is null and exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and role='admin' and status='active'))
 or exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and status='active' and user_id=p_doctor)
 or exists(select 1 from public.clinic_staff_members s join public.staff_doctor_scopes d on d.clinic_id=s.clinic_id and d.staff_user_id=s.user_id
  join public.clinic_members m on m.clinic_id=d.clinic_id and m.user_id=d.doctor_user_id and m.status='active'
  where s.clinic_id=p_clinic and s.user_id=p_actor and s.active and (p_doctor is null or d.doctor_user_id=p_doctor)));
$$;
revoke all on function public.reception_actor_allowed(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The team picker needs affiliation metadata, independently of operational
-- agenda access. Keep clinic_access.doctors as its existing strict scoped DTO.
create function public.reception_team_doctors(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 perform public.assert_session_assurance();
 if auth.role() is distinct from 'authenticated' or public.is_reception_account(auth.uid())
  or exists(select 1 from public.account_deletion_requests where user_id=auth.uid())
  or not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=auth.uid() and role='admin' and status='active') then
  raise exception 'Somente a administração desta clínica pode consultar a equipe' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.name,page.id),'[]') into items from (
  select m.user_id as id,coalesce(nullif(trim(s.doctor_name),''),'Médico') as name,s.specialty
  from public.clinic_members m left join public.user_settings s on s.user_id=m.user_id
  where m.clinic_id=p_clinic and m.status='active'
   and not exists(select 1 from public.account_deletion_requests where user_id=m.user_id)
  order by name,m.user_id limit 201
 ) page;
 if jsonb_array_length(items)>200 then raise exception 'Muitos profissionais. O diretório precisa ser paginado antes de continuar.' using errcode='22023';end if;
 return items;
end $$;
revoke all on function public.reception_team_doctors(uuid) from public,anon,authenticated,service_role;
grant execute on function public.reception_team_doctors(uuid) to authenticated;
