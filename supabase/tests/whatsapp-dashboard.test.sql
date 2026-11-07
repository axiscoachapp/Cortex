-- Reception dashboard aggregate (migration 20261107130000). Synthetic clinics, people, numbers and ids only.
-- Rows are written directly with explicit times (now() is constant inside the transaction).
begin;
insert into auth.users(id,email) values
 ('ea100000-0000-4000-8000-000000000001','dash-admin@example.invalid'),
 ('ea100000-0000-4000-8000-000000000002','dash-reception@example.invalid'),
 ('ea100000-0000-4000-8000-000000000003','dash-former@example.invalid'),
 ('ea100000-0000-4000-8000-000000000004','dash-doctor@example.invalid');
insert into public.clinics(id,name,created_by) values
 ('ea200000-0000-4000-8000-000000000001','Clínica sintética painel','ea100000-0000-4000-8000-000000000001'),
 ('ea200000-0000-4000-8000-000000000002','Outra clínica sintética','ea100000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000001','admin','active'),
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000004','doctor','active');
insert into public.clinic_staff_members(clinic_id,user_id,name,active) values
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000002','Recepção sintética',true),
 ('ea200000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000003','Recepção antiga',false);
insert into public.whatsapp_channels(id,clinic_id,phone_number_id,waba_id,status,token_sealed) values
 ('ea300000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000001','400000000001','4000000001','connected','{"v":1,"keyId":"k1","nonce":"x","ciphertext":"y"}'),
 ('ea300000-0000-4000-8000-000000000002','ea200000-0000-4000-8000-000000000002','400000000002','4000000002','connected','{"v":1,"keyId":"k1","nonce":"x","ciphertext":"y"}');

create temp table t0(at timestamptz) on commit drop;
insert into t0 values (date_trunc('hour', now()) - interval '3 days');
create function pg_temp.conv(n int, clinic int, status text, opened interval, owner uuid default null) returns uuid language sql as $$
  insert into public.whatsapp_conversations(id,clinic_id,channel_id,wa_id,status,opened_at,closed_at,assigned_to,assigned_at)
  values (('ea400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, ('ea200000-0000-4000-8000-00000000000'||clinic)::uuid,
    ('ea300000-0000-4000-8000-00000000000'||clinic)::uuid, '55419999'||lpad(n::text,5,'0'), status, (select at from t0)+opened,
    case when status='closed' then (select at from t0)+opened+interval '5 hours' end, owner, case when owner is not null then now() end)
  returning id;
$$;
create function pg_temp.msg(p_conv uuid, p_dir text, p_at interval, p_status text default null, p_sender uuid default null) returns void language sql as $$
  insert into public.whatsapp_messages(clinic_id,conversation_id,direction,kind,body,status,sent_by,request_id,created_at)
  select c.clinic_id, c.id, p_dir, 'text', 'x', coalesce(p_status, case when p_dir='in' then 'received' else 'sent' end), p_sender,
    case when p_dir='out' then gen_random_uuid() end, (select t.at from t0 t)+p_at
  from public.whatsapp_conversations c where c.id=p_conv;
$$;

do $$ declare a uuid; rec uuid:='ea100000-0000-4000-8000-000000000002'; admin uuid:='ea100000-0000-4000-8000-000000000001';
  former uuid:='ea100000-0000-4000-8000-000000000003'; doctor uuid:='ea100000-0000-4000-8000-000000000004'; begin
  -- 1: answered by a person after 10 min (a bot message at 1 min does not count). Open, owned by the reception.
  a := pg_temp.conv(1, 1, 'open', interval '0', rec);
  perform pg_temp.msg(a, 'in', interval '0'); perform pg_temp.msg(a, 'out', interval '1 minute');
  perform pg_temp.msg(a, 'out', interval '10 minutes', 'delivered', rec);
  -- 2: a failed and an unknown human send, then a sent one after 30 min.
  a := pg_temp.conv(2, 1, 'open', interval '1 hour', admin);
  perform pg_temp.msg(a, 'in', interval '1 hour'); perform pg_temp.msg(a, 'out', interval '1 hour 2 minutes', 'failed', rec);
  perform pg_temp.msg(a, 'out', interval '1 hour 5 minutes', 'unknown', rec); perform pg_temp.msg(a, 'out', interval '1 hour 30 minutes', 'read', admin);
  -- 3: no human send, closed (counts in closedWithoutHumanSend, not "abandonment").
  a := pg_temp.conv(3, 1, 'closed', interval '2 hours');
  perform pg_temp.msg(a, 'in', interval '2 hours'); perform pg_temp.msg(a, 'out', interval '2 hours 1 minute', 'pending', rec);
  -- 4: reopened: the old cycle (human answer before opened_at) is not counted; the current cycle has none. Open, unassigned.
  a := pg_temp.conv(4, 1, 'open', interval '1 day');
  perform pg_temp.msg(a, 'in', interval '-1 hour'); perform pg_temp.msg(a, 'out', interval '-50 minutes', 'sent', rec);
  perform pg_temp.msg(a, 'in', interval '1 day');
  -- 5: started only by an automation (no inbound in the cycle): not in the cohort. Open, owned by a former receptionist.
  a := pg_temp.conv(5, 1, 'open', interval '0', former);
  perform pg_temp.msg(a, 'out', interval '5 minutes', 'sent');
  -- 6: started before the window: not in the cohort. Open, owned by a doctor who is not eligible (not admin, not staff).
  a := pg_temp.conv(6, 1, 'open', interval '-10 days', doctor);
  perform pg_temp.msg(a, 'in', interval '-10 days');
  -- 7: another clinic: never counted.
  a := pg_temp.conv(7, 2, 'open', interval '0');
  perform pg_temp.msg(a, 'in', interval '0');
end $$;

grant select on t0 to service_role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare r jsonb; c jsonb; o jsonb; begin
  r := public.whatsapp_dashboard('ea200000-0000-4000-8000-000000000001', (select at from t0) - interval '1 hour', (select at from t0) + interval '2 days');
  c := r->'cohort'; o := r->'openNow';
  assert (c->>'incomingCycles')::int=4 and (c->>'withHumanSend')::int=2 and (c->>'withoutHumanSend')::int=2, 'cohort: '||c::text;
  assert (c->>'closedWithoutHumanSend')::int=1, 'closed without human: '||c::text;
  -- Median of 600 s and 1800 s.
  assert (c->>'medianFirstHumanSendSeconds')::numeric=1200, 'median: '||c::text;
  assert (o->>'total')::int=5 and (o->>'unassigned')::int=1 and (o->>'assignedToIneligible')::int=2, 'open now: '||o::text;
  assert o->'owners' = jsonb_build_array(jsonb_build_object('userId','ea100000-0000-4000-8000-000000000001','openCount',1),
    jsonb_build_object('userId','ea100000-0000-4000-8000-000000000002','openCount',1)), 'owners: '||(o->'owners')::text;
  -- An empty window: median null, not zero.
  r := public.whatsapp_dashboard('ea200000-0000-4000-8000-000000000001', (select at from t0) + interval '5 days', (select at from t0) + interval '6 days');
  assert (r->'cohort'->>'incomingCycles')::int=0 and r->'cohort'->'medianFirstHumanSendSeconds'='null'::jsonb, 'empty window: '||r::text;
  begin
    perform public.whatsapp_dashboard('ea200000-0000-4000-8000-000000000001', now() - interval '32 days', now());
    raise exception 'window over 31 days accepted';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('authenticated','public.whatsapp_dashboard(uuid,timestamptz,timestamptz)','execute')
    and has_function_privilege('service_role','public.whatsapp_dashboard(uuid,timestamptz,timestamptz)','execute'), 'grants';
end $$;
rollback;
