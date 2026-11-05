import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Called only by the owned, isolated review harness; no independent DB target.
const pause=()=>new Promise(r=>setTimeout(r,75));
const sealed=`'{"v":1,"keyId":"synthetic","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}'::jsonb`;
const service="set local role service_role;set local request.jwt.claim.role='service_role';";
function session(container,context){
 const child=spawn('docker',['--host',context,'exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
 let output='',errors='',closed=false,ended=false;
 child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{errors+=d;});child.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(new Error('Owned OAuth probe exceeded deadline'));},35000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',status=>{closed=true;clearTimeout(timer);resolve({status,output,errors});});
 });
 const send=q=>child.stdin.write(q+'\n');
 send("set statement_timeout='15s';set lock_timeout='12s';");
 return {send,diagnostic:()=>errors.split('\n').find(l=>l.startsWith('ERROR:'))??'No SQL error received',wait:async marker=>{
  const end=Date.now()+10000;let match;
  while(!(match=output.match(new RegExp(marker+'(\\d+)')))){assert.ok(!closed&&Date.now()<end,'OAuth marker unavailable: '+errors);await pause();}
  return Number(match[1]);
 },end:q=>{if(!ended&&!closed){ended=true;child.stdin.end(q+'\n');}return done;}};
}

export async function reviewOauthFence({sql,container,context}){
 const results=[];
 for(const short of [true,false]){
  const user=randomUUID(),factor=randomUUID(),authSession=randomUUID(),tag='oauth-review-'+randomUUID();
  const state=short?'1':'3',next=short?'2':'4';
  sql(`insert into auth.users(id,email) values('${user}','oauth-review@example.invalid');
   insert into public.user_settings(user_id,prescriber_cpf) values('${user}','52998224725') on conflict(user_id) do update set prescriber_cpf=excluded.prescriber_cpf;
   insert into auth.mfa_factors(id,user_id,status,factor_type) values('${factor}','${user}','verified','totp');
   insert into auth.sessions(id,user_id,factor_id,aal,not_after) values('${authSession}','${user}','${factor}','aal2',clock_timestamp()+interval '${short?8:60} seconds');
   insert into cortex_private.signature_oauth_states(state_hash,user_id,psc,verifier,created_at,expires_at)
    select repeat('${state}',64),'${user}','vidaas',${sealed},t,t+interval '10 minutes' from (select clock_timestamp()-interval '11 minutes' t) x;`);
  assert.equal(sql(`select count(*) from public.user_settings where user_id='${user}' and prescriber_cpf is not null`),'1');
  const holder=session(container,context);let worker;
  try{
   holder.send(`begin;${service}select public.signature_expire_sessions();select 'OAUTH_HOLDER='||pg_backend_pid();`);
   const pid=await holder.wait('OAUTH_HOLDER=');
   worker=session(container,context);
   worker.send(`set application_name='${tag}';begin;${service}
    select public.signature_begin_authorization('${user}','vidaas',repeat('${next}',64),${sealed},
     jsonb_build_object('sessionId','${authSession}','aal','aal2','exp',floor(extract(epoch from clock_timestamp()))::bigint+3600));
    select 'OAUTH_FINISHED';`);
   let blocked=false;
   const end=Date.now()+5000;
   while(Date.now()<end){
    if(sql(`select exists(select 1 from pg_stat_activity where application_name='${tag}' and ${pid}=any(pg_blocking_pids(pid)))`)==='t'){blocked=true;break;}
    await pause();
   }
   assert.ok(blocked,'OAuth request did not reach the owned row holder: '+worker.diagnostic());
   if(short)sql(`select pg_sleep(greatest(0,extract(epoch from (not_after-clock_timestamp())))+0.15) from auth.sessions where id='${authSession}';`);
   assert.equal(sql(`select not_after<=clock_timestamp() from auth.sessions where id='${authSession}'`),short?'t':'f');
   assert.equal((await holder.end('commit;')).status,0);
   const completed=await worker.end('commit;');assert.equal(completed.status,0,completed.errors);
   assert.ok(completed.output.includes('OAUTH_FINISHED'));
   const row=JSON.parse(sql(`select jsonb_build_object('clockAfterDeadline',clock_timestamp()>=a.not_after,'recordedCreatedAtBeforeDeadline',s.created_at<a.not_after,'present',true) from cortex_private.signature_oauth_states s join auth.sessions a on a.user_id=s.user_id where s.state_hash=repeat('${next}',64) and a.id='${authSession}'`));
   assert.equal(row.clockAfterDeadline,short);assert.equal(row.recordedCreatedAtBeforeDeadline,true);
   // The holder was released only after the observed expiration in the short
   // case. The blocked DELETE precedes INSERT, so creation happened later
   // even though created_at was sampled earlier and is now backdated.
   results.push({deadline:short?'expired while waiting':'live control',blockedOnExpiredOauthRow:true,deadlineExpiredBeforeHolderRelease:short,authorizationCreated:true,returnedAfterDeadline:row.clockAfterDeadline,recordedCreatedAtBeforeDeadline:true});
  }finally{
   await holder.end('rollback;');if(worker)await worker.end('rollback;');
  }
 }
 return results;
}
