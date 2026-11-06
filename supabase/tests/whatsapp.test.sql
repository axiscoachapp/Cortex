-- WhatsApp channel and agenda automations (migration 20261106100000). Synthetic people, numbers and ids only.
begin;
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
    'whatsapp_automations','whatsapp_automation_runs'] loop
    assert not has_table_privilege('anon','public.'||t,'select') and not has_table_privilege('authenticated','public.'||t,'select'), t||' readable';
    assert not has_table_privilege('authenticated','public.'||t,'insert') and not has_table_privilege('authenticated','public.'||t,'update'), t||' writable';
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), t||' without RLS';
  end loop;
  foreach f in array array['public.whatsapp_record_event(text,jsonb)','public.whatsapp_ingest_inbound(text,text,text,text,text,text,text,jsonb,text,timestamptz)',
    'public.whatsapp_begin_outbound(uuid,uuid,uuid,uuid,text,text,jsonb)','public.whatsapp_conversation_action(uuid,uuid,uuid,integer,text,uuid,text)',
    'public.whatsapp_automation_candidates(timestamptz,integer)','public.whatsapp_automation_begin(uuid,uuid,timestamptz,text,text,text,jsonb)',
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

-- Agenda automations: due window, once per appointment and start, reply captured.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000002',true);
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,status,type) values
 ('e6700000-0000-4000-8000-000000000001',auth.uid(),'e6500000-0000-4000-8000-000000000001','Consulta','2099-12-10T15:00Z','2099-12-10T15:30Z','agendado','retorno'),
 ('e6700000-0000-4000-8000-000000000002',auth.uid(),'e6500000-0000-4000-8000-000000000001','Consulta','2099-12-10T17:00Z','2099-12-10T17:30Z','cancelado','retorno');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
create temp table rule(id uuid) on commit drop;
insert into rule select (public.whatsapp_automation_save('e6200000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000001',null,null,
  '{"name":"Lembrete 48 h","enabled":true,"trigger":"before_start","offsetMinutes":2880,"templateName":"lembrete_consulta","templateLanguage":"pt_BR",
    "params":[{"source":"paciente_primeiro_nome"},{"source":"data"}],"doctorIds":["e6100000-0000-4000-8000-000000000002"]}')->>'id')::uuid;
do $$ declare n int; r jsonb; again jsonb; begin
  assert pg_temp.sqlstate_of($q$select public.whatsapp_automation_save('e6200000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000001',null,null,
    '{"name":"Outra","trigger":"before_start","offsetMinutes":60,"templateName":"x","templateLanguage":"pt_BR","doctorIds":["e6100000-0000-4000-8000-000000000004"]}')$q$)='22023',
    'rule for a doctor outside the clinic';
  select count(*) into n from public.whatsapp_automation_candidates('2099-12-08T12:00Z',100);
  assert n=0, 'sent before its time';
  select count(*) into n from public.whatsapp_automation_candidates('2099-12-08T15:10Z',100) c where c.appointment_id='e6700000-0000-4000-8000-000000000001' and c.phone='5541999990001' and c.patient_name='Paciente Exemplo' and c.opted_out;
  assert n=1, 'due appointment not listed (phone/opt-out)';
  assert not exists (select 1 from public.whatsapp_automation_candidates('2099-12-08T17:10Z',100) where appointment_id='e6700000-0000-4000-8000-000000000002'), 'cancelled appointment listed';
  assert not exists (select 1 from public.whatsapp_automation_candidates('2099-12-09T06:00Z',100)), 'stale reminder (over 14 h late) listed';
  -- Opted out: recorded as skipped, never sent.
  r := public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000001','2099-12-10T15:00Z','5541999990001','opt_out','',null);
  assert (r->>'skipped')::boolean, 'opt-out not skipped';
  assert public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000001','2099-12-10T15:00Z','5541999990001',null,'x','{}') is null, 'claimed twice';
  assert not exists (select 1 from public.whatsapp_automation_candidates('2099-12-08T15:10Z',100)), 'claimed appointment still listed';
end $$;
-- A rescheduled appointment is a new reminder; the patient opts back in.
do $$ declare r jsonb; m uuid; c uuid; begin
  perform public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','','wamid.IN000010','text','VOLTAR',null,null,now());
  update public.appointments set start_time='2099-12-11T15:00Z', end_time='2099-12-11T15:30Z' where id='e6700000-0000-4000-8000-000000000001';
  assert exists (select 1 from public.whatsapp_automation_candidates('2099-12-09T15:10Z',100) where not opted_out), 'rescheduled appointment not due';
  r := public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000001','2099-12-11T15:00Z','5541999990001',null,
    'Olá Paciente, sua consulta é 11/12.','{"name":"lembrete_consulta","language":"pt_BR","params":["Paciente","11/12"]}');
  m := (r->>'messageId')::uuid; c := (r->>'conversationId')::uuid;
  assert r->>'to'='5541999990001' and c=(select id from public.whatsapp_conversations where user_id='BR.1111'), 'reminder went to another conversation';
  update public.whatsapp_conversations set unread_count=3 where id=c;
  perform public.whatsapp_finish_outbound(m,'wamid.OUT000002',null);
  assert (select status='sent' from public.whatsapp_automation_runs where message_id=m), 'run not sent';
  assert (select unread_count=3 from public.whatsapp_conversations where id=c), 'automation cleared the unread badge';
  perform public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.1111','','wamid.IN000011','button','Confirmar',null,'wamid.OUT000002',now());
  assert (select reply='Confirmar' and replied_at is not null from public.whatsapp_automation_runs where message_id=m), 'reply not captured';
  -- A new person gets a closed conversation that only opens when they answer.
  r := public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000002','2099-12-10T17:00Z','5541999960005',null,'x','{}');
  assert (select status='closed' from public.whatsapp_conversations where id=(r->>'conversationId')::uuid), 'automation opened a queue item';
  perform public.whatsapp_finish_outbound((r->>'messageId')::uuid,null,'O número não pode receber mensagens pelo WhatsApp.');
  assert (select status='failed' and reason like 'O número%' from public.whatsapp_automation_runs where id=(r->>'runId')::uuid), 'failure not recorded on the run';
end $$;
rollback;
