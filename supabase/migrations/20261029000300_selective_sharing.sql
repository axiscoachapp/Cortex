-- Sharing is a separate authenticated surface. Existing owner-only tables,
-- Storage policies, AI handlers and export paths intentionally stay owner-only.
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'doctor' check(role in ('admin','doctor')),
  status text not null default 'invited' check(status in ('invited','active','inactive')),
  updated_at timestamptz not null default now(),
  primary key(clinic_id,user_id)
);
create table public.patient_shares (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  permission text not null check(permission in ('read','contribute')),
  allow_download boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(patient_id,recipient_user_id),
  check(owner_user_id<>recipient_user_id),
  foreign key(patient_id,owner_user_id) references public.patients(id,user_id) on delete restrict
);
create table public.shared_chart_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  author_name text not null,
  entry_type text not null check(entry_type in ('encounter','addendum')),
  content text not null check(length(trim(content)) between 1 and 50000),
  created_at timestamptz not null default now(),
  foreign key(patient_id,owner_user_id) references public.patients(id,user_id) on delete restrict
);
create table public.chart_access_audit (
  id bigint generated always as identity primary key,
  patient_id uuid,
  clinic_id uuid,
  owner_user_id uuid,
  actor_user_id uuid not null,
  action text not null,
  resource_id uuid,
  created_at timestamptz not null default now()
);
create index patient_shares_recipient on public.patient_shares(recipient_user_id,patient_id);
create index shared_entries_patient on public.shared_chart_entries(patient_id,created_at,id);
create index chart_audit_patient on public.chart_access_audit(patient_id,created_at desc);

create function public.prevent_shared_entry_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Clinical contributions are immutable; append an addendum' using errcode='42501'; end $$;
create trigger immutable_shared_entry before update or delete on public.shared_chart_entries for each row execute function public.prevent_shared_entry_mutation();
revoke all on function public.prevent_shared_entry_mutation() from public;

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.patient_shares enable row level security;
alter table public.shared_chart_entries enable row level security;
alter table public.chart_access_audit enable row level security;
-- No direct client grants: RPCs check current membership/grant on every call.
revoke all on public.clinics,public.clinic_members,public.patient_shares,public.shared_chart_entries,public.chart_access_audit from anon,authenticated;

create function public.sharing_actor() returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Authentication required' using errcode='42501'; end if;
  perform public.assert_session_assurance();
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,123));
  if exists(select 1 from public.account_deletion_requests where user_id=auth.uid()) then raise exception 'Account unavailable' using errcode='42501'; end if;
  return auth.uid();
end $$;
create function public.active_shared_grant(p_patient_id uuid,p_user_id uuid) returns public.patient_shares
language sql stable security definer set search_path='' as $$
 select s from public.patient_shares s
 join public.clinic_members r on r.clinic_id=s.clinic_id and r.user_id=s.recipient_user_id and r.status='active'
 join public.clinic_members o on o.clinic_id=s.clinic_id and o.user_id=s.owner_user_id and o.status='active'
 join public.patients p on p.id=s.patient_id and p.user_id=s.owner_user_id and p.deletion_requested_at is null
 where s.patient_id=p_patient_id and s.recipient_user_id=p_user_id and s.revoked_at is null
 and (s.expires_at is null or s.expires_at>now())
 and not exists(select 1 from public.account_deletion_requests d where d.user_id in (s.owner_user_id,s.recipient_user_id))
$$;
revoke all on function public.sharing_actor(),public.active_shared_grant(uuid,uuid) from public,anon,authenticated;

create function public.create_clinic(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_id uuid;
begin
  if length(trim(p_name)) not between 2 and 120 then raise exception 'Nome da clínica inválido' using errcode='22023'; end if;
  if exists(select 1 from public.clinic_members where user_id=v_actor and status='active') then raise exception 'Você já participa de uma clínica ativa' using errcode='22023'; end if;
  insert into public.clinics(name,created_by) values(trim(p_name),v_actor) returning id into v_id;
  insert into public.clinic_members(clinic_id,user_id,role,status) values(v_id,v_actor,'admin','active');
  insert into public.chart_access_audit(clinic_id,actor_user_id,action) values(v_id,v_actor,'clinic_created');
  return v_id;
end $$;
create function public.invite_clinic_doctor(p_clinic_id uuid,p_email text) returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_user uuid;
begin
  if not exists(select 1 from public.clinic_members where clinic_id=p_clinic_id and user_id=v_actor and role='admin' and status='active') then raise exception 'Not authorized' using errcode='42501'; end if;
  select id into v_user from auth.users where lower(email)=lower(trim(p_email));
  if v_user is null then raise exception 'O médico precisa criar uma conta antes de receber o convite' using errcode='22023'; end if;
  if v_user=v_actor then raise exception 'Você já participa desta clínica' using errcode='22023'; end if;
  insert into public.clinic_members(clinic_id,user_id,role,status) values(p_clinic_id,v_user,'doctor','invited')
  on conflict(clinic_id,user_id) do update set status=case when public.clinic_members.status='active' then 'active' else 'invited' end,updated_at=now();
  insert into public.chart_access_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic_id,v_actor,'member_invited',v_user);
  return true;
end $$;
create function public.respond_clinic_invitation(p_clinic_id uuid,p_accept boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor();
begin
  if p_accept and exists(select 1 from public.clinic_members where user_id=v_actor and clinic_id<>p_clinic_id and status='active') then raise exception 'Você já participa de outra clínica' using errcode='22023'; end if;
  update public.clinic_members set status=case when p_accept then 'active' else 'inactive' end,updated_at=now()
    where clinic_id=p_clinic_id and user_id=v_actor and status='invited';
  if not found then raise exception 'Convite indisponível' using errcode='42501'; end if;
  insert into public.chart_access_audit(clinic_id,actor_user_id,action) values(p_clinic_id,v_actor,case when p_accept then 'invitation_accepted' else 'invitation_declined' end);
  return true;
end $$;
create function public.offboard_clinic_doctor(p_clinic_id uuid,p_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor();
begin
  if p_user_id=v_actor then raise exception 'Não é possível desativar o próprio administrador' using errcode='22023'; end if;
  if not exists(select 1 from public.clinic_members where clinic_id=p_clinic_id and user_id=v_actor and role='admin' and status='active') then raise exception 'Not authorized' using errcode='42501'; end if;
  -- Shares and contributions remain in custody; this transition stops future access.
  update public.clinic_members set status='inactive',updated_at=now() where clinic_id=p_clinic_id and user_id=p_user_id;
  update public.patient_shares set revoked_at=now(),revision=revision+1,updated_at=now() where clinic_id=p_clinic_id and (recipient_user_id=p_user_id or owner_user_id=p_user_id) and revoked_at is null;
  insert into public.chart_access_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic_id,v_actor,'member_offboarded',p_user_id);
  return true;
end $$;
create function public.sharing_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor();
begin
  return jsonb_build_object(
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('clinic_id',c.id,'name',c.name,'role',m.role,'status',m.status)) from public.clinic_members m join public.clinics c on c.id=m.clinic_id where m.user_id=v_actor),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('clinic_id',m.clinic_id,'user_id',m.user_id,'name',coalesce(nullif(s.doctor_name,''),u.email),'status',m.status,'role',m.role)) from public.clinic_members m join auth.users u on u.id=m.user_id left join public.user_settings s on s.user_id=m.user_id where exists(select 1 from public.clinic_members me where me.clinic_id=m.clinic_id and me.user_id=v_actor and me.status='active')),'[]'::jsonb),
    'received',coalesce((select jsonb_agg(jsonb_build_object('patient_id',p.id,'name',p.name,'owner_name',coalesce(nullif(us.doctor_name,''),'Médico responsável'),'permission',s.permission,'allow_download',s.allow_download,'revision',s.revision,'expires_at',s.expires_at)) from public.patient_shares s join public.patients p on p.id=s.patient_id left join public.user_settings us on us.user_id=s.owner_user_id where s.recipient_user_id=v_actor and (public.active_shared_grant(s.patient_id,v_actor)).id is not null),'[]'::jsonb),
    'granted',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'patient_id',s.patient_id,'patient_name',p.name,'recipient_name',coalesce(nullif(us.doctor_name,''),u.email),'permission',s.permission,'allow_download',s.allow_download,'revoked_at',s.revoked_at,'expires_at',s.expires_at)) from public.patient_shares s join public.patients p on p.id=s.patient_id join auth.users u on u.id=s.recipient_user_id left join public.user_settings us on us.user_id=s.recipient_user_id where s.owner_user_id=v_actor),'[]'::jsonb)
  );
end $$;
create function public.grant_patient_share(p_patient_id uuid,p_recipient_user_id uuid,p_permission text,p_allow_download boolean default false,p_expires_at timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_clinic uuid; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,123));
  if p_permission not in ('read','contribute') or p_recipient_user_id=v_actor or (p_expires_at is not null and p_expires_at<=now()) then raise exception 'Permissão ou validade inválida' using errcode='22023'; end if;
  perform 1 from public.patients where id=p_patient_id and user_id=v_actor and deletion_requested_at is null for update;
  if not found then raise exception 'Patient unavailable' using errcode='42501'; end if;
  select a.clinic_id into v_clinic from public.clinic_members a join public.clinic_members b on b.clinic_id=a.clinic_id where a.user_id=v_actor and b.user_id=p_recipient_user_id and a.status='active' and b.status='active' limit 1 for share of a,b;
  if v_clinic is null then raise exception 'Ambos os médicos precisam estar ativos na mesma clínica' using errcode='42501'; end if;
  insert into public.patient_shares(patient_id,owner_user_id,recipient_user_id,clinic_id,permission,allow_download,expires_at)
  values(p_patient_id,v_actor,p_recipient_user_id,v_clinic,p_permission,coalesce(p_allow_download,false),p_expires_at)
  on conflict(patient_id,recipient_user_id) do update set permission=excluded.permission,allow_download=excluded.allow_download,expires_at=excluded.expires_at,revoked_at=null,revision=public.patient_shares.revision+1,updated_at=now() returning id into v_id;
  insert into public.chart_access_audit(patient_id,owner_user_id,actor_user_id,action,resource_id) values(p_patient_id,v_actor,v_actor,'share_granted',v_id);
  return v_id;
end $$;
create function public.revoke_patient_share(p_share_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_share public.patient_shares;
begin
  select * into v_share from public.patient_shares where id=p_share_id and owner_user_id=v_actor for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  update public.patient_shares set revoked_at=now(),revision=revision+1,updated_at=now() where id=p_share_id;
  insert into public.chart_access_audit(patient_id,owner_user_id,actor_user_id,action,resource_id) values(v_share.patient_id,v_actor,v_actor,'share_revoked',p_share_id);
  return true;
end $$;

create function public.check_shared_patient_access(p_patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_share public.patient_shares; v_owner uuid;
begin
  select * into v_share from public.active_shared_grant(p_patient_id,v_actor);
  select user_id into v_owner from public.patients where id=p_patient_id and deletion_requested_at is null;
  if v_share.id is null and v_owner is distinct from v_actor then raise exception 'Acesso revogado ou indisponível' using errcode='42501'; end if;
  if exists(select 1 from public.account_deletion_requests where user_id=v_owner) then raise exception 'Acesso indisponível' using errcode='42501'; end if;
  return jsonb_build_object('permission',case when v_actor=v_owner then 'owner' else v_share.permission end,'authorization_revision',coalesce(v_share.revision,0));
end $$;
create function public.get_shared_patient_chart(p_patient_id uuid,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_share public.patient_shares; v_limit integer:=least(greatest(p_limit,1),500); v_owner uuid; v_chart jsonb; v_final_grant public.patient_shares;
begin
  select * into v_share from public.active_shared_grant(p_patient_id,v_actor);
  select user_id into v_owner from public.patients where id=p_patient_id and deletion_requested_at is null;
  if v_share.id is null and v_owner is distinct from v_actor then raise exception 'Acesso revogado ou indisponível' using errcode='42501'; end if;
  if exists(select 1 from public.account_deletion_requests where user_id=v_owner) then raise exception 'Acesso indisponível' using errcode='42501'; end if;
  insert into public.chart_access_audit(patient_id,owner_user_id,actor_user_id,action) values(p_patient_id,v_owner,v_actor,'chart_viewed');
  v_chart := jsonb_build_object(
    'permission',case when v_actor=v_owner then 'owner' else v_share.permission end,
    'allow_download',case when v_actor=v_owner then true else v_share.allow_download end,
    'authorization_revision',coalesce(v_share.revision,0),
    'patient',(select jsonb_build_object('id',id,'name',name,'age',age,'allergies',allergies,'medications',medications,'diagnoses',diagnoses,'clinical_notes',clinical_notes,'medical_history',medical_history,'social_anamnesis',social_anamnesis) from public.patients where id=p_patient_id),
    'consultations',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,created_at,chief_complaint,soap_note,user_id as author_user_id from public.consultations where patient_id=p_patient_id and user_id=v_owner order by created_at desc,id desc limit v_limit) q),'[]'::jsonb),
    'consultation_count',(select count(*) from public.consultations where patient_id=p_patient_id and user_id=v_owner),
    'entries',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,author_user_id,author_name,entry_type,content,created_at from public.shared_chart_entries where patient_id=p_patient_id order by created_at desc,id desc limit v_limit) q),'[]'::jsonb),
    'entry_count',(select count(*) from public.shared_chart_entries where patient_id=p_patient_id),
    'files',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,file_name,mime_type,created_at from public.patient_files where patient_id=p_patient_id and user_id=v_owner order by created_at desc,id desc limit v_limit) q),'[]'::jsonb),
    'file_count',(select count(*) from public.patient_files where patient_id=p_patient_id and user_id=v_owner),
    'prescriptions',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,created_at,status,expires_at from public.prescriptions where patient_id=p_patient_id and user_id=v_owner order by created_at desc,id desc limit v_limit) q),'[]'::jsonb),
    'structured_history',coalesce((select jsonb_agg(to_jsonb(q)) from (
      select w.id,w.kind,w.title,w.content,w.details,w.status,w.created_at,w.updated_at,w.user_id as author_user_id,coalesce(nullif(us.doctor_name,''),'Médico responsável') as author_name
      from public.clinical_work_items w left join public.user_settings us on us.user_id=w.user_id
      where w.patient_id=p_patient_id and w.user_id=v_owner and (
        (w.kind in ('observation','pregnancy') and w.status not in ('draft','cancelled')) or
        (w.kind in ('medication','instruction','intake') and w.status='approved')
      ) order by w.created_at desc,w.id desc limit v_limit
    ) q),'[]'::jsonb),
    'structured_history_count',(select count(*) from public.clinical_work_items w where w.patient_id=p_patient_id and w.user_id=v_owner and (
      (w.kind in ('observation','pregnancy') and w.status not in ('draft','cancelled')) or
      (w.kind in ('medication','instruction','intake') and w.status='approved')
    ))
  );
  if v_owner<>v_actor then
    select * into v_final_grant from public.active_shared_grant(p_patient_id,v_actor);
    if v_final_grant.id is null or v_final_grant.revision is distinct from v_share.revision then raise exception 'Permissões alteradas durante a consulta. Reabra o prontuário.' using errcode='42501'; end if;
  end if;
  return v_chart;
end $$;
create function public.append_shared_chart_entry(p_patient_id uuid,p_expected_authorization_revision integer,p_entry_type text,p_content text,p_request_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor(); v_share public.patient_shares; v_owner uuid; v_id uuid; v_author text; v_existing public.shared_chart_entries;
begin
  -- Lock the grant so revoke and append have a single transaction order. A
  -- stale editor cannot contribute after revoke/regrant, even if permission returns.
  select user_id into v_owner from public.patients where id=p_patient_id and deletion_requested_at is null for update;
  select * into v_share from public.patient_shares where patient_id=p_patient_id and recipient_user_id=v_actor for update;
  if v_owner is distinct from v_actor then
    if (public.active_shared_grant(p_patient_id,v_actor)).id is null or v_share.permission<>'contribute' then raise exception 'Contribuição não autorizada' using errcode='42501'; end if;
    if v_share.revision is distinct from p_expected_authorization_revision then raise exception 'Permissões alteradas. Reabra o prontuário.' using errcode='40001'; end if;
  end if;
  if v_owner is null or exists(select 1 from public.account_deletion_requests where user_id=v_owner) then raise exception 'Prontuário indisponível' using errcode='42501'; end if;
  if p_entry_type not in ('encounter','addendum') or length(trim(p_content)) not between 1 and 50000 then raise exception 'Registro inválido' using errcode='22023'; end if;
  if p_request_id is null then raise exception 'Missing request identity' using errcode='22023'; end if;
  select * into v_existing from public.shared_chart_entries where id=p_request_id;
  if found then
    if v_existing.patient_id=p_patient_id and v_existing.author_user_id=v_actor and v_existing.entry_type=p_entry_type and v_existing.content=trim(p_content) then return v_existing.id; end if;
    raise exception 'Request identity already used' using errcode='22023';
  end if;
  select coalesce(nullif(s.doctor_name,''),u.email) into v_author from auth.users u left join public.user_settings s on s.user_id=u.id where u.id=v_actor;
  insert into public.shared_chart_entries(id,patient_id,owner_user_id,author_user_id,actor_user_id,author_name,entry_type,content) values(p_request_id,p_patient_id,v_owner,v_actor,v_actor,v_author,p_entry_type,trim(p_content)) returning id into v_id;
  insert into public.chart_access_audit(patient_id,owner_user_id,actor_user_id,action,resource_id) values(p_patient_id,v_owner,v_actor,'entry_added',v_id);
  return v_id;
end $$;

-- Service-only, checked twice by the authenticated streaming boundary. No
-- recipient receives a storage path or a reusable signed URL.
create function public.authorize_shared_file(p_actor_user_id uuid,p_file_id uuid,p_record_access boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_file public.patient_files; v_share public.patient_shares;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into v_file from public.patient_files where id=p_file_id;
  select * into v_share from public.active_shared_grant(v_file.patient_id,p_actor_user_id);
  if v_file.id is null or (v_file.user_id<>p_actor_user_id and (v_share.id is null or not v_share.allow_download)) then raise exception 'Download não autorizado' using errcode='42501'; end if;
  if not public.is_canonical_storage_path(v_file.storage_path) or not starts_with(v_file.storage_path,'patients/'||v_file.user_id::text||'/'||v_file.patient_id::text||'/') then raise exception 'Arquivo indisponível' using errcode='42501'; end if;
  if exists(select 1 from public.patients where id=v_file.patient_id and deletion_requested_at is not null) or exists(select 1 from public.account_deletion_requests where user_id in (v_file.user_id,p_actor_user_id)) then raise exception 'Prontuário indisponível' using errcode='42501'; end if;
  if p_record_access then insert into public.chart_access_audit(patient_id,owner_user_id,actor_user_id,action,resource_id) values(v_file.patient_id,v_file.user_id,p_actor_user_id,'file_delivery_authorized',v_file.id); end if;
  return jsonb_build_object('storage_path',v_file.storage_path,'owner_user_id',v_file.user_id,'patient_id',v_file.patient_id,'file_name',v_file.file_name,'mime_type',v_file.mime_type);
end $$;
create function public.patient_sharing_audit(p_patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.sharing_actor();
begin
  if not exists(select 1 from public.patients where id=p_patient_id and user_id=v_actor) then raise exception 'Not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(q)) from (select a.action,a.created_at,coalesce(nullif(s.doctor_name,''),u.email,'Médico removido') as actor_name from public.chart_access_audit a left join auth.users u on u.id=a.actor_user_id left join public.user_settings s on s.user_id=a.actor_user_id where a.patient_id=p_patient_id order by a.created_at desc,a.id desc limit 100) q),'[]'::jsonb);
end $$;

-- Existing preflight and BEFORE DELETE triggers now also guard shared custody.
alter function public.assert_deletion_scope(uuid,uuid) rename to assert_deletion_scope_legacy;
create function public.assert_deletion_scope(p_user_id uuid,p_patient_id uuid default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,123));
  if exists(select 1 from public.patient_shares where (owner_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id)) or (p_patient_id is null and recipient_user_id=p_user_id))
    or (p_patient_id is null and exists(select 1 from public.clinics where created_by=p_user_id))
    or exists(select 1 from public.shared_chart_entries where (owner_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id)) or (p_patient_id is null and author_user_id=p_user_id)) then
    raise exception 'Shared chart custody must be resolved before deletion' using errcode='P4091';
  end if;
  return public.assert_deletion_scope_legacy(p_user_id,p_patient_id);
end $$;
revoke all on function public.assert_deletion_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_deletion_scope(uuid,uuid) to service_role;

-- Repeat custody checks in the transaction that commits deletion intent.
-- A separate HTTP preflight alone leaves a gap in which a grant can be created.
create function public.guard_shared_deletion_intent() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='account_deletion_requests' then
    perform public.assert_deletion_scope(new.user_id,null);
  elsif new.deletion_requested_at is not null and old.deletion_requested_at is null then
    perform public.assert_deletion_scope(new.user_id,new.id);
  end if;
  return new;
end $$;
revoke all on function public.guard_shared_deletion_intent() from public;
create trigger shared_custody_deletion_intent before insert or update on public.account_deletion_requests for each row execute function public.guard_shared_deletion_intent();
create trigger shared_custody_deletion_intent before update of deletion_requested_at on public.patients for each row execute function public.guard_shared_deletion_intent();

revoke all on function public.create_clinic(text),public.invite_clinic_doctor(uuid,text),public.respond_clinic_invitation(uuid,boolean),public.offboard_clinic_doctor(uuid,uuid),public.sharing_overview(),public.grant_patient_share(uuid,uuid,text,boolean,timestamptz),public.revoke_patient_share(uuid),public.check_shared_patient_access(uuid),public.get_shared_patient_chart(uuid,integer),public.append_shared_chart_entry(uuid,integer,text,text,uuid),public.patient_sharing_audit(uuid),public.authorize_shared_file(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.create_clinic(text),public.invite_clinic_doctor(uuid,text),public.respond_clinic_invitation(uuid,boolean),public.offboard_clinic_doctor(uuid,uuid),public.sharing_overview(),public.grant_patient_share(uuid,uuid,text,boolean,timestamptz),public.revoke_patient_share(uuid),public.check_shared_patient_access(uuid),public.get_shared_patient_chart(uuid,integer),public.append_shared_chart_entry(uuid,integer,text,text,uuid),public.patient_sharing_audit(uuid) to authenticated;
grant execute on function public.authorize_shared_file(uuid,uuid,boolean) to service_role;
