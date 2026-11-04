-- A CRM booking records a human-confirmed beneficiary. Changing that patient
-- would reinterpret its history even when both patients share a contact/doctor.
create function public.guard_reception_appointment_patient() returns trigger
language plpgsql set search_path = '' as $$
begin
 if old.clinic_id is not null and new.patient_id is distinct from old.patient_id then
  raise exception 'Para trocar o paciente, cancele o agendamento e crie uma nova reserva na recepção'
   using errcode = '42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_reception_appointment_patient() from public, anon, authenticated, service_role;
create trigger aa_reception_appointment_patient_guard before update on public.appointments
 for each row execute function public.guard_reception_appointment_patient();
