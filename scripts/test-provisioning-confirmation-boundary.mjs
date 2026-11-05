import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';

// The deployment helper is unchanged; only the SDK transport is supplied by
// the laboratory. Native mode sends its exact Authorization bearer to /user.
export function loadConfirmationBoundary({authSource,boundarySource,createClient}){
 const auth={},boundary={};
 new Function('require','exports','Deno',authSource)(id=>{
  if(id.includes('@supabase/supabase-js'))return {createClient};
  if(id==='./http.ts')return {fetchWithDeadline:()=>{throw new Error('Unexpected shim fetch');}};
  throw new Error('Unexpected Auth import');
 },auth,{env:{get:()=> 'synthetic'}});
 new Function('require','exports',boundarySource)(id=>{assert.ok(id.endsWith('/auth.ts'));return auth;},boundary);
 return boundary.confirmProvisioningIntent;
}

export async function exerciseConfirmationBoundary({auth,adminJwt,call,sql,syntheticSecrets,fixture,begin,birth,fresh,factory}){
 let rpcCalls=0,userLookups=0,beforeCommit=null,verifiedBeforeRpc=false;
 const confirm=factory((_url,_key,options)=>({auth:{getUser:async()=>{
  const header=options.global.headers.Authorization;assert.match(header,/^Bearer [^\s]+$/);
  const response=await call(auth,'/user',header.slice(7));userLookups++;verifiedBeforeRpc=response.status===200;
  return {data:{user:response.status===200?response.body:null},error:response.status===200?null:{message:'Synthetic refusal'}};
 }}}));
 const request=token=>new Request('https://edge.synthetic.invalid',{headers:{Authorization:'Bearer '+token}});
 const port=async c=>{
  rpcCalls++;assert.equal(verifiedBeforeRpc,true);if(beforeCommit)await beforeCommit();
  // Test-only SQLSTATE envelope, no raw SQL message. The successful statement
  // commits normally; the exception subtransaction rolls failed writes back.
  const result=JSON.parse(sql(`begin;set local request.jwt.claim.role='service_role';
   create temp table confirmation_result(value jsonb,code text) on commit drop;
   do $$ begin begin insert into confirmation_result values(provision_intent_lab.confirm_from_server('${c.operationId}','${c.actorId}','${c.sessionId}','${c.aal}',${c.exp}),null);
    exception when others then insert into confirmation_result values(null,sqlstate);end;end $$;
   select jsonb_build_object('value',value,'code',code) from confirmation_result;commit;`));
  if(result.code)throw Object.assign(new Error('Private SQL refusal'),{code:result.code});return result.value;
 };
 const context=await fresh(),f=fixture(),initial=begin(f,context);await birth(f);
 const checks=[];
 for(const role of ['anon','authenticated','service_role','provision_create_writer_lab','provision_confirm_writer_lab','provision_birth_writer_lab']){
  assert.equal(sql(`select has_function_privilege('${role}','provision_intent_lab.confirm_from_server(uuid,uuid,uuid,text,bigint)','execute')`),'f');
 }
 for(const key of ['actorId','sessionId','clinicId','plannedUserId','aal','exp','finish']){
  await assert.rejects(()=>confirm(request(context.token),{operationId:f.op,[key]:randomUUID()},port),{code:'invalid_request'});
 }
 const parts=context.token.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);const forged=parts.join('.');syntheticSecrets.push(forged);
 await assert.rejects(()=>confirm(request(forged),{operationId:f.op},port),{status:401});assert.equal(rpcCalls,0);
 checks.push('Exact bearer reaches Native /user; tampered signature and client authority fields never reach SQL; wrapper is unavailable to clients and private producers');

 const original=await confirm(request(context.token),{operationId:f.op},port);
 assert.deepEqual(original,{operationId:f.op,plannedUserId:f.id,clinicId:initial.clinic_id,expiresAt:new Date(initial.expires_at).toISOString()});
 assert.equal(Object.isFrozen(original),true);assert.deepEqual(await confirm(request(context.token),{operationId:f.op},port),original);
 assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${f.op}'`),'confirmed');
 checks.push('Real Native AAL2 context confirms through the SQL wrapper; replay preserves the exact administrative DTO and deadline');

 const password=randomBytes(24).toString('hex'),email='boundary-other-'+randomUUID()+'@example.invalid';syntheticSecrets.push(password);
 assert.equal((await call(auth,'/admin/users',adminJwt,{email,password,email_confirm:true})).status,200);
 const login=await call(auth,'/token?grant_type=password',adminJwt,{email,password});assert.equal(login.status,200);syntheticSecrets.push(login.body.access_token,login.body.refresh_token);
 const beforeAal1=rpcCalls;await assert.rejects(()=>confirm(request(login.body.access_token),{operationId:f.op},port),{status:403});assert.equal(rpcCalls,beforeAal1);
 const factor=await call(auth,'/factors',login.body.access_token,{factor_type:'totp',friendly_name:'Synthetic boundary actor'});assert.equal(factor.status,200);syntheticSecrets.push(factor.body.totp.secret);
 const challenge=await call(auth,'/factors/'+factor.body.id+'/challenge',login.body.access_token,{});assert.equal(challenge.status,200);
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const letter of factor.body.totp.secret.replace(/=+$/,''))bits+=alphabet.indexOf(letter.toUpperCase()).toString(2).padStart(5,'0');
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(counter).digest(),offset=digest[19]&15;
 const verified=await call(auth,'/factors/'+factor.body.id+'/verify',login.body.access_token,{challenge_id:challenge.body.id,code:String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')});assert.equal(verified.status,200);syntheticSecrets.push(verified.body.access_token,verified.body.refresh_token);
 const bUser=await call(auth,'/user',verified.body.access_token);assert.equal(bUser.status,200);
 const bClaims=JSON.parse(Buffer.from(verified.body.access_token.split('.')[1],'base64url').toString());assert.equal(bClaims.sub,bUser.body.id);assert.equal(bClaims.aal,'aal2');assert.ok(Number.isSafeInteger(bClaims.exp));
 for(const value of [bClaims.sub,bClaims.session_id])assert.match(value,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
 // Explicit installer fixture: B is an authorized admin of the same clinic,
 // so the foreign-intent refusal cannot be masked by missing clinic scope.
 sql(`begin;insert into public.clinic_members(clinic_id,user_id,role,status) values('${initial.clinic_id}','${bClaims.sub}','admin','active');
  insert into provision_intent_lab.members values('${initial.clinic_id}','${bClaims.sub}','admin','active');commit;`);
 const bFixture=fixture();begin(bFixture,bClaims);await birth(bFixture);
 const bReceipt=await confirm(request(verified.body.access_token),{operationId:bFixture.op},port);assert.equal(bReceipt.plannedUserId,bFixture.id);
 await assert.rejects(()=>confirm(request(verified.body.access_token),{operationId:f.op},port),{code:'not_authorized'});
 const another=await fresh();await assert.rejects(()=>confirm(request(another.token),{operationId:f.op},port),{code:'not_authorized'});
 await assert.rejects(()=>confirm(request(context.token),{operationId:randomUUID()},port),{code:'not_authorized'});
 assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${f.op}'`),'confirmed');
 assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${bFixture.op}'`),'confirmed');
 checks.push('Native AAL1 is refused; same-clinic authorized admin B confirms its own intent but cannot adopt A; a different real session and unknown operation are refused, preserving both confirmed rows');

 const race=fixture();begin(race,context);await birth(race);const beforeRace=rpcCalls;
 beforeCommit=async()=>{assert.equal((await call(auth,'/logout?scope=local',context.token,{})).status,204);assert.equal(sql(`select count(*) from auth.sessions where id='${context.session_id}'`),'0');};
 await assert.rejects(()=>confirm(request(context.token),{operationId:race.op},port),{code:'not_authorized'});beforeCommit=null;
 assert.equal(rpcCalls,beforeRace+1);assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${race.op}'`),'prepared');
 assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${race.op}') and exists(select 1 from auth.users where id='${race.id}')`),'t');
 for(const table of ['clinic_members','clinic_staff_members','patients','consultations'])assert.equal(sql(`select count(*) from public.${table} where user_id in (select planned_user_id from provision_intent_lab.intents)`),'0');
 assert.equal(sql('select count(*) from public.staff_doctor_scopes'),'0');
 checks.push('Native logout after Auth verification but before SQL wins; one failed confirmation preserves prepared intent, Auth identity and receipt without membership, scope or automatic retry');
 assert.equal(checks.length,4);
 return {confirmationBoundaryProofPassed:true,confirmationBoundaryChecks:checks,nativeUserEndpointLookups:userLookups,edgeHttpRouteTested:false,sdkTransportShim:true,confirmationSqlCalls:rpcCalls};
}
