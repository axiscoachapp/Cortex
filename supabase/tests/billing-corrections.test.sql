-- Billing corrections (migration 20261111130000). Synthetic clinic, people, plans and ids only.
begin;
create function pg_temp.sqlstate_of(command text) returns text language plpgsql as $$
begin execute command; return 'ok'; exception when others then return sqlstate; end $$;

insert into auth.users(id,email) values
 ('ea100000-0000-4000-8000-000000000001','bill2-admin@example.invalid'),
 ('ea100000-0000-4000-8000-000000000002','bill2-doctor@example.invalid'),
 ('ea100000-0000-4000-8000-000000000003','bill2-reception@example.invalid'),
 ('ea100000-0000-4000-8000-000000000004','bill2-doctor2@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('ea200000-0000-4000-8000-000000000001','Clínica sintética correções','ea100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','admin','active'),
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000002','doctor','active'),
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000004','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000003','Recepção sintética');
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000003','ea100000-0000-4000-8000-000000000002');
insert into public.appointments(id,user_id,title,start_time,end_time) values
 ('ea600000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000002','Consulta sintética',now()-interval '1 day',now()-interval '1 day'+interval '30 minutes');

-- Privileges.
do $$ declare f text; begin
  assert not has_table_privilege('authenticated','public.billing_events','select') and not has_table_privilege('anon','public.billing_events','select'), 'events readable';
  assert (select relrowsecurity from pg_class where oid='public.billing_events'::regclass), 'events without RLS';
  foreach f in array array['public.billing_charge_edit(uuid,uuid,uuid,integer,jsonb)','public.billing_charge_represent(uuid,uuid,uuid,integer)',
    'public.billing_charge_write_off(uuid,uuid,uuid,integer,text)','public.billing_batch_clear_xml(uuid,uuid,uuid,integer)',
    'public.billing_batch_unsend(uuid,uuid,uuid,integer)'] loop
    assert not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
      and has_function_privilege('service_role',f,'execute'), f||' grants';
  end loop;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

do $$ declare c uuid:='ea200000-0000-4000-8000-000000000001'; admin uuid:='ea100000-0000-4000-8000-000000000001';
  doctor uuid:='ea100000-0000-4000-8000-000000000002'; rec uuid:='ea100000-0000-4000-8000-000000000003'; doctor2 uuid:='ea100000-0000-4000-8000-000000000004';
  payer uuid:='ea300000-0000-4000-8000-000000000001'; appt uuid:='ea600000-0000-4000-8000-000000000001'; req uuid:='ea700000-0000-4000-8000-000000000001';
  r jsonb; b uuid; rev int; ch public.billing_charges; ids uuid[];
begin
  insert into public.billing_payers(id,clinic_id,name,ans_registry,provider_code) values (payer,c,'Operadora Exemplo','999999','123456');

  -- Idempotency: one request id per clinic; one live charge per appointment and procedure.
  insert into public.billing_charges(id,clinic_id,appointment_id,doctor_id,patient_name,guide_type,table_code,procedure_code,description,unit_amount,amount,service_date,client_request_id)
  values ('ea400000-0000-4000-8000-000000000001',c,appt,doctor,'Paciente Um','particular','00','PARTICULAR','Consulta particular',300,300,current_date-1,req);
  assert pg_temp.sqlstate_of(format($q$insert into public.billing_charges(clinic_id,doctor_id,patient_name,guide_type,procedure_code,description,unit_amount,amount,service_date,client_request_id)
    values (%L,%L,'X','particular','PARTICULAR','Outra',1,1,current_date,%L)$q$, c, doctor, req))='23505', 'request id reused';
  assert pg_temp.sqlstate_of(format($q$insert into public.billing_charges(clinic_id,appointment_id,doctor_id,patient_name,guide_type,table_code,procedure_code,description,unit_amount,amount,service_date)
    values (%L,%L,%L,'X','particular','00','PARTICULAR','Outra',1,1,current_date)$q$, c, appt, doctor))='23505', 'second charge of the same procedure for one appointment';
  -- Another procedure of the same visit is fine; a cancelled charge frees the slot.
  insert into public.billing_charges(id,clinic_id,appointment_id,doctor_id,patient_name,guide_type,table_code,procedure_code,description,unit_amount,amount,service_date)
  values ('ea400000-0000-4000-8000-000000000003',c,appt,doctor,'Paciente Um','particular','00','41301102','Colposcopia',80,80,current_date-1);
  update public.billing_charges set status='cancelled' where id='ea400000-0000-4000-8000-000000000001';
  insert into public.billing_charges(id,clinic_id,appointment_id,doctor_id,patient_name,guide_type,table_code,procedure_code,description,unit_amount,amount,service_date)
  values ('ea400000-0000-4000-8000-000000000002',c,appt,doctor,'Paciente Um','particular','00','PARTICULAR','Consulta particular',300,300,current_date-1);

  -- Edit: open and unpaid only, in scope, revision checked; an event records each changed field.
  ch := (select x from public.billing_charges x where id='ea400000-0000-4000-8000-000000000002');
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_edit(%L,%L,%L,%s,'{"unit_amount":250,"amount":250}')$q$, c, doctor2, ch.id, ch.revision))='42501', 'out-of-scope edit';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_edit(%L,%L,%L,%s,'{"unit_amount":250,"amount":250}')$q$, c, rec, ch.id, ch.revision + 1))='40001', 'stale edit';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_edit(%L,%L,%L,%s,'{"unit_amount":250,"amount":200}')$q$, c, rec, ch.id, ch.revision))='23514', 'amount check';
  r := public.billing_charge_edit(c, rec, ch.id, ch.revision, '{"unit_amount":250,"amount":250,"description":"Consulta particular","status":"paid","doctor_id":"ea100000-0000-4000-8000-000000000004","paid_amount":250}');
  assert (r->>'amount')::numeric=250 and r->>'status'='open' and (r->>'doctor_id')::uuid=doctor and (r->>'paid_amount')::numeric=0
    and (r->>'revision')::int=ch.revision+1, 'edit applied only allowed fields: '||r::text;
  assert (select count(*) from public.billing_events where charge_id=ch.id and action='charge_edit' and actor=rec
    and detail = '{"amount":{"from":300.00,"to":250.00},"unit_amount":{"from":300.00,"to":250.00}}'::jsonb)=1,
    'edit event: '||(select string_agg(detail::text, ' | ') from public.billing_events where charge_id=ch.id);
  -- To a plan: the card is required by the table; with it, the change is accepted and logged.
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_edit(%L,%L,%L,%s,'{"payer_id":"%s","guide_type":"consulta"}')$q$, c, admin, ch.id, ch.revision+1, payer))='23514', 'plan without card';
  r := public.billing_charge_edit(c, admin, ch.id, ch.revision+1, jsonb_build_object('payer_id', payer, 'guide_type', 'consulta', 'card_number', '0001',
    'table_code', '22', 'procedure_code', '10101012', 'consultation_type', '1', 'authorization_password', 'SENHA1'));
  assert (select detail->>'authorization_password' from public.billing_events where charge_id=ch.id order by id desc limit 1)='alterada', 'password kept out of the log';
  -- Paid or partial charges are not edited.
  perform public.billing_charge_pay(c, admin, 'ea400000-0000-4000-8000-000000000003', 1, 10, 'pix', current_date, '');
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_edit(%L,%L,%L,%s,'{"notes":"x"}')$q$, c, admin, 'ea400000-0000-4000-8000-000000000003',
    (select revision from public.billing_charges where id='ea400000-0000-4000-8000-000000000003')))='55000', 'edit of a charge with payment';

  -- Batch: clear the XML of a draft, mark sent, take it back, then refuse once a statement exists.
  ids := array[ch.id];
  r := public.billing_batch_create(c, admin, payer, 'consulta', ids);
  b := (r->>'id')::uuid;
  rev := (r->>'revision')::int;
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_clear_xml(%L,%L,%L,%s)$q$, c, admin, b, rev))='55000', 'clear without XML';
  r := public.billing_batch_update(c, admin, b, rev, jsonb_build_object('xmlHash', repeat('a',32), 'xml', '<xml/>'));
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_clear_xml(%L,%L,%L,%s)$q$, c, rec, b, (r->>'revision')::int))='42501', 'reception cleared XML';
  r := public.billing_batch_clear_xml(c, admin, b, (r->>'revision')::int);
  assert r->>'xml_hash' is null and r->>'generated_at' is null and not r ? 'xml_payload'
    and (select xml_payload is null from public.billing_batches where id=b), 'XML cleared: '||r::text;
  assert (select detail->>'xmlHash' from public.billing_events where batch_id=b and action='batch_xml_cleared')=repeat('a',32), 'clear event';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_update(%L,%L,%L,%s,'{"sentAt":"2026-11-07"}')$q$, c, admin, b, (r->>'revision')::int))='55000', 'sent after the XML was cleared';
  r := public.billing_batch_update(c, admin, b, (r->>'revision')::int, jsonb_build_object('xmlHash', repeat('b',32), 'xml', '<xml2/>'));
  r := public.billing_batch_update(c, admin, b, (r->>'revision')::int, '{"sentAt":"2026-11-07","protocol":"P-9"}');
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_clear_xml(%L,%L,%L,%s)$q$, c, admin, b, (r->>'revision')::int))='55000', 'XML cleared after sending';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_unsend(%L,%L,%L,%s)$q$, c, admin, b, (r->>'revision')::int - 1))='40001', 'stale unsend';
  r := public.billing_batch_unsend(c, admin, b, (r->>'revision')::int);
  assert r->>'status'='draft' and r->>'sent_at' is null and r->>'protocol' is null and r->>'xml_hash'=repeat('b',32), 'unsent: '||r::text;
  assert (select bool_and(status='batched') from public.billing_charges where batch_id=b), 'guides back to batched';
  assert (select detail->>'protocol' from public.billing_events where batch_id=b and action='batch_unsent')='P-9', 'unsend event';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_unsend(%L,%L,%L,%s)$q$, c, admin, b, (r->>'revision')::int))='55000', 'unsend of a draft';
  r := public.billing_batch_update(c, admin, b, (r->>'revision')::int, '{"sentAt":"2026-11-08"}');
  -- Denied guide: re-present (keeps the number, leaves the batch) or write off; reports keep the write-off as glosa.
  r := public.billing_batch_settle(c, admin, b, (r->>'revision')::int, current_date, jsonb_build_array(jsonb_build_object('chargeId', ch.id, 'paid', 0, 'denialCode', '1423', 'denialNote', 'Carteirinha vencida')));
  r := public.billing_batch_reopen(c, admin, b, (r->>'revision')::int);
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_unsend(%L,%L,%L,%s)$q$, c, admin, b, (r->>'revision')::int))='55000', 'unsend after a statement';
  r := public.billing_batch_settle(c, admin, b, (r->>'revision')::int, current_date, jsonb_build_array(jsonb_build_object('chargeId', ch.id, 'paid', 0, 'denialCode', '1423', 'denialNote', 'Carteirinha vencida')));
  ch := (select x from public.billing_charges x where id=ch.id);
  assert ch.status='denied' and ch.guide_number is not null, 'denied';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_represent(%L,%L,%L,%s)$q$, c, rec, ch.id, ch.revision))='42501', 'reception re-presented';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_write_off(%L,%L,%L,%s,'')$q$, c, rec, ch.id, ch.revision))='42501', 'reception wrote off';
  r := public.billing_charge_represent(c, admin, ch.id, ch.revision);
  assert r->>'status'='open' and r->>'batch_id' is null and (r->>'guide_number')::bigint=ch.guide_number and (r->>'denied_amount')::numeric=0 and r->>'denial_code' is null, 'represented: '||r::text;
  assert (select detail->>'denialCode'='1423' and batch_id=b from public.billing_events where charge_id=ch.id and action='charge_represent'), 'represent event';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_represent(%L,%L,%L,%s)$q$, c, admin, ch.id, (r->>'revision')::int))='55000', 'represent of an open charge';
  -- A new batch keeps its guide number; denied again, then written off.
  r := public.billing_batch_create(c, admin, payer, 'consulta', ids);
  assert (select guide_number from public.billing_charges where id=ch.id)=ch.guide_number, 'guide number kept';
  b := (r->>'id')::uuid;
  r := public.billing_batch_update(c, admin, b, (r->>'revision')::int, jsonb_build_object('xmlHash', repeat('c',32), 'xml', '<xml3/>'));
  r := public.billing_batch_update(c, admin, b, (r->>'revision')::int, '{"sentAt":"2026-11-09"}');
  r := public.billing_batch_settle(c, admin, b, (r->>'revision')::int, current_date, jsonb_build_array(jsonb_build_object('chargeId', ch.id, 'paid', 0, 'denialCode', '1423')));
  ch := (select x from public.billing_charges x where id=ch.id);
  r := public.billing_charge_write_off(c, admin, ch.id, ch.revision, '  Convênio não aceita recurso  ');
  assert r->>'status'='denied' and r->>'written_off_at' is not null and (r->>'written_off_by')::uuid=admin, 'written off: '||r::text;
  assert (select detail->>'note' from public.billing_events where charge_id=ch.id and action='charge_write_off')='Convênio não aceita recurso', 'write-off event';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_write_off(%L,%L,%L,%s,'')$q$, c, admin, ch.id, (r->>'revision')::int))='55000', 'written off twice';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_represent(%L,%L,%L,%s)$q$, c, admin, ch.id, (r->>'revision')::int))='55000', 'represent after write-off';
end $$;
rollback;
