-- Dedicated administrative identities. Clinical memberships and owner RLS stay private.
create table public.clinic_staff_members (
 user_id uuid primary key references auth.users(id) on delete restrict,
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 name text not null check(length(trim(name)) between 2 and 120),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(clinic_id,user_id)
);
create table public.staff_doctor_scopes (
 clinic_id uuid not null,
 staff_user_id uuid not null,
 doctor_user_id uuid not null,
 primary key(clinic_id,staff_user_id,doctor_user_id),
 foreign key(clinic_id,staff_user_id) references public.clinic_staff_members(clinic_id,user_id) on delete restrict,
 foreign key(clinic_id,doctor_user_id) references public.clinic_members(clinic_id,user_id) on delete restrict
);
create table public.reception_audit (
 id bigint generated always as identity primary key,
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 actor_user_id uuid references auth.users(id) on delete restrict,
 action text not null,
 resource_id uuid,
 details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['clinic_staff_members','staff_doctor_scopes','reception_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.is_reception_account(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_user is not null and (exists(select 1 from public.clinic_staff_members where user_id=p_user)
 or exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'account_type'='reception'));
$$;
revoke all on function public.is_reception_account(uuid) from public,anon,authenticated;

create function public.clinical_session_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select not public.is_reception_account(auth.uid());
$$;
revoke all on function public.clinical_session_allowed() from public,anon;
grant execute on function public.clinical_session_allowed() to authenticated,service_role;

create function public.assert_clinical_actor() returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if public.is_reception_account(auth.uid()) then raise exception 'Operação restrita ao ambiente médico' using errcode='42501'; end if;
end $$;
revoke all on function public.assert_clinical_actor() from public,anon,authenticated;

-- Defence in depth: a reception login cannot create its own clinical workspace either.
do $$ declare t text; begin
 foreach t in array array['patients','appointments','consultations','consultation_drafts','patient_files','prescriptions',
 'clinical_record_revisions','clinical_work_items','clinical_work_revisions','document_templates','knowledge_documents',
 'knowledge_chunks','knowledge_review_events','user_integrations','google_oauth_transactions','patient_chat_turns','user_settings'] loop
  execute format('create policy clinical_identity on public.%I as restrictive for all to authenticated using(public.clinical_session_allowed()) with check(public.clinical_session_allowed())',t);
 end loop;
end $$;
create policy clinical_identity on storage.objects as restrictive for all to authenticated
 using(public.clinical_session_allowed()) with check(public.clinical_session_allowed());

-- These authenticated SECURITY DEFINER paths bypass RLS. Retain their signatures/ACLs.
do $$ declare signature text; definition text; guarded text; begin
 foreach signature in array array[
 'public.sharing_actor()', 'public.workspace_directory(integer)',
 'public.update_user_settings(jsonb)', 'public.revoke_prescription(uuid)', 'public.get_integration_status(uuid)',
 'public.review_document_proposal(uuid,integer,text,boolean)',
 'public.review_history_proposal(uuid,integer,integer,text,text,boolean)',
 'public.create_knowledge_source(text,text,text,text,uuid)', 'public.review_knowledge_source(uuid,boolean)',
 'public.delete_knowledge_source(uuid)', 'public.approve_medication_reconciliation(uuid,integer,integer)',
 'public.finalize_manual_encounter(uuid,integer)', 'public.list_patient_chat_turns(uuid,uuid,integer)'
 ] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  guarded:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n PERFORM public.assert_clinical_actor();','i');
  if guarded=definition then raise exception 'Missing clinical guard point: %',signature; end if;
  execute guarded;
 end loop;
end $$;

-- Actor-argument helpers must check that argument, including their owner-only branches.
do $$ declare signature text; actor text; definition text; guarded text; begin
 for signature,actor in select * from (values
 ('public.assert_chat_patient(uuid,uuid)','p_user'),
 ('public.authorize_shared_file(uuid,uuid,boolean)','p_actor_user_id'),
 ('public.protocol_sources_allowed(uuid,jsonb)','p_actor_user_id')) as v(signature,actor) loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  guarded:=regexp_replace(definition,'\mBEGIN\M',format(E'BEGIN\n IF public.is_reception_account(%I) THEN RAISE EXCEPTION ''Operação restrita ao ambiente médico'' USING ERRCODE=''42501''; END IF;',actor),'i');
  execute guarded;
 end loop;
end $$;
do $$ declare signature text; definition text; guarded text; begin
 foreach signature in array array['public.active_shared_grant(uuid,uuid)','public.active_protocol_grant(uuid,uuid)','public.match_knowledge(uuid,public.vector,integer)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  if signature like '%active_shared%' then guarded:=replace(definition,'where s.patient_id=', 'where not public.is_reception_account(p_user_id) and s.patient_id=');
  elsif signature like '%active_protocol%' then guarded:=replace(definition,'where s.document_id=', 'where not public.is_reception_account(p_actor_user_id) and s.document_id=');
  else guarded:=replace(definition,'where (auth.role()', 'where not public.is_reception_account(p_user_id) and (auth.role()'); end if;
  if guarded=definition then raise exception 'Missing SQL guard point: %',signature; end if;
  execute guarded;
 end loop;
end $$;
create or replace function public.clinical_account_writable() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.clinical_session_allowed()
 and not exists(select 1 from public.account_deletion_requests where user_id=auth.uid());
$$;

create function public.guard_clinical_membership() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.is_reception_account(new.user_id) then raise exception 'Conta de recepção não pode ser convertida em conta médica' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_clinical_membership() from public,anon,authenticated;
create trigger clinical_member_identity before insert or update on public.clinic_members for each row execute function public.guard_clinical_membership();

create function public.reception_actor_allowed(p_clinic uuid,p_doctor uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_actor is not null and not exists(select 1 from public.account_deletion_requests where user_id=p_actor)
 and (p_doctor is null or exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_doctor and status='active'))
 and (exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and role='admin' and status='active')
 or (exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_actor and status='active' and user_id=p_doctor)
 or exists(select 1 from public.clinic_staff_members s join public.staff_doctor_scopes d on d.clinic_id=s.clinic_id and d.staff_user_id=s.user_id
   join public.clinic_members m on m.clinic_id=d.clinic_id and m.user_id=d.doctor_user_id and m.status='active'
   where s.clinic_id=p_clinic and s.user_id=p_actor and s.active and (p_doctor is null or d.doctor_user_id=p_doctor))));
$$;
revoke all on function public.reception_actor_allowed(uuid,uuid,uuid) from public,anon,authenticated;
create function public.reception_scope_ok(p_clinic uuid,p_doctor uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.role()='authenticated' and public.session_assurance_ok() and public.reception_actor_allowed(p_clinic,p_doctor,auth.uid());
$$;
revoke all on function public.reception_scope_ok(uuid,uuid) from public,anon,authenticated;

create function public.assert_reception_scope(p_clinic uuid,p_doctor uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_session_assurance();
 if not coalesce(public.reception_scope_ok(p_clinic,p_doctor),false) then raise exception 'Sem permissão para esta agenda ou fila' using errcode='42501'; end if;
 -- Serialize writes with membership/scope revocation; no long external calls in this transaction.
 perform 1 from public.clinic_members where clinic_id=p_clinic and user_id in (auth.uid(),p_doctor) for share;
 perform 1 from public.clinic_staff_members where clinic_id=p_clinic and user_id=auth.uid() for share;
 perform 1 from public.staff_doctor_scopes where clinic_id=p_clinic and staff_user_id=auth.uid() and (p_doctor is null or doctor_user_id=p_doctor) for share;
 if not coalesce(public.reception_scope_ok(p_clinic,p_doctor),false) then raise exception 'Permissão revogada' using errcode='42501'; end if;
 return auth.uid();
end $$;
revoke all on function public.assert_reception_scope(uuid,uuid) from public,anon,authenticated;

create function public.clinic_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid; kind text:='clinical'; admin boolean:=false; active boolean:=false; doctors jsonb; staff jsonb:='[]'; clinic_name text;
begin
 perform public.assert_session_assurance();
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Authentication required' using errcode='42501'; end if;
 if exists(select 1 from public.account_deletion_requests where user_id=auth.uid()) then raise exception 'Conta indisponível' using errcode='42501'; end if;
 if public.is_reception_account(auth.uid()) then
  kind:='reception'; select clinic_id,s.active into c,active from public.clinic_staff_members s where user_id=auth.uid();
 else
  select clinic_id,role='admin',true into c,admin,active from public.clinic_members where user_id=auth.uid() and status='active' limit 1;
 end if;
 select name into clinic_name from public.clinics where id=c;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(u.doctor_name,''),'Médico'),'specialty',u.specialty) order by u.doctor_name,m.user_id),'[]') into doctors
 from public.clinic_members m left join public.user_settings u on u.user_id=m.user_id
 where m.clinic_id=c and m.status='active' and public.reception_scope_ok(c,m.user_id);
 if admin then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.name,'active',s.active,'doctorIds',
   (select coalesce(jsonb_agg(d.doctor_user_id order by d.doctor_user_id),'[]') from public.staff_doctor_scopes d where d.staff_user_id=s.user_id and d.clinic_id=c)) order by s.name),'[]') into staff
  from public.clinic_staff_members s where s.clinic_id=c;
 end if;
 return jsonb_build_object('kind',kind,'active',coalesce(active,false),'admin',coalesce(admin,false),
 'clinic',case when c is null then null else jsonb_build_object('id',c,'name',clinic_name) end,'doctors',doctors,'staff',staff,'actorId',auth.uid());
end $$;
revoke all on function public.clinic_access() from public,anon;
grant execute on function public.clinic_access() to authenticated;

create function public.set_reception_scopes(p_clinic uuid,p_staff uuid,p_doctors uuid[],p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_active is null or p_doctors is null or cardinality(p_doctors)>50 or array_position(p_doctors,null) is not null then raise exception 'Selecione agendas válidas' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_doctors) d where not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=d and status='active')) then raise exception 'Médico não pertence à clínica ativa' using errcode='42501'; end if;
 update public.clinic_staff_members set active=p_active where user_id=p_staff and clinic_id=p_clinic;
 if not found then raise exception 'Integrante indisponível' using errcode='42501'; end if;
 delete from public.staff_doctor_scopes where clinic_id=p_clinic and staff_user_id=p_staff and (not p_active or not(doctor_user_id=any(p_doctors)));
 if p_active then insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) select p_clinic,p_staff,d from unnest(p_doctors) d group by d on conflict do nothing; end if;
end $$;
revoke all on function public.set_reception_scopes(uuid,uuid,uuid[],boolean) from public,anon,authenticated;

create function public.update_reception_staff(p_staff uuid,p_doctors uuid[],p_active boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 perform public.assert_session_assurance();
 select clinic_id into c from public.clinic_members where user_id=auth.uid() and role='admin' and status='active' for share;
 if c is null or auth.role() is distinct from 'authenticated' then raise exception 'Somente administrador da clínica' using errcode='42501'; end if;
 perform public.assert_reception_scope(c);
 perform public.set_reception_scopes(c,p_staff,p_doctors,p_active);
 insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details) values(c,auth.uid(),'staff_scopes_updated',p_staff,jsonb_build_object('active',p_active,'doctorIds',p_doctors));
 return true;
end $$;
revoke all on function public.update_reception_staff(uuid,uuid[],boolean) from public,anon;
grant execute on function public.update_reception_staff(uuid,uuid[],boolean) to authenticated;

create function public.provision_clinic_receptionist(p_actor uuid,p_user uuid,p_name text,p_doctors uuid[]) returns boolean
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
 select clinic_id into c from public.clinic_members where user_id=p_actor and role='admin' and status='active' for share;
 if c is null or public.is_reception_account(p_actor) or exists(select 1 from public.account_deletion_requests where user_id=p_actor) then raise exception 'Administrador indisponível' using errcode='42501'; end if;
 if p_user is null or p_user=p_actor or length(trim(p_name)) not between 2 and 120 or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
 or exists(select 1 from public.clinic_members where user_id=p_user) or exists(select 1 from public.patients where user_id=p_user)
 or exists(select 1 from public.knowledge_documents where user_id=p_user) then raise exception 'Use uma conta dedicada de recepção, sem prontuários' using errcode='42501'; end if;
 insert into public.clinic_staff_members(user_id,clinic_id,name) values(p_user,c,trim(p_name));
 update auth.users set raw_app_meta_data=raw_app_meta_data||'{"account_type":"reception"}'::jsonb where id=p_user;
 perform public.set_reception_scopes(c,p_user,p_doctors,true);
 insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values(c,p_actor,'staff_provisioned',p_user);
 return true;
end $$;
revoke all on function public.provision_clinic_receptionist(uuid,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.provision_clinic_receptionist(uuid,uuid,text,uuid[]) to service_role;
