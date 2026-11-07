-- Billing (migration 20261107120000). Synthetic clinic, people, plans and ids only.
begin;
create function pg_temp.sqlstate_of(command text) returns text language plpgsql as $$
begin execute command; return 'ok'; exception when others then return sqlstate; end $$;

insert into auth.users(id,email) values
 ('e9100000-0000-4000-8000-000000000001','bill-admin@example.invalid'),
 ('e9100000-0000-4000-8000-000000000002','bill-doctor@example.invalid'),
 ('e9100000-0000-4000-8000-000000000003','bill-reception@example.invalid'),
 ('e9100000-0000-4000-8000-000000000004','bill-doctor2@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('e9200000-0000-4000-8000-000000000001','Clínica sintética faturamento','e9100000-0000-4000-8000-000000000001'),
 ('e9200000-0000-4000-8000-000000000002','Outra clínica sintética','e9100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001','admin','active'),
 ('e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000002','doctor','active'),
 ('e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000004','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name) values
 ('e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000003','Recepção sintética');
insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values
 ('e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000003','e9100000-0000-4000-8000-000000000002');

-- Privileges.
do $$ declare t text; f text; begin
  foreach t in array array['billing_settings','billing_payers','billing_prices','billing_professionals','billing_coverages','billing_batches',
    'billing_charges','billing_payments','billing_expenses'] loop
    assert not has_table_privilege('authenticated','public.'||t,'select') and not has_table_privilege('anon','public.'||t,'select'), t||' readable';
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), t||' without RLS';
  end loop;
  foreach f in array array['public.billing_role(uuid,uuid)','public.billing_doctor_ok(uuid,uuid,uuid)','public.billing_visible_doctors(uuid,uuid)',
    'public.billing_batch_create(uuid,uuid,uuid,text,uuid[])','public.billing_batch_cancel(uuid,uuid,uuid,integer)',
    'public.billing_batch_update(uuid,uuid,uuid,integer,jsonb)','public.billing_batch_settle(uuid,uuid,uuid,integer,date,jsonb)',
    'public.billing_charge_pay(uuid,uuid,uuid,integer,numeric,text,date,text)','public.billing_payment_cancel(uuid,uuid,uuid)'] loop
    assert not has_function_privilege('authenticated',f,'execute') and has_function_privilege('service_role',f,'execute'), f||' grants';
  end loop;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

do $$ declare c uuid:='e9200000-0000-4000-8000-000000000001'; admin uuid:='e9100000-0000-4000-8000-000000000001';
  doctor uuid:='e9100000-0000-4000-8000-000000000002'; rec uuid:='e9100000-0000-4000-8000-000000000003'; doctor2 uuid:='e9100000-0000-4000-8000-000000000004';
  payer uuid:='e9300000-0000-4000-8000-000000000001'; ids uuid[]; r jsonb; b uuid; rev int; ch public.billing_charges;
begin
  -- Roles and scope.
  assert public.billing_role(c, admin)='admin' and public.billing_role(c, rec)='reception' and public.billing_role(c, doctor)='doctor', 'roles';
  assert public.billing_role('e9200000-0000-4000-8000-000000000002', rec) is null, 'role in another clinic';
  assert public.billing_doctor_ok(c, doctor, rec) and not public.billing_doctor_ok(c, doctor2, rec), 'reception scope';
  assert public.billing_doctor_ok(c, doctor2, admin) and public.billing_doctor_ok(c, doctor, doctor) and not public.billing_doctor_ok(c, doctor2, doctor), 'doctor scope';
  assert public.billing_visible_doctors(c, rec) = array[doctor], 'visible doctors';

  insert into public.billing_payers(id,clinic_id,name,ans_registry,provider_code) values (payer,c,'Operadora Exemplo','999999','123456');
  -- Charges: two plan consultations of doctor 1, one of doctor 2, one SP/SADT, one private.
  insert into public.billing_charges(id,clinic_id,doctor_id,patient_name,payer_id,card_number,guide_type,procedure_code,description,unit_amount,amount,service_date,consultation_type) values
   ('e9400000-0000-4000-8000-000000000001',c,doctor,'Paciente Um',payer,'0001','consulta','10101012','Consulta',150,150,current_date-2,'1'),
   ('e9400000-0000-4000-8000-000000000002',c,doctor,'Paciente Dois',payer,'0002','consulta','10101012','Consulta',150,150,current_date-1,'2'),
   ('e9400000-0000-4000-8000-000000000003',c,doctor2,'Paciente Três',payer,'0003','consulta','10101012','Consulta',150,150,current_date-1,'1'),
   ('e9400000-0000-4000-8000-000000000004',c,doctor,'Paciente Um',payer,'0001','sadt','41301102','Colposcopia',80,80,current_date-2,null);
  insert into public.billing_charges(id,clinic_id,doctor_id,patient_name,guide_type,procedure_code,description,unit_amount,quantity,amount,service_date) values
   ('e9400000-0000-4000-8000-000000000005',c,doctor,'Paciente Quatro','particular','10101012','Consulta particular',250,1,250,current_date);
  -- Constraints: private without plan, plan with a card, amount = unit x quantity.
  assert pg_temp.sqlstate_of(format($q$insert into public.billing_charges(clinic_id,doctor_id,patient_name,payer_id,guide_type,procedure_code,description,unit_amount,amount,service_date)
    values (%L,%L,'X',%L,'consulta','10101012','Consulta',1,1,current_date)$q$, c, doctor, payer))='23514', 'plan charge without a card';
  assert pg_temp.sqlstate_of(format($q$insert into public.billing_charges(clinic_id,doctor_id,patient_name,guide_type,procedure_code,description,unit_amount,quantity,amount,service_date)
    values (%L,%L,'X','particular','10101012','Consulta',100,2,150,current_date)$q$, c, doctor))='23514', 'amount different from unit x quantity';

  -- Batch: admin only, same plan and type, open charges only, at most 100.
  ids := array['e9400000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-000000000002','e9400000-0000-4000-8000-000000000003']::uuid[];
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_create(%L,%L,%L,'consulta',%L)$q$, c, rec, payer, ids))='42501', 'reception created a batch';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_create(%L,%L,%L,'consulta',%L)$q$, c, admin, payer,
    ids || 'e9400000-0000-4000-8000-000000000004'::uuid))='40001', 'mixed guide types';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_create(%L,%L,%L,'consulta',%L)$q$, c, admin, payer,
    array['e9400000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-000000000001']::uuid[]))='22023', 'repeated charge';
  r := public.billing_batch_create(c, admin, payer, 'consulta', ids);
  b := (r->>'id')::uuid;
  assert (r->>'number')::int=1 and (r->>'guides')::int=3 and (r->>'total')::numeric=450, 'batch: '||r::text;
  assert (select array_agg(guide_number order by service_date, created_at, id) from public.billing_charges where batch_id=b) = array[1,2,3]::bigint[], 'guide numbers';
  assert (select next_guide_number from public.billing_settings where clinic_id=c)=4, 'next guide number';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_create(%L,%L,%L,'consulta',%L)$q$, c, admin, payer, ids))='40001', 'charge in two batches';

  -- Cancel a draft: charges back to open, keeping their numbers; then batch again (number 1 is free again, guides keep numbers).
  rev := (select revision from public.billing_batches where id=b);
  r := public.billing_batch_cancel(c, admin, b, rev);
  assert (select count(*) from public.billing_charges where id=any(ids) and status='open' and batch_id is null and guide_number is not null)=3, 'cancel';
  r := public.billing_batch_create(c, admin, payer, 'consulta', ids);
  b := (r->>'id')::uuid;
  assert (select next_guide_number from public.billing_settings where clinic_id=c)=4, 'numbers reused after cancel';

  -- Sent only after the XML; settle needs every guide once, and a code for each denial.
  rev := (select revision from public.billing_batches where id=b);
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_update(%L,%L,%L,%s,'{"sentAt":"2026-11-07"}')$q$, c, admin, b, rev))='55000', 'sent without XML';
  r := public.billing_batch_update(c, admin, b, rev, jsonb_build_object('xmlHash', repeat('a',32), 'xml', '<xml/>'));
  r := public.billing_batch_update(c, admin, b, (r->>'revision')::int, '{"sentAt":"2026-11-07","protocol":"P-1"}');
  assert r->>'status'='sent' and (select count(*) from public.billing_charges where batch_id=b and status='sent')=3, 'sent';
  rev := (r->>'revision')::int;
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_update(%L,%L,%L,%s,'{"xmlHash":"%s"}')$q$, c, admin, b, rev, repeat('b',32)))='55000', 'XML changed after sending';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_settle(%L,%L,%L,%s,current_date,'[{"chargeId":"e9400000-0000-4000-8000-000000000001","paid":150}]')$q$, c, admin, b, rev))='22023', 'partial statement';
  assert pg_temp.sqlstate_of(format($q$select public.billing_batch_settle(%L,%L,%L,%s,current_date,'[
    {"chargeId":"e9400000-0000-4000-8000-000000000001","paid":150},{"chargeId":"e9400000-0000-4000-8000-000000000002","paid":100},
    {"chargeId":"e9400000-0000-4000-8000-000000000003","paid":0}]')$q$, c, admin, b, rev))='22023', 'denial without code';
  r := public.billing_batch_settle(c, admin, b, rev, current_date, '[
    {"chargeId":"e9400000-0000-4000-8000-000000000001","paid":150},
    {"chargeId":"e9400000-0000-4000-8000-000000000002","paid":100,"denialCode":"1705","denialNote":"Valor acima da tabela"},
    {"chargeId":"e9400000-0000-4000-8000-000000000003","paid":0,"denialCode":"1423"}]');
  assert (r->>'paid')::numeric=250 and (r->>'denied')::numeric=200, 'settle: '||r::text;
  assert (select string_agg(status, ',' order by id) from public.billing_charges where batch_id=b)='paid,partial,denied', 'charge statuses';
  assert (select status='closed' and paid_amount=250 from public.billing_batches where id=b), 'batch closed';
  assert (select count(*)=1 and sum(amount)=250 from public.billing_payments where batch_id=b and method='convenio'), 'batch payment';

  -- Private payment: reception in scope, installments up to the amount; not for plan charges.
  ch := (select x from public.billing_charges x where id='e9400000-0000-4000-8000-000000000005');
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_pay(%L,%L,%L,%s,100,'pix',current_date,'')$q$, c, doctor2, ch.id, ch.revision))='42501', 'out-of-scope payment';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_pay(%L,%L,%L,%s,300,'pix',current_date,'')$q$, c, rec, ch.id, ch.revision))='22023', 'overpayment';
  r := public.billing_charge_pay(c, rec, ch.id, ch.revision, 100, 'pix', current_date, 'sinal');
  assert r->>'status'='partial', 'first installment';
  r := public.billing_charge_pay(c, rec, ch.id, (r->>'revision')::int, 150, 'credito', current_date, '');
  assert r->>'status'='paid' and (r->>'paidAmount')::numeric=250, 'paid';
  assert pg_temp.sqlstate_of(format($q$select public.billing_charge_pay(%L,%L,'e9400000-0000-4000-8000-000000000004',%s,10,'pix',current_date,'')$q$, c, admin,
    (select revision from public.billing_charges where id='e9400000-0000-4000-8000-000000000004')))='55000', 'plan charge paid as private';
  -- Reversal: admin only; the charge returns to partial.
  assert pg_temp.sqlstate_of(format($q$select public.billing_payment_cancel(%L,%L,%L)$q$, c, rec,
    (select id from public.billing_payments where charge_id=ch.id and method='credito')))='42501', 'reception reversed a payment';
  r := public.billing_payment_cancel(c, admin, (select id from public.billing_payments where charge_id=ch.id and method='credito'));
  assert r->>'status'='partial' and (r->>'paidAmount')::numeric=100, 'reversal';
  assert pg_temp.sqlstate_of(format($q$select public.billing_payment_cancel(%L,%L,%L)$q$, c, admin, (select id from public.billing_payments where batch_id=b)))='55000',
    'batch payment reversed as private';
end $$;
rollback;
