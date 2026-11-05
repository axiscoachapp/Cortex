// Profile the actual RPC and its actual inner page query, on synthetic data only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
const measure=process.argv.includes('--measure');assert.ok(process.argv.slice(2).every(arg=>arg==='--measure')&&process.argv.length<=3);assert.ok(!process.env.DOCKER_HOST);
const raw=(name,args,input)=>spawnSync(name,args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:24*1024*1024}),ok=result=>{assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout.trim();};
const git=args=>ok(raw('git',args)),baseline='be5b04ed81855b355a5fbb88d8bc5875d68158d6';
const context=ok(raw('docker',['context','show'])),endpoint=JSON.parse(ok(raw('docker',['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}'])));assert.match(endpoint,/^(npipe:\/{2,}\.\/pipe\/[^/]+|unix:\/\/\/.*)$/);
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,input)=>spawnSync('docker',['--host',endpoint,...args],{input,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:24*1024*1024});
const migration='supabase/migrations/20261105270000_reception_calendar_scope.sql',runner='scripts/test-reception-calendar-scope.mjs',seed='supabase/tests/reception-calendar-window.test.sql';
const paths=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).split('\n').filter(path=>path.endsWith('.sql')).sort(),sources=new Map(paths.map(path=>[path,git(['show',baseline+':'+path])]));
sources.set('supabase/tests/bootstrap.sql',git(['show',baseline+':supabase/tests/bootstrap.sql']));sources.set(seed,git(['show',baseline+':'+seed]));sources.set(runner,readFileSync(runner,'utf8'));if(!measure)sources.set(migration,readFileSync(migration,'utf8'));
const suites=['reception-calendar-window','reception-invalid-intervals','reception-calendar','reception-appointment-changes','reception-clinic-boundary','reception-appointment-identity','reception-link-state','reception-link-state-permissions','reception-function-boundaries','reception-scope-lifecycle'];
for(const name of suites){const path='supabase/tests/'+name+'.test.sql';sources.set(path,git(['show',baseline+':'+path]));}
const name='cortex-calendar-scope-'+randomUUID().slice(0,8),db=name+'-db';let network=false,container=false,report;
try{
 ok(docker(['network','create','--internal','--label','cortex.test.run='+name,name]));network=true;
 ok(docker(['run','--detach','--pull=never','--name',db,'--network',name,'--label','cortex.test.run='+name,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));container=true;
 let ready=false;for(let i=0;i<60;i++){if(docker(['exec',db,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(done=>setTimeout(done,300));}assert.ok(ready);
 const sql=source=>docker(['exec','-i',db,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],"set statement_timeout='60s';set lock_timeout='3s';\n"+source),run=source=>ok(sql(source));
 run([sources.get('supabase/tests/bootstrap.sql'),...paths.flatMap(path=>['\\connect postgres postgres',sources.get(path)])].join('\n'));
 const marker='-- Seed corruption only in this owned disposable transaction';assert.equal(sources.get(seed).split(marker).length,2);run(sources.get(seed).split(marker)[0]+'\ncommit;');
 const refs=JSON.parse(run("select jsonb_build_object('clinic',a.clinic_id,'patientA',a.patient_id,'contactA',a.contact_id,'patientC',(select patient_id from public.appointments where user_id='e1100000-0000-4000-8000-000000000003'),'contactC',(select contact_id from public.appointments where user_id='e1100000-0000-4000-8000-000000000003')) from public.appointments a where user_id='e1100000-0000-4000-8000-000000000001';"));for(const value of Object.values(refs))assert.match(value,/^[0-9a-f-]{36}$/);
 run(`begin;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
 alter table public.appointments disable trigger zz_reception_appointment_guard;
 insert into public.appointments(user_id,patient_id,contact_id,clinic_id,title,start_time,end_time) select 'e1100000-0000-4000-8000-000000000001','${refs.patientA}','${refs.contactA}','${refs.clinic}','Synthetic permitted profile','2099-12-15T13:00Z','2099-12-15T13:30Z' from generate_series(1,20);
 set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000003';
 insert into public.appointments(user_id,patient_id,contact_id,clinic_id,title,start_time,end_time) select 'e1100000-0000-4000-8000-000000000003','${refs.patientC}','${refs.contactC}','${refs.clinic}','Synthetic undelegated profile','2099-12-15T13:00Z','2099-12-15T13:30Z' from generate_series(1,1000);
 insert into auth.users(id,email) select md5('synthetic-profile-owner-'||n)::uuid,'synthetic-profile-'||n||'@example.invalid' from generate_series(1,100) n;
 insert into public.appointments(user_id,title,start_time,end_time) select md5('synthetic-profile-owner-'||n)::uuid,'Synthetic private profile','2099-12-15T13:00Z','2099-12-15T13:30Z' from generate_series(1,100) n cross join generate_series(1,40) each_row;
 alter table public.appointments enable trigger zz_reception_appointment_guard;commit;analyze public.appointments;analyze public.clinic_members;analyze public.staff_doctor_scopes;`);
 const claims="set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='e1100000-0000-4000-8000-000000000002';";
 const args=`'${refs.clinic}'::uuid,'2099-12-15T03:00Z'::timestamptz,'2099-12-16T03:00Z'::timestamptz,null::uuid`,rpc=`public.reception_appointments(${args})`;
 const result=()=>JSON.parse(run('set role authenticated;'+claims+`select ${rpc};`));
 const beforeResult=result();assert.equal(beforeResult.items.length,21);assert.ok(beforeResult.items.every(item=>item.doctorId==='e1100000-0000-4000-8000-000000000001'));
 function profile(){
  const samples=[];for(let i=0;i<3;i++){
   const plan=JSON.parse(run(claims+`set track_functions='all';set plan_cache_mode='force_generic_plan';select pg_stat_reset();explain(analyze,buffers,format json) select ${rpc};select pg_stat_force_next_flush();`));
   const calls=Number(run("select coalesce((select calls from pg_stat_user_functions where funcid='public.reception_scope_ok(uuid,uuid)'::regprocedure),0);"));assert.ok(calls>0,'Function statistics were not collected');samples.push({executionMs:plan[0]['Execution Time'],scopeCalls:calls});
  }
  const definition=run("select pg_get_functiondef('public.reception_appointments(uuid,timestamptz,timestamptz,uuid)'::regprocedure);");
  const inner=definition.match(/select a\.id,[\s\S]+?order by a\.start_time,a\.id limit 1001/i)?.[0];assert.ok(inner);
  const page=inner.replace(/\bp_clinic\b/g,'$1').replace(/\bp_start\b/g,'$2').replace(/\bp_end\b/g,'$3').replace(/\bp_doctor\b/g,'$4').replace(/\bscoped_doctors\b/g,'$5');
  const plan=JSON.parse(run(claims+`set plan_cache_mode='force_generic_plan';prepare profile_page(uuid,timestamptz,timestamptz,uuid,uuid[]) as ${page};explain(analyze,buffers,format json) execute profile_page(${args},array['e1100000-0000-4000-8000-000000000001'::uuid]);`));
  const scans=[];function walk(node,appointmentBranch=false){const own=node['Relation Name']==='appointments',branch=own||appointmentBranch;if(own||(branch&&node['Node Type']==='Bitmap Index Scan'))scans.push({type:node['Node Type'],index:node['Index Name'],indexCond:node['Index Cond'],actualRows:node['Actual Rows'],rowsRemoved:node['Rows Removed by Filter'],sharedHitBlocks:node['Shared Hit Blocks'],sharedReadBlocks:node['Shared Read Blocks']});for(const child of node.Plans??[])walk(child,branch);}walk(plan[0].Plan);
  return {samples,scans,innerPlan:plan};
 }
 const before=profile();
 if(!measure){
  run(sources.get(migration));const afterResult=result();assert.deepEqual(afterResult,beforeResult,'Scoped prefilter changed authorized payload');const after=profile();assert.ok(Math.max(...after.samples.map(sample=>sample.scopeCalls))<=10,'Scope calls exceeded the synthetic membership budget');assert.ok(Math.max(...after.samples.map(sample=>sample.scopeCalls))<Math.min(...before.samples.map(sample=>sample.scopeCalls)),'Scope calls did not decrease');assert.ok(after.scans.some(scan=>scan.indexCond?.includes('user_id')),'Scoped page did not use a doctor index condition: '+JSON.stringify(after.scans));
  // Remove only the owned synthetic fixture before transaction-scoped regressions.
  run('truncate public.clinics,auth.users cascade;');for(const name of suites)run(sources.get('supabase/tests/'+name+'.test.sql'));report={passed:true,before,after,suites:suites.map(name=>'supabase/tests/'+name+'.test.sql')};
 }else report={measurementOnly:true,before};
 for(const path of [runner,...(measure?[]:[migration])])assert.equal(readFileSync(path,'utf8'),sources.get(path));
 report={...report,syntheticOnly:true,baseline,fixture:{appointments:5023,permitted:21,undelegatedSameClinic:1001,foreignPrivate:4000},migrations:paths.length+(measure?0:1),sources:[...sources].map(([path,source])=>({path,sha256:createHash('sha256').update(source).digest('hex')}))};
}finally{
 if(container){assert.equal(ok(docker(['inspect','--format','{{index .Config.Labels "cortex.test.run"}}',db])),name);ok(docker(['rm','--force','--volumes',db]));assert.notEqual(docker(['inspect',db]).status,0);}
 if(network){assert.equal(ok(docker(['network','inspect','--format','{{index .Labels "cortex.test.run"}}',name])),name);ok(docker(['network','rm',name]));assert.notEqual(docker(['network','inspect',name]).status,0);}
}
const folder='docs/reviews/2026-11-05/calendar-scope';mkdirSync(folder,{recursive:true});writeFileSync(folder+'/'+(measure?'MEASUREMENT':'SQL')+'.json',JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');console.log(JSON.stringify({passed:report.passed,measurementOnly:report.measurementOnly,before:report.before.samples,after:report.after?.samples,scans:report.after?.scans??report.before.scans,migrations:report.migrations,cleanupVerified:true}));
