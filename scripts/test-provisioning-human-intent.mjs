import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Trust boundary: native Auth verifies the token before claims feed private SQL.
export async function exerciseProvisioningHumanIntent({auth,rest,adminJwt,version,call,sql,syntheticSecrets,asyncHttp,pause,holderSession,restartAuth}) {
 const checks=[];const password=randomBytes(24).toString('hex');syntheticSecrets.push(password);
 sql(readFileSync('supabase/tests/prototypes/provisioning-auth-identity.sql','utf8'));
 sql(readFileSync('supabase/tests/prototypes/provisioning-human-intent.sql','utf8'));
 const created=await call(auth,'/admin/users',adminJwt,{email:'intent-admin@example.invalid',password,email_confirm:true});assert.equal(created.status,200);
 const login=await call(auth,'/token?grant_type=password',adminJwt,{email:'intent-admin@example.invalid',password});assert.equal(login.status,200);
 syntheticSecrets.push(login.body.access_token,login.body.refresh_token);
 const context=async session=>{
  const verified=await call(auth,'/user',session.body.access_token);assert.equal(verified.status,200);
  const claims=JSON.parse(Buffer.from(session.body.access_token.split('.')[1],'base64url'));
  assert.equal(claims.sub,verified.body.id);assert.equal(claims.role,'authenticated');
  for(const value of [claims.sub,claims.session_id])assert.match(value,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  assert.ok(['aal1','aal2'].includes(claims.aal)&&Number.isSafeInteger(claims.exp));
  return {actor:claims.sub,session:claims.session_id,aal:claims.aal,exp:claims.exp,token:session.body.access_token};
 };
 const aal1=await context(login);
 const factor=await call(auth,'/factors',login.body.access_token,{factor_type:'totp',friendly_name:'Synthetic intent factor'});assert.equal(factor.status,200);syntheticSecrets.push(factor.body.totp.secret);
 const totp=secret=>{
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret.replace(/=+$/,''))bits+=alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5,'0');
  const key=Buffer.from(bits.match(/.{8}/g).map(part=>parseInt(part,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(counter).digest(),offset=digest[19]&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
 };
 const upgrade=async(session,selected=factor)=>{
  const challenge=await call(auth,'/factors/'+selected.body.id+'/challenge',session.body.access_token,{});assert.equal(challenge.status,200);
  const upgraded=await call(auth,'/factors/'+selected.body.id+'/verify',session.body.access_token,{challenge_id:challenge.body.id,code:totp(selected.body.totp.secret)});assert.equal(upgraded.status,200);
  syntheticSecrets.push(upgraded.body.access_token,upgraded.body.refresh_token);const c=await context(upgraded);assert.equal(c.aal,'aal2');return c;
 };
 const fresh=async()=>{
  const l=await call(auth,'/token?grant_type=password',adminJwt,{email:'intent-admin@example.invalid',password});assert.equal(l.status,200);
  syntheticSecrets.push(l.body.access_token,l.body.refresh_token);return upgrade(l);
 };
 const ctx=await upgrade(login);
 const clinic=randomUUID(),op=randomUUID(),planned=randomUUID();
 sql(`insert into provision_intent_lab.members values('${clinic}','${ctx.actor}','admin','active')`);
 const args=c=>`'${c.actor}','${c.session}','${clinic}','${c.aal}',${c.exp}`;
 const denied=(query,code='42501')=>sql(`do $$ begin begin ${query};raise exception 'Expected human intent refusal';exception when sqlstate '${code}' then null;end;end $$;`);
 const begin=(f,c)=>JSON.parse(sql(`select provision_intent_lab.begin_intent('${f.op}','${f.id}',${args(c)})`));
 const check=(f,c,finish=false)=>`select provision_intent_lab.check_intent('${f.op}',${args(c)},${finish})`;
 const fixture=()=>({op:randomUUID(),id:randomUUID(),email:'target-'+randomUUID()+'@example.invalid'});
 const birth=async(f,extra={})=>{
  const r=await call(auth,'/admin/users',adminJwt,{id:f.id,email:f.email,email_confirm:true,app_metadata:{account_type:'reception',cortex_provision_operation:f.op,cortex_provision_revision:1},...extra});
  assert.equal(r.status,200);assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${f.op}')`),'t');
 };
 const holder=async(query,iso='read committed')=>{
  const child=holderSession();let output='',errors='',ended=false;
  child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{errors+=d;});
  const done=new Promise(resolve=>child.once('close',code=>resolve({code,errors})));
  child.stdin.write(`\\set VERBOSITY verbose\nbegin isolation level ${iso};${query};select 'INTENT_HELD='||pg_backend_pid();\n`);
  let pid;
  for(let n=0;n<100;n++){const match=/INTENT_HELD=(\d+)/.exec(output);if(match){pid=Number(match[1]);break;}await new Promise(r=>setTimeout(r,40));}
  assert.ok(pid,'Owned intent holder did not reach its barrier');
  return {pid,end:async text=>{if(!ended){ended=true;child.stdin.end(text+';\n');}return done;}};
 };
 const observe=async h=>{
  for(let n=0;n<35;n++){
   if(sql(`select exists(select 1 from pg_stat_activity where usename='supabase_auth_admin' and wait_event_type='Lock' and ${h.pid}=any(pg_blocking_pids(pid)))`)==='t')return;await pause();
  }throw new Error('Native request did not reach its actual holder');
 };
 denied(`perform provision_intent_lab.begin_intent('${randomUUID()}','${randomUUID()}',${args(aal1)})`);
 checks.push('Native AAL1 bearer context cannot reserve an intent even after account MFA enrollment');
 sql(`select provision_intent_lab.begin_intent('${op}','${planned}',${args(ctx)})`);
 const born=await call(auth,'/admin/users',adminJwt,{id:planned,email:'intent-target@example.invalid',email_confirm:true,app_metadata:{account_type:'reception',cortex_provision_operation:op,cortex_provision_revision:1}});assert.equal(born.status,200);
 assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${op}')`),'t');
 const staleLogout=await holder('select count(*) from auth.users','repeatable read');
 try{
  const logout=await call(auth,'/logout?scope=global',ctx.token,{});assert.equal(logout.status,204);
  const staleResult=await staleLogout.end(check({op},ctx,true)+';commit');assert.notEqual(staleResult.code,0);assert.match(staleResult.errors,/40001/);
 }finally{await staleLogout.end('rollback');}
 assert.equal(sql(`select count(*) from auth.sessions where id='${ctx.session}'`),'0');
 sql(`do $$ begin begin perform provision_intent_lab.check_intent('${op}',${args(ctx)},true);
  raise exception 'Revoked native session accepted';exception when insufficient_privilege then null;end;end $$;`);
 checks.push('Native logout after verified AAL2 context and Auth birth defeats cached context and an established RR snapshot');
 let active=await fresh();
 const positive=fixture(),first=begin(positive,active);await birth(positive);
 const confirmed=JSON.parse(sql(check(positive,active,true))),replayed=begin(positive,active);
 assert.equal(confirmed.phase,'confirmed');assert.equal(replayed.expires_at,first.expires_at);assert.equal(replayed.planned_user_id,positive.id);
 assert.equal(sql(check(positive,active,true)),sql(check(positive,active,true)));
 checks.push('Real TOTP/AAL2 confirmation and exact replay preserve identity and original deadline without another Auth write');

 const other=await call(auth,'/admin/users',adminJwt,{email:'intent-other@example.invalid',email_confirm:true});assert.equal(other.status,200);assert.match(other.body.id,/^[0-9a-f-]{36}$/);
 sql(`insert into provision_intent_lab.members values('${clinic}','${other.body.id}','admin','active')`);
 denied(`perform provision_intent_lab.begin_intent('${randomUUID()}','${randomUUID()}',${args({...active,actor:other.body.id})})`);
 denied(`perform provision_intent_lab.begin_intent('${randomUUID()}','${randomUUID()}',${args({...active,session:randomUUID()})})`);
 checks.push('A different actor or absent native session cannot reuse verified context parameters');
 denied(`perform provision_intent_lab.begin_intent('${positive.op}','${randomUUID()}',${args(active)})`,'22023');
 const anotherSession=await fresh();
 denied(`perform provision_intent_lab.begin_intent('${positive.op}','${positive.id}',${args(anotherSession)})`,'22023');
 checks.push('Existing operation cannot change planned identity or bind itself to a new genuine session');

 const noReceipt=fixture();begin(noReceipt,active);denied(`perform provision_intent_lab.check_intent('${noReceipt.op}',${args(active)},true)`,'40001');
 assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${noReceipt.op}'`),'prepared');
 checks.push('Valid human context does not confirm an identity without its native birth receipt');
 const expired=fixture();begin(expired,active);await birth(expired);
 sql(`update provision_intent_lab.intents set expires_at=clock_timestamp()-interval '1 second' where operation_id='${expired.op}'`);
 sql(`select provision_intent_lab.assert_context(${args(active)})`);
 denied(`perform provision_intent_lab.check_intent('${expired.op}',${args(active)},true)`);
 denied(`perform provision_intent_lab.begin_intent('${expired.op}','${expired.id}',${args(active)})`);
 checks.push('Owned expired-deadline fixture refuses confirmation and replay without extending the old deadline');
 const sessionExpiry=await fresh(),expiresSession=fixture();begin(expiresSession,sessionExpiry);await birth(expiresSession);
 sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sessionExpiry.session}'`);
 denied(`perform provision_intent_lab.check_intent('${expiresSession.op}',${args(sessionExpiry)},true)`);
 checks.push('Owned native not_after expiry fixture defeats a still-unexpired captured bearer context');

 const authority=fixture();begin(authority,active);await birth(authority);
 sql(`update provision_intent_lab.members set status='inactive' where clinic_id='${clinic}' and user_id='${active.actor}'`);
 denied(`perform provision_intent_lab.check_intent('${authority.op}',${args(active)},true)`);
 sql(`update provision_intent_lab.members set status='active' where clinic_id='${clinic}' and user_id='${active.actor}'`);
 assert.equal((await call(auth,'/admin/users/'+active.actor,adminJwt,{app_metadata:{account_type:'reception'}},'PUT')).status,200);
 denied(`perform provision_intent_lab.check_intent('${authority.op}',${args(active)},true)`);
 assert.equal((await call(auth,'/admin/users/'+active.actor,adminJwt,{app_metadata:{account_type:'clinical'}},'PUT')).status,200);
 checks.push('Current fixture membership loss or native account reclassification refuses completion without deleting the created identity');

 const busy=await holder(`update provision_intent_lab.members set status='inactive' where clinic_id='${clinic}' and user_id='${active.actor}'`);
 try{denied(`perform provision_intent_lab.check_intent('${authority.op}',${args(active)},true)`,'40001');}finally{assert.equal((await busy.end('rollback')).code,0);}
 const old=await holder('select count(*) from auth.users','repeatable read');
 try{
  sql(`update provision_intent_lab.members set role='doctor' where clinic_id='${clinic}' and user_id='${active.actor}'`);
  const r=await old.end(check(authority,active,true)+';commit');assert.notEqual(r.code,0);assert.match(r.errors,/40001/);
  denied(`perform provision_intent_lab.check_intent('${authority.op}',${args(active)},true)`);
 }finally{await old.end('rollback');sql(`update provision_intent_lab.members set role='admin' where clinic_id='${clinic}' and user_id='${active.actor}'`);}
 checks.push('Held membership mutation refuses NOWAIT and an old RR snapshot cannot confirm after a committed role change');

 const inverse=fixture();begin(inverse,active);await birth(inverse);
 const winner=await holder(check(inverse,active,true));let loggingOut;
 try{
  loggingOut=asyncHttp({url:auth+'/logout?scope=global',method:'POST',headers:{Authorization:'Bearer '+active.token,'Content-Type':'application/json'},body:'{}'});
  await observe(winner);assert.equal((await winner.end('commit')).code,0);assert.equal((await loggingOut).status,204);
 }finally{await winner.end('rollback');if(loggingOut)await Promise.allSettled([loggingOut]);}
 assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${inverse.op}'`),'confirmed');
 denied(`perform provision_intent_lab.check_intent('${inverse.op}',${args(active)},true)`);
 checks.push('Native logout actually waits for the short confirmation transaction; history remains but replay after logout fails');

 sql(`create function provision_intent_lab.pause_birth() returns trigger language plpgsql set search_path='' as $$
  begin if new.raw_user_meta_data ? 'lab_intent_wait' then perform pg_advisory_xact_lock((new.raw_user_meta_data->>'lab_intent_wait')::bigint);end if;return new;end $$;
  create trigger zz_intent_pause after insert on auth.users for each row execute function provision_intent_lab.pause_birth();`);
 const inFlight=async(kind,c,change)=>{
  const f=fixture();begin(f,c);sql(check(f,c));const key=Math.floor(Math.random()*1000000000)+1,h=await holder(`select pg_advisory_xact_lock(${key})`);let request;
  try{
   request=asyncHttp({url:auth+'/admin/users',method:'POST',timeout:15000,headers:{Authorization:'Bearer '+adminJwt,'Content-Type':'application/json'},body:JSON.stringify({id:f.id,email:f.email,email_confirm:true,app_metadata:{account_type:'reception',cortex_provision_operation:f.op,cortex_provision_revision:1},user_metadata:{lab_intent_wait:key}})});
   await observe(h);await change(f);assert.equal((await h.end('commit')).code,0);assert.equal((await request).status,200);
  }finally{await h.end('rollback');if(request)await Promise.allSettled([request]);}
  assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${f.op}')`),'t');
  denied(`perform provision_intent_lab.check_intent('${f.op}',${args(c)},true)`);
  assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${f.op}'`),'prepared');
  assert.equal(sql(`select count(*) from provision_intent_lab.members where user_id='${f.id}'`),'0');
  checks.push('Observed in-flight Auth birth after '+kind+' preserves the identity but refuses administrative confirmation');
 };
 active=await fresh();
 try{await inFlight('membership revocation',active,async()=>{sql(`update provision_intent_lab.members set status='inactive' where clinic_id='${clinic}' and user_id='${active.actor}'`);});}
 finally{sql(`update provision_intent_lab.members set status='active' where clinic_id='${clinic}' and user_id='${active.actor}'`);}
 await inFlight('native logout',active,async()=>{assert.equal((await call(auth,'/logout?scope=global',active.token,{})).status,204);});

 await restartAuth({GOTRUE_JWT_EXP:'8'});
 try{
  const short=await fresh();assert.ok(short.exp-Math.floor(Date.now()/1000)<=12,'Native short JWT configuration was not honored');
  await inFlight('real bearer expiry',short,async()=>{
   let expired=false;for(let n=0;n<60;n++){if(sql(`select clock_timestamp()>=to_timestamp(${short.exp})`)==='t'){expired=true;break;}await pause();}
   assert.ok(expired,'Native bearer expiry was not reached');assert.equal(sql(`select count(*) from auth.sessions where id='${short.session}'`),'1');
  });
 }finally{await restartAuth({GOTRUE_JWT_EXP:'3600'});}

 const supported=await fresh(),factorIntent=fixture();begin(factorIntent,supported);await birth(factorIntent);
 assert.equal(sql(`select factor_id::text from auth.sessions where id='${supported.session}'`),factor.body.id);
 const secondSession=await fresh();
 const secondFactor=await call(auth,'/factors',secondSession.token,{factor_type:'totp',friendly_name:'Synthetic secondary factor'});assert.equal(secondFactor.status,200);syntheticSecrets.push(secondFactor.body.totp.secret);
 const secondCtx=await upgrade({body:{access_token:secondSession.token}},secondFactor);
 assert.notEqual(secondCtx.session,supported.session);
 const switched=await upgrade({body:{access_token:supported.token}},secondFactor);
 assert.equal(switched.session,supported.session,'Native factor replacement must occur on the same session');
 assert.equal(sql(`select factor_id::text from auth.sessions where id='${supported.session}'`),secondFactor.body.id);
 denied(`perform provision_intent_lab.check_intent('${factorIntent.op}',${args(supported)},true)`);
 checks.push('Real factor verification on the same native session cannot silently rebind the original intent');
 assert.equal((await call(auth,'/factors/'+factor.body.id,switched.token,undefined,'DELETE')).status,200);
 assert.equal(sql(`select count(*) from auth.mfa_factors where id='${secondFactor.body.id}' and status='verified'`),'1');
 assert.equal(sql(`select count(*) from auth.sessions where id='${supported.session}'`),'1');
 assert.equal(sql(`select provision_intent_lab.assert_context(${args(switched)})`),secondFactor.body.id);
 denied(`perform provision_intent_lab.check_intent('${factorIntent.op}',${args(supported)},true)`);
 checks.push('Native removal of the supporting factor refuses the old intent while another genuine verified factor remains');
 for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`select has_schema_privilege('${role}','provision_intent_lab','usage')`),'f');
 assert.equal((await call(rest,'/rpc/check_intent',switched.token,{p_operation:positive.op})).status,404);
 checks.push('Intent records and private authorizers are not exposed to clients or the Data API');
 assert.equal(checks.length,17);
 return {syntheticOnly:true,labOnly:true,authVersion:version,checks,prototypeIsProductionFix:false,humanIntentLabProofPassed:true,productionAuthorizationImplemented:false,
  notCovered:['production clinic/custody integration','all privileged writers and membership ABA','credential setup and recovery','app APIs/UI and data authorization']};
}
