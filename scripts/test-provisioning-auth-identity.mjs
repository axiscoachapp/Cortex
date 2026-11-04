import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Native creation/receipt proof only. No human authorization or data release.
export async function exerciseProvisioningAuthIdentity({auth,rest,adminJwt,version,call,sql,asyncHttp,pause,syntheticSecrets,holderSession}) {
  const checks=[];
  const metadata=f=>({account_type:'reception',cortex_provision_operation:f.op,cortex_provision_revision:1});
  const intent=label=>{
    const f={op:randomUUID(),id:randomUUID(),email:'provision-'+label+'@example.invalid'};
    sql(`insert into provision_identity_lab.operations(operation_id,planned_user_id) values('${f.op}','${f.id}')`);return f;
  };
  const create=f=>call(auth,'/admin/users',adminJwt,{id:f.id,email:f.email,email_confirm:true,app_metadata:metadata(f)});
  const receipt=f=>sql(`select provision_identity_lab.has_birth_receipt('${f.op}')`);
  const phase=f=>sql(`select phase from provision_identity_lab.operations where operation_id='${f.op}'`);
  const absent=f=>assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),'0');
  const rejected=r=>assert.ok([409,422,500].includes(r.status),'Native refusal must be an HTTP response, not a transport failure');
  const held=async statement=>{
    const child=holderSession();let output='',ended=false;
    const done=new Promise(resolve=>child.once('close',resolve));
    const marker=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Identity holder did not reach its barrier')),8000);
      child.once('error',()=>{clearTimeout(timer);reject(new Error('Identity holder failed'));});
      child.once('close',()=>{clearTimeout(timer);reject(new Error('Identity holder closed before its barrier'));});
      child.stdout.on('data',data=>{output+=data;const match=/IDENTITY_HELD=(\d+)/.exec(output);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
    });
    child.stdin.write(`begin;${statement};select 'IDENTITY_HELD='||pg_backend_pid();\n`);
    const pid=await marker;
    return {pid,end:async command=>{if(!ended){ended=true;child.stdin.end(command+';\n');}return done;}};
  };
  const ignoredId=randomUUID();
  const withoutId=await call(auth,'/admin/users',adminJwt,{email:'without-planned-id@example.invalid',email_confirm:true});
  assert.equal(withoutId.status,200);assert.notEqual(withoutId.body.id,ignoredId);
  checks.push('RED control: create without a preallocated id cannot recover that planned identity');
  sql(readFileSync('supabase/tests/prototypes/provisioning-auth-identity.sql','utf8'));
  const op=randomUUID(),id=randomUUID();
  sql(`insert into provision_identity_lab.operations(operation_id,planned_user_id) values('${op}','${id}')`);
  const created=await call(auth,'/admin/users',adminJwt,{id,email:'planned-id@example.invalid',email_confirm:true,
    app_metadata:{account_type:'reception',cortex_provision_operation:op,cortex_provision_revision:1}});
  assert.equal(created.status,200);assert.equal(created.body.id,id);
  assert.equal(sql(`select phase from provision_identity_lab.operations where operation_id='${op}'`),'auth_created','Birth receipt missing after native creation');
  assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${op}')`),'t');
  assert.equal(sql(`select o.birth_transaction::text=u.xmin::text from provision_identity_lab.operations o join auth.users u on u.id=o.planned_user_id where o.operation_id='${op}'`),'t');
  checks.push('Native create commits the exact planned id and a transactional birth receipt');

  const lost=intent('lost-response');
  const discarded=await asyncHttp({url:auth+'/admin/users',method:'POST',headers:{Authorization:'Bearer '+adminJwt,'Content-Type':'application/json'},
    body:JSON.stringify({id:lost.id,email:lost.email,email_confirm:true,app_metadata:metadata(lost)})},`
    import {readFileSync} from 'node:fs';const q=JSON.parse(readFileSync(0,'utf8'));
    const r=await fetch(q.url,{method:q.method,headers:q.headers,body:q.body,signal:AbortSignal.timeout(10000)});
    await r.arrayBuffer();console.log(JSON.stringify({status:0,body:null}));`);
  assert.equal(discarded.status,0);
  for(let n=0;n<2;n++){const recovered=await call(auth,'/admin/users/'+lost.id,adminJwt);assert.equal(recovered.status,200);assert.equal(recovered.body.id,lost.id);assert.equal(receipt(lost),'t');}
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${lost.id}'`),'0');
  checks.push('Discarded native create response reconciles by reserved id and birth receipt without another write or session');

  const password=randomBytes(24).toString('hex');syntheticSecrets.push(password);
  const existing=await call(auth,'/admin/users',adminJwt,{email:'existing-identity@example.invalid',password,email_confirm:true,app_metadata:{fixture:'original'}});
  assert.equal(existing.status,200);const existingId=existing.body.id;
  checks.push('An unrelated native creation without a provisioning marker remains unchanged');
  const emailCollision=intent('email-collision');
  rejected(await call(auth,'/admin/users',adminJwt,{id:emailCollision.id,email:'existing-identity@example.invalid',email_confirm:true,app_metadata:metadata(emailCollision)}));
  absent(emailCollision);assert.equal(phase(emailCollision),'prepared');
  assert.equal((await call(auth,'/admin/users/'+existingId,adminJwt)).body.app_metadata.fixture,'original');
  checks.push('Existing email is neither adopted nor overwritten after a native duplicate refusal');
  rejected(await call(auth,'/admin/users',adminJwt,{id:existingId,email:'id-collision@example.invalid',email_confirm:true,app_metadata:metadata({op:randomUUID()})}));
  assert.equal(sql("select count(*) from auth.users where email='id-collision@example.invalid'"),'0');
  assert.equal((await call(auth,'/admin/users/'+existingId,adminJwt)).body.app_metadata.fixture,'original');
  checks.push('Existing UUID collision cannot change the existing identity or create the new email');

  // Deliberately malformed owner fixture: a reservation against a PREEXISTING
  // user. Later trusted metadata can match, but there was no birth in this op.
  const forged={op:randomUUID(),id:existingId};
  sql(`insert into provision_identity_lab.operations(operation_id,planned_user_id) values('${forged.op}','${forged.id}')`);
  const login=await call(auth,'/token?grant_type=password',adminJwt,{email:'existing-identity@example.invalid',password});assert.equal(login.status,200);
  syntheticSecrets.push(login.body.access_token,login.body.refresh_token);
  assert.equal((await call(auth,'/user',login.body.access_token,{data:{cortex_provision_operation:forged.op,cortex_provision_revision:1}},'PUT')).status,200);
  assert.equal(receipt(forged),'f');
  assert.equal((await call(auth,'/admin/users/'+existingId,adminJwt,{app_metadata:metadata(forged)},'PUT')).status,200);
  assert.equal((await call(auth,'/admin/users/'+existingId,adminJwt)).body.app_metadata.cortex_provision_operation,forged.op);
  assert.equal(phase(forged),'prepared');assert.equal(receipt(forged),'f');
  assert.equal((await call(auth,'/token?grant_type=password',adminJwt,{email:'existing-identity@example.invalid',password})).status,200);
  checks.push('RED metadata-only candidate: user and Admin metadata edits cannot manufacture a birth receipt for a preexisting user; its password is preserved');

  for(const kind of ['operation','revision','user-metadata']){
    const f=intent(kind),app=metadata(f);if(kind==='operation')app.cortex_provision_operation=randomUUID();
    if(kind==='revision')app.cortex_provision_revision=2;if(kind==='user-metadata')delete app.cortex_provision_operation;
    rejected(await call(auth,'/admin/users',adminJwt,{id:f.id,email:f.email,email_confirm:true,app_metadata:app,user_metadata:metadata(f)}));
    absent(f);assert.equal(phase(f),'prepared');assert.equal(receipt(f),'f');
    checks.push('Wrong '+kind+' rolls back the native creation and its receipt');
  }

  sql(`create function provision_identity_lab.force_rollback() returns trigger language plpgsql set search_path='' as $$
   begin if new.raw_user_meta_data->>'lab_rollback'='true' then raise exception 'Synthetic deferred rollback';end if;return new;end $$;
   create constraint trigger provision_identity_lab_rollback after insert on auth.users deferrable initially deferred
    for each row execute function provision_identity_lab.force_rollback();`);
  const rolled=intent('rollback');
  const rollback=await call(auth,'/admin/users',adminJwt,{id:rolled.id,email:rolled.email,email_confirm:true,app_metadata:metadata(rolled),user_metadata:{lab_rollback:true}});
  assert.equal(rollback.status,500);absent(rolled);assert.equal(phase(rolled),'prepared');assert.equal(receipt(rolled),'f');
  assert.equal(sql(`select birth_transaction is null from provision_identity_lab.operations where operation_id='${rolled.op}'`),'t');
  checks.push('Error after the native INSERT rolls back Auth identity and both receipt stages in the same transaction');

  const concurrent=intent('concurrent'),tableHolder=await held('lock table auth.users in share mode');let pending=[];
  try{
    const request={url:auth+'/admin/users',method:'POST',headers:{Authorization:'Bearer '+adminJwt,'Content-Type':'application/json'},body:JSON.stringify({id:concurrent.id,email:concurrent.email,email_confirm:true,app_metadata:metadata(concurrent)})};
    pending=[asyncHttp(request),asyncHttp(request)];let observed=false;
    for(let n=0;n<40;n++){
      if(sql(`select count(*) from pg_stat_activity where usename='supabase_auth_admin' and wait_event_type='Lock' and ${tableHolder.pid}=any(pg_blocking_pids(pid)) and query ilike '%insert%'`)==='2'){observed=true;break;}await pause();
    }
    assert.ok(observed,'Both native INSERTs must actually wait on the owned table holder');
    assert.equal(await tableHolder.end('commit'),0);const results=await Promise.all(pending);
    assert.equal(results.filter(r=>r.status===200).length,1);rejected(results.find(r=>r.status!==200));
    assert.equal(receipt(concurrent),'t');assert.equal(sql(`select count(*) from auth.users where id='${concurrent.id}'`),'1');
    checks.push('Two native creates observed behind one table lock yield one identity and one receipt, not an inferred sequential race');
  }finally{await tableHolder.end('rollback');await Promise.allSettled(pending);}

  const busy=intent('busy'),rowHolder=await held(`select 1 from provision_identity_lab.operations where operation_id='${busy.op}' for update`);
  try{assert.equal((await create(busy)).status,500);absent(busy);assert.equal(receipt(busy),'f');}
  finally{await rowHolder.end('rollback');}
  assert.equal(phase(busy),'prepared');checks.push('Busy reservation refuses the native INSERT while its holder remains open and leaves no partial identity');

  assert.equal((await call(auth,'/admin/users/'+lost.id,adminJwt,undefined,'DELETE')).status,200);absent(lost);
  assert.equal(phase(lost),'auth_created');assert.equal(receipt(lost),'f');rejected(await create(lost));absent(lost);
  checks.push('Deleted Auth identity leaves history but cannot be recreated or treated as a current receipt');
  for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`select has_schema_privilege('${role}','provision_identity_lab','usage')`),'f');
  assert.equal((await call(rest,'/rpc/has_birth_receipt',login.body.access_token,{p_operation:op})).status,404);
  assert.equal((await call(rest,'/operations?select=operation_id',login.body.access_token)).status,404);
  checks.push('Private receipts are unavailable to anon/authenticated/service roles and absent from the Data API');
  assert.equal(checks.length,15);
  return {syntheticOnly:true,labOnly:true,authVersion:version,checks,prototypeIsProductionFix:false,
    birthReceiptProofPassed:true,humanAuthorizationImplemented:false,privateProvisioningIntegration:false,
    notCovered:['human session/MFA/administrator binding','credential completion','membership/consent/legacy integration','all privileged ledger writers','production custody and upgrade','hosted Auth configuration']};
}
