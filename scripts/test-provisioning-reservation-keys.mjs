import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';

// Called only by the owned Native Auth laboratory. Never accepts a DB URL.
export async function exerciseReservationKeys({auth,rest,adminJwt,call,sql,syntheticSecrets,holderSession,pause,ctx,clinic,fixture,args,red}){
 const password=randomBytes(24).toString('hex');syntheticSecrets.push(password);
 const created=await call(auth,'/admin/users',adminJwt,{email:'reservation-second@example.invalid',password,email_confirm:true});assert.equal(created.status,200);
 const login=await call(auth,'/token?grant_type=password',adminJwt,{email:'reservation-second@example.invalid',password});assert.equal(login.status,200);
 syntheticSecrets.push(login.body.access_token,login.body.refresh_token);
 const factor=await call(auth,'/factors',login.body.access_token,{factor_type:'totp',friendly_name:'Synthetic independent reservation'});assert.equal(factor.status,200);syntheticSecrets.push(factor.body.totp.secret);
 const challenge=await call(auth,'/factors/'+factor.body.id+'/challenge',login.body.access_token,{});assert.equal(challenge.status,200);
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of factor.body.totp.secret.replace(/=+$/,''))bits+=alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5,'0');
 const key=Buffer.from(bits.match(/.{8}/g).map(p=>parseInt(p,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',key).update(counter).digest(),offset=digest[19]&15,code=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
 const upgraded=await call(auth,'/factors/'+factor.body.id+'/verify',login.body.access_token,{challenge_id:challenge.body.id,code});assert.equal(upgraded.status,200);
 syntheticSecrets.push(upgraded.body.access_token,upgraded.body.refresh_token);
 const user=await call(auth,'/user',upgraded.body.access_token);assert.equal(user.status,200);
 const other=JSON.parse(Buffer.from(upgraded.body.access_token.split('.')[1],'base64url'));
 assert.equal(other.sub,user.body.id);assert.equal(other.role,'authenticated');assert.equal(other.aal,'aal2');assert.ok(Number.isSafeInteger(other.exp));
 for(const id of [other.sub,other.session_id])assert.match(id,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
 assert.notEqual(other.sub,ctx.sub);assert.notEqual(other.session_id,ctx.session_id);
 const clinicCreated=await call(rest,'/rpc/create_clinic',upgraded.body.access_token,{p_name:'Synthetic independent reservation clinic'});assert.equal(clinicCreated.status,200);
 const otherClinic=clinicCreated.body;assert.match(otherClinic,/^[0-9a-f-]{36}$/);assert.notEqual(otherClinic,clinic);
 sql(`insert into provision_intent_lab.members values('${otherClinic}','${other.sub}','admin','active');`);
 const otherArgs=`'${other.sub}','${other.session_id}','${otherClinic}','${other.aal}',${other.exp}`;
 const begin=(f,b=false)=>`select provision_intent_lab.begin_intent('${f.op}','${f.id}',${b?otherArgs:args(ctx)})`;
 const service="set local request.jwt.claim.role='service_role';";
 const trusted=q=>sql(`begin;${service}${q};commit;`);
 const connection=()=>{
  const child=holderSession();let output='',errors='',closed=false,ended=false;
  child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{errors+=d;});child.stdin.on('error',()=>{});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',status=>{closed=true;resolve({status,output,errors});});});
  const send=q=>child.stdin.write(q+'\n');
  send("\\set VERBOSITY verbose\nset statement_timeout='12s';set lock_timeout='10s';select 'RES_PID='||pg_backend_pid();");
  return {send,closed:()=>closed,output:()=>output,wait:async marker=>{
   const end=Date.now()+8000;let match;
   while(!(match=output.match(new RegExp(marker+'(\\d+)')))){assert.ok(!closed&&Date.now()<end,'Reservation marker unavailable');await pause();}
   return Number(match[1]);
  },finish:q=>{if(!ended&&!closed){ended=true;child.stdin.end(q+'\n');}return done;}};
 };
 const watch=async(worker,holderPid)=>{
  const pid=await worker.wait('RES_PID=');let waited=false;
  const end=Date.now()+5000;
  while(!worker.closed()&&!worker.output().includes('RES_DONE')&&Date.now()<end){
   if(sql(`select exists(select 1 from pg_stat_activity where pid=${pid} and ${holderPid}=any(pg_blocking_pids(pid)))`)==='t'){waited=true;break;}
   await pause();
  }
  assert.ok(waited||worker.closed()||worker.output().includes('RES_DONE'),'Reservation neither finished nor reached holder');
  return waited;
 };
 const held=async q=>{
  const holder=connection();await holder.wait('RES_PID=');holder.send(`begin;${service}${q};select 'RES_HELD='||pg_backend_pid();`);
  return {holder,pid:await holder.wait('RES_HELD=')};
 };
 const checks=[];
 const denied=(q,code)=>trusted(`do $$ begin begin perform ${q.slice(7)};raise exception 'Expected reservation refusal';exception when sqlstate '${code}' then null;end;end $$`);
 const collide=async(holding,contending,{wait=false,refusal='40001',prefix=''}={})=>{
  const {holder,pid}=await held(holding);let worker;
  try{
   worker=connection();worker.send(`begin;${service}${prefix}${contending};\n\\echo RES_DONE`);
   assert.equal(await watch(worker,pid),wait,'Unexpected reservation wait behavior');
   if(wait)assert.equal((await holder.finish('rollback;')).status,0);
   const result=await worker.finish('rollback;');
   if(refusal){assert.notEqual(result.status,0);assert.match(result.errors,new RegExp(refusal));}
   else assert.equal(result.status,0);
  }finally{await holder.finish('rollback;');if(worker)await worker.finish('rollback;');}
 };
 const collision=fixture(),contender={...fixture(),id:collision.id};
 const {holder,pid}=await held(begin(collision));let worker;
 try{
  worker=connection();worker.send(`begin;${service}${begin(contender,true)};\n\\echo RES_DONE`);
  const waited=await watch(worker,pid);
  if(red){
   assert.equal(waited,true,'Reservation RED did not reach the unique-index holder');
   assert.equal((await holder.finish('commit;')).status,0);
   const result=await worker.finish('rollback;');assert.notEqual(result.status,0);assert.match(result.errors,/23505/);
   assert.equal(sql(`select count(*) from provision_identity_lab.operations where operation_id='${contender.op}'`),'0');
   return {reservationProofPassed:false,independentNativeAdmins:true,independentNativeClinics:true,uniqueIndexWaitObserved:true,refusalAfterHolderCommit:'23505'};
  }
  assert.equal(waited,false,'Reservation waited on the unique-index holder');
  const result=await worker.finish('rollback;');assert.notEqual(result.status,0);assert.match(result.errors,/40001/);
  worker=connection();worker.send(`begin;${service}${begin({...fixture(),op:collision.op},true)};\n\\echo RES_DONE`);
  assert.equal(await watch(worker,pid),false);const sameOperation=await worker.finish('rollback;');assert.notEqual(sameOperation.status,0);assert.match(sameOperation.errors,/40001/);
  const independent=fixture();worker=connection();worker.send(`begin;${service}${begin(independent,true)};\n\\echo RES_DONE`);
  assert.equal(await watch(worker,pid),false);assert.equal((await worker.finish('commit;')).status,0);
  assert.equal(sql(`select exists(select 1 from pg_stat_activity where pid=${pid} and xact_start is not null and state='idle in transaction')`),'t');
  assert.equal((await holder.finish('commit;')).status,0);
  const before=JSON.parse(sql(`select to_jsonb(i) from provision_intent_lab.intents i where operation_id='${collision.op}'`));
  assert.deepEqual(JSON.parse(trusted(begin(collision))),before);
  denied(begin(collision,true),'22023');denied(begin(contender,true),'23505');
  checks.push('Independent Native admins/clinics: same target and same operation refuse40001 while holder stays open; independent keys commit; exact replay preserves bindings/deadline and cross-actor adoption is denied');
 }finally{await holder.finish('rollback;');if(worker)await worker.finish('rollback;');}
 const rolledBack=fixture(),retry={...fixture(),id:rolledBack.id};
 await collide(begin(rolledBack),begin(retry,true));
 const accepted=JSON.parse(trusted(begin(retry,true)));
 const born=await call(auth,'/admin/users',adminJwt,{id:retry.id,email:retry.email,email_confirm:true,app_metadata:{account_type:'reception',cortex_provision_operation:retry.op,cortex_provision_revision:1}});assert.equal(born.status,200);
 assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${retry.op}')`),'t');
 assert.equal(JSON.parse(trusted(`select provision_intent_lab.check_intent('${retry.op}',${otherArgs},true)`)).phase,'confirmed');
 assert.equal(JSON.parse(trusted(begin(retry,true))).expires_at,accepted.expires_at);
 checks.push('Holder rollback releases both keys; the other genuine administrator reserves, obtains a Native birth receipt, confirms and replays without renewing the deadline');

 const rawOperation=f=>`insert into provision_identity_lab.operations(operation_id,planned_user_id) values('${f.op}','${f.id}')`;
 const generation=sql(`select provisioning_authority_generation from public.clinic_members where clinic_id='${clinic}' and user_id='${ctx.sub}'`);
 const factorId=sql(`select factor_id from auth.sessions where id='${ctx.session_id}'`);
 const rawIntent=f=>`insert into provision_intent_lab.intents(operation_id,planned_user_id,actor_id,session_id,clinic_id,factor_id,expires_at,membership_generation)
  values('${f.op}','${f.id}','${ctx.sub}','${ctx.session_id}','${clinic}','${factorId}',clock_timestamp()+interval '5 minutes','${generation}')`;
 // Service gets only temporary table access. Source fields above are built as
 // installer, so the service never needs an Auth table grant for this probe.
 const grants="grant usage on schema provision_identity_lab,provision_intent_lab to service_role;grant select,insert,update on provision_identity_lab.operations,provision_intent_lab.intents to service_role;set local role service_role;";
 for(const replica of [false,true]){
  const f=fixture(),prefix=(replica?"set local session_replication_role='replica';":'')+grants;
  await collide(begin(f),rawOperation({...fixture(),id:f.id}),{prefix});
  await collide(begin(f),rawIntent(f),{prefix});
 }
 checks.push('Temporarily granted service INSERTs into both ledgers refuse40001, including an invisible parent and replica; no Auth SELECT grant is needed');

 const updated=fixture();trusted(rawOperation(updated));
 await collide(`update provision_identity_lab.operations set phase=phase where operation_id='${updated.op}'`,rawOperation({...fixture(),id:updated.id}));
 const updatedIntent=fixture();trusted(begin(updatedIntent));
 await collide(`update provision_intent_lab.intents set phase=phase where operation_id='${updatedIntent.op}'`,rawIntent(updatedIntent),{prefix:grants});
 checks.push('Permitted no-op UPDATEs of committed operations and intents also hold reservation keys; duplicate INSERT refuses40001 instead of waiting on xmax');

 for(const [table,holding,contending] of [
  ['provision_identity_lab.operations',`update provision_identity_lab.operations set phase=phase where operation_id='${updated.op}'`,rawOperation({...fixture(),id:updated.id})],
  ['provision_intent_lab.intents',`update provision_intent_lab.intents set phase=phase where operation_id='${updatedIntent.op}'`,rawIntent(updatedIntent)],
 ]){
  sql(`alter table ${table} disable trigger aa_reservation_keys`);
  try{await collide(holding,contending,{wait:true,refusal:'23505'});}
  finally{sql(`alter table ${table} enable always trigger aa_reservation_keys`);}
 }
 assert.equal(sql("select count(*) from pg_trigger where tgname='aa_reservation_keys' and tgenabled='A' and tgrelid in ('provision_identity_lab.operations'::regclass,'provision_intent_lab.intents'::regclass)"),'2');
 for(const role of ['anon','authenticated','service_role','provision_birth_writer_lab'])assert.equal(sql(`select has_function_privilege('${role}','provision_identity_lab.acquire_reservation_keys(uuid,uuid)','execute')`),'f');
 denied("select provision_identity_lab.acquire_reservation_keys(null,gen_random_uuid())",'22023');
 await collide(`update provision_identity_lab.operations set phase=phase where operation_id='${updated.op}'`,rawOperation({...fixture(),id:updated.id}));
 checks.push('Disabling only each new trigger exposes an observed unique-index wait on committed-row UPDATE; restoring ALWAYS restores40001; null keys and client EXECUTE remain denied');
 assert.equal(checks.length,5);
 return {reservationProofPassed:true,reservationChecks:checks,independentNativeAdmins:true,independentNativeClinics:true,unrelatedKeysProgressWhileHolderOpen:true,updateAndReplicaParticipation:true,uniqueIndexWaitControlsObserved:2};
}
