begin;
insert into auth.users(id,email) values ('93000000-0000-4000-8000-000000000001','sync-owner@example.invalid');
insert into public.appointments(id,user_id,title,start_time,end_time) values
 ('93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000001','Consulta sintética',now()+interval '1 day',now()+interval '25 hours');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare op jsonb; next_op jsonb; begin
 op:=public.claim_calendar_sync('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000011');
 assert op->>'claim' is not null,'Durable operation not claimed';
 assert public.claim_calendar_sync('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000011') is null,'Concurrent operation allowed';
 update public.appointments set notes='Nova edição durante envio' where id='93000000-0000-4000-8000-000000000011';
 assert public.finish_calendar_sync('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000011',(op->>'claim')::uuid,(op->'appointment'->>'google_sync_revision')::integer,'synced',null),'Completion lost owned lease';
 assert (select google_sync_status='pending' and google_sync_claim is null from public.appointments where id='93000000-0000-4000-8000-000000000011'),'Raced edit incorrectly marked synced';
 next_op:=public.claim_calendar_sync('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000011');
 assert next_op->'appointment'->>'notes'='Nova edição durante envio','Retry did not use latest queued content';
 assert not public.finish_calendar_sync('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000011',(op->>'claim')::uuid,0,'failed','stale'),'Old worker released new lease';
 assert public.finish_calendar_sync('93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000011',(next_op->>'claim')::uuid,(next_op->'appointment'->>'google_sync_revision')::integer,'synced',null),'Retry failed to complete';
end $$;
rollback;
