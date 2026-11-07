// Frozen-source, synthetic K6 regression. Local disposable Docker only; no published database.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanupOwnedContainer } from './whatsapp-k6-cleanup.mjs';
import { adaptReservationFixture } from './whatsapp-k6-fixture.mjs';

const args = process.argv.slice(2);
assert.ok(args.every(arg => /^--(baseline=[0-9a-f]{40}|run=[a-z0-9-]+|contact-concurrency|bot)$/.test(arg)));
assert.ok(!(args.includes('--bot')&&args.includes('--contact-concurrency')),'Bot and contact concurrency require separate disposable databases');
const baseline = args.find(arg => arg.startsWith('--baseline='))?.slice(11);
assert.ok(baseline, 'An explicit source commit is required');
const run = args.find(arg => arg.startsWith('--run='))?.slice(6) ?? 'baseline';
const folder = resolve('docs/reviews/2026-11-06/whatsapp-k6', run);
await mkdir(resolve(folder, '..'), { recursive: true }); await mkdir(folder);
const command = (binary, values, input) => spawnSync(binary, values, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const requireSuccess = result => { assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout); return result.stdout; };
const git = values => requireSuccess(command('git', values));
const contactConcurrency=args.includes('--contact-concurrency');
const bot=args.includes('--bot');
const runtimePaths=['scripts/reviews/whatsapp-k6-sql.mjs','scripts/reviews/whatsapp-k6-cleanup.mjs','scripts/reviews/whatsapp-k6-fixture.mjs',...(contactConcurrency?['scripts/reviews/whatsapp-k6-contact-concurrency.mjs']:[]),...(bot?['scripts/reviews/whatsapp-k6-bot-cases.mjs','scripts/reviews/whatsapp-k6-bot-concurrency.mjs','scripts/reviews/whatsapp-k6-bot-handler.mjs']:[])];
const runtimeSources=await Promise.all(runtimePaths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const hashes = [], cache=new Map();
const source = path => { if(cache.has(path))return cache.get(path);const text = git(['show', baseline + ':' + path]); hashes.push({ path, sha256: createHash('sha256').update(text).digest('hex') }); cache.set(path,text);return text; };
const docker = (values, input) => command('docker', ['--context', 'desktop-linux', ...values], input);
const endpoint = requireSuccess(docker(['context', 'inspect', 'desktop-linux', '--format', '{{json .Endpoints.docker.Host}}'])).trim();
assert.equal(JSON.parse(endpoint), 'npipe:////./pipe/dockerDesktopLinuxEngine', 'Only the verified local Docker Desktop endpoint is permitted');
const image = requireSuccess(docker(['image', 'inspect', 'pgvector/pgvector:pg16', '--format', '{{.Id}}'])).trim(); assert.match(image, /^sha256:[0-9a-f]{64}$/);
const container = 'cortex-k6-wa-' + randomUUID().slice(0, 8);
let containerId = null;
const sql = text => docker(['exec', '-i', containerId, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '--quiet'], text);
const testPath = 'supabase/tests/whatsapp.test.sql', original = source(testPath);
assert.ok(original.includes('-- Inbound:') && original.startsWith('-- WhatsApp'));
const revisioned=source('supabase/migrations/20261106100000_whatsapp_channel.sql').includes('p_rule_revision integer');
assert.ok(!contactConcurrency||revisioned,'Contact concurrency requires the revisioned reservation contract');
const seed = original.slice(0, original.indexOf('-- Inbound:'));
const setup = `
reset role;
insert into public.patient_contact_links(clinic_id,contact_id,patient_id,doctor_user_id,relationship,confirmed_by) values
('e6200000-0000-4000-8000-000000000001','e6300000-0000-4000-8000-000000000001','e6500000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000002','self','e6100000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000002',true);
insert into public.appointments(id,user_id,patient_id,title,start_time,end_time,status,type,clinic_id,contact_id) values
('e6700000-0000-4000-8000-000000000001',auth.uid(),'e6500000-0000-4000-8000-000000000001','Synthetic private','2099-12-10T15:00Z','2099-12-10T15:30Z','agendado','retorno',null,null),
('e6700000-0000-4000-8000-000000000002',auth.uid(),'e6500000-0000-4000-8000-000000000001','Synthetic cancelled','2099-12-10T17:00Z','2099-12-10T17:30Z','cancelado','retorno','e6200000-0000-4000-8000-000000000001','e6300000-0000-4000-8000-000000000001'),
('e6700000-0000-4000-8000-000000000003',auth.uid(),'e6500000-0000-4000-8000-000000000001','Synthetic clinic control','2099-12-10T16:00Z','2099-12-10T16:30Z','agendado','retorno','e6200000-0000-4000-8000-000000000001','e6300000-0000-4000-8000-000000000001');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$ begin
  if to_regclass('public.whatsapp_opt_ins') is not null then
    execute $q$insert into public.whatsapp_opt_ins(clinic_id,wa_id,source,recorded_by) values
      ('e6200000-0000-4000-8000-000000000001','5541999980002','recepcao','e6100000-0000-4000-8000-000000000001')$q$;
  end if;
end $$;
create temp table rule(id uuid) on commit drop;
insert into rule select (public.whatsapp_automation_save('e6200000-0000-4000-8000-000000000001','e6100000-0000-4000-8000-000000000001',null,null,
'{"name":"Synthetic review","enabled":true,"trigger":"before_start","offsetMinutes":2880,"templateName":"lembrete_consulta","templateLanguage":"pt_BR","params":[{"source":"texto","value":"Synthetic"}]}')->>'id')::uuid;
`;
const suspend = `
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000001',true);
select public.reception_set_link_active('e6300000-0000-4000-8000-000000000001','e6500000-0000-4000-8000-000000000001',1,false);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
`;
const cases = [
  ['private_appointment', setup + `do $$ begin
    assert exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000003'), 'Positive clinic control missing';
    assert not exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000001'), 'K6_PRIVATE_APPOINTMENT_EXPOSED';
  end $$;`],
  ['cancelled_appointment', setup + `do $$ declare r jsonb; begin
    r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000002','2099-12-10T17:00Z','5541999980002',null,'Synthetic','{}');
    assert r is null or coalesce((r->>'skipped')::boolean,false), 'K6_CANCELLED_APPOINTMENT_PREPARED';
  end $$;`],
  ['late_opt_out', setup + `do $$ declare r jsonb; begin
    perform public.whatsapp_ingest_inbound('200000000001','5541999980002',null,'Synthetic','wamid.K6_STOP','text','SAIR',null,null,now());
    assert exists(select 1 from public.whatsapp_conversations where wa_id='5541999980002' and opted_out_at is not null), 'Opt-out control missing';
    r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000003','2099-12-10T16:00Z','5541999980002',null,'Synthetic','{}');
    assert r is null or coalesce((r->>'skipped')::boolean,false), 'K6_OPT_OUT_IGNORED_AT_RESERVATION';
  end $$;`],
  ['changed_payload_replay', `do $$ declare c uuid; r jsonb; begin
    c:=(public.whatsapp_ingest_inbound('200000000001','5541999990001',null,'Synthetic','wamid.K6_REPLAY','text','Synthetic',null,null,now())->>'conversationId')::uuid;
    r:=public.whatsapp_begin_outbound('e6200000-0000-4000-8000-000000000001',c,'e6100000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','text','A',null);
    assert r->>'state'='new','New reservation control failed';
    r:=public.whatsapp_begin_outbound('e6200000-0000-4000-8000-000000000001',c,'e6100000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','text','A',null);
    assert r->>'state'='existing','Identical replay control failed';
    assert pg_temp.sqlstate_of(format($q$select public.whatsapp_begin_outbound('e6200000-0000-4000-8000-000000000001','%s','e6100000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','text','B',null)$q$,c))='22023', 'K6_CHANGED_PAYLOAD_REPLAY_ACCEPTED';
  end $$;`],
  ['cross_conversation_reply', setup + `do $$ declare r jsonb; begin
    r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000003','2099-12-10T16:00Z','5541999980002',null,'Synthetic','{}');
    assert r->>'skipped'='false' and r->>'messageId' is not null, 'Positive reminder control missing';
    perform public.whatsapp_finish_outbound((r->>'messageId')::uuid,'wamid.K6_REMINDER',null);
    perform public.whatsapp_ingest_inbound('200000000001','5541999960005',null,'Other synthetic','wamid.K6_WRONG_REPLY','interactive','Confirmar',null,'wamid.K6_REMINDER',now());
    assert (select reply is null from public.whatsapp_automation_runs where id=(r->>'runId')::uuid), 'K6_REPLY_BOUND_TO_OTHER_CONVERSATION';
  end $$;`],
  ['identity_alias_collision', `do $$ begin
    perform public.whatsapp_ingest_inbound('200000000001','5541999990001',null,'Synthetic phone','wamid.K6_PHONE','text','Synthetic',null,null,now());
    perform public.whatsapp_ingest_inbound('200000000001',null,'BR.K6','Synthetic user','wamid.K6_USER','text','Synthetic',null,null,now());
    assert (select count(*) from public.whatsapp_conversations)=2,'Separate alias controls missing';
    assert pg_temp.sqlstate_of($q$select public.whatsapp_ingest_inbound('200000000001','5541999990001','BR.K6','Synthetic','wamid.K6_BOTH','text','Synthetic',null,null,now())$q$)='ok', 'K6_IDENTITY_ALIAS_COLLISION';
    assert (select count(*) from public.whatsapp_conversations)=2, 'K6_IDENTITY_ALIASES_SILENTLY_MERGED';
  end $$;`],
  ['internal_guard_with_execute_granted', `reset role; grant execute on function public.whatsapp_record_event(text,jsonb) to authenticated;
    set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
    do $$ begin assert has_function_privilege('authenticated','public.whatsapp_record_event(text,jsonb)','execute'),'Execute control missing';
      assert pg_temp.sqlstate_of($q$select public.whatsapp_record_event(repeat('d',64),'{}')$q$)='42501','K6_INTERNAL_GUARD_MISSING';
    end $$;`],
  ...(original.includes('whatsapp_opt_ins') ? [
    ['changed_rule_filter', setup + `do $$ declare r jsonb; begin
      assert exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000003'), 'Positive candidate control missing';
      update public.whatsapp_automations set doctor_ids=array['e6100000-0000-4000-8000-000000000004'::uuid] where id=(select id from rule);
      assert not exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000003'), 'Changed filter control missing';
      r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000003','2099-12-10T16:00Z','5541999980002',null,'Synthetic','{}');
      assert r is null or coalesce((r->>'skipped')::boolean,false), 'K6_CHANGED_RULE_FILTER_RESERVED';
    end $$;`],
    ['suspended_link_candidate', setup + suspend + `do $$ begin
      assert exists(select 1 from public.patient_contact_links where contact_id='e6300000-0000-4000-8000-000000000001' and not active), 'Suspension control missing';
      assert not exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000003'), 'K6_SUSPENDED_LINK_CANDIDATE';
    end $$;`],
    ['suspended_link_reservation', setup + suspend + `do $$ declare r jsonb; begin
      assert exists(select 1 from public.patient_contact_links where contact_id='e6300000-0000-4000-8000-000000000001' and not active), 'Suspension control missing';
      r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000003','2099-12-10T16:00Z','5541999980002',null,'Synthetic','{}');
      assert r is null or coalesce((r->>'skipped')::boolean,false), 'K6_SUSPENDED_LINK_RESERVED';
    end $$;`],
    ['split_alias_opt_out', setup + `do $$ declare r jsonb; begin
      perform public.whatsapp_ingest_inbound('200000000001','5541999980002',null,'Synthetic phone','wamid.K6_STOP_PHONE','text','Synthetic',null,null,now());
      perform public.whatsapp_ingest_inbound('200000000001',null,'BR.K6STOP','Synthetic user','wamid.K6_STOP_USER','text','Synthetic',null,null,now());
      perform public.whatsapp_ingest_inbound('200000000001','5541999980002','BR.K6STOP','Synthetic both','wamid.K6_STOP_BOTH','text','Synthetic',null,null,now());
      perform public.whatsapp_ingest_inbound('200000000001',null,'BR.K6STOP','Synthetic user','wamid.K6_STOP_ONLY_USER','text','SAIR',null,null,now());
      assert exists(select 1 from public.whatsapp_conversations where user_id='BR.K6STOP' and opted_out_at is not null), 'BSUID opt-out control missing';
      assert (select count(*) from public.whatsapp_conversations)=2, 'Split identity control missing';
      r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000003','2099-12-10T16:00Z','5541999980002',null,'Synthetic','{}');
      assert r is null or coalesce((r->>'skipped')::boolean,false), 'K6_SPLIT_ALIAS_OPT_OUT_RESERVED';
    end $$;`],
  ] : []),
];
if(revisioned)cases.push(
  ['changed_rule_revision',setup+`do $$ declare old_revision integer;r jsonb;begin
    assert exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000003'),'Positive due control missing';
    select revision into old_revision from public.whatsapp_automations where id=(select id from rule);
    update public.whatsapp_automations set revision=revision+1 where id=(select id from rule);
    r:=public.whatsapp_automation_begin(p_automation=>(select id from rule),p_rule_revision=>old_revision,p_appointment=>'e6700000-0000-4000-8000-000000000003',p_start=>'2099-12-10T16:00Z',p_wa_id=>'5541999980002',p_skip_reason=>null,p_body=>'Synthetic',p_template=>'{}');
    assert r is null and not exists(select 1 from public.whatsapp_automation_runs),'K6_OLD_RULE_REVISION_RESERVED';
  end $$;`],
  ['before_due',setup+`do $$ declare r jsonb;begin
    assert exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000003'),'Positive due control missing';
    update public.whatsapp_automations set offset_minutes=60 where id=(select id from rule);
    r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000003','2099-12-10T16:00Z','5541999980002',null,'Synthetic','{}');
    assert r is null and not exists(select 1 from public.whatsapp_automation_runs),'K6_BEFORE_DUE_RESERVED';
  end $$;`],
  ['changed_type_filter',setup+`do $$ declare r jsonb;begin
    assert exists(select 1 from public.whatsapp_automation_candidates('2099-12-08T16:00Z',100) where appointment_id='e6700000-0000-4000-8000-000000000003'),'Positive due control missing';
    update public.whatsapp_automations set appointment_types=array['novo'] where id=(select id from rule);
    r:=public.whatsapp_automation_begin((select id from rule),'e6700000-0000-4000-8000-000000000003','2099-12-10T16:00Z','5541999980002',null,'Synthetic','{}');
    assert r is null and not exists(select 1 from public.whatsapp_automation_runs),'K6_CHANGED_TYPE_FILTER_RESERVED';
  end $$;`],
);
const report = { completed: false, accepted: false, scope:bot?'bot contract probes and reservation regressions; not full C4/C5 approval':'automation reservation regressions; not full C4/C5 approval',revisioned,contactConcurrency,bot,runtimeSources,contactCases:[],botCases:[],botRaces:[],botHandler:[],flowSuite:null,baseline, image, syntheticOnly: true, migrations: 0, existingSuite: null, cases: [], sources: hashes, cleanupVerified: false, failure: null };
try {
  const createdId = requireSuccess(docker(['run','--detach','--rm','--name',container,'--network','none','--env','POSTGRES_HOST_AUTH_METHOD=trust',image])).trim();
  assert.match(createdId, /^[0-9a-f]{64}$/); containerId = createdId;
  let ready = false;
  for (let attempt=0;attempt<60;attempt++) { if(docker(['exec',containerId,'pg_isready','-U','postgres']).status===0){ready=true;break;} await new Promise(resolve=>setTimeout(resolve,500)); }
  assert.ok(ready,'Disposable local PostgreSQL did not become ready');
  requireSuccess(sql(source('supabase/tests/bootstrap.sql')));
  const migrations = git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).trim().split('\n').map(path=>path.trim()).filter(path=>path.endsWith('.sql')).sort();
  for(const path of migrations){requireSuccess(sql(source(path)));report.migrations++;}
  const originalResult=sql(original);report.existingSuite={passed:originalResult.status===0,error:originalResult.status===0?null:originalResult.stderr};
  const flowPath='supabase/tests/whatsapp-flows.test.sql';
  if(git(['ls-tree','--name-only',baseline,'--',flowPath]).trim()){const result=sql(source(flowPath));report.flowSuite={passed:result.status===0,error:result.status===0?null:result.stderr};}
  for(const [name,body] of cases){const result=sql(adaptReservationFixture(seed+body+'\nrollback;',revisioned));const error=result.stderr?.match(/(?:ERROR|CONTEXT):[^\n]*/g)?.join('\n')??result.stderr;const category=result.status===0?'pass':error.includes('K6_')?'contract_failure':'fixture_failure';report.cases.push({name,passed:result.status===0,category,error:result.status===0?null:error});console.log(JSON.stringify(report.cases.at(-1)));}
  if(contactConcurrency){const {exerciseContactFence}=await import('./whatsapp-k6-contact-concurrency.mjs');report.contactCases=await exerciseContactFence({docker,containerId,seed,setup:adaptReservationFixture(setup,revisioned)});}
  if(bot){
    const {probeBotHandler}=await import('./whatsapp-k6-bot-handler.mjs');
    report.botHandler=await probeBotHandler({source});
    const {botCases}=await import('./whatsapp-k6-bot-cases.mjs');
    for(const [name,body] of botCases){
      const result=sql(seed+body+'\nrollback;');
      const error=result.stderr?.match(/(?:ERROR|CONTEXT):[^\n]*/g)?.join('\n')??result.stderr;
      const category=result.status===0?'pass':error.includes('K6_')?'contract_failure':'fixture_failure';
      report.botCases.push({name,passed:result.status===0,category,error:result.status===0?null:error});
      console.log(JSON.stringify(report.botCases.at(-1)));
    }
    const {exerciseBotRaces}=await import('./whatsapp-k6-bot-concurrency.mjs');
    report.botRaces=await exerciseBotRaces({docker,containerId,seed});
    for(const proof of report.botRaces)console.log(JSON.stringify(proof));
  }
  for(const proof of runtimeSources)assert.equal(createHash('sha256').update(await readFile(proof.path)).digest('hex'),proof.sha256,'Harness source changed during run');
  report.completed=![...report.cases,...report.botCases,...report.botRaces,...report.botHandler].some(item=>item.category==='fixture_failure');report.accepted=report.completed&&report.existingSuite.passed&&(!report.flowSuite||report.flowSuite.passed)&&[...report.cases,...report.botCases,...report.botRaces,...report.botHandler,...report.contactCases].every(item=>item.passed);
}catch(error){report.failure=error.message;if(error.contactProof)report.contactCases=error.contactProof;}
finally{
  report.cleanup = cleanupOwnedContainer({ docker, name: container, id: containerId });
  report.cleanupVerified = report.cleanup.verified;
  report.accepted = report.accepted && report.cleanupVerified;
  await writeFile(resolve(folder,'SQL_REVIEW.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({completed:report.completed,accepted:report.accepted,migrations:report.migrations,failed:[...report.cases,...report.botCases,...report.botRaces].filter(item=>!item.passed).map(item=>item.name),cleanupVerified:report.cleanupVerified,failure:report.failure}));
if(!report.completed||!report.accepted||!report.cleanupVerified)process.exitCode=1;
