import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// Only the owning, endpoint-pinned disposable DB runner supplies these ports.
export async function testContactLinkStateConcurrency({ run, start }) {
 const ok=r=>{assert.equal(r.status,0,r.stderr);return r.stdout.trim();},sql=s=>ok(run(s));const checks=[];
 function session(){
  const child=start();let stdout='',stderr='',complete=false,ended=false;
  child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});child.stdin.on('error',()=>{});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',status=>{complete=true;resolve({status,stdout,stderr});});});done.catch(()=>{});
  return {send:s=>child.stdin.write(s+'\n'),held:async()=>{for(let n=0;n<150;n++){if(stdout.includes('STATE_HELD'))return;if(complete)throw new Error(stderr);await new Promise(r=>setTimeout(r,25));}throw new Error('State holder did not reach barrier');},end:async s=>{if(!ended){ended=true;child.stdin.end(s+'\n');}return done;}};
 }
 function fixture(){
  const actor=randomUUID(),patient=randomUUID();sql(`insert into auth.users(id,email) values('${actor}','${actor}@example.invalid');insert into public.patients(id,user_id,name,status) values('${patient}','${actor}','Synthetic state race patient','novo');`);
  const claims=`set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
  const clinic=sql(`begin;${claims}select public.create_clinic('Synthetic state race');commit;`);
  const contact=sql(`begin;${claims}select public.reception_create_contact('${clinic}','Synthetic state race contact','','${randomUUID()}');commit;`);
  sql(`begin;${claims}select public.reception_link_patient('${contact}','${actor}','${patient}','guardian');commit;`);
  const details=JSON.stringify({doctorId:actor,contactId:contact,patientId:patient,startTime:'2099-11-03T12:00:00Z',endTime:'2099-11-03T12:30:00Z',type:'retorno'});
  return {actor,patient,clinic,contact,claims,book:()=>`select public.reception_book_appointment('${clinic}','${details}'::jsonb,'${randomUUID()}')`,state:(rev,active)=>`select public.reception_set_link_active('${contact}','${patient}',${rev},${active})`,confirm:`select public.reception_link_patient('${contact}','${actor}','${patient}','guardian')`,read:`select public.reception_contact('${contact}')`};
 }
 const expectCode=(result,code)=>{assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp(code+':'));if(code==='40001')assert.doesNotMatch(result.stderr,/57014:|lock timeout/);};
 const attempt=(f,source,iso='read committed')=>run(`begin isolation level ${iso};set local statement_timeout='2s';set local lock_timeout='5s';${f.claims}${source};commit;`);
 async function control(signature,needle,holder,f,source){
  const original=sql(`select pg_get_functiondef('${signature}'::regprocedure);`);assert.ok(original.includes(needle));
  try{sql(original.replace(needle,needle.replace(' nowait','')));expectCode(attempt(f,source),'57014');checks.push('isolated '+signature+' NOWAIT removal waits and is detected');}
  finally{sql(original);assert.equal(sql(`select pg_get_functiondef('${signature}'::regprocedure);`),original);}
  assert.ok(holder);
 }
 for(const iso of ['read committed','repeatable read']){
  const f=fixture(),holder=session();try{
   holder.send(`begin;select 1 from public.patient_contact_links where contact_id='${f.contact}' and patient_id='${f.patient}' for update;select 'STATE_HELD';`);await holder.held();
   expectCode(attempt(f,f.book(),iso),'40001');
   if(iso==='read committed')await control('cortex_private.reception_link_is_active(uuid,uuid,uuid,uuid)','for share nowait',holder,f,f.book());
   ok(await holder.end('rollback;'));checks.push(iso+': isolated link UPDATE fence refuses booking without account-epoch contention');
  }finally{await holder.end('rollback;');}
  const g=fixture(),reader=session();try{
   reader.send(`begin;select 1 from public.patient_contact_links where contact_id='${g.contact}' and patient_id='${g.patient}' for share;select 'STATE_HELD';`);await reader.held();
   expectCode(attempt(g,g.state(1,false),iso),'40001');expectCode(attempt(g,g.confirm,iso),'40001');
   expectCode(attempt(g,`select public.reception_update_link_relationship('${g.contact}','${g.patient}',1,'family')`,iso),'40001');
   if(iso==='read committed')await control('public.reception_set_link_active(uuid,uuid,integer,boolean)','for update nowait',reader,g,g.state(1,false));
   ok(await reader.end('rollback;'));checks.push(iso+': isolated link SHARE fence refuses state and confirmation lock upgrades');
  }finally{await reader.end('rollback;');}
  const identity=fixture(),account=session();try{
   account.send(`begin;select 1 from auth.users where id='${identity.actor}' for update;select 'STATE_HELD';`);await account.held();
   expectCode(attempt(identity,identity.state(1,false),iso),'40001');ok(await account.end('rollback;'));
   assert.equal(sql(`select active from public.patient_contact_links where contact_id='${identity.contact}'`),'t');checks.push(iso+': isolated Auth identity fence refuses state change without an audit or suspension');
  }finally{await account.end('rollback;');}
  const suspended=fixture(),writer=session();try{
   writer.send(`begin;${suspended.claims}${suspended.state(1,false)};select 'STATE_HELD';`);await writer.held();expectCode(attempt(suspended,suspended.book(),iso),'40001');
   ok(await writer.end('commit;'));expectCode(attempt(suspended,suspended.book(),iso),'42501');expectCode(attempt(suspended,suspended.confirm,iso),'42501');
   assert.equal(sql(`begin;${suspended.claims}${suspended.state(2,true)};commit;`),'3');expectCode(attempt(suspended,suspended.state(1,false),iso),'40001');
   sql(`begin;${suspended.claims}${suspended.book()};commit;`);checks.push(iso+': committed suspension refuses later booking/confirmation; reactivation works and stale intent cannot win');
  }finally{await writer.end('rollback;');}
  const booked=fixture(),booking=session();try{
   booking.send(`begin;${booked.claims}${booked.book()};select 'STATE_HELD';`);await booking.held();expectCode(attempt(booked,booked.state(1,false),iso),'40001');ok(await booking.end('commit;'));
   assert.equal(sql(`begin;${booked.claims}${booked.state(1,false)};commit;`),'2');assert.equal(sql(`select count(*) from public.appointments where contact_id='${booked.contact}'`),'1');checks.push(iso+': booking first commits before suspension and its history remains');
  }finally{await booking.end('rollback;');}
 }
 const f=fixture(),stale=session();try{
  stale.send(`begin isolation level repeatable read;select 1 from public.patient_contact_links where contact_id='${f.contact}';select 'STATE_HELD';`);await stale.held();sql(`begin;${f.claims}${f.state(1,false)};commit;`);
  const result=await stale.end(f.claims+f.read+';commit;');expectCode(result,'40001');checks.push('RR old operational-reader snapshot cannot disclose a formerly active link');
 }finally{await stale.end('rollback;');}
 const transport=fixture();
 assert.equal(sql(`select bool_and(provolatile='v') from pg_proc where oid in ('public.reception_contacts(uuid,text,uuid)'::regprocedure,'public.reception_contact(uuid)'::regprocedure,'public.reception_case(uuid,uuid)'::regprocedure);`),'t');
 expectCode(run(`begin read only;${transport.claims}${transport.read};commit;`),'25006');
 assert.equal(JSON.parse(sql(`begin read write;${transport.claims}${transport.read};commit;`)).beneficiaries.length,1);
 checks.push('POST reader volatility matches row fences: READ ONLY control refuses and READ WRITE succeeds');
 return checks;
}
