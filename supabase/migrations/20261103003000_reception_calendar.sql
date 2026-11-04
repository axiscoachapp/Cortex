alter table public.appointments
 add column clinic_id uuid,
 add column contact_id uuid,
 add column reception_case_id uuid,
 add column created_by uuid references auth.users(id) on delete restrict,
 add column updated_by uuid references auth.users(id) on delete restrict,
 add column revision integer not null default 1,
 add column checked_in_at timestamptz,
 add constraint appointment_clinic_doctor foreign key(clinic_id,user_id) references public.clinic_members(clinic_id,user_id) on delete restrict,
 add constraint appointment_contact foreign key(clinic_id,contact_id) references public.clinic_contacts(clinic_id,id) on delete restrict,
 add constraint appointment_case foreign key(clinic_id,reception_case_id) references public.reception_cases(clinic_id,id) on delete restrict,
 add constraint appointment_beneficiary foreign key(contact_id,patient_id) references public.patient_contact_links(contact_id,patient_id) on delete restrict,
 add constraint appointment_administrative_scope check((clinic_id is null and contact_id is null and reception_case_id is null) or (clinic_id is not null and contact_id is not null));
create index reception_appointment_period on public.appointments(user_id,start_time,end_time);
create index reception_audit_resource on public.reception_audit(resource_id,created_at);

create table public.reception_calendar_versions (
 doctor_user_id uuid primary key references auth.users(id) on delete cascade, revision bigint not null default 1
);
create table public.reception_booking_requests (
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 request_id uuid not null, payload jsonb not null, appointment_id uuid references public.appointments(id) on delete restrict,
 primary key(clinic_id,actor_user_id,request_id)
);
create table public.reception_schedule_blocks (
 id uuid primary key default gen_random_uuid(), clinic_id uuid not null, doctor_user_id uuid not null,
 start_time timestamptz not null,end_time timestamptz not null,reason text not null check(length(trim(reason)) between 2 and 120),
 active boolean not null default true,created_by uuid not null references auth.users(id) on delete restrict,
 request_id uuid not null,revision integer not null default 1,
 foreign key(clinic_id,doctor_user_id) references public.clinic_members(clinic_id,user_id) on delete restrict,
 unique(clinic_id,created_by,request_id), check(end_time>start_time)
);
do $$ declare t text; begin
 foreach t in array array['reception_calendar_versions','reception_booking_requests','reception_schedule_blocks'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- Stop destructive clinical cleanup before storage is touched when administrative
-- custody is still unresolved. The CRM lifecycle will supply its own retention flow.
do $$ declare definition text; guarded text; begin
 select pg_get_functiondef('public.assert_deletion_scope(uuid,uuid)'::regprocedure) into definition;
 guarded:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n
  IF EXISTS(select 1 from public.patient_contact_links where doctor_user_id=p_user_id and (p_patient_id is null or patient_id=p_patient_id))
   OR EXISTS(select 1 from public.appointments a where a.user_id=p_user_id and (p_patient_id is null or a.patient_id=p_patient_id)
      and (a.clinic_id is not null or exists(select 1 from public.reception_audit where resource_id=a.id)))
   OR (p_patient_id is null and (
    EXISTS(select 1 from public.clinic_staff_members where user_id=p_user_id)
    OR EXISTS(select 1 from public.clinic_contacts where created_by=p_user_id)
    OR EXISTS(select 1 from public.reception_cases where created_by=p_user_id or assigned_to=p_user_id)
    OR EXISTS(select 1 from public.reception_case_notes where actor_user_id=p_user_id)
    OR EXISTS(select 1 from public.reception_case_drafts where actor_user_id=p_user_id)
    OR EXISTS(select 1 from public.reception_audit where actor_user_id=p_user_id)
    OR EXISTS(select 1 from public.reception_booking_requests where actor_user_id=p_user_id)
    OR EXISTS(select 1 from public.reception_schedule_blocks where created_by=p_user_id)
    OR EXISTS(select 1 from public.appointments where created_by=p_user_id or updated_by=p_user_id)))
   THEN RAISE EXCEPTION ''Administrative custody must be resolved before deletion'' USING ERRCODE=''P4092'';
  END IF;','i');
 if guarded=definition then raise exception 'Missing deletion guard point'; end if;
 execute guarded;
end $$;

create function public.lock_reception_calendar(p_doctor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Same lock order as existing guard_clinical_write; the counter also rejects stale
 -- Repeatable Read snapshots rather than relying only on an advisory lock.
 perform pg_advisory_xact_lock(hashtextextended(p_doctor::text,123));
 insert into public.reception_calendar_versions(doctor_user_id) values(p_doctor)
 on conflict(doctor_user_id) do update set revision=reception_calendar_versions.revision+1;
end $$;
revoke all on function public.lock_reception_calendar(uuid) from public,anon,authenticated;

create function public.guard_reception_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare slot_changed boolean; changed boolean;
begin
 if tg_op='DELETE' then
  if old.clinic_id is not null or exists(select 1 from public.reception_audit where resource_id=old.id) then
   raise exception 'Cancele o agendamento para preservar seu histórico' using errcode='42501';
  end if;
  return old;
 end if;
 if new.start_time is null or new.end_time is null or not isfinite(new.start_time) or not isfinite(new.end_time) or new.end_time<=new.start_time then raise exception 'Intervalo de horário inválido' using errcode='22023'; end if;
 if tg_op='UPDATE' then
  if (new.id,new.user_id) is distinct from (old.id,old.user_id) then raise exception 'Identidade e médico do agendamento são imutáveis' using errcode='42501'; end if;
  if (new.clinic_id,new.contact_id,new.reception_case_id,new.created_by) is distinct from (old.clinic_id,old.contact_id,old.reception_case_id,old.created_by) then raise exception 'Vínculo e autoria do agendamento são imutáveis' using errcode='42501'; end if;
  slot_changed:=(new.user_id,new.start_time,new.end_time) is distinct from (old.user_id,old.start_time,old.end_time)
   or (old.status='cancelado' and new.status is distinct from 'cancelado');
  changed:=(to_jsonb(new)-array['revision','updated_by','google_event_id','google_sync_claim','google_sync_error','google_sync_lease_until','google_sync_revision','google_sync_status','reminder_sent'])
   is distinct from (to_jsonb(old)-array['revision','updated_by','google_event_id','google_sync_claim','google_sync_error','google_sync_lease_until','google_sync_revision','google_sync_status','reminder_sent']);
  new.revision:=old.revision+case when changed then 1 else 0 end;
  new.updated_by:=case when changed then auth.uid() else old.updated_by end;
  if slot_changed or new.status is distinct from old.status then new.reminder_sent:=false; end if;
 else slot_changed:=true;changed:=true;new.revision:=1;new.created_by:=auth.uid();new.updated_by:=auth.uid(); end if;
 if new.clinic_id is not null then
  if not exists(select 1 from public.patient_contact_links where clinic_id=new.clinic_id and contact_id=new.contact_id and patient_id=new.patient_id and doctor_user_id=new.user_id) then raise exception 'Confirme o beneficiário nesta agenda' using errcode='42501'; end if;
  if new.reception_case_id is not null and not exists(select 1 from public.reception_cases where id=new.reception_case_id and clinic_id=new.clinic_id and contact_id=new.contact_id and (tg_op<>'INSERT' or doctor_user_id is null or doctor_user_id=new.user_id)) then raise exception 'Encaminhe o atendimento para o médico escolhido antes de agendar' using errcode='42501'; end if;
  if slot_changed and auth.role() is not distinct from 'service_role' then raise exception 'Reserva exige confirmação humana autenticada' using errcode='42501'; end if;
 end if;
 if slot_changed then
  perform public.lock_reception_calendar(new.user_id);
  if new.status is distinct from 'cancelado' and (exists(select 1 from public.appointments a where a.user_id=new.user_id and a.id<>new.id and a.status is distinct from 'cancelado' and a.start_time<new.end_time and a.end_time>new.start_time)
   or exists(select 1 from public.reception_schedule_blocks b where b.doctor_user_id=new.user_id and b.active and b.start_time<new.end_time and b.end_time>new.start_time)) then
   raise exception 'Horário ocupado ou bloqueado. Escolha outro intervalo.' using errcode='23P01';
  end if;
 end if;
 if new.clinic_id is not null and changed then
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
  values(new.clinic_id,auth.uid(),case when tg_op='INSERT' then 'appointment_created' else 'appointment_updated' end,new.id,
   jsonb_build_object('doctorId',new.user_id,'revision',new.revision,'startTime',new.start_time,'endTime',new.end_time,'status',new.status,'origin',coalesce(auth.role(),'database')));
 end if;
 return new;
end $$;
revoke all on function public.guard_reception_appointment() from public,anon,authenticated;
create trigger zz_reception_appointment_guard before insert or update or delete on public.appointments for each row execute function public.guard_reception_appointment();

create function public.reception_appointments(p_clinic uuid,p_start timestamptz,p_end timestamptz,p_doctor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; blocks jsonb;
begin
 if not coalesce(public.reception_scope_ok(p_clinic,p_doctor),false) then raise exception 'Agenda não delegada' using errcode='42501'; end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start or p_end-p_start>interval '42 days' then raise exception 'Selecione um período de até 42 dias' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page."startTime",page.id),'[]') into items from (
  select a.id,a.user_id as "doctorId",a.patient_id as "patientId",a.contact_id as "contactId",a.reception_case_id as "caseId",
   coalesce(p.name,'Horário reservado') as "patientName",a.start_time as "startTime",a.end_time as "endTime",coalesce(a.type,'retorno') as type,
   coalesce(a.status,'agendado') as status,a.revision,a.checked_in_at as "checkedInAt",a.google_sync_status as "googleSyncStatus"
  from public.appointments a left join public.patients p on p.id=a.patient_id and p.user_id=a.user_id
  where a.end_time>p_start and a.start_time<p_end and (a.clinic_id is null or a.clinic_id=p_clinic)
  and (p_doctor is null or a.user_id=p_doctor) and public.reception_scope_ok(p_clinic,a.user_id)
  order by a.start_time,a.id limit 1001) page;
 if jsonb_array_length(items)>1000 then raise exception 'Muitos agendamentos. Reduza o período ou filtre um médico.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'doctorId',doctor_user_id,'startTime',start_time,'endTime',end_time,'reason',reason,'revision',revision) order by start_time,id),'[]') into blocks
 from public.reception_schedule_blocks where clinic_id=p_clinic and active and start_time<p_end and end_time>p_start and (p_doctor is null or doctor_user_id=p_doctor) and public.reception_scope_ok(p_clinic,doctor_user_id);
 return jsonb_build_object('items',items,'blocks',blocks);
end $$;

create function public.reception_book_appointment(p_clinic uuid,p_details jsonb,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; doctor uuid; contact uuid; patient uuid; case_id uuid; starts timestamptz; ends timestamptz; kind text;
 c public.clinic_contacts; request public.reception_booking_requests; beneficiary text; birth date; relation text;
begin
 if jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>8192 or p_request is null then raise exception 'Reserva inválida' using errcode='22023'; end if;
 if (p_details-array['doctorId','contactId','patientId','beneficiaryName','dateOfBirth','relationship','caseId','startTime','endTime','type'])<>'{}'::jsonb then raise exception 'Campos de reserva inválidos' using errcode='22023'; end if;
 doctor:=(p_details->>'doctorId')::uuid;contact:=(p_details->>'contactId')::uuid;patient:=nullif(p_details->>'patientId','')::uuid;case_id:=nullif(p_details->>'caseId','')::uuid;
 starts:=(p_details->>'startTime')::timestamptz;ends:=(p_details->>'endTime')::timestamptz;kind:=p_details->>'type';
 actor:=public.assert_reception_scope(p_clinic,doctor);
 if doctor is null or not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=doctor and status='active') then raise exception 'Médico indisponível' using errcode='42501'; end if;
 if not coalesce(public.reception_contact_allowed(contact),false) then raise exception 'Contato indisponível' using errcode='42501'; end if;
 select * into c from public.clinic_contacts where id=contact and clinic_id=p_clinic;
 if c.id is null or kind is null or kind not in ('novo','retorno','seguimento','urgencia') or starts is null or ends is null or not isfinite(starts) or not isfinite(ends) or ends<=starts or ends-starts>interval '12 hours' then raise exception 'Confirme contato, tipo e horário de até 12 horas' using errcode='22023'; end if;
 if case_id is not null then
  perform 1 from public.reception_cases where id=case_id and clinic_id=p_clinic and contact_id=contact and status not in ('resolved','cancelled') and public.reception_scope_ok(clinic_id,doctor_user_id) for share;
  if not found then raise exception 'Atendimento indisponível para reserva' using errcode='42501'; end if;
 end if;
 insert into public.reception_booking_requests(clinic_id,actor_user_id,request_id,payload) values(p_clinic,actor,p_request,p_details) on conflict do nothing;
 select * into request from public.reception_booking_requests where clinic_id=p_clinic and actor_user_id=actor and request_id=p_request for update;
 if request.payload<>p_details then raise exception 'Operação já usada com outros dados' using errcode='22023'; end if;
 if request.appointment_id is not null then return request.appointment_id; end if;
 perform public.lock_reception_calendar(doctor);
 if patient is null then
  beneficiary:=trim(p_details->>'beneficiaryName');birth:=nullif(p_details->>'dateOfBirth','')::date;relation:=p_details->>'relationship';
  if beneficiary is null or length(beneficiary) not between 2 and 200 or (birth is not null and birth>(now() at time zone 'America/Sao_Paulo')::date) or relation is null or relation not in ('self','guardian','family','other') then raise exception 'Confirme nome, nascimento e relação do novo paciente' using errcode='22023'; end if;
  insert into public.patients(user_id,name,date_of_birth,status) values(doctor,beneficiary,birth,'novo') returning id into patient;
  insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values(p_clinic,contact,patient,doctor,relation,actor);
 elsif not exists(select 1 from public.patient_contact_links l join public.patients p on p.id=l.patient_id and p.user_id=l.doctor_user_id
  where l.clinic_id=p_clinic and l.contact_id=contact and l.patient_id=patient and l.doctor_user_id=doctor and p.archived_at is null and p.deletion_requested_at is null) then raise exception 'Confirme o vínculo do paciente com este contato e médico' using errcode='42501'; end if;
 insert into public.appointments(user_id,patient_id,title,start_time,end_time,type,status,clinic_id,contact_id,reception_case_id)
 values(doctor,patient,'Consulta',starts,ends,kind,'agendado',p_clinic,contact,case_id) returning id into request.appointment_id;
 update public.reception_booking_requests set appointment_id=request.appointment_id where clinic_id=p_clinic and actor_user_id=actor and request_id=p_request;
 return request.appointment_id;
end $$;

create function public.reception_change_appointment(p_clinic uuid,p_appointment uuid,p_revision integer,p_action text,p_start timestamptz default null,p_end timestamptz default null) returns integer
language plpgsql security definer set search_path='' as $$
declare a public.appointments; actor uuid; result integer;
begin
 select * into a from public.appointments where id=p_appointment;
 actor:=public.assert_reception_scope(p_clinic,a.user_id);
 perform public.lock_reception_calendar(a.user_id);
 select * into a from public.appointments where id=p_appointment for update;
 perform public.assert_reception_scope(p_clinic,a.user_id);
 if a.id is null or (a.clinic_id is not null and a.clinic_id<>p_clinic) then raise exception 'Agendamento indisponível' using errcode='42501'; end if;
 if a.revision is distinct from p_revision then raise exception 'O agendamento mudou. Atualize a agenda antes de confirmar.' using errcode='40001'; end if;
 if p_action='reschedule' then
  if a.status in ('cancelado','realizado') or p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '12 hours' then raise exception 'Remarcação inválida' using errcode='22023'; end if;
  update public.appointments set start_time=p_start,end_time=p_end,status='agendado',checked_in_at=null where id=a.id returning revision into result;
 elsif p_action='cancel' then
  if a.status='realizado' then raise exception 'Atendimento realizado não pode ser cancelado nesta agenda' using errcode='22023'; end if;
  update public.appointments set status='cancelado' where id=a.id returning revision into result;
 elsif p_action='confirm' then
  if a.status not in ('agendado','confirmado') then raise exception 'Confirmação indisponível' using errcode='22023'; end if;
  update public.appointments set status='confirmado' where id=a.id returning revision into result;
 elsif p_action='check_in' then
  if a.status in ('cancelado','realizado') then raise exception 'Chegada indisponível' using errcode='22023'; end if;
  update public.appointments set checked_in_at=coalesce(checked_in_at,now()) where id=a.id returning revision into result;
 elsif p_action='undo_check_in' then
  if a.status='realizado' then raise exception 'Atendimento já realizado' using errcode='22023'; end if;
  update public.appointments set checked_in_at=null where id=a.id returning revision into result;
 else raise exception 'Ação de agenda inválida' using errcode='22023'; end if;
 -- Existing legacy rows keep their original metadata. Audit through the acting clinic.
 if a.clinic_id is null then insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
 values(p_clinic,actor,'appointment_'||p_action,a.id,jsonb_build_object('revision',result,'previousStart',a.start_time,'previousEnd',a.end_time)); end if;
 return result;
end $$;

create function public.reception_block_time(p_clinic uuid,p_doctor uuid,p_start timestamptz,p_end timestamptz,p_reason text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.assert_reception_scope(p_clinic,p_doctor); b public.reception_schedule_blocks;
begin
 if not exists(select 1 from public.clinic_members where clinic_id=p_clinic and user_id=actor and role='admin' and status='active') then raise exception 'Somente a gestão cria bloqueios' using errcode='42501'; end if;
 if p_doctor is null or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start or p_end-p_start>interval '31 days' or p_reason is null or length(trim(p_reason)) not between 2 and 120 or p_request is null then raise exception 'Bloqueio inválido' using errcode='22023'; end if;
 perform public.lock_reception_calendar(p_doctor);
 select * into b from public.reception_schedule_blocks where clinic_id=p_clinic and created_by=actor and request_id=p_request;
 if b.id is not null then
  if (b.doctor_user_id,b.start_time,b.end_time,b.reason) is distinct from (p_doctor,p_start,p_end,trim(p_reason)) then raise exception 'Operação já utilizada' using errcode='22023'; end if;return b.id;
 end if;
 if exists(select 1 from public.appointments where user_id=p_doctor and status is distinct from 'cancelado' and start_time<p_end and end_time>p_start) or exists(select 1 from public.reception_schedule_blocks where doctor_user_id=p_doctor and active and start_time<p_end and end_time>p_start) then raise exception 'Há compromissos ou bloqueios neste intervalo' using errcode='23P01'; end if;
 insert into public.reception_schedule_blocks(clinic_id,doctor_user_id,start_time,end_time,reason,created_by,request_id) values(p_clinic,p_doctor,p_start,p_end,trim(p_reason),actor,p_request) returning id into b.id;
 insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values(p_clinic,actor,'schedule_blocked',b.id);return b.id;
end $$;
create function public.reception_unblock_time(p_block uuid,p_revision integer) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.reception_schedule_blocks; actor uuid;
begin
 select * into b from public.reception_schedule_blocks where id=p_block;
 actor:=public.assert_reception_scope(b.clinic_id,b.doctor_user_id);
 if not exists(select 1 from public.clinic_members where clinic_id=b.clinic_id and user_id=actor and role='admin' and status='active') then raise exception 'Somente a gestão remove bloqueios' using errcode='42501'; end if;
 perform public.lock_reception_calendar(b.doctor_user_id);
 update public.reception_schedule_blocks set active=false,revision=revision+1 where id=p_block and active and revision=p_revision;
 if not found then raise exception 'Bloqueio alterado. Atualize a agenda.' using errcode='40001'; end if;
 insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values(b.clinic_id,actor,'schedule_unblocked',b.id);return true;
end $$;

do $$ declare signature text; begin
 foreach signature in array array['public.reception_appointments(uuid,timestamptz,timestamptz,uuid)',
 'public.reception_book_appointment(uuid,jsonb,uuid)','public.reception_change_appointment(uuid,uuid,integer,text,timestamptz,timestamptz)',
 'public.reception_block_time(uuid,uuid,timestamptz,timestamptz,text,uuid)','public.reception_unblock_time(uuid,integer)'] loop
  execute format('revoke all on function %s from public,anon',signature);
  execute format('grant execute on function %s to authenticated',signature);
 end loop;
end $$;
