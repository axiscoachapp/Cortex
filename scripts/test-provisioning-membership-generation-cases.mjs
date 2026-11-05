import assert from 'node:assert/strict';

export async function exerciseMembershipGeneration({sql,result,session,required,prototype,admin,other,clinic,otherClinic}){
 const checks=[],service="set local request.jwt.claim.role='service_role';";
 const where=(c=clinic,a=admin)=>`clinic_id='${c}' and user_id='${a}'`;
 const capture=(c=clinic,a=admin)=>sql(`begin;${service}select provision_membership_lab.current_generation('${c}','${a}');commit;`);
 const check=(g,c=clinic,a=admin)=>`select provision_membership_lab.assert_generation('${c}','${a}',${g?"'"+g+"'":'null'})`;
 const succeeds=g=>sql(`begin;${service}${check(g)};commit;`);
 const refuses=(g,code='42501',c=clinic,a=admin)=>{
  const r=result(`begin;${service}${check(g,c,a)};commit;`);assert.notEqual(r.status,0);assert.match(r.stderr,new RegExp(code+':'));
 };
 const absent=()=>{
  assert.equal(sql("select not exists(select 1 from pg_attribute where attrelid='public.clinic_members'::regclass and attname='provisioning_authority_generation' and not attisdropped) and to_regnamespace('provision_membership_lab') is null"),'t');
 };
 const definitions=()=>sql(`select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.proname,p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='cortex_private' and p.proname in ('touch_custody_epoch','custody_reference_accounts','direct_custody_resources','indirect_custody_resources','reception_provisioning_admin')`);
 const before=definitions();absent();
 // Observe the actual owned backend, not elapsed time or a lock-timeout code.
 const noWait=async(source,code,holderPid,expectWait=false)=>{
  const attempt=session();let waited=false;
  const done=attempt.end("set lock_timeout='30s';set statement_timeout='35s';"+source);
  for(let n=0;n<60;n++){
   if(attempt.completed())break;
   const waiting=sql(`select pid from pg_stat_activity where application_name='${attempt.application}' and wait_event_type='Lock' and ${holderPid}=any(pg_blocking_pids(pid)) limit 1`);
   if(waiting){assert.match(waiting,/^[0-9]+$/);waited=true;assert.equal(sql(`select pg_cancel_backend(${waiting})`),'t');break;}
   await new Promise(r=>setTimeout(r,30));
  }
  const r=await done;assert.notEqual(r.status,0);
  assert.equal(waited,expectWait,expectWait?'Mutation did not reach its actual holder':'Unexpected blocking under an owned holder');
  assert.match(r.stderr,new RegExp((waited?'57014':code)+':'));
  return waited;
 };
 const busyInstall=session();
 let installationControl=false;
 try{
  busyInstall.send("begin;lock table public.clinic_members in access share mode;select 'GEN_HELD='||pg_backend_pid();");const pid=await busyInstall.held();
  await noWait(prototype,'55P03',pid);
  const blocking=prototype.replace('access exclusive mode nowait','access exclusive mode');assert.notEqual(blocking,prototype);
  installationControl=await noWait(blocking,'55P03',pid,true);
 }finally{required(await busyInstall.end('rollback;'));}absent();
 checks.push('Busy installation refuses without waiting; removing NOWAIT is observed and cancelled; no partial DDL');
 const oldInstall=session();
 try{
  oldInstall.send("begin isolation level repeatable read;select count(*) from auth.users;select 'GEN_HELD='||pg_backend_pid();");await oldInstall.held();
  const r=await oldInstall.end(prototype);assert.notEqual(r.status,0);assert.match(r.stderr,/25001:/);
 }finally{await oldInstall.end('rollback;');}absent();
 checks.push('Installation refuses an established RR snapshot without partial DDL');
 sql(prototype);
 let generation=capture();assert.match(generation,/^[0-9a-f-]{36}$/);assert.notEqual(generation,capture(otherClinic,other));
 succeeds(generation);checks.push('Existing real memberships are seeded and the actual admin/T33 guard authorizes current generation');
 refuses(null);refuses(generation,'42501',otherClinic,admin);refuses(generation,'42501',clinic,other);
 const wrongContext=result(`begin;set local request.jwt.claim.role='authenticated';${check(generation)};commit;`);assert.notEqual(wrongContext.status,0);assert.match(wrongContext.stderr,/42501:/);
 checks.push('Null generation, other clinic/member and non-service context cannot use the witness');
 sql(`update public.clinic_members set updated_at=clock_timestamp(),provisioning_authority_generation=gen_random_uuid() where ${where()};`);
 assert.equal(capture(),generation);succeeds(generation);
 sql(`insert into public.clinic_members(clinic_id,user_id,role,status,provisioning_authority_generation) values('${clinic}','${admin}','admin','active',gen_random_uuid()) on conflict(clinic_id,user_id) do update set provisioning_authority_generation=excluded.provisioning_authority_generation;`);
 assert.equal(capture(),generation);checks.push('Timestamp-only, supplied UUID and no-op upsert preserve the current generation');
 for(const [field,away] of [['role','doctor'],['status','inactive']]){
  const original=generation;
  sql(`update public.clinic_members set ${field}='${away}' where ${where()};`);refuses(original);
  sql(`update public.clinic_members set ${field}='${field==='role'?'admin':'active'}',provisioning_authority_generation='${original}' where ${where()};`);
  generation=capture();assert.notEqual(generation,original);refuses(original);succeeds(generation);
  checks.push('Authority '+field+' ABA refuses the old generation even when the writer supplies it');
 }
 const sameTransaction=generation;
 sql(`begin;update public.clinic_members set role='doctor' where ${where()};update public.clinic_members set role='admin' where ${where()};commit;`);
 generation=capture();assert.notEqual(generation,sameTransaction);refuses(sameTransaction);
 checks.push('Loss and return in one transaction still rotates authority');
 const deleted=generation;
 sql(`delete from public.clinic_members where ${where()};insert into public.clinic_members(clinic_id,user_id,role,status,provisioning_authority_generation) values('${clinic}','${admin}','admin','active','${deleted}');`);
 generation=capture();assert.notEqual(generation,deleted);refuses(deleted);succeeds(generation);
 checks.push('DELETE/recreate of the same composite identity cannot restore the old generation');
 assert.equal(sql(`begin;set local role service_role;${service}update public.clinic_members set provisioning_authority_generation='${deleted}' where ${where()} returning provisioning_authority_generation;commit;`),generation);
 assert.equal(capture(),generation);
 const deniedWriter=result(`begin;set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${admin}';update public.clinic_members set provisioning_authority_generation='${deleted}' where ${where()};commit;`);
 assert.notEqual(deniedWriter.status,0);assert.match(deniedWriter.stderr,/42501: permission denied for table clinic_members/);
 assert.equal(capture(),generation);checks.push('Service write reaches the trigger without restoring a UUID; authenticated direct write remains ACL-denied');
 const held=session();
 try{
  held.send(`begin;update public.clinic_members set role='doctor' where ${where()};select 'GEN_HELD='||pg_backend_pid();`);const pid=await held.held();
  await noWait(`begin;${service}${check(generation)};commit;`,'40001',pid);
 }finally{required(await held.end('rollback;'));}succeeds(generation);
 checks.push('Uncommitted member mutation refuses the guard NOWAIT while the writer remains open');
 const memberOnly=session();let memberControl=false;
 const guardSignature='cortex_private.reception_provisioning_admin(uuid,uuid)';
 const guardDefinition=sql(`select pg_get_functiondef('${guardSignature}'::regprocedure)`);
 try{
  memberOnly.send(`begin;select 1 from public.clinic_members where ${where()} for update;select 'GEN_HELD='||pg_backend_pid();`);const pid=await memberOnly.held();
  await noWait(`begin;${service}${check(generation)};commit;`,'40001',pid);
  const blocking=guardDefinition.replace(/(status='active' for share) nowait/i,'$1');assert.notEqual(blocking,guardDefinition);
  try{sql(blocking);memberControl=await noWait(`begin;${service}${check(generation)};commit;`,'40001',pid,true);}
  finally{sql(guardDefinition);assert.equal(sql(`select pg_get_functiondef('${guardSignature}'::regprocedure)`),guardDefinition);}
 }finally{required(await memberOnly.end('rollback;'));}
 checks.push('Member-row refusal is nonblocking; a controlled guard mutation waits, is cancelled and is restored exactly');
 const stale=session(),oldGeneration=generation;
 try{
  stale.send("begin isolation level repeatable read;select count(*) from auth.users;select 'GEN_HELD='||pg_backend_pid();");await stale.held();
  sql(`begin;update public.clinic_members set role='doctor' where ${where()};update public.clinic_members set role='admin' where ${where()};commit;`);
  const r=await stale.end(service+check(oldGeneration)+';commit;');assert.notEqual(r.status,0);assert.match(r.stderr,/40001:/);
 }finally{await stale.end('rollback;');}
 generation=capture();refuses(oldGeneration);succeeds(generation);checks.push('Established RR snapshot refuses committed ABA through the actual T33 barrier');
 const independent=session();
 try{
  independent.send(`begin;update public.clinic_members set role='doctor' where ${where(otherClinic,other)};select 'GEN_HELD='||pg_backend_pid();`);await independent.held();succeeds(generation);
 }finally{required(await independent.end('rollback;'));}
 checks.push('Another account/clinic mutation does not invalidate or block this generation');
 const winner=session(),writer=session();let observed=false;
 try{
  winner.send(`begin;${service}${check(generation)};select 'GEN_HELD='||pg_backend_pid();`);const pid=await winner.held();
  writer.send(`begin;update public.clinic_members set role='doctor' where ${where()};commit;`);
  for(let n=0;n<60;n++){
   if(writer.completed())break;
   if(sql(`select exists(select 1 from pg_stat_activity where application_name='${writer.application}' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid)))`)==='t'){observed=true;break;}
   await new Promise(r=>setTimeout(r,30));
  }
  if(observed){required(await winner.end('commit;'));required(await writer.end(''));}
  else{const r=await writer.end('');assert.notEqual(r.status,0);assert.match(r.stderr,/40001:/);required(await winner.end('commit;'));
   sql(`update public.clinic_members set role='doctor' where ${where()};`);}
 }finally{await winner.end('rollback;');await writer.end('rollback;');}
 refuses(generation);sql(`update public.clinic_members set role='admin' where ${where()};`);generation=capture();succeeds(generation);
 checks.push(observed?'Guard-first ordering actually blocks the member writer until the short check commits':'Guard-first ordering makes the member writer refuse 40001 before explicit retry');
 // A clinic creator has real custody and cannot request deletion. Use a
 // separate synthetic member without that responsibility for this guard case.
 const leaving='a2810000-0000-4000-8000-000000000003';
 sql(`insert into auth.users(id,email) values('${leaving}','generation-leaving@example.invalid');insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${leaving}','admin','active');`);
 const leavingGeneration=capture(clinic,leaving);
 sql(`insert into public.account_deletion_requests(user_id) values('${leaving}');`);refuses(leavingGeneration,'42501',clinic,leaving);
 checks.push('Current real account deletion intent is still refused by the existing guard');
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(sql(`select has_schema_privilege('${role}','provision_membership_lab','usage') or has_function_privilege('${role}','provision_membership_lab.current_generation(uuid,uuid)','execute') or has_function_privilege('${role}','provision_membership_lab.assert_generation(uuid,uuid,uuid)','execute')`),'f');
 }
 assert.equal(definitions(),before);assert.equal(sql('select count(*) from public.staff_doctor_scopes'),'0');
 checks.push('Private ACL, no grants, original provisioning guard and all T33 function definitions preserved');
 assert.equal(checks.length,17);
 return {checks,inverseWriterWaitObserved:observed,installationNowaitMutationDetected:installationControl,membershipNowaitMutationDetected:memberControl};
}
