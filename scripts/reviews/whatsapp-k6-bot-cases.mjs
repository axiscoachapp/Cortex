// Independent bot contract probes. Each case uses a fresh rollback-only synthetic seed.
const clinic='e6200000-0000-4000-8000-000000000001';
const actor='e6100000-0000-4000-8000-000000000003';
const phone='5541999950008';
const flow={enabled:true,handoffText:'Synthetic handoff',defaultQueue:'geral',hours:{},definition:{start:'inicio',nodes:{inicio:{title:'Synthetic menu',text:'Synthetic choice',options:[{label:'Synthetic route',goto:'queue:agenda'}]}}}};
export const botSetup=`
select public.whatsapp_flow_save('${clinic}','e6100000-0000-4000-8000-000000000001',0,'${JSON.stringify(flow)}');
create temp table bot_context(id uuid) on commit drop;
insert into bot_context select (public.whatsapp_ingest_inbound('200000000001','${phone}',null,'Synthetic','wamid.K6BOT_A','text','Synthetic',null,null,now())->>'conversationId')::uuid;
`;
const apply=({trigger='wamid.K6BOT_A',revision='0',newCycle=true,flowRevision=1,status='active',queue='null',close=false}={})=>`public.whatsapp_bot_apply((select id from bot_context),'${trigger}',${revision},${newCycle},${flowRevision},'inicio',0,'[]','${status}',null,${queue},${close},'[{"kind":"text","body":"Synthetic bot"}]')`;
const human=`select public.whatsapp_begin_outbound('${clinic}',(select id from bot_context),'${actor}',gen_random_uuid(),'text','Synthetic human',null);`;
const noBot=`assert not exists(select 1 from public.whatsapp_messages where bot),'K6_BOT_REFUSAL_CREATED_MESSAGE';`;
const start=`do $$ declare r jsonb;begin r:=${apply()};assert r->>'applied'='true' and jsonb_array_length(r->'messageIds')=1,'Bot positive control failed';end $$;`;
const end=(body)=>`do $$ declare r jsonb;begin ${body} end $$;`;
const revise=`update public.whatsapp_flows set revision=2 where clinic_id='${clinic}';`;

export const botCases=[
  ['bot_positive_and_revision_replay',botSetup+start.replace('Bot positive control failed','K6_BOT_POSITIVE_START_FAILED')+end(`
    assert (select status='active' and revision=1 from public.whatsapp_bot_sessions where conversation_id=(select id from bot_context)),'Session control missing';
    r:=${apply()};assert r->>'applied'='false' and r->>'reason'='revision','K6_BOT_REVISION_REPLAY';
    assert (select count(*)=1 from public.whatsapp_messages where bot),'K6_BOT_REPLAY_ADDED_MESSAGE';`)],
  ['bot_latest_tied_inbound',botSetup+`
    select public.whatsapp_ingest_inbound('200000000001','${phone}',null,'Synthetic','wamid.K6BOT_Z','text','Synthetic newer',null,null,now());
    `+end(`assert (select count(distinct created_at)=1 from public.whatsapp_messages where direction='in'),'Timestamp tie fixture missing';
    r:=${apply()};assert r->>'reason'='stale','K6_BOT_OLDER_TIED_TRIGGER_APPLIED';${noBot}
    r:=${apply({trigger:'wamid.K6BOT_Z'})};assert r->>'applied'='true','K6_BOT_LATEST_TIE_REFUSED';`)],
  ['bot_stale_flow_no_effects',botSetup+revise+end(`
    r:=${apply({status:'closed',queue:"'agenda'",close:true})};assert r->>'reason'='flow','K6_BOT_STALE_FLOW_APPLIED';${noBot}
    assert not exists(select 1 from public.whatsapp_bot_sessions),'K6_BOT_STALE_FLOW_CREATED_SESSION';
    assert (select status='open' and queue='geral' from public.whatsapp_conversations where id=(select id from bot_context)),'K6_BOT_STALE_FLOW_CHANGED_CONVERSATION';`)],
  ['bot_assigned_new_cycle',botSetup+`update public.whatsapp_conversations set assigned_to='${actor}',assigned_at=now() where id=(select id from bot_context);`+end(`
    r:=${apply()};assert r->>'reason'='taken','K6_BOT_ASSIGNED_APPLIED';${noBot}`)],
  ['bot_human_during_active_cycle',botSetup+start+human+end(`
    r:=${apply({revision:'1',newCycle:false})};assert r->>'reason'='taken','K6_BOT_ACTIVE_IGNORED_HUMAN';
    assert (select count(*)=1 from public.whatsapp_messages where bot),'K6_BOT_ACTIVE_ADDED_MESSAGE';
    assert (select status='human' from public.whatsapp_bot_sessions),'K6_BOT_ACTIVE_NOT_STOPPED';`)],
  ['bot_human_before_first_cycle',botSetup+human+end(`
    assert (select count(*)=1 from public.whatsapp_messages where sent_by is not null),'Human control missing';
    r:=${apply()};assert r->>'applied'='false' and r->>'reason'='taken','K6_BOT_FIRST_CYCLE_IGNORED_HUMAN';${noBot}
    assert not exists(select 1 from public.whatsapp_bot_sessions),'K6_BOT_FIRST_HUMAN_CREATED_SESSION';`)],
  ['bot_human_before_flow_restart',botSetup+start+human+revise+end(`
    r:=${apply({revision:'1',flowRevision:2})};assert r->>'applied'='false' and r->>'reason'='taken','K6_BOT_FLOW_RESTART_IGNORED_HUMAN';
    assert (select count(*)=1 from public.whatsapp_messages where bot),'K6_BOT_FLOW_RESTART_ADDED_MESSAGE';
    assert (select status='human' and revision=2 from public.whatsapp_bot_sessions),'K6_BOT_FLOW_RESTART_NOT_STOPPED';`)],
  ['bot_human_before_idle_restart',botSetup+start+human+`
    update public.whatsapp_bot_sessions set started_at=now()-interval '26 hours',updated_at=now()-interval '25 hours' where conversation_id=(select id from bot_context);
    `+end(`r:=${apply({revision:'1'})};assert r->>'applied'='false' and r->>'reason'='taken','K6_BOT_IDLE_RESTART_IGNORED_HUMAN';
    assert (select count(*)=1 from public.whatsapp_messages where bot),'K6_BOT_IDLE_RESTART_ADDED_MESSAGE';
    assert (select status='human' and revision=2 from public.whatsapp_bot_sessions),'K6_BOT_IDLE_RESTART_NOT_STOPPED';`)],
  ['bot_expired_window',`
    select public.whatsapp_flow_save('${clinic}','e6100000-0000-4000-8000-000000000001',0,'${JSON.stringify(flow)}');
    create temp table bot_context(id uuid) on commit drop;
    insert into bot_context select (public.whatsapp_ingest_inbound('200000000001','${phone}',null,'Synthetic','wamid.K6BOT_A','text','Delayed synthetic',null,null,now()-interval '25 hours')->>'conversationId')::uuid;
    `+end(`
    assert (select last_inbound_at<now()-interval '24 hours' from public.whatsapp_conversations where id=(select id from bot_context)),'Expired window fixture missing';
    assert pg_temp.sqlstate_of(format($q$select public.whatsapp_begin_outbound('${clinic}','%s','${actor}',gen_random_uuid(),'text','Synthetic human',null)$q$,(select id from bot_context)))='P0W01','Human expired-window control missing';
    begin r:=${apply()};exception when sqlstate 'P0W01' then r:='{"applied":false}';end;
    assert r->>'applied'='false','K6_BOT_EXPIRED_WINDOW_RESERVED';${noBot}
    assert not exists(select 1 from public.whatsapp_bot_sessions),'K6_BOT_EXPIRED_WINDOW_CREATED_SESSION';`)],
  ['bot_handoff_blocks_continuation',botSetup+end(`
    r:=${apply({status:'handed_off',queue:"'agenda'"})};assert r->>'applied'='true','Handoff positive control missing';
    assert (select queue='agenda' and status='open' from public.whatsapp_conversations where id=(select id from bot_context)),'Handoff queue missing';
    r:=${apply({revision:'1',newCycle:false})};assert r->>'reason'='revision','K6_BOT_AFTER_HANDOFF_APPLIED';
    assert (select count(*)=1 from public.whatsapp_messages where bot),'K6_BOT_AFTER_HANDOFF_ADDED_MESSAGE';`)],
  ['bot_reopened_old_human_allowed',botSetup+start+human+`
    update public.whatsapp_bot_sessions set started_at=now()-interval '2 hours',status='human' where conversation_id=(select id from bot_context);
    update public.whatsapp_messages set created_at=now()-interval '1 hour' where sent_by is not null;
    update public.whatsapp_conversations set status='closed',closed_at=now()-interval '30 minutes' where id=(select id from bot_context);
    select public.whatsapp_ingest_inbound('200000000001','${phone}',null,'Synthetic','wamid.K6BOT_REOPEN','text','Synthetic reopen',null,null,now());
    `+end(`assert (select opened_at>started_at from public.whatsapp_conversations c join public.whatsapp_bot_sessions s on s.conversation_id=c.id),'Reopen control missing';
    r:=${apply({revision:'1',trigger:'wamid.K6BOT_REOPEN'})};assert r->>'applied'='true','K6_BOT_REOPEN_NOT_ALLOWED';`)],
  ['bot_internal_guard_with_execute',`
    reset role;
    grant execute on function public.whatsapp_bot_apply(uuid,text,integer,boolean,integer,text,integer,jsonb,text,text,text,boolean,jsonb) to authenticated;
    set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);
    `+end(`assert pg_temp.sqlstate_of($q$select public.whatsapp_bot_apply(null,null,0,true,1,'inicio',0,'[]','active',null,null,false,'[]')$q$)='42501','K6_BOT_INTERNAL_ROLE_GUARD_BYPASSED';`)],
];

// Versioned retest: an expired/absent window must leave every persisted field unchanged,
// including an existing active session, even when queue/close/output were requested.
const messageSnapshot=`(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.whatsapp_messages m)`;
const unchangedWindow=call=>`do $$ declare r jsonb;before_conversation jsonb;before_session jsonb;before_messages jsonb;begin
  select to_jsonb(c) into before_conversation from public.whatsapp_conversations c where c.id=(select id from bot_context);
  select to_jsonb(s) into before_session from public.whatsapp_bot_sessions s where s.conversation_id=(select id from bot_context);
  before_messages:=${messageSnapshot};
  r:=${call};assert r='{"applied":false,"reason":"window"}'::jsonb,'K6_BOT_WINDOW_REASON';
  assert (select to_jsonb(c) from public.whatsapp_conversations c where c.id=(select id from bot_context)) is not distinct from before_conversation,'K6_BOT_WINDOW_CHANGED_CONVERSATION';
  assert (select to_jsonb(s) from public.whatsapp_bot_sessions s where s.conversation_id=(select id from bot_context)) is not distinct from before_session,'K6_BOT_WINDOW_CHANGED_SESSION';
  assert ${messageSnapshot}=before_messages,'K6_BOT_WINDOW_CHANGED_MESSAGES';
end $$;`;
const requestedEffects=options=>apply({status:'closed',queue:"'agenda'",close:true,...options});
export const botWindowCases=[
  ['harness_window_message_mutation_is_detected',botSetup+`
    create function pg_temp.synthetic_mutating_window_refusal() returns jsonb language plpgsql as $mutation$
    begin update public.whatsapp_messages set body='Synthetic mutated fixture';return '{"applied":false,"reason":"window"}'::jsonb;end $mutation$;
    do $control$ begin
      assert (select count(*)=1 from public.whatsapp_messages),'Mutation control requires exactly one inbound';
      begin
        execute $snapshot$${unchangedWindow('pg_temp.synthetic_mutating_window_refusal()')}$snapshot$;
        raise exception 'Window harness accepted a changed message with the same count';
      exception when assert_failure then
        assert sqlerrm='K6_BOT_WINDOW_CHANGED_MESSAGES','Window harness failed for an unrelated reason';
      end;
    end $control$;`],
  ['bot_null_window_zero_effects',botSetup+`update public.whatsapp_conversations set last_inbound_at=null where id=(select id from bot_context);`+unchangedWindow(requestedEffects())],
  ['bot_expired_window_zero_effects',botSetup+`update public.whatsapp_conversations set last_inbound_at=now()-interval '25 hours' where id=(select id from bot_context);`+unchangedWindow(requestedEffects())],
  ['bot_exactly_24h_zero_effects',botSetup+`update public.whatsapp_conversations set last_inbound_at=now()-interval '24 hours' where id=(select id from bot_context);`+unchangedWindow(requestedEffects())],
  ['bot_expired_active_session_unchanged',botSetup+start+`update public.whatsapp_conversations set last_inbound_at=now()-interval '25 hours' where id=(select id from bot_context);`+unchangedWindow(requestedEffects({revision:'1',newCycle:false}))],
  ['bot_inside_24h_effects_positive',botSetup+`update public.whatsapp_conversations set last_inbound_at=now()-interval '24 hours'+interval '1 millisecond' where id=(select id from bot_context);`+end(`
    r:=${requestedEffects()};assert r->>'applied'='true' and jsonb_array_length(r->'messageIds')=1,'K6_BOT_INSIDE_WINDOW_REFUSED';
    assert (select status='closed' and queue='agenda' and closed_at is not null from public.whatsapp_conversations where id=(select id from bot_context)),'K6_BOT_POSITIVE_EFFECTS_MISSING';
    assert (select status='closed' and revision=1 from public.whatsapp_bot_sessions),'K6_BOT_POSITIVE_SESSION_MISSING';
    assert (select count(*)=1 from public.whatsapp_messages where bot),'K6_BOT_POSITIVE_MESSAGE_MISSING';`)],
];
