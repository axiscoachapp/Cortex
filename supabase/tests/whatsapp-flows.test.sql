-- WhatsApp menu bot (migration 20261106110000). Synthetic clinic, people and ids only.
begin;
create function pg_temp.sqlstate_of(command text) returns text language plpgsql as $$
begin execute command; return 'ok'; exception when others then return sqlstate; end $$;

insert into auth.users(id,email) values
 ('e7100000-0000-4000-8000-000000000001','bot-admin@example.invalid'),
 ('e7100000-0000-4000-8000-000000000003','bot-reception@example.invalid');
insert into public.clinics(id,name,created_by) values ('e7200000-0000-4000-8000-000000000001','Clínica sintética robô','e7100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values ('e7200000-0000-4000-8000-000000000001','e7100000-0000-4000-8000-000000000001','admin','active');

do $$ declare t text; f text; begin
  foreach t in array array['whatsapp_flows','whatsapp_bot_sessions'] loop
    assert not has_table_privilege('authenticated','public.'||t,'select') and not has_table_privilege('anon','public.'||t,'select'), t||' readable';
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), t||' without RLS';
  end loop;
  foreach f in array array['public.whatsapp_flow_save(uuid,uuid,integer,jsonb)',
    'public.whatsapp_bot_apply(uuid,text,integer,boolean,integer,text,integer,jsonb,text,text,text,boolean,jsonb)'] loop
    assert not has_function_privilege('authenticated',f,'execute') and has_function_privilege('service_role',f,'execute'), f||' grants';
  end loop;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into public.whatsapp_channels(id,clinic_id,phone_number_id,waba_id,status,token_sealed) values
 ('e7400000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001','300000000001','3000000001','connected','{"v":1,"keyId":"k1","nonce":"x","ciphertext":"y"}');
create temp table flow_def(def jsonb) on commit drop;
insert into flow_def values ('{"enabled":true,"handoffText":"Uma pessoa da recepção continua por aqui.","defaultQueue":"geral","hours":{},
  "definition":{"start":"inicio","nodes":{"inicio":{"title":"Boas-vindas","text":"Como podemos ajudar?","options":[{"label":"Agendar","goto":"queue:agendamento"}]}}}}');

-- Flow saved with a revision guard.
do $$ declare r jsonb; begin
  r := public.whatsapp_flow_save('e7200000-0000-4000-8000-000000000001','e7100000-0000-4000-8000-000000000001',0,(select def from flow_def));
  assert (r->>'revision')::int=1, 'first save';
  assert pg_temp.sqlstate_of($q$select public.whatsapp_flow_save('e7200000-0000-4000-8000-000000000001','e7100000-0000-4000-8000-000000000001',0,(select def from flow_def))$q$)='40001',
    'second creation accepted';
  r := public.whatsapp_flow_save('e7200000-0000-4000-8000-000000000001','e7100000-0000-4000-8000-000000000001',1,(select def from flow_def));
  assert (r->>'revision')::int=2, 'update';
  assert pg_temp.sqlstate_of($q$select public.whatsapp_flow_save('e7200000-0000-4000-8000-000000000001','e7100000-0000-4000-8000-000000000001',1,(select def from flow_def))$q$)='40001',
    'stale revision accepted';
end $$;

-- Bot steps.
do $$ declare c uuid; r jsonb; rev int; m public.whatsapp_messages; begin
  perform public.whatsapp_ingest_inbound('300000000001','5541999910001',null,'Paciente','wamid.B0000001','text','Oi',null,null,now());
  select id into c from public.whatsapp_conversations where wa_id='5541999910001';
  -- New cycle: menu reserved as a bot message, session active.
  r := public.whatsapp_bot_apply(c,'wamid.B0000001',0,true,2,'inicio',0,'[]','active',null,null,false,'[{"kind":"interactive","body":"Como podemos ajudar?\n\n1. Agendar"}]');
  assert (r->>'applied')::boolean and jsonb_array_length(r->'messageIds')=1 and r->>'to'='5541999910001', 'first step: '||r::text;
  rev := (r->>'revision')::int;
  select * into m from public.whatsapp_messages where id=(r->'messageIds'->>0)::uuid;
  assert m.bot and m.sent_by is null and m.status='pending' and m.kind='interactive' and m.recipient='5541999910001', 'bot message';
  assert (select status='active' and node='inicio' from public.whatsapp_bot_sessions where conversation_id=c), 'session';
  -- Same revision again (redelivery race) is refused.
  r := public.whatsapp_bot_apply(c,'wamid.B0000001',0,true,2,'inicio',0,'[]','active',null,null,false,'[]');
  assert not (r->>'applied')::boolean, 'double start';
  -- Wrong flow revision is refused.
  r := public.whatsapp_bot_apply(c,'wamid.B0000001',rev,false,1,'inicio',0,'[]','active',null,null,false,'[]');
  assert r->>'reason'='flow', 'old flow accepted';
  -- A newer inbound message makes this trigger stale.
  perform public.whatsapp_ingest_inbound('300000000001','5541999910001',null,'','wamid.B0000002','text','Agendar',null,null,now()+interval '1 second');
  r := public.whatsapp_bot_apply(c,'wamid.B0000001',rev,false,2,'inicio',1,'[]','active',null,null,false,'[]');
  assert r->>'reason'='stale', 'stale trigger accepted';
  -- Hand-off to a queue.
  r := public.whatsapp_bot_apply(c,'wamid.B0000002',rev,false,2,'inicio',0,'["Agendar"]','handed_off','queue:agendamento','agendamento',false,
    '[{"kind":"text","body":"Uma pessoa da recepção continua por aqui."}]');
  assert (r->>'applied')::boolean, 'hand-off';
  assert (select queue='agendamento' and status='open' from public.whatsapp_conversations where id=c), 'queue not set';
  assert (select status='handed_off' and path='["Agendar"]'::jsonb from public.whatsapp_bot_sessions where conversation_id=c), 'session after hand-off';
  -- A handed-off cycle does not accept more bot steps.
  r := public.whatsapp_bot_apply(c,'wamid.B0000002',(r->>'revision')::int,false,2,'inicio',0,'[]','active',null,null,false,'[]');
  assert not (r->>'applied')::boolean, 'step after hand-off';
end $$;

-- A person took the conversation: assignment, or a human answer during the cycle.
do $$ declare c uuid; r jsonb; rev int; begin
  perform public.whatsapp_ingest_inbound('300000000001','5541999910002',null,'Outra','wamid.B0000010','text','Oi',null,null,now());
  select id into c from public.whatsapp_conversations where wa_id='5541999910002';
  r := public.whatsapp_bot_apply(c,'wamid.B0000010',0,true,2,'inicio',0,'[]','active',null,null,false,'[]');
  rev := (r->>'revision')::int;
  perform public.whatsapp_finish_outbound((select id from public.whatsapp_messages where conversation_id=c and bot limit 1),null,'x',false);
  -- Human answer inside the window.
  perform public.whatsapp_begin_outbound('e7200000-0000-4000-8000-000000000001',c,'e7100000-0000-4000-8000-000000000003',gen_random_uuid(),'text','Olá, aqui é a recepção',null);
  perform public.whatsapp_ingest_inbound('300000000001','5541999910002',null,'','wamid.B0000011','text','1',null,null,now()+interval '1 second');
  r := public.whatsapp_bot_apply(c,'wamid.B0000011',rev,false,2,'inicio',0,'[]','active',null,null,false,'[]');
  assert r->>'reason'='taken', 'bot answered after a person';
  assert (select status='human' from public.whatsapp_bot_sessions where conversation_id=c), 'session not ended as human';
  -- Assigned conversation: no bot even for a new cycle.
  update public.whatsapp_conversations set assigned_to='e7100000-0000-4000-8000-000000000001', assigned_at=now() where id=c;
  r := public.whatsapp_bot_apply(c,'wamid.B0000011',(select revision from public.whatsapp_bot_sessions where conversation_id=c),true,2,'inicio',0,'[]','active',null,null,false,'[]');
  assert r->>'reason'='taken', 'bot answered an assigned conversation';
end $$;

-- K6/5b P1: a person who answered in the current opening also blocks a first cycle and a restart
-- (new flow revision or idle), without assignment. An answer from before a reopening does not.
do $$ declare c uuid; r jsonb; begin
  -- First cycle after a human answer: nothing reserved, no session.
  perform public.whatsapp_ingest_inbound('300000000001','5541999910004',null,'Quarta','wamid.B0000030','text','Oi',null,null,now());
  select id into c from public.whatsapp_conversations where wa_id='5541999910004';
  perform public.whatsapp_begin_outbound('e7200000-0000-4000-8000-000000000001',c,'e7100000-0000-4000-8000-000000000003',gen_random_uuid(),'text','Bom dia, recepção',null);
  r := public.whatsapp_bot_apply(c,'wamid.B0000030',0,true,2,'inicio',0,'[]','active',null,'agendamento',false,'[{"kind":"interactive","body":"Menu"}]');
  assert r->>'reason'='taken', 'first cycle after a human answer: '||r::text;
  assert not exists (select 1 from public.whatsapp_bot_sessions where conversation_id=c), 'session created after a human answer';
  assert not exists (select 1 from public.whatsapp_messages where conversation_id=c and bot), 'bot message reserved after a human answer';
  assert (select queue is distinct from 'agendamento' from public.whatsapp_conversations where id=c), 'queue changed after a human answer';

  -- Restart (new cycle over an active session) after a human answer: refused and the session ends as human.
  perform public.whatsapp_ingest_inbound('300000000001','5541999910005',null,'Quinta','wamid.B0000040','text','Oi',null,null,now());
  select id into c from public.whatsapp_conversations where wa_id='5541999910005';
  r := public.whatsapp_bot_apply(c,'wamid.B0000040',0,true,2,'inicio',0,'[]','active',null,null,false,'[]');
  assert (r->>'applied')::boolean, 'start before the human answer';
  perform public.whatsapp_begin_outbound('e7200000-0000-4000-8000-000000000001',c,'e7100000-0000-4000-8000-000000000003',gen_random_uuid(),'text','Pode falar comigo',null);
  perform public.whatsapp_ingest_inbound('300000000001','5541999910005',null,'','wamid.B0000041','text','Oi de novo',null,null,now()+interval '1 second');
  r := public.whatsapp_bot_apply(c,'wamid.B0000041',(r->>'revision')::int,true,2,'inicio',0,'[]','active',null,null,false,'[{"kind":"interactive","body":"Menu"}]');
  assert r->>'reason'='taken', 'restart after a human answer: '||r::text;
  assert (select status='human' from public.whatsapp_bot_sessions where conversation_id=c), 'restart did not end the cycle as human';
  assert (select count(*)=0 from public.whatsapp_messages where conversation_id=c and bot), 'restart reserved a bot message';

  -- Reopened conversation: the answer from the previous opening does not block the new cycle.
  perform public.whatsapp_ingest_inbound('300000000001','5541999910006',null,'Sexta','wamid.B0000050','text','Oi',null,null,now());
  select id into c from public.whatsapp_conversations where wa_id='5541999910006';
  perform public.whatsapp_begin_outbound('e7200000-0000-4000-8000-000000000001',c,'e7100000-0000-4000-8000-000000000003',gen_random_uuid(),'text','Resposta antiga',null);
  update public.whatsapp_messages set created_at=now()-interval '2 hours' where conversation_id=c and direction='out';
  update public.whatsapp_conversations set opened_at=now()-interval '1 hour' where id=c;
  r := public.whatsapp_bot_apply(c,'wamid.B0000050',0,true,2,'inicio',0,'[]','active',null,null,false,'[{"kind":"interactive","body":"Menu"}]');
  assert (r->>'applied')::boolean, 'reopened conversation blocked by an old answer: '||r::text;
end $$;

-- K6/5b P2: a late message (provider time 25 h ago) leaves the 24-hour window closed; the bot step
-- is refused with no effect on session, queue, closing or messages.
do $$ declare c uuid; r jsonb; begin
  perform public.whatsapp_ingest_inbound('300000000001','5541999910007',null,'Sétima','wamid.B0000060','text','Oi',null,null,now()-interval '25 hours');
  select id into c from public.whatsapp_conversations where wa_id='5541999910007';
  assert (select last_inbound_at <= now()-interval '24 hours' from public.whatsapp_conversations where id=c), 'fixture: window still open';
  r := public.whatsapp_bot_apply(c,'wamid.B0000060',0,true,2,'inicio',0,'[]','handed_off','queue:agendamento','agendamento',true,
    '[{"kind":"text","body":"Uma pessoa da recepção continua por aqui."}]');
  assert r->>'reason'='window', 'expired window accepted: '||r::text;
  assert not exists (select 1 from public.whatsapp_bot_sessions where conversation_id=c), 'session after a refused step';
  assert not exists (select 1 from public.whatsapp_messages where conversation_id=c and direction='out'), 'message after a refused step';
  assert (select status='open' and queue is distinct from 'agendamento' from public.whatsapp_conversations where id=c), 'queue or closing after a refused step';
end $$;

-- Closing step, disabled flow, invalid input, and the bot flag constraint.
do $$ declare c uuid; r jsonb; begin
  perform public.whatsapp_ingest_inbound('300000000001','5541999910003',null,'Terceira','wamid.B0000020','text','Oi',null,null,now());
  select id into c from public.whatsapp_conversations where wa_id='5541999910003';
  r := public.whatsapp_bot_apply(c,'wamid.B0000020',0,true,2,'info',0,'["Endereço"]','closed','close',null,true,'[{"kind":"text","body":"Rua Exemplo, 100"}]');
  assert (r->>'applied')::boolean and (select status='closed' and unread_count=0 from public.whatsapp_conversations where id=c), 'close step';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_bot_apply('%s','wamid.B0000020',0,true,2,'x',0,'[]','active',null,'Fila Inválida',false,'[]')$q$, c))='22023', 'invalid queue';
  assert pg_temp.sqlstate_of(format($q$select public.whatsapp_bot_apply('%s','wamid.B0000020',0,true,2,'x',0,'[]','active',null,null,false,'[{"kind":"template","body":"x"}]')$q$, c))='22023', 'bot sent a template';
  update public.whatsapp_flows set enabled=false where clinic_id='e7200000-0000-4000-8000-000000000001';
  perform public.whatsapp_ingest_inbound('300000000001','5541999910003',null,'','wamid.B0000021','text','Oi de novo',null,null,now()+interval '1 second');
  r := public.whatsapp_bot_apply(c,'wamid.B0000021',(select revision from public.whatsapp_bot_sessions where conversation_id=c),true,2,'inicio',0,'[]','active',null,null,false,'[]');
  assert r->>'reason'='flow', 'disabled flow answered';
  assert pg_temp.sqlstate_of(format($q$insert into public.whatsapp_messages(clinic_id,conversation_id,direction,kind,body,status,sent_by,request_id,bot)
    values ('e7200000-0000-4000-8000-000000000001','%s','out','text','x','pending','e7100000-0000-4000-8000-000000000003',gen_random_uuid(),true)$q$, c))='23514',
    'bot message with a human author';
end $$;
rollback;
