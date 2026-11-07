-- Pre-consultation (migration 20261107110000). Synthetic clinic, people, phones and ids only.
begin;
create function pg_temp.as_doctor(command text) returns void language plpgsql as $$
begin
  -- Slot changes on the clinic agenda require an authenticated person (guard_reception_appointment).
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000002',true);
  execute command;
  perform set_config('request.jwt.claim.role','service_role',true);
end $$;
create function pg_temp.sqlstate_of(command text) returns text language plpgsql as $$
begin execute command; return 'ok'; exception when others then return sqlstate; end $$;

insert into auth.users(id,email) values
 ('e8100000-0000-4000-8000-000000000001','intake-admin@example.invalid'),
 ('e8100000-0000-4000-8000-000000000002','intake-doctor@example.invalid'),
 ('e8100000-0000-4000-8000-000000000003','intake-reception@example.invalid'),
 ('e8100000-0000-4000-8000-000000000004','intake-doctor2@example.invalid'),
 ('e8100000-0000-4000-8000-000000000005','intake-reception2@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('e8200000-0000-4000-8000-000000000001','Clínica sintética pré-consulta','e8100000-0000-4000-8000-000000000001'),
 ('e8200000-0000-4000-8000-000000000002','Outra clínica sintética','e8100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000001','admin','active'),
 ('e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000002','doctor','active'),
 ('e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000004','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000003','Recepção sintética'),
 ('e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000005','Recepção sintética 2');
-- Reception 1 serves doctor 1 only; reception 2 serves doctor 2 only.
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000003','e8100000-0000-4000-8000-000000000002'),
 ('e8200000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000005','e8100000-0000-4000-8000-000000000004');
insert into public.user_settings(user_id,doctor_name) values ('e8100000-0000-4000-8000-000000000002','Dra. Exemplo')
 on conflict (user_id) do update set doctor_name=excluded.doctor_name;
insert into public.patients(id,user_id,name,status,phone) values
 ('e8500000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000002','Paciente Exemplo','novo','(41) 99999-0001');
insert into public.clinic_contacts(id,clinic_id,name,phone,phone_normalized,created_by,request_id) values
 ('e8300000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001','Paciente Exemplo','(41) 99999-7001','5541999997001',
  'e8100000-0000-4000-8000-000000000001',gen_random_uuid());
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values
 ('e8200000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000001','e8500000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000002','self','e8100000-0000-4000-8000-000000000001');
insert into public.appointments(id,user_id,patient_id,clinic_id,contact_id,title,start_time,end_time,status,type) values
 ('e8700000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000002','e8500000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000001','Consulta',
  date_trunc('minute',now())+interval '3 days',date_trunc('minute',now())+interval '3 days 30 minutes','agendado','novo'),
 ('e8700000-0000-4000-8000-000000000002','e8100000-0000-4000-8000-000000000002','e8500000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000001','Consulta',
  date_trunc('minute',now())+interval '4 days',date_trunc('minute',now())+interval '4 days 30 minutes','cancelado','retorno');
insert into public.appointments(id,user_id,patient_id,clinic_id,contact_id,title,start_time,end_time,status,type) values
 ('e8700000-0000-4000-8000-000000000004','e8100000-0000-4000-8000-000000000002','e8500000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001','e8300000-0000-4000-8000-000000000001','Consulta',
  date_trunc('minute',now())+interval '8 days',date_trunc('minute',now())+interval '8 days 30 minutes','agendado','retorno');
-- A private appointment of doctor 1 (no clinic) never gets a clinic pre-consultation.
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,status,type) values
 ('e8700000-0000-4000-8000-000000000003','e8100000-0000-4000-8000-000000000002','e8500000-0000-4000-8000-000000000001','Particular',
  date_trunc('minute',now())+interval '5 days',date_trunc('minute',now())+interval '5 days 30 minutes','agendado','retorno');

-- Privileges.
do $$ declare t text; f text; begin
  foreach t in array array['intake_forms','intake_requests'] loop
    assert not has_table_privilege('authenticated','public.'||t,'select') and not has_table_privilege('anon','public.'||t,'select'), t||' readable';
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), t||' without RLS';
  end loop;
  foreach f in array array['public.intake_form_save(uuid,uuid,integer,boolean,jsonb)','public.intake_scope_ok(uuid,uuid,uuid)',
    'public.intake_request_ensure(uuid,uuid,uuid,uuid,text,text)','public.intake_request_rotate(uuid,uuid,uuid,text,text)',
    'public.intake_public_open(text)','public.intake_public_submit(text,integer,jsonb,jsonb,boolean,text)',
    'public.intake_review(uuid,uuid,uuid,text,integer)','public.intake_list(uuid,uuid,timestamptz,timestamptz)'] loop
    assert not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
      and has_function_privilege('service_role',f,'execute'), f||' grants';
  end loop;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

do $$ declare r jsonb; o jsonb; s jsonb; l jsonb; req uuid; rev int;
  c uuid:='e8200000-0000-4000-8000-000000000001'; admin uuid:='e8100000-0000-4000-8000-000000000001';
  doctor uuid:='e8100000-0000-4000-8000-000000000002'; rec uuid:='e8100000-0000-4000-8000-000000000003';
  doctor2 uuid:='e8100000-0000-4000-8000-000000000004'; rec2 uuid:='e8100000-0000-4000-8000-000000000005';
  h1 text:=repeat('1',64); h2 text:=repeat('2',64);
begin
  -- No form yet, or a disabled form: no link.
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_ensure(%L,'e8700000-0000-4000-8000-000000000001',%L,gen_random_uuid(),'abcdefghijklmnopqrstuv',%L)$q$, c, rec, h1))='55000', 'link without form';
  r := public.intake_form_save(c, admin, 0, false, '{"intro":"Oi","thanks":"Obrigado","sections":[]}');
  assert (r->>'revision')::int=1, 'first save';
  assert pg_temp.sqlstate_of(format($q$select public.intake_form_save(%L,%L,0,true,'{}')$q$, c, admin))='40001', 'second creation accepted';
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_ensure(%L,'e8700000-0000-4000-8000-000000000001',%L,gen_random_uuid(),'abcdefghijklmnopqrstuv',%L)$q$, c, rec, h1))='55000', 'link with a disabled form';
  r := public.intake_form_save(c, admin, 1, true, '{"intro":"Oi","thanks":"Obrigado","sections":[{"id":"dados","title":"Dados","audience":"registration","questions":[]}]}');

  -- Scope: reception 2 serves only doctor 2; the admin does not see doctor 1's agenda implicitly; another clinic is refused.
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_ensure(%L,'e8700000-0000-4000-8000-000000000001',%L,gen_random_uuid(),'abcdefghijklmnopqrstuv',%L)$q$, c, rec2, h1))='42501', 'reception out of scope';
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_ensure(%L,'e8700000-0000-4000-8000-000000000001',%L,gen_random_uuid(),'abcdefghijklmnopqrstuv',%L)$q$, c, admin, h1))='42501', 'admin without agenda';
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_ensure('e8200000-0000-4000-8000-000000000002','e8700000-0000-4000-8000-000000000001',%L,gen_random_uuid(),'abcdefghijklmnopqrstuv',%L)$q$, rec, h1))='P0002', 'other clinic';
  -- Cancelled and private appointments: refused.
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_ensure(%L,'e8700000-0000-4000-8000-000000000002',%L,gen_random_uuid(),'abcdefghijklmnopqrstuv',%L)$q$, c, rec, h1))='22023', 'cancelled appointment';
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_ensure(%L,'e8700000-0000-4000-8000-000000000003',%L,gen_random_uuid(),'abcdefghijklmnopqrstuv',%L)$q$, c, doctor, h1))='P0002', 'private appointment';

  -- The reception creates the link; a second call (automation) returns the same request and nonce.
  r := public.intake_request_ensure(c,'e8700000-0000-4000-8000-000000000001',rec,'e8900000-0000-4000-8000-000000000001','abcdefghijklmnopqrstuv',h1);
  assert (r->>'created')::boolean and r->>'nonce'='abcdefghijklmnopqrstuv', 'first link: '||r::text;
  r := public.intake_request_ensure(c,'e8700000-0000-4000-8000-000000000001',null,'e8900000-0000-4000-8000-000000000002','zzzzzzzzzzzzzzzzzzzzzz',h2);
  assert not (r->>'created')::boolean and r->>'id'='e8900000-0000-4000-8000-000000000001' and r->>'nonce'='abcdefghijklmnopqrstuv', 'second link replaced the first';
  req := 'e8900000-0000-4000-8000-000000000001';

  -- Public opening: clinic, doctor's display name, date and form; never the patient's name or answers.
  o := public.intake_public_open(h1);
  assert o->>'state'='open' and o->>'clinicName'='Clínica sintética pré-consulta' and o->>'doctorName'='Dra. Exemplo' and o ? 'form', 'open: '||o::text;
  assert position('Paciente' in o::text)=0 and position('99999' in o::text)=0, 'patient data on the public page';
  assert public.intake_public_open(h2) is null and public.intake_public_open('x') is null, 'unknown token opened';
  assert (select opened_at is not null from public.intake_requests where id=req), 'opening not recorded';

  -- Submission: stored by audience, consent recorded for the contact's phone on file.
  s := public.intake_public_submit(h1, 2, '[{"id":"nome","label":"Nome","value":"Paciente Exemplo","field":"name"}]', '[{"id":"motivo","label":"Motivo","value":"Rotina"}]', true, 'v1');
  assert (s->>'submissions')::int=1, 'submit';
  assert (select status='answered' and whatsapp_consent and jsonb_array_length(health)=1 from public.intake_requests where id=req), 'answers not stored';
  assert exists (select 1 from public.whatsapp_opt_ins where clinic_id=c and wa_id='5541999997001' and source='paciente' and revoked_at is null), 'consent not recorded';
  assert public.intake_public_open(h1)->>'state'='answered' and not (public.intake_public_open(h1)::text like '%Rotina%'), 'answers read back on the public page';
  -- Old form snapshot: refused.
  assert pg_temp.sqlstate_of(format($q$select public.intake_public_submit(%L,1,'[]','[]',false,'v1')$q$, h1))='40001', 'stale form revision';
  assert pg_temp.sqlstate_of(format($q$select public.intake_public_submit(%L,2,'{}','[]',false,'v1')$q$, h1))='22023', 'object instead of list';

  -- Review: the doctor reads health; the reception cannot; the reception reviews registration, then the form locks.
  rev := (select revision from public.intake_requests where id=req);
  assert pg_temp.sqlstate_of(format($q$select public.intake_review(%L,%L,%L,'health',%s)$q$, c, req, rec, rev))='42501', 'reception reviewed health';
  assert pg_temp.sqlstate_of(format($q$select public.intake_review(%L,%L,%L,'registration',%s)$q$, c, req, rec2, rev))='42501', 'out-of-scope reception reviewed';
  assert pg_temp.sqlstate_of(format($q$select public.intake_review(%L,%L,%L,'registration',%s)$q$, c, req, rec, rev-1))='40001', 'stale revision reviewed';
  r := public.intake_review(c, req, doctor, 'health', rev);
  r := public.intake_review(c, req, rec, 'registration', (r->>'revision')::int);
  assert (select registration_reviewed_by=rec and health_reviewed_by=doctor from public.intake_requests where id=req), 'review marks';
  assert public.intake_public_open(h1)->>'state'='reviewed' and not (public.intake_public_open(h1) ? 'form' and public.intake_public_open(h1)->'form' <> 'null'::jsonb),
    'reviewed form still offered';
  assert pg_temp.sqlstate_of(format($q$select public.intake_public_submit(%L,2,'[]','[]',false,'v1')$q$, h1))='55000', 'resubmitted after review';

  -- Rotation: the old link stops working at once.
  r := public.intake_request_rotate(c, req, rec, 'bbbbbbbbbbbbbbbbbbbbbb', h2);
  assert public.intake_public_open(h1) is null and public.intake_public_open(h2)->>'state'='reviewed', 'rotation';
  assert pg_temp.sqlstate_of(format($q$select public.intake_request_rotate(%L,%L,%L,'cccccccccccccccccccccc',%L)$q$, c, req, rec2, repeat('3',64)))='42501', 'out-of-scope rotation';

  -- List: the reception sees its doctor's appointments and their state; out of scope sees nothing.
  l := public.intake_list(c, rec, now(), now()+interval '7 days');
  assert jsonb_array_length(l)=2 and l->0->>'state'='answered' and l->0->>'contactName'='Paciente Exemplo' and l->1->>'state'='none', 'list: '||l::text;
  assert jsonb_array_length(public.intake_list(c, rec2, now(), now()+interval '7 days'))=0, 'out-of-scope list';
  assert jsonb_array_length(public.intake_list(c, admin, now(), now()+interval '7 days'))=0, 'admin sees another doctor''s agenda';
  assert pg_temp.sqlstate_of(format($q$select public.intake_list(%L,%L,now(),now()+interval '16 days')$q$, c, rec))='22023', 'window too long';
end $$;

-- An earlier opt-out is never overridden by the form; a cancelled appointment closes the form.
do $$ declare c uuid:='e8200000-0000-4000-8000-000000000001'; r jsonb; h text:=repeat('4',64); begin
  update public.whatsapp_opt_ins set revoked_at=now() where clinic_id=c and wa_id='5541999997001';
  r := public.intake_request_ensure(c,'e8700000-0000-4000-8000-000000000004','e8100000-0000-4000-8000-000000000003',gen_random_uuid(),'dddddddddddddddddddddd',h);
  perform public.intake_public_submit(h, 2, '[]', '[]', true, 'v1');
  assert exists (select 1 from public.whatsapp_opt_ins where clinic_id=c and wa_id='5541999997001' and revoked_at is not null), 'form overrode an opt-out';
  perform pg_temp.as_doctor($q$update public.appointments set status='cancelado' where id='e8700000-0000-4000-8000-000000000004'$q$);
  assert public.intake_public_open(h)->>'state'='closed', 'cancelled appointment still open';
  assert pg_temp.sqlstate_of(format($q$select public.intake_public_submit(%L,2,'[]','[]',false,'v1')$q$, h))='55000', 'submit after cancellation';
end $$;
rollback;
