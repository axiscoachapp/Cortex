create table public.clinic_contacts (
 id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete restrict,
 name text not null check(length(trim(name)) between 2 and 200), phone text not null default '', phone_normalized text,
 created_by uuid not null references auth.users(id) on delete restrict, request_id uuid not null,
 created_at timestamptz not null default now(), unique(clinic_id,id), unique(clinic_id,created_by,request_id)
);
create index clinic_contact_phone on public.clinic_contacts(clinic_id,phone_normalized);
create table public.patient_contact_links (
 clinic_id uuid not null, contact_id uuid not null, patient_id uuid not null, doctor_user_id uuid not null,
 relationship text not null check(relationship in ('self','guardian','family','other')),
 confirmed_by uuid not null references auth.users(id) on delete restrict, confirmed_at timestamptz not null default now(),
 primary key(contact_id,patient_id), foreign key(clinic_id,contact_id) references public.clinic_contacts(clinic_id,id) on delete restrict,
 foreign key(patient_id,doctor_user_id) references public.patients(id,user_id) on delete restrict,
 foreign key(clinic_id,doctor_user_id) references public.clinic_members(clinic_id,user_id) on delete restrict
);
create table public.reception_cases (
 id uuid primary key default gen_random_uuid(), clinic_id uuid not null, contact_id uuid not null,
 doctor_user_id uuid, subject text not null check(length(trim(subject)) between 2 and 200),
 kind text not null check(kind in ('first_consult','return','scheduling','information','other')),
 status text not null default 'new' check(status in ('new','assigned','waiting_patient','waiting_internal','resolved','cancelled')),
 assigned_to uuid references auth.users(id) on delete restrict, created_by uuid not null references auth.users(id) on delete restrict,
 request_id uuid not null, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(clinic_id,id), unique(clinic_id,created_by,request_id),
 foreign key(clinic_id,contact_id) references public.clinic_contacts(clinic_id,id) on delete restrict,
 foreign key(clinic_id,doctor_user_id) references public.clinic_members(clinic_id,user_id) on delete restrict,
 check(status<>'new' or assigned_to is null), check(status<>'assigned' or assigned_to is not null)
);
create index reception_queue_order on public.reception_cases(clinic_id,created_at desc,id desc);
create index reception_case_assignee on public.reception_cases(clinic_id,assigned_to,status);
create table public.reception_case_notes (
 id uuid primary key, case_id uuid not null references public.reception_cases(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 body text not null check(length(trim(body)) between 1 and 4000), created_at timestamptz not null default now()
);
create table public.reception_case_drafts (
 case_id uuid not null references public.reception_cases(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 body text not null check(length(body)<=4000), revision integer not null default 1, updated_at timestamptz not null default now(),
 primary key(case_id,actor_user_id)
);
do $$ declare t text; begin
 foreach t in array array['clinic_contacts','patient_contact_links','reception_cases','reception_case_notes','reception_case_drafts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.normalize_reception_phone(p_raw text) returns text language plpgsql immutable set search_path='' as $$
declare digits text:=regexp_replace(coalesce(p_raw,''),'[^0-9]','','g');
begin
 if trim(coalesce(p_raw,''))='' then return null; end if;
 if length(p_raw)>40 or p_raw !~ '^[+0-9 ().-]+$' or length(digits) not between 10 and 15 then raise exception 'Informe telefone com DDD ou internacional com +' using errcode='22023'; end if;
 if trim(p_raw) not like '+%' and length(digits) in (10,11) then return '55'||digits; end if;
 return digits;
end $$;
revoke all on function public.normalize_reception_phone(text) from public,anon,authenticated;

create function public.reception_contact_allowed(p_contact uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.clinic_contacts c where c.id=p_contact and public.reception_scope_ok(c.clinic_id)
 and (exists(select 1 from public.clinic_members where clinic_id=c.clinic_id and user_id=auth.uid() and role='admin' and status='active')
 or exists(select 1 from public.patient_contact_links l where l.contact_id=c.id and public.reception_scope_ok(c.clinic_id,l.doctor_user_id))
 or exists(select 1 from public.reception_cases r where r.contact_id=c.id and public.reception_scope_ok(c.clinic_id,r.doctor_user_id))
 or (not exists(select 1 from public.patient_contact_links where contact_id=c.id) and not exists(select 1 from public.reception_cases where contact_id=c.id))));
$$;
revoke all on function public.reception_contact_allowed(uuid) from public,anon,authenticated;

create function public.reception_create_contact(p_clinic uuid,p_name text,p_phone text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_reception_scope(p_clinic); c public.clinic_contacts; normalized text;
begin
 if p_name is null or length(trim(p_name)) not between 2 and 200 or p_request is null then raise exception 'Informe nome e identificação da operação' using errcode='22023'; end if;
 normalized:=public.normalize_reception_phone(p_phone);
 insert into public.clinic_contacts(clinic_id,name,phone,phone_normalized,created_by,request_id)
 values(p_clinic,trim(p_name),trim(coalesce(p_phone,'')),normalized,actor,p_request) on conflict(clinic_id,created_by,request_id) do nothing returning * into c;
 if c.id is null then
  select * into c from public.clinic_contacts where clinic_id=p_clinic and created_by=actor and request_id=p_request;
  if c.name<>trim(p_name) or c.phone<>trim(coalesce(p_phone,'')) then raise exception 'Operação já usada com outros dados' using errcode='22023'; end if;
 else insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic,actor,'contact_created',c.id); end if;
 return c.id;
end $$;

create function public.reception_contacts(p_clinic uuid,p_search text default '',p_before uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; before_at timestamptz; digits text:=regexp_replace(coalesce(p_search,''),'[^0-9]','','g');
begin
 if not coalesce(public.reception_scope_ok(p_clinic),false) then raise exception 'Sem acesso à recepção' using errcode='42501'; end if;
 if length(coalesce(p_search,''))>200 then raise exception 'Pesquisa muito longa' using errcode='22023'; end if;
 if p_before is not null then select created_at into before_at from public.clinic_contacts where id=p_before and clinic_id=p_clinic and public.reception_contact_allowed(id); if not found then raise exception 'Cursor indisponível' using errcode='22023'; end if; end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page."createdAt" desc,page.id desc),'[]') into items from (
 select id,name,phone,created_at as "createdAt" from public.clinic_contacts c where clinic_id=p_clinic and public.reception_contact_allowed(id)
 and (coalesce(p_search,'')='' or position(lower(p_search) in lower(name))>0 or (digits<>'' and
  (position(digits in phone_normalized)>0 or (phone_normalized is null and position(digits in regexp_replace(phone,'[^0-9]','','g'))>0))))
 and (p_before is null or (created_at,id)<(before_at,p_before)) order by created_at desc,id desc limit 50) page;
 return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=50 then items->49->>'id' else null end);
end $$;

create function public.reception_patient_search(p_clinic uuid,p_doctor uuid,p_search text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 if not coalesce(public.reception_scope_ok(p_clinic,p_doctor),false) then raise exception 'Agenda não delegada' using errcode='42501'; end if;
 if p_doctor is null or length(trim(coalesce(p_search,''))) not between 2 and 200 then return '[]'; end if;
 select coalesce(jsonb_agg(to_jsonb(page)),'[]') into items from (
  select id,name,date_of_birth as "dateOfBirth" from public.patients where user_id=p_doctor and deletion_requested_at is null and archived_at is null
  and position(lower(trim(p_search)) in lower(name))>0 order by name,id limit 25) page;
 return items;
end $$;

create function public.reception_contact(p_contact uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.clinic_contacts; beneficiaries jsonb;
begin
 if not coalesce(public.reception_contact_allowed(p_contact),false) then raise exception 'Contato indisponível' using errcode='42501'; end if;
 select * into c from public.clinic_contacts where id=p_contact;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'dateOfBirth',p.date_of_birth,'doctorId',l.doctor_user_id,'relationship',l.relationship) order by p.name),'[]') into beneficiaries
 from public.patient_contact_links l join public.patients p on p.id=l.patient_id and p.user_id=l.doctor_user_id
 where l.contact_id=c.id and p.archived_at is null and p.deletion_requested_at is null and public.reception_scope_ok(c.clinic_id,l.doctor_user_id);
 return jsonb_build_object('id',c.id,'clinicId',c.clinic_id,'name',c.name,'phone',c.phone,'beneficiaries',beneficiaries);
end $$;

create function public.reception_link_patient(p_contact uuid,p_doctor uuid,p_patient uuid,p_relationship text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.clinic_contacts; actor uuid;
begin
 select * into c from public.clinic_contacts where id=p_contact;
 actor:=public.assert_reception_scope(c.clinic_id,p_doctor);
 if not coalesce(public.reception_contact_allowed(c.id),false) then raise exception 'Contato indisponível' using errcode='42501'; end if;
 if p_relationship is null or p_relationship not in ('self','guardian','family','other') then raise exception 'Confirme a relação com o paciente' using errcode='22023'; end if;
 if not exists(select 1 from public.patients where id=p_patient and user_id=p_doctor and archived_at is null and deletion_requested_at is null) then raise exception 'Paciente indisponível' using errcode='42501'; end if;
 insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by)
 values(c.clinic_id,c.id,p_patient,p_doctor,p_relationship,actor) on conflict(contact_id,patient_id) do update set relationship=excluded.relationship,confirmed_by=excluded.confirmed_by,confirmed_at=now();
 insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details) values(c.clinic_id,actor,'beneficiary_confirmed',c.id,jsonb_build_object('patientId',p_patient,'doctorId',p_doctor,'relationship',p_relationship));
 return true;
end $$;

create function public.reception_create_case(p_contact uuid,p_doctor uuid,p_subject text,p_kind text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.clinic_contacts; r public.reception_cases; actor uuid;
begin
 select * into c from public.clinic_contacts where id=p_contact;
 actor:=public.assert_reception_scope(c.clinic_id,p_doctor);
 if not coalesce(public.reception_contact_allowed(c.id),false) then raise exception 'Contato indisponível' using errcode='42501'; end if;
 if p_subject is null or length(trim(p_subject)) not between 2 and 200 or p_request is null or p_kind is null or p_kind not in ('first_consult','return','scheduling','information','other') then raise exception 'Informe assunto e tipo de atendimento' using errcode='22023'; end if;
 insert into public.reception_cases(clinic_id,contact_id,doctor_user_id,subject,kind,created_by,request_id)
 values(c.clinic_id,c.id,p_doctor,trim(p_subject),p_kind,actor,p_request) on conflict(clinic_id,created_by,request_id) do nothing returning * into r;
 if r.id is null then
  select * into r from public.reception_cases where clinic_id=c.clinic_id and created_by=actor and request_id=p_request;
  if r.contact_id<>p_contact or r.doctor_user_id is distinct from p_doctor or r.subject<>trim(p_subject) or r.kind<>p_kind then raise exception 'Operação já usada com outros dados' using errcode='22023'; end if;
 else insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values(c.clinic_id,actor,'case_created',r.id); end if;
 return r.id;
end $$;

create function public.reception_queue(p_clinic uuid,p_status text default 'open',p_mine boolean default false,p_doctor uuid default null,p_before uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; before_at timestamptz;
begin
 if not coalesce(public.reception_scope_ok(p_clinic,p_doctor),false) then raise exception 'Sem acesso à fila' using errcode='42501'; end if;
 if p_before is not null then select created_at into before_at from public.reception_cases where id=p_before and clinic_id=p_clinic and public.reception_scope_ok(clinic_id,doctor_user_id); if not found then raise exception 'Cursor indisponível' using errcode='22023'; end if; end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page."createdAt" desc,page.id desc),'[]') into items from (
  select r.id,r.subject,r.kind,r.status,r.revision,r.contact_id as "contactId",c.name as "contactName",c.phone,
   r.doctor_user_id as "doctorId",r.assigned_to as "assignedTo",coalesce(s.name,u.doctor_name) as "assigneeName",r.created_at as "createdAt"
  from public.reception_cases r join public.clinic_contacts c on c.id=r.contact_id
  left join public.clinic_staff_members s on s.user_id=r.assigned_to left join public.user_settings u on u.user_id=r.assigned_to
  where r.clinic_id=p_clinic and public.reception_scope_ok(r.clinic_id,r.doctor_user_id)
  and (p_doctor is null or r.doctor_user_id=p_doctor) and (not p_mine or r.assigned_to=auth.uid())
  and ((p_status='open' and r.status not in ('resolved','cancelled')) or p_status='all' or r.status=p_status)
  and (p_before is null or (r.created_at,r.id)<(before_at,p_before)) order by r.created_at desc,r.id desc limit 50) page;
 return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=50 then items->49->>'id' else null end);
end $$;

create function public.reception_case(p_case uuid,p_before_note uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.reception_cases; c public.clinic_contacts; notes jsonb; beneficiaries jsonb; eligible jsonb; draft jsonb; before_at timestamptz;
begin
 select * into r from public.reception_cases where id=p_case;
 if not coalesce(public.reception_scope_ok(r.clinic_id,r.doctor_user_id),false) then raise exception 'Atendimento indisponível' using errcode='42501'; end if;
 select * into c from public.clinic_contacts where id=r.contact_id;
 if p_before_note is not null then select created_at into before_at from public.reception_case_notes where id=p_before_note and case_id=r.id; if not found then raise exception 'Cursor indisponível' using errcode='22023'; end if; end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page."createdAt",page.id),'[]') into notes from (
 select n.id,n.body,n.actor_user_id as "actorId",coalesce(s.name,u.doctor_name,'Equipe') as "actorName",n.created_at as "createdAt"
 from public.reception_case_notes n left join public.clinic_staff_members s on s.user_id=n.actor_user_id left join public.user_settings u on u.user_id=n.actor_user_id
 where n.case_id=r.id and (p_before_note is null or (n.created_at,n.id)<(before_at,p_before_note)) order by n.created_at desc,n.id desc limit 50) page;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'dateOfBirth',p.date_of_birth,'doctorId',l.doctor_user_id,'relationship',l.relationship) order by p.name),'[]') into beneficiaries
 from public.patient_contact_links l join public.patients p on p.id=l.patient_id and p.user_id=l.doctor_user_id
 where l.contact_id=r.contact_id and p.deletion_requested_at is null and p.archived_at is null and public.reception_scope_ok(r.clinic_id,l.doctor_user_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') into eligible from (
 select s.user_id as id,s.name from public.clinic_staff_members s where s.clinic_id=r.clinic_id and public.reception_actor_allowed(r.clinic_id,r.doctor_user_id,s.user_id)
 union select m.user_id,coalesce(nullif(u.doctor_name,''),'Médico') from public.clinic_members m left join public.user_settings u on u.user_id=m.user_id
 where m.clinic_id=r.clinic_id and m.status='active' and public.reception_actor_allowed(r.clinic_id,r.doctor_user_id,m.user_id)) candidates;
 select jsonb_build_object('body',d.body,'revision',d.revision) into draft from public.reception_case_drafts d where case_id=r.id and actor_user_id=auth.uid();
 return jsonb_build_object('id',r.id,'clinicId',r.clinic_id,'contactId',c.id,'contactName',c.name,'phone',c.phone,'doctorId',r.doctor_user_id,
 'subject',r.subject,'kind',r.kind,'status',r.status,'assignedTo',r.assigned_to,'revision',r.revision,'createdAt',r.created_at,
 'beneficiaries',beneficiaries,'eligibleAssignees',eligible,'notes',notes,'noteCount',(select count(*) from public.reception_case_notes where case_id=r.id),
 'draft',coalesce(draft,'{"body":"","revision":0}'));
end $$;

create function public.reception_update_case(p_case uuid,p_revision integer,p_action text,p_value jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.reception_cases; actor uuid; admin boolean; target uuid; next_status text;
begin
 select * into r from public.reception_cases where id=p_case;
 actor:=public.assert_reception_scope(r.clinic_id,r.doctor_user_id);
 if p_action='transfer' then
  target:=(p_value->>'assigneeId')::uuid;
  perform 1 from public.clinic_members where clinic_id=r.clinic_id and user_id=target for share;
  perform 1 from public.clinic_staff_members where clinic_id=r.clinic_id and user_id=target for share;
  perform 1 from public.staff_doctor_scopes where clinic_id=r.clinic_id and staff_user_id=target for share;
 elsif p_action='route' then
  perform public.assert_reception_scope(r.clinic_id,(p_value->>'doctorId')::uuid);
  perform 1 from public.clinic_members where clinic_id=r.clinic_id and user_id=r.assigned_to for share;
  perform 1 from public.clinic_staff_members where clinic_id=r.clinic_id and user_id=r.assigned_to for share;
  perform 1 from public.staff_doctor_scopes where clinic_id=r.clinic_id and staff_user_id=r.assigned_to for share;
 end if;
 select * into r from public.reception_cases where id=p_case for update;
 perform public.assert_reception_scope(r.clinic_id,r.doctor_user_id);
 if p_revision is distinct from r.revision then raise exception 'O atendimento foi atualizado. Recarregue a fila.' using errcode='40001'; end if;
 admin:=exists(select 1 from public.clinic_members where clinic_id=r.clinic_id and user_id=actor and role='admin' and status='active');
 if p_action='claim' then
  if r.status in ('resolved','cancelled') or (r.assigned_to is not null and r.assigned_to<>actor) then raise exception 'Atendimento já assumido ou encerrado' using errcode='40001'; end if;
  update public.reception_cases set assigned_to=actor,status='assigned' where id=r.id;
 elsif p_action='reopen' then
  if r.status not in ('resolved','cancelled') then raise exception 'Atendimento já está aberto' using errcode='40001'; end if;
  update public.reception_cases set assigned_to=null,status='new' where id=r.id;
 else
  if r.status in ('resolved','cancelled') then raise exception 'Reabra o atendimento antes de alterar' using errcode='22023'; end if;
  if not admin and r.assigned_to is distinct from actor then raise exception 'Assuma o atendimento antes de alterar' using errcode='42501'; end if;
  if p_action='transfer' then
   target:=(p_value->>'assigneeId')::uuid;
   if not coalesce(public.reception_actor_allowed(r.clinic_id,r.doctor_user_id,target),false) then raise exception 'Atendente sem permissão nesta fila' using errcode='42501'; end if;
   update public.reception_cases set assigned_to=target,status='assigned' where id=r.id;
  elsif p_action='route' then
   target:=(p_value->>'doctorId')::uuid;
   perform public.assert_reception_scope(r.clinic_id,target);
   if target is null then raise exception 'Selecione um médico' using errcode='22023'; end if;
   update public.reception_cases set doctor_user_id=target,
    assigned_to=case when public.reception_actor_allowed(r.clinic_id,target,r.assigned_to) then r.assigned_to else null end,
    status=case when r.status='assigned' and not public.reception_actor_allowed(r.clinic_id,target,r.assigned_to) then 'new' else r.status end where id=r.id;
  elsif p_action='status' then
   next_status:=p_value->>'status';
   if r.status in ('resolved','cancelled') or next_status is null or next_status not in ('assigned','waiting_patient','waiting_internal','resolved','cancelled') then raise exception 'Transição inválida' using errcode='22023'; end if;
   update public.reception_cases set status=next_status where id=r.id;
  else raise exception 'Ação inválida' using errcode='22023'; end if;
 end if;
 update public.reception_cases set revision=revision+1,updated_at=now() where id=r.id returning revision into p_revision;
 insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details) values(r.clinic_id,actor,'case_'||p_action,r.id,
  jsonb_build_object('revision',p_revision,'doctorId',case when p_action='route' then target end,
   'assigneeId',case when p_action='transfer' then target end,'status',case when p_action='status' then next_status end));
 return p_revision;
end $$;

create function public.reception_add_note(p_case uuid,p_body text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reception_cases; actor uuid; n public.reception_case_notes; draft jsonb;
begin
 select * into r from public.reception_cases where id=p_case;
 actor:=public.assert_reception_scope(r.clinic_id,r.doctor_user_id);
 select * into r from public.reception_cases where id=p_case for update;
 perform public.assert_reception_scope(r.clinic_id,r.doctor_user_id);
 if r.assigned_to is distinct from actor and not exists(select 1 from public.clinic_members where clinic_id=r.clinic_id and user_id=actor and role='admin' and status='active') then raise exception 'Assuma o atendimento antes de registrar' using errcode='42501'; end if;
 if p_request is null or p_body is null or length(trim(p_body)) not between 1 and 4000 then raise exception 'Anotação deve ter entre 1 e 4.000 caracteres' using errcode='22023'; end if;
 if r.status in ('resolved','cancelled') and not exists(select 1 from public.reception_case_notes where id=p_request and case_id=r.id and actor_user_id=actor and body=trim(p_body)) then raise exception 'Reabra o atendimento para registrar novas anotações' using errcode='22023'; end if;
 insert into public.reception_case_notes(id,case_id,actor_user_id,body) values(p_request,r.id,actor,trim(p_body)) on conflict(id) do nothing returning * into n;
 if n.id is null then
  select * into n from public.reception_case_notes where id=p_request;
  if n.case_id<>r.id or n.actor_user_id<>actor or n.body<>trim(p_body) then raise exception 'Operação já utilizada' using errcode='22023'; end if;
 else insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values(r.clinic_id,actor,'case_note_added',n.id); end if;
 update public.reception_case_drafts d set body='',revision=d.revision+1,updated_at=now() where d.case_id=r.id and d.actor_user_id=actor and trim(d.body)=trim(p_body);
 select jsonb_build_object('body',d.body,'revision',d.revision) into draft from public.reception_case_drafts d where d.case_id=r.id and d.actor_user_id=actor;
 return jsonb_build_object('id',n.id,'draft',coalesce(draft,'{"body":"","revision":0}'));
end $$;

create function public.reception_save_draft(p_case uuid,p_body text,p_revision integer) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.reception_cases; actor uuid; revision integer;
begin
 select * into r from public.reception_cases where id=p_case;
 actor:=public.assert_reception_scope(r.clinic_id,r.doctor_user_id);
 select * into r from public.reception_cases where id=p_case for update;
 perform public.assert_reception_scope(r.clinic_id,r.doctor_user_id);
 if p_body is null or length(p_body)>4000 or p_revision is null then raise exception 'Rascunho inválido' using errcode='22023'; end if;
 if p_revision=0 then
  insert into public.reception_case_drafts(case_id,actor_user_id,body) values(r.id,actor,p_body) on conflict do nothing returning reception_case_drafts.revision into revision;
 else
  update public.reception_case_drafts d set body=p_body,revision=d.revision+1,updated_at=now() where d.case_id=r.id and d.actor_user_id=actor and d.revision=p_revision returning d.revision into revision;
 end if;
 if revision is null then raise exception 'Rascunho alterado em outra aba. Preserve o texto antes de recarregar.' using errcode='40001'; end if;
 return revision;
end $$;

-- Removing a scope immediately releases open work whose assignee is no longer eligible.
create function public.release_reception_assignments() returns trigger language plpgsql security definer set search_path='' as $$
declare r record; affected_clinic uuid;
begin
 affected_clinic:=case when tg_op='DELETE' then old.clinic_id else new.clinic_id end;
 -- An inactive physician's open work must return to intake, rather than disappear
 -- behind the active-doctor permission check. The historical chart stays private.
 for r in update public.reception_cases c set doctor_user_id=null,assigned_to=null,
  status='new',revision=revision+1,updated_at=now()
  where c.clinic_id=affected_clinic and c.status not in ('resolved','cancelled') and c.doctor_user_id is not null
  and not exists(select 1 from public.clinic_members m where m.clinic_id=c.clinic_id and m.user_id=c.doctor_user_id and m.status='active')
  returning c.clinic_id,c.id,c.revision loop
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(r.clinic_id,auth.uid(),'case_returned_to_intake',r.id,jsonb_build_object('revision',r.revision));
 end loop;
 for r in update public.reception_cases c set assigned_to=null,status=case when status='assigned' then 'new' else status end,revision=revision+1,updated_at=now()
  where c.clinic_id=affected_clinic and assigned_to is not null and status not in ('resolved','cancelled') and not public.reception_actor_allowed(c.clinic_id,c.doctor_user_id,c.assigned_to)
  returning c.clinic_id,c.id,c.revision loop
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(r.clinic_id,auth.uid(),'case_assignment_released',r.id,jsonb_build_object('revision',r.revision));
 end loop;
 return null;
end $$;
revoke all on function public.release_reception_assignments() from public,anon,authenticated;
create trigger reception_staff_release after update of active on public.clinic_staff_members for each row execute function public.release_reception_assignments();
create trigger reception_scope_release after delete on public.staff_doctor_scopes for each row execute function public.release_reception_assignments();
create trigger reception_doctor_release after update of status on public.clinic_members for each row execute function public.release_reception_assignments();

do $$ declare signature text; begin
 foreach signature in array array[
 'public.reception_create_contact(uuid,text,text,uuid)','public.reception_contacts(uuid,text,uuid)',
 'public.reception_patient_search(uuid,uuid,text)','public.reception_contact(uuid)','public.reception_link_patient(uuid,uuid,uuid,text)',
 'public.reception_create_case(uuid,uuid,text,text,uuid)','public.reception_queue(uuid,text,boolean,uuid,uuid)',
 'public.reception_case(uuid,uuid)','public.reception_update_case(uuid,integer,text,jsonb)',
 'public.reception_add_note(uuid,text,uuid)','public.reception_save_draft(uuid,text,integer)'] loop
  execute format('revoke all on function %s from public,anon',signature);
  execute format('grant execute on function %s to authenticated',signature);
 end loop;
end $$;
