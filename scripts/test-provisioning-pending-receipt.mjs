import assert from 'node:assert/strict';

// Owned disposable Native laboratory. No production route or authorizer.
export async function exercisePendingReceipt({auth,adminJwt,version,call,sql,rawSql,fixture,begin,birth,ctx,args,query,trusted,refused,holderSession,asyncHttp,pause,report}){
 const checks=[];
 const replay=f=>`select provision_intent_lab.begin_intent('${f.op}','${f.id}',${args(ctx)})`;
 const digest=f=>sql(`select md5(jsonb_build_array((select to_jsonb(o) from provision_identity_lab.operations o where operation_id='${f.op}'),(select to_jsonb(i) from provision_intent_lab.intents i where operation_id='${f.op}'))::text)`);
 const attempt=q=>rawSql(`begin;set local request.jwt.claim.role='service_role';${q};rollback;`);
 const denied=result=>{assert.notEqual(result.status,0);assert.match(result.stderr,/40001/);assert.doesNotMatch(result.stderr,/lock timeout|statement timeout/);};
 const f=fixture(),original=begin(f,ctx),beforeBirth=digest(f);
 assert.equal(JSON.parse(trusted(query(f,ctx,false))).phase,'prepared');assert.deepEqual(begin(f,ctx),original);
 assert.equal(digest(f),beforeBirth);assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),'0');refused(query(f,ctx,true),'40001');
 checks.push('Valid reservation before first Native birth permits check and begin replay with no Auth target, while confirmation refuses');
 await birth(f);const born=digest(f);
 assert.equal(sql(`select phase='auth_created' and birth_transaction is not null from provision_identity_lab.operations where operation_id='${f.op}'`),'t');
 assert.deepEqual(JSON.parse(trusted(query(f,ctx,false))),original);assert.deepEqual(begin(f,ctx),original);assert.equal(digest(f),born);
 checks.push('Native-born live target with prepared intent permits nonconfirming check and begin replay without changing either ledger');
 assert.equal((await call(auth,'/admin/users/'+f.id,adminJwt,undefined,'DELETE')).status,200);
 assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),'0');assert.equal(digest(f),born);
 const results=[['check',attempt(query(f,ctx,false))],['begin',attempt(replay(f))]];
 const accepted=results.filter(([,r])=>r.status===0).map(([kind,r])=>{assert.equal(JSON.parse(r.stdout.trim()).phase,'prepared');return kind;});
 if(accepted.length)throw Object.assign(new Error('Born target removed before confirmation still returns prepared intent'),{receiptEvidence:{...report,pendingReceiptRedOnly:true,authVersion:version,nativeDeleteStatus:200,operationPhase:'auth_created',intentPhase:'prepared',acceptedPaths:accepted,ledgersPreserved:digest(f)===born,pendingReceiptProofPassed:false}});
 for(const [,result] of results)denied(result);refused(query(f,ctx,true),'40001');assert.equal(digest(f),born);
 checks.push('Completed Native DELETE before confirmation refuses check, begin replay and confirmation, preserving birth and prepared intent');
 const recreated=await call(auth,'/admin/users',adminJwt,{id:f.id,email:f.email,email_confirm:true,app_metadata:{account_type:'reception',cortex_provision_operation:f.op,cortex_provision_revision:1}});
 assert.ok(recreated.status>=400&&recreated.status<=599);assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),'0');assert.equal(digest(f),born);
 denied(attempt(query(f,ctx,false)));denied(attempt(replay(f)));
 checks.push('Native attempt to recreate the removed UUID cannot revive its historical operation or leave a new identity');
 const changed=fixture(),start=begin(changed,ctx);await birth(changed);const stable=digest(changed);
 assert.equal((await call(auth,'/admin/users/'+changed.id,adminJwt,{app_metadata:{cortex_provision_revision:2}},'PUT')).status,200);
 denied(attempt(query(changed,ctx,false)));denied(attempt(replay(changed)));refused(query(changed,ctx,true),'40001');assert.equal(digest(changed),stable);assert.equal(start.phase,'prepared');
 checks.push('Native metadata mismatch after birth also refuses every prepared replay path without rewriting evidence');

 const snapshotReplay=async(isolation,kind,fromPrepared=false,expectAccepted=false)=>{
  const stale=fixture();begin(stale,ctx);if(!fromPrepared)await birth(stale);
  const child=holderSession();let out='',err='',ended=false;
  child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});const done=new Promise(resolve=>child.once('close',resolve));
  try{
   child.stdin.write(`\\set VERBOSITY verbose\nbegin isolation level ${isolation};set local request.jwt.claim.role='service_role';select provision_identity_lab.has_birth_receipt('${stale.op}');select 'PENDING_SNAPSHOT='||pg_backend_pid();\n`);
   let ready=false;for(let n=0;n<80;n++){if(/PENDING_SNAPSHOT=\d+/.test(out)){ready=true;break;}await pause();}assert.ok(ready);assert.match(out,fromPrepared?/^f$/m:/^t$/m);
   if(fromPrepared)await birth(stale);const preserved=digest(stale);
   assert.equal((await call(auth,'/admin/users/'+stale.id,adminJwt,undefined,'DELETE')).status,200);
   child.stdin.end((kind==='check'?query(stale,ctx,false):replay(stale))+';commit;\n');ended=true;
   const status=await done;
   if(expectAccepted){assert.equal(status,0,err);assert.equal(JSON.parse(out.split('\n').find(line=>line.startsWith('{'))).phase,'prepared');}
   else{assert.notEqual(status,0);assert.match(err,/40001/);assert.doesNotMatch(err,/lock timeout|statement timeout/);}
   assert.equal(digest(stale),preserved);
  }finally{if(!ended)child.stdin.end('rollback;\n');await done;}
 };
 for(const isolation of ['read committed','repeatable read'])for(const kind of ['check','begin'])for(const fromPrepared of [false,true]){
  await snapshotReplay(isolation,kind,fromPrepared);
  checks.push(`${isolation} snapshot established ${fromPrepared?'before':'after'} birth refuses ${kind} after Native birth/DELETE, preserving both ledgers`);
 }

 // Hold a real Native DELETE inside its row trigger, after the row lock.
 {
  const busy=fixture();begin(busy,ctx);await birth(busy);const preserved=digest(busy),key=721000000+Math.floor(Math.random()*1000000);
  sql(`create function provision_intent_lab.pending_delete_pause() returns trigger language plpgsql set search_path='' as $$ begin perform pg_advisory_xact_lock(${key});return old;end $$;create trigger pending_receipt_delete_pause before delete on auth.users for each row when(old.id='${busy.id}') execute function provision_intent_lab.pending_delete_pause();`);
  const child=holderSession();let out='',ended=false,request,settled=false;child.stdout.on('data',d=>{out+=d;});const done=new Promise(resolve=>child.once('close',resolve));
  const release=async()=>{if(!ended){ended=true;child.stdin.end('rollback;\n');}assert.equal(await done,0);};
  try{
   child.stdin.write(`begin;select pg_advisory_xact_lock(${key});select 'PENDING_DELETE='||pg_backend_pid();\n`);
   let pid;for(let n=0;n<80;n++){const found=/PENDING_DELETE=(\d+)/.exec(out);if(found){pid=Number(found[1]);break;}await pause();}assert.ok(pid);
   request=asyncHttp({url:auth+'/admin/users/'+busy.id,method:'DELETE',headers:{Authorization:'Bearer '+adminJwt}}).then(r=>{settled=true;return r;});
   let observed=false;for(let n=0;n<80;n++){if(sql(`select exists(select 1 from pg_stat_activity where usename='supabase_auth_admin' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid)))`)==='t'){observed=true;break;}await pause();}assert.ok(observed,'Native DELETE never reached the held trigger');
   denied(attempt(query(busy,ctx,false)));denied(attempt(replay(busy)));assert.equal(settled,false);assert.equal(digest(busy),preserved);
   await release();assert.equal((await request).status,200);assert.equal(sql(`select count(*) from auth.users where id='${busy.id}'`),'0');assert.equal(digest(busy),preserved);
  }finally{await release();if(request)await Promise.allSettled([request]);sql('drop trigger pending_receipt_delete_pause on auth.users;drop function provision_intent_lab.pending_delete_pause();');}
  checks.push('Observed in-flight Native DELETE makes both prepared replay paths fail with 40001 without waiting for delete completion');
 }
 // Remove only the new born/prepared distinction; the old acceptance returns.
 const signature='provision_intent_lab.fence_current_receipt(uuid,uuid,boolean)',definition=sql(`select pg_get_functiondef('${signature}'::regprocedure)`);
 const site="not p_require_birth and receipt_operation.phase='prepared' and receipt_operation.birth_transaction is null";
 assert.equal(definition.split(site).length,2);
 const mutant=definition.replace(site,'not p_require_birth');
 const control=rawSql(`begin;set local request.jwt.claim.role='service_role';${mutant};${query(f,ctx,false)};${replay(f)};rollback;`);
 assert.equal(control.status,0,control.stderr);const rows=control.stdout.trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));assert.equal(rows.length,2);for(const row of rows)assert.deepEqual(row,original);
 assert.equal(sql(`select pg_get_functiondef('${signature}'::regprocedure)`),definition);denied(attempt(query(f,ctx,false)));assert.equal(digest(f),born);
 checks.push('Removing only the born/prepared predicate restores both stale prepared responses; rollback restores the fence and immutable ledgers');
 const lockSite='for share nowait;';assert.equal(definition.split(lockSite).length,2);
 try{
  sql(definition.replace(lockSite,';'));
  for(const kind of ['check','begin'])await snapshotReplay('repeatable read',kind,true,true);
 }finally{sql(definition);}
 assert.equal(sql(`select pg_get_functiondef('${signature}'::regprocedure)`),definition);
 checks.push('Removing only the operation row lock lets a pre-birth RR snapshot return stale prepared history through both paths; original function restored');
 assert.equal(checks.length,16);
 return {pendingReceiptChecks:checks,pendingReceiptProofPassed:true};
}
