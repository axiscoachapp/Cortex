import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Standalone runs ALWAYS own a new disposable database. No hosted credentials.
// Until T27/2 is implemented this opt-in regression is expected to exit nonzero.
const docker = (args, input) => spawnSync('docker', args, {input, encoding:'utf8', windowsHide:true, timeout:30000, maxBuffer:16*1024*1024});
const required = (result) => {assert.equal(result.status,0,result.stderr || result.error?.message);return result.stdout.trim();};
const bounds = "set statement_timeout='5s';set lock_timeout='1s';";
const claims = (actor) => `set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
const trusted = "set local role service_role;set local request.jwt.claim.role='service_role';";
const deletionRefusal = /ERROR:\s+55000: Account deletion in progress/;
const busyEpoch = /ERROR:\s+40001: Custody changed concurrently; retry the transaction/;
const staleEpoch = /ERROR:\s+40001: could not serialize access due to concurrent update/;

function session(container) {
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true,timeout:12000});
 let output='',errors='';const listeners=new Set();
 child.stdout.on('data',chunk=>{output+=chunk;for(const notify of listeners)notify();});
 child.stderr.on('data',chunk=>{errors+=chunk;});
 const done=new Promise((resolveDone,reject)=>{child.once('error',reject);child.once('close',code=>resolveDone({status:code,stdout:output,stderr:errors}));});
 child.stdin.on('error',()=>{}); // A rejected SQL statement can close psql before end().
 const send=sql=>child.stdin.write(sql+'\n');
 send(bounds);
 return {
  send,
  wait: marker=>new Promise((resolveMarker,reject)=>{
   const cleanup=()=>{clearTimeout(timer);listeners.delete(check);};
   const check=()=>{if(output.includes(marker)){cleanup();resolveMarker();}};
   const timer=setTimeout(()=>{cleanup();child.kill();reject(new Error('Timed out before '+marker));},10000);
   listeners.add(check);check();
   done.then(()=>{if(!output.includes(marker)){cleanup();reject(new Error('Session ended before '+marker+': '+errors));}},reject);
  }),
  finish: async sql=>{
   send(sql);child.stdin.end();
   let timer;
   try{return await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error('Session did not finish'));},10000);})]);}
   finally{clearTimeout(timer);}
  },
  close: ()=>{child.stdin.end();child.kill();},
 };
}

async function testReceptionDeletionConcurrency(container) {
 assert.match(container,/^cortex-deletion-race-[a-z0-9-]+$/,'Unexpected owned test container name');
 const sqlResult=source=>docker(['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],bounds+source);
 const sql=source=>required(sqlResult(source));
 const admin='e9100000-0000-4000-8000-000000000001',clinic='e9200000-0000-4000-8000-000000000001',contact='e9300000-0000-4000-8000-000000000001';
 const doctors=[2,3,4,5].map(n=>`e9100000-0000-4000-8000-${String(n).padStart(12,'0')}`);
 sql(`insert into auth.users(id,email) values('${admin}','race-custody-admin@example.invalid'),${doctors.map((id,n)=>`('${id}','race-custody-${n}@example.invalid')`).join(',')};
  insert into public.clinics(id,name,created_by) values('${clinic}','Clínica sintética concorrência','${admin}');
  insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${admin}','admin','active'),${doctors.map(id=>`('${clinic}','${id}','doctor','active')`).join(',')};
  insert into public.clinic_contacts(id,clinic_id,name,created_by,request_id) values('${contact}','${clinic}','Contato sintético','${admin}',gen_random_uuid());`);
 const intent=id=>`insert into public.account_deletion_requests(user_id) values('${id}');`;
 const writeCase=id=>`insert into public.reception_cases(clinic_id,contact_id,doctor_user_id,subject,kind,created_by,request_id) values('${clinic}','${contact}','${id}','Caso sintético concorrente','scheduling','${admin}',gen_random_uuid());`;
 const outcomes=[];
 function record(name,id,results,refusal,expectedIntent) {
  const rejected=results.filter(r=>r.status!==0);
  for(const result of rejected)assert.match(result.stderr,refusal,'Unexpected SQL failure: '+result.stderr);
  const [intentPresent,referencePresent]=sql(`select exists(select 1 from public.account_deletion_requests where user_id='${id}'),
   (exists(select 1 from public.reception_cases where doctor_user_id='${id}') or exists(select 1 from public.clinic_contacts where created_by='${id}'));`).split('|').map(v=>v==='t');
  const unsafe=intentPresent && referencePresent;
  if(!unsafe){
   assert.equal(rejected.length,1,'Safety requires an explicit refusal, not a silent no-op');
   assert.equal(intentPresent,expectedIntent,'Wrong transaction survived');
   assert.equal(referencePresent,!expectedIntent,'Expected surviving reference missing');
  }
  const sqlstates=rejected.map(r=>r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)[1]);
  const outcome={scenario:name,unsafe,intentPresent,referencePresent,sqlstates};
  outcomes.push(outcome);process.stdout.write(JSON.stringify(outcome)+'\n');
 }
 // Confirmed intent must stop a privileged actor reference, even without a doctor field.
 const a=sqlResult('begin;'+intent(doctors[0])+'commit;');required(a);
 const b=sqlResult(`begin;${trusted}insert into public.clinic_contacts(clinic_id,name,created_by,request_id) values('${clinic}','Contato após intenção','${doctors[0]}',gen_random_uuid());commit;`);
 record('intent-before-service-actor',doctors[0],[a,b],deletionRefusal,true);

 // A committed intent must not overlook an uncommitted case that later commits.
 const writer=session(container);
 try {
  writer.send('begin;'+trusted+writeCase(doctors[1])+'\n\\echo CASE_HELD');
  await writer.wait('CASE_HELD');
  const marker=sqlResult('begin;'+intent(doctors[1])+'commit;');
  const written=await writer.finish('commit;');required(written);
  record('uncommitted-case-before-intent',doctors[1],[marker,written],busyEpoch,false);
 } finally {writer.close();}

 // The marker's old snapshot must not miss a newly committed restrictive case.
 const oldMarker=session(container);
 try {
  oldMarker.send('begin isolation level repeatable read;select count(*) from public.reception_cases;\n\\echo MARKER_SNAPSHOT');
  await oldMarker.wait('MARKER_SNAPSHOT');
  const written=sqlResult('begin;'+trusted+writeCase(doctors[2])+'commit;');required(written);
  const marker=await oldMarker.finish(intent(doctors[2])+'commit;');
  record('old-marker-snapshot',doctors[2],[written,marker],staleEpoch,false);
 } finally {oldMarker.close();}

 // Public RPC, not just service-role: an old writer must not bypass a new marker.
 const oldWriter=session(container);
 try {
  oldWriter.send('begin isolation level repeatable read;'+claims(admin)+'select count(*) from public.patients;\n\\echo WRITER_SNAPSHOT');
  await oldWriter.wait('WRITER_SNAPSHOT');
  const marker=sqlResult('begin;'+intent(doctors[3])+'commit;');required(marker);
  const written=await oldWriter.finish(`select public.reception_create_case('${contact}','${doctors[3]}','Caso RPC sintético','scheduling',gen_random_uuid());commit;`);
  record('old-public-writer-snapshot',doctors[3],[marker,written],staleEpoch,true);
 } finally {oldWriter.close();}
 assert.equal(outcomes.filter(r=>r.unsafe).length,0,'Deletion intent and restrictive reference both persisted: '+outcomes.filter(r=>r.unsafe).map(r=>r.scenario).join(', '));
 return outcomes;
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
 assert.ok(process.argv.slice(2).every(arg=>arg==='--prototype'),'Only --prototype is supported');
 const container=`cortex-deletion-race-${randomUUID().slice(0,8)}`;
 let ownsContainer=false;
 try {
  required(docker(['run','--detach','--rm','--name',container,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));
  ownsContainer=true;
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
   if(docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}
   await new Promise(resolveWait=>setTimeout(resolveWait,500));
  }
  assert.ok(ready,'Disposable database did not start');
  const apply=source=>required(docker(['exec','-i',container,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],source));
  apply(readFileSync('supabase/tests/bootstrap.sql','utf8'));
  for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort())apply(readFileSync(`supabase/migrations/${name}`,'utf8'));
  const prototype=process.argv.includes('--prototype');
  if(prototype)apply(readFileSync('supabase/tests/prototypes/reception-deletion-epoch.sql','utf8'));
  process.stdout.write(`Database mode: ${prototype?'test-only epoch prototype':'current migrations'}\n`);
  await testReceptionDeletionConcurrency(container);
 } finally {if(ownsContainer)required(docker(['stop',container]));}
}
