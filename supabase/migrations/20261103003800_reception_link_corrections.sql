-- Metadata is backfilled from the known original confirmation, not from an
-- invented historical correction or actor. No link state is changed here.
alter table public.patient_contact_links
 add column revision integer not null default 1 check(revision>0),
 add column updated_at timestamptz,
 add column updated_by uuid references auth.users(id) on delete restrict;
update public.patient_contact_links set updated_at=confirmed_at;
alter table public.patient_contact_links alter column updated_at set not null;
alter table public.patient_contact_links alter column updated_at set default now();

create function public.assert_reception_link_editor(p_clinic uuid,p_doctor uuid,p_patient uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_reception_scope(p_clinic);
 if not public.reception_contact_admin(p_clinic) then raise exception 'Somente a administração desta clínica pode corrigir o vínculo' using errcode='42501';end if;
 perform 1 from public.clinic_members where clinic_id=p_clinic and user_id=p_doctor and status='active' for share;
 if not found or exists(select 1 from public.account_deletion_requests where user_id=p_doctor) then raise exception 'Profissional indisponível' using errcode='42501';end if;
 perform 1 from public.patients where id=p_patient and user_id=p_doctor and archived_at is null and deletion_requested_at is null for share;
 if not found then raise exception 'Paciente indisponível' using errcode='42501';end if;
end $$;
revoke all on function public.assert_reception_link_editor(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.guard_reception_link_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Preserve o histórico do vínculo administrativo' using errcode='42501';end if;
 if tg_op='INSERT' then new.revision:=1;new.updated_at:=new.confirmed_at;new.updated_by:=null;return new;end if;
 if (new.clinic_id,new.contact_id,new.patient_id,new.doctor_user_id,new.confirmed_by,new.confirmed_at)
  is distinct from (old.clinic_id,old.contact_id,old.patient_id,old.doctor_user_id,old.confirmed_by,old.confirmed_at) then
  raise exception 'Identidade e confirmação original do vínculo são imutáveis' using errcode='42501';
 end if;
 if new.relationship is distinct from old.relationship then
  perform public.assert_reception_link_editor(old.clinic_id,old.doctor_user_id,old.patient_id);
  new.revision:=old.revision+1;new.updated_at:=clock_timestamp();new.updated_by:=auth.uid();
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
  values(old.clinic_id,auth.uid(),'beneficiary_relationship_corrected',old.contact_id,
   jsonb_build_object('patientId',old.patient_id,'doctorId',old.doctor_user_id,'revision',new.revision,'from',old.relationship,'to',new.relationship));
 else new.revision:=old.revision;new.updated_at:=old.updated_at;new.updated_by:=old.updated_by;end if;
 return new;
end $$;
revoke all on function public.guard_reception_link_identity() from public,anon,authenticated,service_role;
create trigger reception_link_identity before insert or update or delete on public.patient_contact_links
 for each row execute function public.guard_reception_link_identity();
revoke truncate on public.patient_contact_links from public,anon,authenticated,service_role;

-- A separate single-link snapshot preserves every existing strict reader DTO.
-- active=true describes the current implicit state; revocation is a later slice.
create function public.reception_link_edit(p_contact uuid,p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.patient_contact_links; result jsonb;
begin
 select * into l from public.patient_contact_links where contact_id=p_contact and patient_id=p_patient;
 if not public.reception_contact_admin(l.clinic_id) then raise exception 'Vínculo indisponível para correção' using errcode='42501';end if;
 select jsonb_build_object('contactId',l.contact_id,'patientId',l.patient_id,'doctorId',l.doctor_user_id,
  'patientName',p.name,'dateOfBirth',p.date_of_birth,'doctorName',coalesce(nullif(trim(s.doctor_name),''),'Médico'),
  'relationship',l.relationship,'revision',l.revision,'active',true,
  'patientAvailable',p.archived_at is null and p.deletion_requested_at is null,
  'doctorActive',exists(select 1 from public.clinic_members m where m.clinic_id=l.clinic_id and m.user_id=l.doctor_user_id and m.status='active')
   and not exists(select 1 from public.account_deletion_requests where user_id=l.doctor_user_id)) into result
 from public.patients p left join public.user_settings s on s.user_id=l.doctor_user_id
 where p.id=l.patient_id and p.user_id=l.doctor_user_id;
 return result;
end $$;

create function public.reception_update_link_relationship(p_contact uuid,p_patient uuid,p_revision integer,p_relationship text) returns integer
language plpgsql security definer set search_path='' as $$
declare l public.patient_contact_links; result integer;
begin
 select * into l from public.patient_contact_links where contact_id=p_contact and patient_id=p_patient;
 perform public.assert_reception_link_editor(l.clinic_id,l.doctor_user_id,l.patient_id);
 select * into l from public.patient_contact_links where contact_id=p_contact and patient_id=p_patient for update;
 perform public.assert_reception_link_editor(l.clinic_id,l.doctor_user_id,l.patient_id);
 if p_revision is distinct from l.revision then raise exception 'O vínculo mudou. Preserve o preenchimento e recupere a versão atual.' using errcode='40001';end if;
 if p_relationship is null or p_relationship not in ('self','guardian','family','other') then raise exception 'Confirme uma relação válida com o paciente' using errcode='22023';end if;
 if p_relationship=l.relationship then return l.revision;end if;
 update public.patient_contact_links set relationship=p_relationship where contact_id=p_contact and patient_id=p_patient returning revision into result;
 return result;
end $$;
revoke all on function public.reception_link_edit(uuid,uuid),public.reception_update_link_relationship(uuid,uuid,integer,text) from public,anon;
grant execute on function public.reception_link_edit(uuid,uuid),public.reception_update_link_relationship(uuid,uuid,integer,text) to authenticated;
