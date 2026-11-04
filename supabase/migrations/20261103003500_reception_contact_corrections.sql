-- Correct the administrative interlocutor without changing a doctor's patient.
alter table public.clinic_contacts
 add column revision integer not null default 1,
 add column updated_at timestamptz not null default now(),
 add column creation_payload_hash bytea;
-- Preserve creation retry semantics after mutable name/phone are corrected. Store
-- a private digest, rather than a second copy of the original personal values.
update public.clinic_contacts set creation_payload_hash=sha256(convert_to(jsonb_build_array(trim(name),trim(phone))::text,'UTF8'));
alter table public.clinic_contacts alter column creation_payload_hash set not null;

create function public.guard_reception_contact_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.creation_payload_hash:=sha256(convert_to(jsonb_build_array(trim(new.name),trim(new.phone))::text,'UTF8'));
  new.revision:=1;return new;
 end if;
 if (new.id,new.clinic_id,new.created_by,new.request_id,new.created_at,new.creation_payload_hash)
  is distinct from (old.id,old.clinic_id,old.created_by,old.request_id,old.created_at,old.creation_payload_hash) then
  raise exception 'Identidade e origem do contato são imutáveis' using errcode='42501';
 end if;
 if (new.name,new.phone,new.phone_normalized) is distinct from (old.name,old.phone,old.phone_normalized) then
  new.revision:=old.revision+1;new.updated_at:=now();
 else new.revision:=old.revision;new.updated_at:=old.updated_at;end if;
 return new;
end $$;
revoke all on function public.guard_reception_contact_identity() from public,anon,authenticated;
create trigger reception_contact_identity before insert or update on public.clinic_contacts for each row execute function public.guard_reception_contact_identity();

create or replace function public.reception_create_contact(p_clinic uuid,p_name text,p_phone text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_reception_scope(p_clinic); c public.clinic_contacts; normalized text; payload_hash bytea;
begin
 if p_name is null or length(trim(p_name)) not between 2 and 200 or p_request is null then raise exception 'Informe nome e identificação da operação' using errcode='22023';end if;
 normalized:=public.normalize_reception_phone(p_phone);
 payload_hash:=sha256(convert_to(jsonb_build_array(trim(p_name),trim(coalesce(p_phone,'')))::text,'UTF8'));
 insert into public.clinic_contacts(clinic_id,name,phone,phone_normalized,created_by,request_id)
 values(p_clinic,trim(p_name),trim(coalesce(p_phone,'')),normalized,actor,p_request)
 on conflict(clinic_id,created_by,request_id) do nothing returning * into c;
 if c.id is null then
  select * into c from public.clinic_contacts where clinic_id=p_clinic and created_by=actor and request_id=p_request;
  if c.creation_payload_hash is distinct from payload_hash then raise exception 'Operação já usada com outros dados' using errcode='22023';end if;
  if not coalesce(public.reception_contact_allowed(c.id),false) then raise exception 'Contato indisponível' using errcode='42501';end if;
 else insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic,actor,'contact_created',c.id);end if;
 return c.id;
end $$;

create function public.reception_contact_admin(p_clinic uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(public.reception_scope_ok(p_clinic),false) and exists(
  select 1 from public.clinic_members where clinic_id=p_clinic and user_id=auth.uid() and role='admin' and status='active');
$$;
revoke all on function public.reception_contact_admin(uuid) from public,anon,authenticated;

-- Separate contract: the existing strict contact/booking projections stay unchanged.
create function public.reception_contact_edit(p_contact uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.clinic_contacts;
begin
 select * into c from public.clinic_contacts where id=p_contact;
 if not public.reception_contact_admin(c.clinic_id) then raise exception 'Somente a administração desta clínica pode corrigir o contato' using errcode='42501';end if;
 return jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'revision',c.revision);
end $$;

create function public.reception_update_contact(p_contact uuid,p_revision integer,p_name text,p_phone text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.clinic_contacts; actor uuid; normalized text; raw_phone text; result integer; changed text[]:='{}';
begin
 select * into c from public.clinic_contacts where id=p_contact;
 actor:=public.assert_reception_scope(c.clinic_id);
 if not public.reception_contact_admin(c.clinic_id) then raise exception 'Somente a administração desta clínica pode corrigir o contato' using errcode='42501';end if;
 select * into c from public.clinic_contacts where id=p_contact for update;
 perform public.assert_reception_scope(c.clinic_id);
 if not public.reception_contact_admin(c.clinic_id) then raise exception 'Permissão revogada' using errcode='42501';end if;
 if p_revision is distinct from c.revision then raise exception 'O contato mudou. Preserve o preenchimento e recupere o cadastro atual.' using errcode='40001';end if;
 if p_name is null or length(trim(p_name)) not between 2 and 200 or p_phone is null then raise exception 'Informe nome válido e telefone com DDD quando conhecido' using errcode='22023';end if;
 -- A name-only correction must preserve an ambiguous legacy phone verbatim.
 raw_phone:=case when p_phone=c.phone then c.phone else trim(p_phone) end;
 normalized:=case when raw_phone=c.phone then c.phone_normalized else public.normalize_reception_phone(raw_phone) end;
 if trim(p_name)<>c.name then changed:=array_append(changed,'name');end if;
 if raw_phone<>c.phone then changed:=array_append(changed,'phone');end if;
 update public.clinic_contacts set name=trim(p_name),phone=raw_phone,phone_normalized=normalized where id=c.id returning revision into result;
 if cardinality(changed)>0 then
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(c.clinic_id,actor,'contact_corrected',c.id,jsonb_build_object('revision',result,'changedFields',changed));
 end if;
 return result;
end $$;
revoke all on function public.reception_contact_edit(uuid),public.reception_update_contact(uuid,integer,text,text) from public,anon;
grant execute on function public.reception_contact_edit(uuid),public.reception_update_contact(uuid,integer,text,text) to authenticated;
