import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// Receives only the owning runner's endpoint-pinned disposable DB operations.
export async function testContactLinksPageConcurrency({ run, start, definition }) {
 const ok=result=>{assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 const admin=randomUUID(),clinic=randomUUID(),contact=randomUUID(),checks=[];
 ok(run(`insert into auth.users(id,email) values('${admin}','${admin}@example.invalid');insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic link page race','${admin}');insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${admin}','admin','active');insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values('${contact}','${clinic}','Synthetic race contact','${admin}','${randomUUID()}');`));
 const claims=`set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${admin}';`;
 const read=`select public.reception_contact_links('${clinic}','${contact}')`;
 function session(){
  const child=start();let stdout='',stderr='',completed=false,ended=false;
  child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});child.stdin.on('error',()=>{});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',status=>{completed=true;resolve({status,stdout,stderr});});});done.catch(()=>{});
  return {send:sql=>child.stdin.write(sql+'\n'),held:async()=>{for(let n=0;n<100;n++){if(stdout.includes('PAGE_HELD'))return;if(completed)throw new Error(stderr);await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Page holder failed to reach barrier');},end:async sql=>{if(!ended){ended=true;child.stdin.end(sql+'\n');}return done;}};
 }
 for(const iso of ['read committed','repeatable read'])for(const target of ['authority','account','contact']){
  const holder=session();try{
   const table=target==='authority'?'public.clinic_members':target==='account'?'auth.users':'public.clinic_contacts';
   const predicate=target==='authority'?`clinic_id='${clinic}' and user_id='${admin}'`:`id='${target==='account'?admin:contact}'`;
   holder.send(`begin;select 1 from ${table} where ${predicate} for update;select 'PAGE_HELD';`);await holder.held();
   const refused=run(`begin isolation level ${iso};set local statement_timeout='2s';set local lock_timeout='5s';${claims}${read};commit;`);
   assert.notEqual(refused.status,0);assert.match(refused.stderr,/40001:/);assert.doesNotMatch(refused.stderr,/57014:|lock timeout/);
   if(target==='contact'&&iso==='read committed'){
    const replacement=definition.replace('create function public.reception_contact_links','create or replace function public.reception_contact_links');
    try{ok(run(replacement.replaceAll('for share nowait','for share')));const waiting=run(`begin;set local statement_timeout='500ms';set local lock_timeout='2s';${claims}${read};commit;`);assert.notEqual(waiting.status,0);assert.match(waiting.stderr,/57014:/);checks.push('contact NOWAIT removal is detected by statement cancellation control');}
    finally{ok(run(replacement));}
   }
   ok(await holder.end('rollback;'));assert.equal(JSON.parse(ok(run(`begin;${claims}${read};commit;`))).items.length,0);
   checks.push(iso+': '+target+' held first refuses immediately with 40001, then succeeds after release');
  }finally{await holder.end('rollback;');}
 }
 const stale=session();try{
  stale.send(`begin isolation level repeatable read;select count(*) from public.clinic_members;select 'PAGE_HELD';`);await stale.held();
  ok(run(`update public.clinic_members set role='doctor' where clinic_id='${clinic}' and user_id='${admin}';`));
  const old=await stale.end(claims+read+';commit;');assert.notEqual(old.status,0);assert.match(old.stderr,/40001:/);
  const fresh=run(`begin;${claims}${read};commit;`);assert.notEqual(fresh.status,0);assert.match(fresh.stderr,/42501:/);
  checks.push('RR old authority snapshot refuses; new transaction cannot read after admin role removal');
 }finally{await stale.end('rollback;');}
 return checks;
}
