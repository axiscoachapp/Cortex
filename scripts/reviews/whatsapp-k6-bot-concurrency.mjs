// Deterministic two-session races against the frozen functions in the owned local container.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { botSetup } from './whatsapp-k6-bot-cases.mjs';

export async function exerciseBotRaces({docker,containerId,seed}) {
  assert.match(containerId,/^[0-9a-f]{64}$/);
  const required=result=>{assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout;};
  const sql=text=>required(docker(['exec','-i',containerId,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-A','-t','--quiet'],"set statement_timeout='10s';set lock_timeout='8s';\n"+text)).trim();
  const service="set local role service_role;select set_config('request.jwt.claim.role','service_role',true);";
  const sessions=[],proof=[];
  const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
  const until=async(read,label)=>{for(let n=0;n<60;n++){const value=read();if(value)return value;await pause();}throw new Error('Fixture barrier not observed: '+label);};
  const start=async()=>{
    const application='cortex-k6-bot-'+randomUUID();
    const child=spawn('docker',['--context','desktop-linux','exec','-i',containerId,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-A','-t','--quiet'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='',closed=false;
    child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
    child.on('error',error=>{err+=error.message;});child.stdin.on('error',error=>{err+=error.code??error.message;});
    const done=new Promise(resolve=>child.once('close',status=>{closed=true;resolve({status,err});}));
    const session={application,child,done,pid:null,closed:()=>closed,out:()=>out,err:()=>err,send:text=>child.stdin.write(text+'\n')};
    sessions.push(session);
    session.send(`set application_name='${application}';set statement_timeout='12s';set lock_timeout='10s';select 'K6_PID='||pg_backend_pid();`);
    const pid=await until(()=>out.match(/^K6_PID=(\d+)$/m)?.[1]??(closed?(()=>{throw new Error(err||'Session closed before PID');})():null),'session PID');
    session.pid=Number(pid);assert.ok(Number.isSafeInteger(session.pid)&&session.pid>0);return session;
  };
  const marker=async(session,name)=>until(()=>session.out().includes(name)||(session.closed()?(()=>{throw new Error(session.err()||'Session closed before '+name);})():false),name);
  const waitOn=async(waiter,holder)=>{
    let observed;
    try {return await until(()=>{
      if(waiter.closed())throw new Error('Waiter exited: '+waiter.err());
      observed=sql(`select json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'waitType',wait_event_type,'waitEvent',wait_event,'state',state) from pg_stat_activity where pid=${waiter.pid} and application_name='${waiter.application}';`);
      const row=observed?JSON.parse(observed):null;
      return row?.waitType==='Lock'&&row.blockers.includes(holder.pid)?row:null;
    },'owned bot waiter blocked by owned holder');}
    catch(error){throw new Error(error.message+'; last observed: '+observed);}
  };
  const finish=async session=>{session.child.stdin.end('commit;\n\\q\n');const result=await session.done;assert.equal(result.status,0,result.err);};
  const clinic='e6200000-0000-4000-8000-000000000001',actor='e6100000-0000-4000-8000-000000000003';
  const apply=(id,trigger,revision,newCycle)=>`public.whatsapp_bot_apply('${id}','${trigger}',${revision},${newCycle},1,'inicio',0,'[]','active',null,null,false,'[{"kind":"text","body":"Synthetic concurrent bot"}]')`;
  const human=id=>`public.whatsapp_begin_outbound('${clinic}','${id}','${actor}',gen_random_uuid(),'text','Synthetic concurrent human',null)`;
  const count=id=>Number(sql(`select count(*) from public.whatsapp_messages where conversation_id='${id}' and bot;`));
  const response=session=>{const raw=session.out().match(/^K6_RESULT=(.+)$/m)?.[1];assert.ok(raw,'Bot result marker missing');return JSON.parse(raw);};
  let phase='seed';
  try {
    const initial=sql(seed+botSetup+"select 'K6_CONV='||id from bot_context;commit;");
    const first=initial.match(/^K6_CONV=([0-9a-f-]{36})$/m)?.[1];assert.match(first??'',/^[0-9a-f-]{36}$/);
    const newConversation=(phone,trigger)=>{
      const out=sql(`begin;${service}select 'K6_CONV='||(public.whatsapp_ingest_inbound('200000000001','${phone}',null,'Synthetic','${trigger}','text','Synthetic',null,null,now())->>'conversationId');commit;`);
      const id=out.match(/^K6_CONV=([0-9a-f-]{36})$/m)?.[1];assert.match(id??'',/^[0-9a-f-]{36}$/);return id;
    };
    phase='human holds conversation before first bot';
    const humanFirst=await start();
    humanFirst.send(`begin;${service}select ${human(first)};\n\\echo K6_HUMAN_HELD`);
    await marker(humanFirst,'K6_HUMAN_HELD');
    assert.equal(sql(`select state from pg_stat_activity where pid=${humanFirst.pid};`),'idle in transaction','Human fixture must retain the conversation lock');
    const firstBot=await start();
    firstBot.send(`begin;${service}select 'K6_RESULT='||(${apply(first,'wamid.K6BOT_A',0,true)})::text;`);
    const firstBlock=await waitOn(firstBot,humanFirst);
    await finish(humanFirst);await marker(firstBot,'K6_RESULT=');await finish(firstBot);
    const firstResult=response(firstBot),firstCount=count(first);
    const humanCount=Number(sql(`select count(*) from public.whatsapp_messages where conversation_id='${first}' and sent_by is not null;`));
    const sessionCount=Number(sql(`select count(*) from public.whatsapp_bot_sessions where conversation_id='${first}';`));
    const firstPassed=firstResult.applied===false&&firstResult.reason==='taken'&&firstCount===0&&humanCount===1&&sessionCount===0;
    proof.push({name:'bot_waits_for_human_before_first_cycle',passed:firstPassed,category:firstPassed?'pass':'contract_failure',barrier:firstBlock,result:firstResult.applied,reason:firstResult.reason??null,botMessages:firstCount,humanMessages:humanCount,botSessions:sessionCount,humanCommitted:true});

    phase='concurrent identical start uses revision CAS';
    const second=newConversation('5541999950009','wamid.K6BOT_CAS');
    const winner=await start();winner.send(`begin;${service}select 'K6_RESULT='||(${apply(second,'wamid.K6BOT_CAS',0,true)})::text;`);await marker(winner,'K6_RESULT=');
    const loser=await start();loser.send(`begin;${service}select 'K6_RESULT='||(${apply(second,'wamid.K6BOT_CAS',0,true)})::text;`);
    const casBlock=await waitOn(loser,winner);await finish(winner);await marker(loser,'K6_RESULT=');await finish(loser);
    const won=response(winner),lost=response(loser),casCount=count(second);
    proof.push({name:'bot_concurrent_start_reserves_once',passed:won.applied===true&&lost.applied===false&&lost.reason==='revision'&&casCount===1,category:won.applied===true&&lost.applied===false&&lost.reason==='revision'&&casCount===1?'pass':'contract_failure',barrier:casBlock,winner:won.applied,loser:lost.reason,botMessages:casCount});

    phase='human holds conversation during active cycle';
    const active=newConversation('5541999950010','wamid.K6BOT_ACTIVE');
    sql(`begin;${service}select ${apply(active,'wamid.K6BOT_ACTIVE',0,true)};commit;`);assert.equal(count(active),1,'Active cycle control missing');
    const humanActive=await start();humanActive.send(`begin;${service}select ${human(active)};\n\\echo K6_HUMAN_ACTIVE_HELD`);await marker(humanActive,'K6_HUMAN_ACTIVE_HELD');
    const botActive=await start();botActive.send(`begin;${service}select 'K6_RESULT='||(${apply(active,'wamid.K6BOT_ACTIVE',1,false)})::text;`);
    const activeBlock=await waitOn(botActive,humanActive);await finish(humanActive);await marker(botActive,'K6_RESULT=');await finish(botActive);
    const activeResult=response(botActive),activeCount=count(active),status=sql(`select status from public.whatsapp_bot_sessions where conversation_id='${active}';`);
    proof.push({name:'bot_waits_for_human_during_active_cycle',passed:activeResult.applied===false&&activeResult.reason==='taken'&&activeCount===1&&status==='human',category:activeResult.applied===false&&activeResult.reason==='taken'&&activeCount===1&&status==='human'?'pass':'contract_failure',barrier:activeBlock,result:activeResult.reason,botMessages:activeCount,session:status});
    return proof;
  } catch(error){proof.push({name:phase,passed:false,category:'fixture_failure',error:error.message});return proof;}
  finally {
    for(const session of sessions){if(!session.closed()){
      if(session.pid)sql(`select pg_terminate_backend(pid) from pg_stat_activity where pid=${session.pid} and application_name='${session.application}';`);
      session.child.stdin.end();await session.done;
    }}
  }
}
