-- Administrative state only: keep keys, original confirmation and clinical charts.
begin;
alter table public.patient_contact_links add column active boolean not null default true;

create function cortex_private.reception_link_is_active(p_clinic uuid,p_contact uuid,p_patient uuid,p_doctor uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare enabled boolean;
begin
 select active into enabled from public.patient_contact_links
 where clinic_id=p_clinic and contact_id=p_contact and patient_id=p_patient and doctor_user_id=p_doctor for share nowait;
 return coalesce(enabled,false);
exception when lock_not_available then raise exception 'Vínculo em alteração. Atualize antes de tentar novamente.' using errcode='40001';
end $$;
revoke all on function cortex_private.reception_link_is_active(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.assert_reception_link_editor(p_clinic uuid,p_doctor uuid,p_patient uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_reception_scope(p_clinic);
 if not public.reception_contact_admin(p_clinic) then raise exception 'Somente a administração desta clínica pode corrigir o vínculo' using errcode='42501';end if;
 perform 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_doctor and status='active' for share nowait;
 if not found or exists(select 1 from public.account_deletion_requests where user_id=p_doctor) then raise exception 'Profissional indisponível' using errcode='42501';end if;
 perform 1 from public.patients where id=p_patient and user_id=p_doctor and archived_at is null and deletion_requested_at is null for share nowait;
 if not found then raise exception 'Paciente indisponível' using errcode='42501';end if;
exception when lock_not_available then raise exception 'Disponibilidade em alteração. Atualize antes de tentar novamente.' using errcode='40001';
end $$;

create or replace function public.guard_reception_link_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Preserve o histórico do vínculo administrativo' using errcode='42501';end if;
 if tg_op='INSERT' then
  if not new.active then raise exception 'Novo vínculo exige confirmação ativa' using errcode='42501';end if;
  new.revision:=1;new.updated_at:=new.confirmed_at;new.updated_by:=null;return new;
 end if;
 if (new.clinic_id,new.contact_id,new.patient_id,new.doctor_user_id,new.confirmed_by,new.confirmed_at)
  is distinct from (old.clinic_id,old.contact_id,old.patient_id,old.doctor_user_id,old.confirmed_by,old.confirmed_at) then
  raise exception 'Identidade e confirmação original do vínculo são imutáveis' using errcode='42501';end if;
 if new.active is distinct from old.active then
  perform cortex_private.reception_delegation_actor(old.clinic_id);
  if new.relationship is distinct from old.relationship then raise exception 'Corrija estado e relação em operações separadas' using errcode='22023';end if;
  if new.active then perform public.assert_reception_link_editor(old.clinic_id,old.doctor_user_id,old.patient_id);end if;
  new.revision:=old.revision+1;new.updated_at:=clock_timestamp();new.updated_by:=auth.uid();
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
  values(old.clinic_id,auth.uid(),case when new.active then 'beneficiary_reactivated' else 'beneficiary_suspended' end,old.contact_id,
   jsonb_build_object('patientId',old.patient_id,'doctorId',old.doctor_user_id,'revision',new.revision,'fromActive',old.active,'toActive',new.active));
 elsif new.relationship is distinct from old.relationship then
  if not old.active then raise exception 'Vínculo suspenso. Solicite reativação administrativa.' using errcode='42501';end if;
  perform public.assert_reception_link_editor(old.clinic_id,old.doctor_user_id,old.patient_id);
  new.revision:=old.revision+1;new.updated_at:=clock_timestamp();new.updated_by:=auth.uid();
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
  values(old.clinic_id,auth.uid(),'beneficiary_relationship_corrected',old.contact_id,
   jsonb_build_object('patientId',old.patient_id,'doctorId',old.doctor_user_id,'revision',new.revision,'from',old.relationship,'to',new.relationship));
 else new.revision:=old.revision;new.updated_at:=old.updated_at;new.updated_by:=old.updated_by;end if;
 return new;
end $$;
alter table public.patient_contact_links enable always trigger reception_link_identity;

create function public.reception_set_link_active(p_contact uuid,p_patient uuid,p_revision integer,p_active boolean) returns integer
language plpgsql volatile security definer set search_path='' as $$
declare link public.patient_contact_links;result integer;
begin
 select * into link from public.patient_contact_links where contact_id=p_contact and patient_id=p_patient;
 if not found then raise exception 'Vínculo indisponível' using errcode='42501';end if;
 perform cortex_private.reception_delegation_actor(link.clinic_id);
 perform 1 from auth.users where id=auth.uid() for share nowait;
 if not found then raise exception 'Conta administrativa indisponível' using errcode='42501';end if;
 if p_active is null then raise exception 'Confirme o estado desejado' using errcode='22023';end if;
 if p_active then perform public.assert_reception_link_editor(link.clinic_id,link.doctor_user_id,link.patient_id);end if;
 select * into link from public.patient_contact_links where contact_id=p_contact and patient_id=p_patient for update nowait;
 if not found then raise exception 'Vínculo indisponível' using errcode='42501';end if;
 perform cortex_private.reception_delegation_actor(link.clinic_id);
 if p_revision is distinct from link.revision then raise exception 'O vínculo mudou. Recupere a versão atual.' using errcode='40001';end if;
 if link.active=p_active then return link.revision;end if;
 update public.patient_contact_links set active=p_active where contact_id=p_contact and patient_id=p_patient returning revision into result;
 return result;
exception when lock_not_available then raise exception 'Vínculo em alteração. Atualize antes de tentar novamente.' using errcode='40001';
end $$;
revoke all on function public.reception_set_link_active(uuid,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.reception_set_link_active(uuid,uuid,integer,boolean) to authenticated;

create function public.guard_reception_link_activity() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare requires_active boolean;
begin
 if tg_op='UPDATE' and (old.clinic_id is not null or new.clinic_id is not null) and
  (new.id,new.user_id,new.patient_id,new.clinic_id,new.contact_id,new.reception_case_id,new.created_by) is distinct from
  (old.id,old.user_id,old.patient_id,old.clinic_id,old.contact_id,old.reception_case_id,old.created_by) then
  raise exception 'Identidade do agendamento CRM é imutável' using errcode='42501';end if;
 if new.clinic_id is null then return new;end if;
 requires_active:=tg_op='INSERT';
 if tg_op='UPDATE' then requires_active:=(new.start_time,new.end_time) is distinct from (old.start_time,old.end_time)
  or (old.status='cancelado' and new.status is distinct from 'cancelado');end if;
 if requires_active and not cortex_private.reception_link_is_active(new.clinic_id,new.contact_id,new.patient_id,new.user_id) then
  raise exception 'Vínculo suspenso ou indisponível. Confirme o cadastro antes de reservar.' using errcode='42501';end if;
 return new;
end $$;
revoke all on function public.guard_reception_link_activity() from public,anon,authenticated,service_role;
create trigger ab_reception_link_activity before insert or update on public.appointments for each row execute function public.guard_reception_link_activity();
alter table public.appointments enable always trigger ab_reception_link_activity;

-- Exact guard points preserve prior function bodies/ACLs and strict projections.
-- Orphan detection deliberately continues to count inactive historical links.
do $$ declare patch record;definition text;begin
 for patch in select * from (values
  ('public.reception_contact_allowed(uuid)'::regprocedure,'where l.contact_id=c.id and public.reception_scope_ok','where l.contact_id=c.id and cortex_private.reception_link_is_active(l.clinic_id,l.contact_id,l.patient_id,l.doctor_user_id) and public.reception_scope_ok'),
  ('public.reception_contact(uuid)'::regprocedure,'where l.contact_id=c.id and p.archived_at','where l.contact_id=c.id and cortex_private.reception_link_is_active(l.clinic_id,l.contact_id,l.patient_id,l.doctor_user_id) and p.archived_at'),
  ('public.reception_case(uuid,uuid)'::regprocedure,'where l.contact_id=r.contact_id and p.deletion_requested_at','where l.contact_id=r.contact_id and cortex_private.reception_link_is_active(l.clinic_id,l.contact_id,l.patient_id,l.doctor_user_id) and p.deletion_requested_at'),
  ('public.reception_link_patient(uuid,uuid,uuid,text)'::regprocedure,'if existing.relationship is distinct from p_relationship then',E'if not existing.active then raise exception ''Vínculo suspenso. Solicite reativação administrativa.'' using errcode=''42501'';end if;\n  if existing.relationship is distinct from p_relationship then'),
  ('public.reception_link_patient(uuid,uuid,uuid,text)'::regprocedure,'for update;','for update nowait;'),
  ('public.reception_update_link_relationship(uuid,uuid,integer,text)'::regprocedure,'if p_relationship=l.relationship then',E'if not l.active then raise exception ''Vínculo suspenso. Solicite reativação administrativa.'' using errcode=''42501'';end if;\n if p_relationship=l.relationship then'),
  ('public.reception_update_link_relationship(uuid,uuid,integer,text)'::regprocedure,'for update;','for update nowait;'),
  ('public.reception_link_edit(uuid,uuid)'::regprocedure,'''active'',true','''active'',l.active'),
  ('public.reception_contact_links(uuid,uuid,uuid,integer)'::regprocedure,'''active'',true','''active'',l.active')
 ) as changes(target,needle,replacement) loop
  definition:=pg_get_functiondef(patch.target);
  if (length(definition)-length(replace(definition,patch.needle,'')))/length(patch.needle)<>1 then
   raise exception 'Unexpected link-state guard point: %',patch.target;end if;
  execute replace(definition,patch.needle,patch.replacement);
 end loop;
end $$;
-- A scoped read can already hold SHARE on this row: do not block on upgrade.
do $$ declare signature regprocedure;definition text;body text;guarded text;begin
 foreach signature in array array['public.reception_link_patient(uuid,uuid,uuid,text)'::regprocedure,'public.reception_update_link_relationship(uuid,uuid,integer,text)'::regprocedure] loop
  select pg_get_functiondef(signature),prosrc into definition,body from pg_proc where oid=signature;
  guarded:=regexp_replace(body,'\mend\M\s*$',E'exception when lock_not_available then raise exception ''Vínculo em alteração. Atualize antes de tentar novamente.'' using errcode=''40001'';\nend','i');
  if guarded=body or position('exception when lock_not_available' in body)>0 then raise exception 'Unexpected link lock guard: %',signature;end if;
  execute replace(definition,body,guarded);
 end loop;
end $$;
-- PostgREST dispatches STABLE RPCs in READ ONLY even for POST. These scoped
-- readers now take row fences, so their existing POST calls need READ WRITE.
alter function public.reception_contact_allowed(uuid) volatile;
alter function public.reception_contacts(uuid,text,uuid) volatile;
alter function public.reception_contact(uuid) volatile;
alter function public.reception_case(uuid,uuid) volatile;
commit;
