-- WhatsApp channel and agenda automations (migration 20261106100000). Synthetic people, numbers and ids only.
begin;
create function pg_temp.as_doctor(command text) returns void language plpgsql as $$
begin
  -- Slot changes on the clinic agenda require an authenticated person (guard_reception_appointment).
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000002',true);
  execute command;
  perform set_config('request.jwt.claim.role','service_role',true);
end $$;
create function pg_temp.sqlstate_of(command text) returns text language plpgsql as $$
begin execute command; return 'ok'; exception when others then return sqlstate; end $$;

insert into auth.users(id,email) values
 ('e6100000-0000-4000-8000-000000000001','wa-admin@example.invalid'),
 ('e6100000-0000-4000-8000-000000000002','wa-doctor@example.invalid'),
 ('e6100000-0000-4000-8000-000000000003','wa-reception@example.invalid'),
 ('e6100000-0000-4000-8000-000000000004','wa-other@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('e6200000-0000-4000-8000-000000000001','Clínica sintética WhatsApp','e6100000-0000-4000-8000-000000000001'),
 ('e6200000-0000-4000-8000-000000000002','Outra clínica sintética','e6100000-0000-4000-8000-000000000004');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('e6200000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000001','admin','active'),
 ('e6200000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000002','doctor','active'),
 ('e6200000-0000-4000-8000-000000000002','e6100000-0000-4000-8000-000000000004','admin','active');
insert into public.patients(id,user_id,name,status,phone) values
 ('e6500000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000002','Paciente Exemplo','novo','(41) 99999-0001');
insert into public.clinic_contacts(id,clinic_id,name,phone,phone_normalized,created_by,request_id) values
 ('e6300000-0000-4000-8000-000000000001','e6200000-0000-4000-8000-000000000001','Contato Exemplo','(41) 99998-0002','5541999980002',
  'e6100000-0000-4000-8000-000000000001',gen_random_uuid());

-- Privileges: nothing for anon/authenticated; functions only for service_role.
do $$ declare t text; f text; begin
  foreach t in array array['whatsapp_channels','whatsapp_conversations','whatsapp_messages','whatsapp_webhook_events','whatsapp_templates',
    'whatsapp_automations','whatsapp_automation_runs','whatsapp_opt_ins'] loop
    assert not has_table_privilege('anon','public.'||t,'select') and not has_table_privilege('authenticated','public.'||t,'select'), t||' readable';
    assert not has_table_privilege('authenticated','public.'||t,'insert') and not has_table_privilege('authenticated','public.'||t,'update'), t||' writable';
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), t||' without RLS';
  end loop;
  foreach f in array array['public.whatsapp_record_event(text,jsonb)','public.whatsapp_ingest_inbound(text,text,text,text,text,text,text,jsonb,text,timestamptz)',
    'public.whatsapp_begin_outbound(uuid,uuid,uuid,uuid,text,text,jsonb)','public.whatsapp_conversation_action(uuid,uuid,uuid,integer,text,uuid,text)',
    'public.whatsapp_automation_candidates(timestamptz,integer)','public.whatsapp_automation_begin(uuid,integer,uuid,timestamptz,text,text,text,jsonb)',
    'public.whatsapp_automation_save(uuid,uuid,uuid,integer,jsonb)'] loop
    assert not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'), f||' callable';
    assert has_function_privilege('service_role',f,'execute'), f||' not callable by service_role';
  end loop;
  assert public.whatsapp_phone_variants('554199990001') = array['554199990001','5541999990001'], 'ninth digit variant';
  assert public.whatsapp_phone_variants('5541999990001') = array['5541999990001','554199990001'], 'reverse variant';
  assert public.whatsapp_safe_phone('(41) 99999-0001') = '5541999990001' and public.whatsapp_safe_phone('abc') is null, 'safe phone';
end $$;

-- Functions refuse an authenticated caller even if granted by mistake later.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000001',true);
do $$ begin assert pg_temp.sqlstate_of($q$select public.whatsapp_record_event(repeat('a',64),'{}')$q$) = '42501', 'authenticated reached record_event'; end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into public.whatsapp_channels(id,clinic_id,phone_number_id,waba_id,status,token_sealed) values
 ('e6400000-0000-4000-8000-000000000001','e6200000-0000-4000-8000-000000000001','200000000001','1000000001','connected','{"v":1,"keyId":"k1","nonce":"x","ciphertext":"y"}');

-- Webhook delivery bookkeeping: stored once, payload erased after processing.
do $$ declare r jsonb; begin
  r := public.whatsapp_record_event(repeat('b',64),'{"object":"whatsapp_business_account"}');
  assert (r->>'new')::boolean and not (r->>'processed')::boolean, 'first record';
  r := public.whatsapp_record_event(repeat('b',64),'{"object":"whatsapp_business_account"}');
  assert not (r->>'new')::boolean and not (r->>'processed')::boolean, 'retry before processing must process again';
  perform public.whatsapp_finish_event(repeat('b',64), null);
  r := public.whatsapp_record_event(repeat('b',64),'{"object":"whatsapp_business_account"}');
  assert (r->>'processed')::boolean, 'processed delivery';
  assert (select payload is null and attempts=2 from public.whatsapp_webhook_events where payload_sha256=repeat('b',64)), 'payload kept or attempts wrong';
end $$;

-- Inbound: idempotent per wamid, one conversation per person (phone or BSUID), contact matched by phone variant.
do $$ declare r jsonb; c public.whatsapp_conversations; c2 uuid; begin
  r := public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','Paciente Exemplo','wamid.IN000001','text','Olá, quero remarcar',null,null,now());
  assert not (r->>'duplicate')::boolean, 'first message';
  r := public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','Paciente Exemplo','wamid.IN000001','text','Olá, quero remarcar',null,null,now());
  assert (r->>'duplicate')::boolean, 'duplicate not detected';
  r := public.whatsapp_ingest_inbound('200000000001',null,'BR.1111','','wamid.IN000002','text','Pode ser amanhã?',null,null,now());
  select * into c from public.whatsapp_conversations where user_id='BR.1111';
  assert c.id = (r->>'conversationId')::uuid and c.unread_count=2 and c.status='open' and c.wa_id='5541999990001', 'BSUID-only message split the conversation';
  assert c.profile_name='Paciente Exemplo', 'empty profile name overwrote';
  assert (select count(*) from public.whatsapp_messages where conversation_id=c.id)=2, 'messages';
  r := public.whatsapp_ingest_inbound('200000000001',null,'BR.2222','Pessoa com usuário','wamid.IN000003','text','Oi',null,null,now());
  assert (select wa_id is null from public.whatsapp_conversations where user_id='BR.2222'), 'BSUID-only conversation';
  r := public.whatsapp_ingest_inbound('200000000001','554199980002',null,'Contato','wamid.IN000004','text','Bom dia',null,null,now());
  c2 := (r->>'conversationId')::uuid;
  assert (select contact_id from public.whatsapp_conversations where id=c2)='e6300000-0000-4000-8000-000000000001', 'contact not matched by ninth-digit variant';
  r := public.whatsapp_ingest_inbound('999999999','5541999990009',null,'','wamid.IN000005','text','x',null,null,now());
  assert r->>'ignored'='unknown_channel', 'unknown channel accepted';
  assert pg_temp.sqlstate_of($q$select public.whatsapp_ingest_inbound('200000000001',null,null,'','wamid.IN000006','text','x',null,null,now())$q$)='22023', 'anonymous sender accepted';
end $$;

-- Reception actions with revision, assignment rules and reopening.
do $$ declare c public.whatsapp_conversations; r jsonb; begin
  select * into c from public.whatsapp_conversations where user_id='BR.1111';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_conversation_action('e6200000-0000-4000-8000-000000000001','%s','e6100000-0000-4000-8000-000000000001',%s,'assign','e6100000-0000-4000-8000-000000000002',null)$q$, c.id, c.revision))='22023',
    'non-admin doctor assigned';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_conversation_action('e6200000-0000-4000-8000-000000000002','%s','e6100000-0000-4000-8000-000000000004',%s,'close',null,null)$q$, c.id, c.revision))='42501',
    'other clinic acted on the conversation';
  r := public.whatsapp_conversation_action('e6200000-0000-4000-8000-000000000001',c.id,'e6100000-0000-4000-8000-000000000001',c.revision,'assign','e6100000-0000-4000-8000-000000000001',null);
  assert (r->>'assignedTo')::uuid='e6100000-0000-4000-8000-000000000001' and (r->>'revision')::int=c.revision+1, 'assign';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_conversation_action('e6200000-0000-4000-8000-000000000001','%s','e6100000-0000-4000-8000-000000000001',%s,'close',null,null)$q$, c.id, c.revision))='40001',
    'stale revision accepted';
  perform public.whatsapp_conversation_action('e6200000-0000-4000-8000-000000000001',c.id,'e6100000-0000-4000-8000-000000000001',c.revision+1,'close',null,null);
  assert (select status='closed' and unread_count=0 from public.whatsapp_conversations where id=c.id), 'close';
  perform public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','','wamid.IN000007','text','Mais uma dúvida',null,null,now());
  assert (select status='open' and closed_at is null and first_response_at is null and assigned_to is not null from public.whatsapp_conversations where id=c.id), 'reopen on new message';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_conversation_action('e6200000-0000-4000-8000-000000000001','%s','e6100000-0000-4000-8000-000000000001',%s,'link_contact','e6300000-0000-4000-8000-000000000099',null)$q$,
    c.id, (select revision from public.whatsapp_conversations where id=c.id)))='22023', 'unknown contact linked';
end $$;

-- Outbound: window, opt-out, idempotency, receipts only move forward.
do $$ declare c public.whatsapp_conversations; r jsonb; m uuid; begin
  select * into c from public.whatsapp_conversations where user_id='BR.1111';
  r := public.whatsapp_begin_outbound(c.clinic_id,c.id,'e6100000-0000-4000-8000-000000000003','e6600000-0000-4000-8000-000000000001','text','Podemos às 15h?',null);
  m := (r->>'messageId')::uuid;
  assert r->>'state'='new', 'reserve';
  r := public.whatsapp_begin_outbound(c.clinic_id,c.id,'e6100000-0000-4000-8000-000000000003','e6600000-0000-4000-8000-000000000001','text','Podemos às 15h?',null);
  assert r->>'state'='existing' and (r->>'messageId')::uuid=m, 'same request reserved twice';
  perform public.whatsapp_finish_outbound(m,'wamid.OUT000001',null);
  assert (select status='sent' and wamid='wamid.OUT000001' from public.whatsapp_messages where id=m), 'sent';
  assert (select first_response_at is not null and unread_count=0 from public.whatsapp_conversations where id=c.id), 'first response not recorded';
  assert public.whatsapp_apply_status('200000000001','wamid.OUT000001','read',now(),null), 'read';
  assert not public.whatsapp_apply_status('200000000001','wamid.OUT000001','delivered',now(),null), 'receipt regressed';
  assert not public.whatsapp_apply_status('200000000001','wamid.OUT000001','failed',now(),'x'), 'failed after read';
  assert not public.whatsapp_apply_status('999999999','wamid.OUT000001','read',now(),null), 'other channel updated the receipt';
  update public.whatsapp_conversations set last_inbound_at=now()-interval '25 hours' where id=c.id;
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_begin_outbound('%s','%s','e6100000-0000-4000-8000-000000000003',gen_random_uuid(),'text','Oi',null)$q$, c.clinic_id, c.id))='P0W01', 'free text outside the window';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_begin_outbound('%s','%s','e6100000-0000-4000-8000-000000000003',gen_random_uuid(),'template','',
    '{"name":"lembrete","language":"pt_BR","params":[]}')$q$, c.clinic_id, c.id))='ok', 'template outside the window refused';
  perform public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','','wamid.IN000008','text','SAIR',null,null,now());
  assert (select opted_out_at is not null from public.whatsapp_conversations where id=c.id), 'opt-out not recorded';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_begin_outbound('%s','%s','e6100000-0000-4000-8000-000000000003',gen_random_uuid(),'template','',
    '{"name":"lembrete","language":"pt_BR","params":[]}')$q$, c.clinic_id, c.id))='P0W02', 'template sent after opt-out';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_begin_outbound('e6200000-0000-4000-8000-000000000002','%s','e6100000-0000-4000-8000-000000000004',gen_random_uuid(),'text','x',null)$q$, c.id))='42501', 'other clinic sent on the conversation';
end $$;

-- Identity change follows the person.
do $$ begin
  perform public.whatsapp_ingest_inbound('200000000001','5541999970003','BR.3333','Troca','wamid.IN000009','text','Oi',null,null,now());
  assert public.whatsapp_identity_change('200000000001','wamid.SYS00001','BR.3333','BR.4444','5541999970004','user_changed_number',now()), 'change ignored';
  assert (select wa_id='5541999970004' and user_id='BR.4444' from public.whatsapp_conversations where user_id='BR.4444'), 'conversation did not follow';
  assert (select body !~ '[0-9]{8}' from public.whatsapp_messages where wamid='wamid.SYS00001'), 'phone written into the system note';
end $$;

-- K6 controls: the internal guard holds even if EXECUTE is granted by mistake.
grant execute on function public.whatsapp_record_event(text,jsonb) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
do $$ begin assert pg_temp.sqlstate_of($q$select public.whatsapp_record_event(repeat('c',64),'{}')$q$) = '42501', 'guard depends on the ACL only'; end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
revoke execute on function public.whatsapp_record_event(text,jsonb) from authenticated;

-- K6: a replay with other content, a reply from another conversation and a phone/BSUID split.
do $$ declare c public.whatsapp_conversations; other uuid; r jsonb; m uuid; begin
  select * into c from public.whatsapp_conversations where user_id='BR.4444';
  update public.whatsapp_conversations set last_inbound_at=now() where id=c.id;
  r := public.whatsapp_begin_outbound(c.clinic_id,c.id,'e6100000-0000-4000-8000-000000000003','e6600000-0000-4000-8000-000000000009','text','Primeira versão',null);
  assert (r->>'to')='5541999970004' and r->>'recipient' is null, 'reserved recipient not returned';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_begin_outbound('%s','%s','e6100000-0000-4000-8000-000000000003','e6600000-0000-4000-8000-000000000009','text','Outra versão',null)$q$, c.clinic_id, c.id))='22023',
    'replay with another body accepted';
  m := (r->>'messageId')::uuid;
  perform public.whatsapp_finish_outbound(m,null,'Sem resposta do WhatsApp',true);
  assert (select status='unknown' from public.whatsapp_messages where id=m), 'lost answer marked as failed';
  -- A reply in another conversation does not touch this conversation's runs.
  perform public.whatsapp_ingest_inbound('200000000001','5541999950006',null,'Outra pessoa','wamid.IN000020','text','oi',null,null,now());
  select id into other from public.whatsapp_conversations where wa_id='5541999950006';
  assert other <> c.id, 'fixture';
  -- Phone-only and BSUID-only conversations, then one delivery with both: no 23505, no silent merge.
  perform public.whatsapp_ingest_inbound('200000000001',null,'BR.5555','Pessoa','wamid.IN000021','text','oi',null,null,now());
  perform public.whatsapp_ingest_inbound('200000000001','5541999950006','BR.5555','Pessoa','wamid.IN000022','text','oi de novo',null,null,now());
  assert (select count(*) from public.whatsapp_conversations where wa_id='5541999950006' or user_id='BR.5555')=2, 'conversations merged or lost';
  assert exists (select 1 from public.whatsapp_messages where wamid='wamid.IN000022'), 'delivery lost on key collision';
end $$;

-- Agenda automations: only clinic appointments with an active contact link, consent required,
-- everything rechecked when claiming. Times are relative to now() (constant inside the transaction).
insert into public.clinic_contacts(id,clinic_id,name,phone,phone_normalized,created_by,request_id) values
 ('e6300000-0000-4000-8000-000000000002','e6200000-0000-4000-8000-000000000001','Paciente Exemplo','(41) 99999-0001','5541999990001',
  'e6100000-0000-4000-8000-000000000001',gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000002',true);
-- A private appointment of the doctor (no clinic): never read by automations.
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,status,type) values
 ('e6700000-0000-4000-8000-000000000009',auth.uid(),'e6500000-0000-4000-8000-000000000001','Consulta particular',
  date_trunc('minute',now())+interval '38 hours',date_trunc('minute',now())+interval '38 hours 30 minutes','agendado','retorno');
reset role;
-- Clinic appointments (as the reception would book them), linked to the reception contact through a confirmed link.
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values
 ('e6200000-0000-4000-8000-000000000001','e6300000-0000-4000-8000-000000000002','e6500000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000002','self','e6100000-0000-4000-8000-000000000001');
insert into public.appointments(id,user_id,patient_id,clinic_id,contact_id,title,start_time,end_time,status,type) values
 ('e6700000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000002','e6500000-0000-4000-8000-000000000001','e6200000-0000-4000-8000-000000000001','e6300000-0000-4000-8000-000000000002','Consulta',
  date_trunc('minute',now())+interval '40 hours',date_trunc('minute',now())+interval '40 hours 30 minutes','agendado','retorno'),
 ('e6700000-0000-4000-8000-000000000002','e6100000-0000-4000-8000-000000000002','e6500000-0000-4000-8000-000000000001','e6200000-0000-4000-8000-000000000001','e6300000-0000-4000-8000-000000000002','Consulta',
  date_trunc('minute',now())+interval '44 hours',date_trunc('minute',now())+interval '44 hours 30 minutes','cancelado','retorno');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
create temp table rule(id uuid) on commit drop;
insert into rule select (public.whatsapp_automation_save('e6200000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000001',null,null,
  '{"name":"Lembrete 48 h","enabled":true,"trigger":"before_start","offsetMinutes":2880,"templateName":"lembrete_consulta","templateLanguage":"pt_BR",
    "params":[{"source":"paciente_primeiro_nome"},{"source":"data"}],"doctorIds":["e6100000-0000-4000-8000-000000000002"]}')->>'id')::uuid;
create function pg_temp.rev() returns integer language sql as $$ select revision from public.whatsapp_automations where id=(select id from rule) $$;
create function pg_temp.start1() returns timestamptz language sql as $$ select start_time from public.appointments where id='e6700000-0000-4000-8000-000000000001' $$;
do $$ declare n int; r jsonb; begin
  assert pg_temp.sqlstate_of($q$select public.whatsapp_automation_save('e6200000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000001',null,null,
    '{"name":"Outra","trigger":"before_start","offsetMinutes":60,"templateName":"x","templateLanguage":"pt_BR","doctorIds":["e6100000-0000-4000-8000-000000000004"]}')$q$)='22023',
    'rule for a doctor outside the clinic';
  assert not exists (select 1 from public.whatsapp_automation_candidates(now()-interval '20 hours',100)), 'sent before its time';
  assert not exists (select 1 from public.whatsapp_automation_candidates(now(),100) where appointment_id='e6700000-0000-4000-8000-000000000009'),
    'private appointment of the doctor listed';
  select count(*) into n from public.whatsapp_automation_candidates(now(),100) c where c.appointment_id='e6700000-0000-4000-8000-000000000001'
    and c.phone='5541999990001' and c.patient_name='Paciente Exemplo' and not c.consented;
  assert n=1, 'clinic appointment not listed (contact phone, consent flag)';
  assert not exists (select 1 from public.whatsapp_automation_candidates(now(),100) where appointment_id='e6700000-0000-4000-8000-000000000002'), 'cancelled appointment listed';
  assert not exists (select 1 from public.whatsapp_automation_candidates(now()+interval '30 hours',100)), 'stale reminder (over 14 h late) listed';
  -- Not due yet when claimed: nothing is recorded.
  update public.whatsapp_automations set offset_minutes=60, revision=revision+1 where id=(select id from rule);
  assert public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}') is null,
    'claimed before its time';
  update public.whatsapp_automations set offset_minutes=2880, revision=revision+1 where id=(select id from rule);
  -- Without consent the claim is recorded as skipped, even if the caller passed no reason.
  r := public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}');
  assert (r->>'skipped')::boolean and r->>'reason' like 'Sem consentimento%', 'sent without consent: ' || coalesce(r::text,'null');
  assert public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}') is null, 'claimed twice';
  -- A private appointment cannot be claimed either.
  r := public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000009',
    (select start_time from public.appointments where id='e6700000-0000-4000-8000-000000000009'),'5541999990001',null,'x','{}');
  assert (r->>'skipped')::boolean and r->>'reason' like '%agenda da clínica%', 'private appointment claimed';
  delete from public.whatsapp_automation_runs where appointment_id='e6700000-0000-4000-8000-000000000001';
end $$;
-- Consent, rescheduling, rule edits, suspended links and changes between selection and claim.
do $$ declare r jsonb; m uuid; c uuid; old_rev int; begin
  perform public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','','wamid.IN000010','text','VOLTAR',null,null,now());
  assert exists (select 1 from public.whatsapp_opt_ins where wa_id='5541999990001' and source='paciente' and revoked_at is null), 'VOLTAR did not renew consent';
  perform pg_temp.as_doctor($q$update public.appointments set start_time=date_trunc('minute',now())+interval '42 hours', end_time=date_trunc('minute',now())+interval '42 hours 30 minutes' where id='e6700000-0000-4000-8000-000000000001'$q$);
  assert exists (select 1 from public.whatsapp_automation_candidates(now(),100) where appointment_id='e6700000-0000-4000-8000-000000000001' and consented and not opted_out),
    'rescheduled appointment not due';
  -- Rule edited after the selection (old revision) or now excluding this doctor: not claimed.
  old_rev := pg_temp.rev();
  update public.whatsapp_automations set doctor_ids=array['e6100000-0000-4000-8000-000000000001'::uuid], revision=revision+1 where id=(select id from rule);
  assert not exists (select 1 from public.whatsapp_automation_candidates(now(),100) where appointment_id='e6700000-0000-4000-8000-000000000001'), 'filter change ignored';
  assert public.whatsapp_automation_begin((select id from rule),old_rev,'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}') is null,
    'claimed with the old rule';
  assert public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}') is null,
    'claimed outside the rule filter';
  update public.whatsapp_automations set doctor_ids=null, revision=revision+1 where id=(select id from rule);
  -- Changed between selection and claim: the old start time is refused.
  r := public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1()+interval '1 day','5541999990001',null,'x','{}');
  assert (r->>'skipped')::boolean and r->>'reason' like '%horário%', 'stale start time claimed';
  -- Cancelled between selection and claim.
  perform pg_temp.as_doctor($q$update public.appointments set status='cancelado' where id='e6700000-0000-4000-8000-000000000001'$q$);
  r := public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}');
  assert (r->>'skipped')::boolean and r->>'reason' like '%não está mais agendada%', 'cancelled appointment claimed';
  delete from public.whatsapp_automation_runs where appointment_id='e6700000-0000-4000-8000-000000000001';
  perform pg_temp.as_doctor($q$update public.appointments set status='agendado' where id='e6700000-0000-4000-8000-000000000001'$q$);
  -- Opted out between selection and claim.
  perform public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','','wamid.IN000012','text','SAIR',null,null,now());
  r := public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}');
  assert (r->>'skipped')::boolean, 'opted-out person claimed';
  assert exists (select 1 from public.whatsapp_opt_ins where wa_id='5541999990001' and revoked_at is not null), 'SAIR did not revoke consent';
  delete from public.whatsapp_automation_runs where appointment_id='e6700000-0000-4000-8000-000000000001';
  -- The reception records consent again; now it is sent.
  select id into c from public.whatsapp_conversations where user_id='BR.1111';
  perform public.whatsapp_conversation_action('e6200000-0000-4000-8000-000000000001',c,'e6100000-0000-4000-8000-000000000003',
    (select revision from public.whatsapp_conversations where id=c),'record_opt_in',null,null);
  r := public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,
    'Olá Paciente, sua consulta é amanhã.','{"name":"lembrete_consulta","language":"pt_BR","params":["Paciente","amanhã"]}');
  assert not (r->>'skipped')::boolean, 'consented reminder skipped: ' || coalesce(r->>'reason','');
  m := (r->>'messageId')::uuid;
  assert r->>'to'='5541999990001' and (r->>'conversationId')::uuid=c, 'reminder went to another conversation';
  update public.whatsapp_conversations set unread_count=3 where id=c;
  perform public.whatsapp_finish_outbound(m,'wamid.OUT000002',null);
  assert (select status='sent' from public.whatsapp_automation_runs where message_id=m), 'run not sent';
  assert (select unread_count=3 from public.whatsapp_conversations where id=c), 'automation cleared the unread badge';
  -- A button reply from another conversation does not count; from this one it does.
  perform public.whatsapp_ingest_inbound('200000000001','5541999950006',null,'','wamid.IN000013','button','Confirmar',null,'wamid.OUT000002',now());
  assert (select reply is null from public.whatsapp_automation_runs where message_id=m), 'reply from another conversation linked';
  perform public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','','wamid.IN000011','button','Confirmar',null,'wamid.OUT000002',now());
  assert (select reply='Confirmar' and replied_at is not null from public.whatsapp_automation_runs where message_id=m), 'reply captured';
end $$;
-- Suspended contact link (real administrative command): not listed, and refused when claimed.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000001',true);
select public.reception_set_link_active('e6300000-0000-4000-8000-000000000002','e6500000-0000-4000-8000-000000000001',1,false);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare r jsonb; begin
  assert (select not active from public.patient_contact_links where contact_id='e6300000-0000-4000-8000-000000000002'), 'fixture: link still active';
  delete from public.whatsapp_automation_runs where appointment_id='e6700000-0000-4000-8000-000000000001';
  assert not exists (select 1 from public.whatsapp_automation_candidates(now(),100) where appointment_id='e6700000-0000-4000-8000-000000000001'), 'suspended link listed';
  r := public.whatsapp_automation_begin((select id from rule),pg_temp.rev(),'e6700000-0000-4000-8000-000000000001',pg_temp.start1(),'5541999990001',null,'x','{}');
  assert (r->>'skipped')::boolean and r->>'reason' like '%suspenso%', 'suspended link claimed';
end $$;
-- K6 2058: phone A and BSUID B in separate conversations, then SAIR only through B: A stops too.
do $$ begin
  perform public.whatsapp_ingest_inbound('200000000001','5541999940007',null,'Pessoa A','wamid.IN000030','text','oi',null,null,now());
  perform public.whatsapp_ingest_inbound('200000000001',null,'BR.7777','Pessoa B','wamid.IN000031','text','oi',null,null,now());
  insert into public.whatsapp_opt_ins(clinic_id,wa_id,source) values ('e6200000-0000-4000-8000-000000000001','5541999940007','recepcao');
  perform public.whatsapp_ingest_inbound('200000000001','5541999940007','BR.7777','Pessoa','wamid.IN000032','text','oi',null,null,now());
  assert (select linked_wa_id='5541999940007' and wa_id is null from public.whatsapp_conversations where user_id='BR.7777'), 'alias not recorded';
  perform public.whatsapp_ingest_inbound('200000000001',null,'BR.7777','','wamid.IN000033','text','SAIR',null,null,now());
  assert exists (select 1 from public.whatsapp_opt_ins where wa_id='5541999940007' and revoked_at is not null), 'consent of the split phone kept';
  assert (select opted_out_at is not null from public.whatsapp_conversations where wa_id='5541999940007'), 'split phone conversation not opted out';
  assert (select count(*) from public.whatsapp_conversations where wa_id='5541999940007' or user_id='BR.7777')=2, 'identities merged';
end $$;
rollback;
