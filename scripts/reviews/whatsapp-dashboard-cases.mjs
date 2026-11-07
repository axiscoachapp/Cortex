// Independent counts and boundary cases over a fresh synthetic transaction per case.
const clinic='ea200000-0000-4000-8000-000000000001';
const admin='ea100000-0000-4000-8000-000000000001',reception='ea100000-0000-4000-8000-000000000002';
const former='ea100000-0000-4000-8000-000000000003',doctor='ea100000-0000-4000-8000-000000000004';
const at='(select at from t0)';
const query=`public.whatsapp_dashboard('${clinic}',${at},${at}+interval '2 days')`;
const service="grant select on t0 to service_role;set local role service_role;select set_config('request.jwt.claim.role','service_role',true);";
const fill=body=>`do $$ declare a uuid;b uuid;begin ${body} end $$;`;
const check=body=>service+`do $$ declare r jsonb;c jsonb;o jsonb;begin r:=${query};c:=r->'cohort';o:=r->'openNow';${body} end $$;`;
const human=(dir,time,status='sent',sender=reception)=>`perform pg_temp.msg(a,'${dir}',interval '${time}','${status}','${sender}');`;

export const dashboardCases=[
  ['half_open_start_boundaries',fill(`
    a:=pg_temp.conv(1,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');
    a:=pg_temp.conv(2,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '2 days');
    a:=pg_temp.conv(3,1,'open',interval '-1 second');perform pg_temp.msg(a,'in',interval '-1 second');
    a:=pg_temp.conv(4,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '2 days'-interval '1 microsecond');
  `)+check(`assert (c->>'incomingCycles')::int=2 and (c->>'withoutHumanSend')::int=2,'K2_HALF_OPEN_COHORT';
    assert (o->>'total')::int=4,'K2_OPEN_NOW_WAS_FILTERED_BY_PERIOD';`)],
  ['earliest_inbound_not_each_message',fill(`
    a:=pg_temp.conv(1,1,'open',interval '-1 day');perform pg_temp.msg(a,'in',interval '-1 day');perform pg_temp.msg(a,'in',interval '1 hour');
    a:=pg_temp.conv(2,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');perform pg_temp.msg(a,'in',interval '1 minute');perform pg_temp.msg(a,'in',interval '2 minutes');
  `)+check(`assert (c->>'incomingCycles')::int=1,'K2_EARLIEST_INBOUND_OR_DUPLICATE_CYCLE';`)],
  ['human_statuses_bot_and_odd_median',fill(`
    a:=pg_temp.conv(1,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');perform pg_temp.msg(a,'out',interval '1 minute');
    update public.whatsapp_messages set bot=true where conversation_id=a and direction='out';
    ${human('out','2 minutes','pending')}${human('out','3 minutes','unknown')}${human('out','4 minutes','failed')}${human('out','10 minutes','sent')}
    a:=pg_temp.conv(2,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');${human('out','30 minutes','delivered')}
    a:=pg_temp.conv(3,1,'closed',interval '0');perform pg_temp.msg(a,'in',interval '0');${human('out','5 minutes','read')}
  `)+check(`assert (c->>'incomingCycles')::int=3 and (c->>'withHumanSend')::int=3,'K2_HUMAN_STATUS_DENOMINATORS';
    assert (c->>'medianFirstHumanSendSeconds')::int=600,'K2_BOT_PENDING_UNKNOWN_FAILED_OR_MEDIAN';
    assert (c->>'closedWithoutHumanSend')::int=0,'K2_ANSWERED_CLOSED_MISCLASSIFIED';`)],
  ['even_median_rounds_to_integer_second',fill(`
    a:=pg_temp.conv(1,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');${human('out','0 seconds')}
    a:=pg_temp.conv(2,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');${human('out','1 second')}
  `)+check(`assert (c->>'medianFirstHumanSendSeconds')::int=1 and (c->>'withHumanSend')::int=2,'K2_EVEN_MEDIAN_ROUNDING';`)],
  ['provider_time_is_not_elapsed_send_time',fill(`
    a:=pg_temp.conv(1,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');${human('out','5 minutes')}
    update public.whatsapp_messages set provider_at=${at}+interval '50 days' where conversation_id=a;
  `)+check(`assert (c->>'medianFirstHumanSendSeconds')::int=300,'K2_MUTABLE_PROVIDER_TIME_USED';`)],
  ['old_cycle_and_old_human_not_credited',fill(`
    a:=pg_temp.conv(1,1,'open',interval '1 day');perform pg_temp.msg(a,'in',interval '0');${human('out','1 minute')}
    perform pg_temp.msg(a,'in',interval '1 day');
  `)+check(`assert (c->>'incomingCycles')::int=1 and (c->>'withHumanSend')::int=0 and (c->>'withoutHumanSend')::int=1,'K2_OLD_CYCLE_CREDITED';
    assert c->'medianFirstHumanSendSeconds'='null'::jsonb,'K2_MISSING_SAMPLE_BECAME_ZERO';`)],
  ['human_before_first_inbound_does_not_count',fill(`
    a:=pg_temp.conv(1,1,'closed',interval '-1 day');${human('out','-1 minute')}perform pg_temp.msg(a,'in',interval '0');
    a:=pg_temp.conv(2,1,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');${human('out','2 minutes')}
  `)+check(`assert (c->>'withHumanSend')::int=1 and (c->>'withoutHumanSend')::int=1 and (c->>'closedWithoutHumanSend')::int=1,'K2_PRIOR_OUTBOUND_COUNTED';
    assert (c->>'medianFirstHumanSendSeconds')::int=120,'K2_PRIOR_OUTBOUND_INTERVAL';`)],
  ['current_owner_is_not_historical_responder',fill(`
    a:=pg_temp.conv(1,1,'open',interval '0','${admin}');perform pg_temp.msg(a,'in',interval '0');${human('out','5 minutes')}
  `)+check(`assert o->'owners'=jsonb_build_array(jsonb_build_object('userId','${admin}','openCount',1)),'K2_RESPONDER_ATTRIBUTED_AS_CURRENT_OWNER';
    assert (c->>'withHumanSend')::int=1,'K2_CURRENT_OWNER_CHANGED_REPLY_COUNT';`)],
  ['open_now_independent_of_cohort_and_other_clinic',fill(`
    a:=pg_temp.conv(1,1,'open',interval '-10 days','${former}');perform pg_temp.msg(a,'in',interval '-10 days');
    a:=pg_temp.conv(2,1,'open',interval '0','${doctor}');perform pg_temp.msg(a,'out',interval '1 hour');
    a:=pg_temp.conv(3,1,'open',interval '0');
    a:=pg_temp.conv(4,2,'open',interval '0');perform pg_temp.msg(a,'in',interval '0');
  `)+check(`assert (c->>'incomingCycles')::int=0 and c->'medianFirstHumanSendSeconds'='null'::jsonb,'K2_COHORT_EXPOSED_OTHER_CLINIC_OR_OUTBOUND_START';
    assert (o->>'total')::int=3 and (o->>'unassigned')::int=1 and (o->>'assignedToIneligible')::int=2 and o->'owners'='[]'::jsonb,'K2_CURRENT_TOTALS_FILTERED_OR_SCOPE_BORROWED';`)],
  ['eligibility_is_not_borrowed_from_other_clinic',`
    insert into public.clinic_members(clinic_id,user_id,role,status) values ('ea200000-0000-4000-8000-000000000002','${doctor}','admin','active');
    update public.clinic_staff_members set clinic_id='ea200000-0000-4000-8000-000000000002',active=true where user_id='${former}';
    `+fill(`a:=pg_temp.conv(1,1,'open',interval '0','${doctor}');a:=pg_temp.conv(2,1,'open',interval '0','${former}');
      a:=pg_temp.conv(3,1,'open',interval '0','${reception}');a:=pg_temp.conv(4,1,'open',interval '0','${admin}');`)+check(`
    assert (o->>'total')::int=4 and (o->>'assignedToIneligible')::int=2 and jsonb_array_length(o->'owners')=2,'K2_ELIGIBILITY_BORROWED_OTHER_CLINIC';`)],
  ['empty_cohort_exact_shape_and_null_sample',check(`
    assert c=jsonb_build_object('incomingCycles',0,'withHumanSend',0,'withoutHumanSend',0,'medianFirstHumanSendSeconds',null,'closedWithoutHumanSend',0),'K2_EMPTY_COHORT_NOT_EXACT';
    assert o=jsonb_build_object('total',0,'unassigned',0,'assignedToIneligible',0,'owners','[]'::jsonb),'K2_EMPTY_OPEN_TOTALS';
    assert (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['cohort','openNow'],'K2_UNEXPECTED_SQL_PROJECTION';`)],
  ['invalid_windows_and_31day_positive',service+`do $$ declare r jsonb;q text;begin
    r:=public.whatsapp_dashboard('${clinic}',${at}-interval '29 days',${at}+interval '2 days');
    assert r->'cohort'->>'incomingCycles'='0','K2_31DAY_POSITIVE_MISSING';
    foreach q in array array[
      $q$select public.whatsapp_dashboard('${clinic}',null,now())$q$,
      $q$select public.whatsapp_dashboard('${clinic}',now(),null)$q$,
      $q$select public.whatsapp_dashboard('${clinic}',now(),now())$q$,
      $q$select public.whatsapp_dashboard('${clinic}',now(),now()-interval '1 second')$q$,
      $q$select public.whatsapp_dashboard('${clinic}',now()-interval '32 days',now())$q$,
      $q$select public.whatsapp_dashboard('${clinic}','-infinity',now())$q$,
      $q$select public.whatsapp_dashboard('${clinic}',now(),'infinity')$q$
    ] loop assert pg_temp.sqlstate_of(q)='22023','K2_INVALID_SQL_WINDOW';end loop;
  end $$;`],
  ['internal_role_guard_even_when_execute_granted',`
    grant execute on function public.whatsapp_dashboard(uuid,timestamptz,timestamptz) to authenticated;
    grant select on t0 to authenticated;
    set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);
    do $$ begin assert has_function_privilege('authenticated','public.whatsapp_dashboard(uuid,timestamptz,timestamptz)','execute'),'Fixture grant missing';
    assert pg_temp.sqlstate_of($q$select public.whatsapp_dashboard('${clinic}',now()-interval '1 day',now())$q$)='42501','K2_INTERNAL_ROLE_GUARD_BYPASSED';end $$;
    reset role;
  `+check(`assert (c->>'incomingCycles')::int=0,'K2_SERVICE_POSITIVE_MISSING';`)],
  ['read_only_conversation_and_message_rows',fill(`
    a:=pg_temp.conv(1,1,'open',interval '0','${reception}');perform pg_temp.msg(a,'in',interval '0');${human('out','1 minute')}
  `)+service+`do $$ declare before_rows jsonb;after_rows jsonb;r jsonb;begin
    select jsonb_build_object('conversations',(select jsonb_agg(to_jsonb(c) order by c.id) from public.whatsapp_conversations c),
      'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.whatsapp_messages m)) into before_rows;
    r:=${query};assert r->'cohort'->>'withHumanSend'='1','K2_READONLY_POSITIVE_MISSING';
    select jsonb_build_object('conversations',(select jsonb_agg(to_jsonb(c) order by c.id) from public.whatsapp_conversations c),
      'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.whatsapp_messages m)) into after_rows;
    assert after_rows=before_rows,'K2_READ_CHANGED_ROWS';
  end $$;`],
];
