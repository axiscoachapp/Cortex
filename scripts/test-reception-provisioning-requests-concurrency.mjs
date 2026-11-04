import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const service="set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';";
const human=a=>`set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${a}';`;
function fixture(sql){
 const f={admin:randomUUID(),doctor:randomUUID(),staff:randomUUID(),clinic:randomUUID(),operation:randomUUID()};
 sql(`insert into auth.users(id,email) values('${f.admin}','${f.admin}@example.invalid'),('${f.doctor}','${f.doctor}@example.invalid'),('${f.staff}','${f.staff}@example.invalid');
 insert into public.clinics(id,name,created_by) values('${f.clinic}','Synthetic provision race','${f.admin}');
 insert into public.clinic_members(clinic_id,user_id,role,status) values('${f.clinic}','${f.admin}','admin','active'),('${f.clinic}','${f.doctor}','doctor','active');
 insert into public.clinic_staff_members(clinic_id,user_id,name) values('${f.clinic}','${f.staff}','Synthetic provision staff');`);return f;
}
const call=f=>`select cortex_private.request_provisioned_reception_delegation('${f.clinic}','${f.staff}','${f.doctor}','${f.admin}','${f.operation}')`;
const count=(sql,f)=>sql(`select count(*) from cortex_private.reception_delegation_requests where staff_user_id='${f.staff}'`);
function refused(r,c){assert.notEqual(r.status,0);assert.match(r.stderr,new RegExp(c+':'));}
async function observe(sql,h,w){
 for(let n=0;n<35;n++){
  if(sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${h.name}' where w.application_name='${w.name}' and h.pid=any(pg_blocking_pids(w.pid)) and w.wait_event_type='Lock')`)==='t')return;
  await new Promise(done=>setTimeout(done,30));
 }throw new Error('Expected observed authority/table wait');
}
export async function exerciseProvisioningRequestsUpgrade({sql,session,required,migration}){
 const names=['validate_reception_delegation_request','guard_reception_delegation_operation'];
 const definitions=names.map(n=>sql(`select pg_get_functiondef('cortex_private.${n}()'::regprocedure)`));
 const held=migration.replace(/commit;\s*$/i,'');assert.notEqual(held,migration);const checks=[],ownedStaff=[];
 assert.equal(sql('select count(*) from cortex_private.reception_delegation_requests'),'0');
 assert.equal(sql('select count(*) from cortex_private.reception_delegation_operations'),'0');
 for(const isolation of ['read committed','repeatable read']){
  const f=fixture(sql),old=session(),installer=session();ownedStaff.push(f.staff);
  try{
   old.send(`begin;${human(f.admin)}select cortex_private.request_reception_delegation('${f.clinic}','${f.staff}','${f.doctor}','${randomUUID()}');commit;
   begin isolation level ${isolation};select count(*) from auth.users;select 'REQUEST_HELD';`);await old.held();
   installer.send(held+"\nselect 'REQUEST_HELD';");await installer.held();
   const pending=old.end(`${human(f.admin)}select cortex_private.request_reception_delegation('${f.clinic}','${f.staff}','${f.doctor}','${randomUUID()}');commit;`);pending.catch(()=>{});
   await observe(sql,installer,old);required(await installer.end('commit;'));required(await pending);
   assert.equal(count(sql,f),'1');
   assert.equal(sql(`select request_source||'|'||requested_by::text||'|'||state from cortex_private.reception_delegation_requests where staff_user_id='${f.staff}'`),`human_request|${f.admin}|pending`);
   assert.equal(sql(`select count(*) from cortex_private.reception_delegation_operations o join cortex_private.reception_delegation_requests r on r.id=o.request_id where r.staff_user_id='${f.staff}'`),'2');
   checks.push(`${isolation}: warmed human backend/snapshot waits for DDL and preserves original human source with one alias`);
  }finally{await old.end('rollback;');await installer.end('rollback;');}
  // Restore only this owned laboratory installation before the next schedule.
  sql(`begin;${definitions.map(d=>d+';').join('\n')}
   drop trigger aa_delegation_request_source on cortex_private.reception_delegation_requests;
   drop function cortex_private.request_provisioned_reception_delegation(uuid,uuid,uuid,uuid,uuid);
   drop function cortex_private.provisioning_request_current(cortex_private.reception_delegation_requests);
   drop function cortex_private.reception_provisioning_admin(uuid,uuid);
   drop function cortex_private.guard_delegation_request_source();
   alter table cortex_private.reception_delegation_requests drop column request_source;commit;`);
  names.forEach((n,i)=>assert.equal(sql(`select pg_get_functiondef('cortex_private.${n}()'::regprocedure)`),definitions[i]));
 }
 assert.equal(sql("select exists(select 1 from pg_attribute where attrelid='cortex_private.reception_delegation_requests'::regclass and attname='request_source' and not attisdropped)"),'f');
 // History is immutable through DELETE. This fresh owned lab contains only
 // our two installation fixtures; clear exactly those tables before suites
 // that expect empty history. No CASCADE or reusable/external target exists.
 const owned=ownedStaff.map(id=>`'${id}'`).join(',');
 assert.equal(sql('select count(*) from cortex_private.reception_delegation_requests'),'2');
 assert.equal(sql(`select count(*) from cortex_private.reception_delegation_requests where staff_user_id in (${owned})`),'2');
 assert.equal(sql('select count(*) from cortex_private.reception_delegation_operations'),'4');
 assert.equal(sql(`select count(*) from cortex_private.reception_delegation_operations o join cortex_private.reception_delegation_requests r on r.id=o.request_id where r.staff_user_id in (${owned})`),'4');
 assert.equal(sql('select count(*) from public.staff_doctor_scopes'),'0');
 sql('truncate cortex_private.reception_delegation_operations,cortex_private.reception_delegation_requests,public.staff_doctor_scopes;');
 return checks;
}
export async function testProvisioningRequestsConcurrency({sql,result,session,required}){
 const checks=[],pass=s=>{checks.push(s);process.stdout.write('Passed provisioning race: '+s+'\n');};
 const noGrant=f=>assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${f.staff}'`),'0');
 const change=(f,k)=>k==='metadata'?`update auth.users set raw_app_meta_data=raw_app_meta_data||'{"account_type":"reception"}'::jsonb where id='${f.admin}'`
  :k==='role'?`update public.clinic_members set role='doctor' where clinic_id='${f.clinic}' and user_id='${f.admin}'`
  :k==='admin-delete'?`delete from public.clinic_members where clinic_id='${f.clinic}' and user_id='${f.admin}'`
  :k==='staff'?`update public.clinic_staff_members set active=false where user_id='${f.staff}'`
  :`update public.clinic_members set status='inactive' where clinic_id='${f.clinic}' and user_id='${f.doctor}'`;
 for(const isolation of ['read committed','repeatable read']){
  const f=fixture(sql),a=session(),b=session();
  try{
   b.send(`begin isolation level ${isolation};select count(*) from auth.users;select 'REQUEST_HELD';`);await b.held();
   a.send(`begin;${service}${call(f)};select 'REQUEST_HELD';`);await a.held();
   refused(await b.end(`${service}${call(f)};commit;`),'40001');required(await a.end('commit;'));
   const r=JSON.parse(sql(`begin;${service}${call(f)};commit;`));assert.equal(r.state,'pending');assert.equal(count(sql,f),'1');noGrant(f);
   assert.equal(sql(`select count(*) from cortex_private.reception_delegation_operations where actor_user_id='${f.admin}'`),'1');
   pass(`${isolation}: concurrent identical request refuses overlap; lost-response replay keeps one request/operation`);
  }finally{await a.end('rollback;');await b.end('rollback;');}
 }
 for(const isolation of ['read committed','repeatable read'])for(const kind of ['metadata','role','admin-delete','staff','doctor'])for(const held of [false,true]){
  const f=fixture(sql),reader=session();let writer;
  try{
   reader.send(`begin isolation level ${isolation};select count(*) from auth.users;select 'REQUEST_HELD';`);await reader.held();
   if(held){writer=session();writer.send(`begin;${change(f,kind)};select 'REQUEST_HELD';`);await writer.held();}else sql(change(f,kind));
   refused(await reader.end(`${service}${call(f)};commit;`),held||isolation==='repeatable read'?'40001':'42501');
   if(writer)required(await writer.end('commit;'));assert.equal(count(sql,f),'0');noGrant(f);
   pass(`${isolation}: ${kind} ${held?'held':'committed'} first prevents request and grant`);
  }finally{await reader.end('rollback;');if(writer)await writer.end('rollback;');}
 }
 for(const isolation of ['read committed','repeatable read'])for(const kind of ['metadata','role','staff']){
  const f=fixture(sql),factory=session(),writer=session();
  try{
   writer.send(`begin isolation level ${isolation};select count(*) from auth.users;select 'REQUEST_HELD';`);await writer.held();
   factory.send(`begin;${service}${call(f)};select 'REQUEST_HELD';`);await factory.held();
   if(kind==='staff'){
    // The staff FK uses KEY SHARE; active updates are refused by the NOWAIT
    // account fence, rather than waiting for a tuple lock held by the factory.
    refused(await writer.end(change(f,kind)+';commit;'),'40001');
    required(await factory.end('commit;'));sql(change(f,kind));
   }else{
    const pending=writer.end(change(f,kind)+';commit;');pending.catch(()=>{});
    await observe(sql,factory,writer);required(await factory.end('commit;'));required(await pending);
   }
   assert.equal(count(sql,f),'1');noGrant(f);
   assert.equal(sql(`select state from cortex_private.reception_delegation_requests where staff_user_id='${f.staff}'`),kind==='staff'?'cancelled':'pending');
   refused(result(`begin;${service}${call(f)};commit;`),'42501');
   pass(`${isolation}: factory first ${kind==='staff'?'refuses staff writer NOWAIT':'observes '+kind+' writer waiting'}; current replay refuses without restoration`);
  }finally{await factory.end('rollback;');await writer.end('rollback;');}
 }
 // A mutation control proves that the Auth fence, beyond epochs, is necessary.
 const definition=sql("select pg_get_functiondef('cortex_private.reception_provisioning_admin(uuid,uuid)'::regprocedure)");
 const needle='perform 1 from auth.users where id=p_admin for share nowait;';assert.ok(definition.includes(needle));
 try{
  sql(definition.replace(needle,'perform 1;'));const f=fixture(sql),reader=session();
  try{
   reader.send("begin isolation level repeatable read;select count(*) from auth.users;select 'REQUEST_HELD';");await reader.held();sql(change(f,'metadata'));
   required(await reader.end(`${service}${call(f)};commit;`));assert.equal(count(sql,f),'1');noGrant(f);
   pass('RED mutation: without Auth tuple fence stale RR classification accepts administrator; no grant created');
  }finally{await reader.end('rollback;');}
 }finally{sql(definition);assert.equal(sql("select pg_get_functiondef('cortex_private.reception_provisioning_admin(uuid,uuid)'::regprocedure)"),definition);}
 assert.equal(checks.length,29);return checks;
}
