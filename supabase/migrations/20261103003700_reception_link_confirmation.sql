-- Booking confirms a new administrative link; it must not double as an editor
-- for a previously confirmed relationship or replace its original attribution.
create or replace function public.reception_link_patient(p_contact uuid,p_doctor uuid,p_patient uuid,p_relationship text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.clinic_contacts; actor uuid; existing public.patient_contact_links;
begin
 select * into c from public.clinic_contacts where id=p_contact;
 actor:=public.assert_reception_scope(c.clinic_id,p_doctor);
 if not coalesce(public.reception_contact_allowed(c.id),false) then raise exception 'Contato indisponível' using errcode='42501'; end if;
 if p_relationship is null or p_relationship not in ('self','guardian','family','other') then raise exception 'Confirme a relação com o paciente' using errcode='22023'; end if;
 perform 1 from public.patients where id=p_patient and user_id=p_doctor and archived_at is null and deletion_requested_at is null for share;
 if not found then raise exception 'Paciente indisponível' using errcode='42501'; end if;
 insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by)
 values(c.clinic_id,c.id,p_patient,p_doctor,p_relationship,actor)
 on conflict(contact_id,patient_id) do nothing;
 if not found then
  select * into existing from public.patient_contact_links where contact_id=c.id and patient_id=p_patient for update;
  if not found then raise exception 'Vínculo mudou durante a confirmação' using errcode='40001'; end if;
  if existing.clinic_id is distinct from c.clinic_id or existing.doctor_user_id is distinct from p_doctor then
   raise exception 'Vínculo indisponível' using errcode='42501';
  end if;
  if existing.relationship is distinct from p_relationship then
   raise exception 'Este vínculo já foi confirmado com outra relação. Confira o cadastro antes de reservar.' using errcode='22023';
  end if;
  return true;
 end if;
 insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
 values(c.clinic_id,actor,'beneficiary_confirmed',c.id,jsonb_build_object('patientId',p_patient,'doctorId',p_doctor,'relationship',p_relationship));
 return true;
end $$;
