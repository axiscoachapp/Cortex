import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
const red=process.argv.includes('--red'),types=process.argv.includes('--types'),reactivation=process.argv.includes('--reactivation'),withdrawal=process.argv.includes('--withdrawal'),provenance=withdrawal||process.argv.includes('--provenance');assert.ok(process.argv.slice(2).every(a=>['--red','--types','--reactivation','--provenance','--withdrawal'].includes(a))&&!(red&&types)&&!(reactivation&&(red||types||provenance)));
assert.ok(!process.env.DOCKER_HOST,'No Docker host override');
const raw=(command,args,input)=>spawnSync(command,args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
const ok=r=>{assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;};
const git=args=>ok(raw('git',args));const baseline=git(['rev-parse','f716e68']).trim();
const context=ok(raw('docker',['context','show'])).trim(),endpoint=JSON.parse(ok(raw('docker',['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}'])));
assert.match(endpoint,/^(npipe:\/{2,}\.\/pipe\/[^/]+|unix:\/\/\/.*)$/);
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,input)=>spawnSync('docker',['--host',endpoint,...args],{input,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
const prefix='cortex-delegation-api-'+randomUUID().slice(0,8),db=prefix+'-db',meta=prefix+'-meta';
const migration='supabase/migrations/20261105200000_reception_delegation_api.sql',provenanceMigration='supabase/migrations/20261105210000_reception_access_provenance.sql',withdrawalMigration='supabase/migrations/20261105220000_reception_card_withdrawal.sql',suite='supabase/tests/'+(withdrawal?'reception-card-withdrawal':provenance?'reception-access-provenance':'reception-delegation-api')+'.test.sql';
const paths=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).trim().split('\n').filter(p=>p.endsWith('.sql')).sort();
const sources=new Map(paths.map(p=>[p,git(['show',baseline+':'+p])]));
sources.set('supabase/tests/bootstrap.sql',git(['show',baseline+':supabase/tests/bootstrap.sql']));
const overlays=new Set([suite]);
const capture=p=>{sources.set(p,readFileSync(p,'utf8'));overlays.add(p);};
capture(suite);if(!red||provenance)capture(migration);if(provenance&&(!red||withdrawal))capture(provenanceMigration);if(withdrawal&&!red)capture(withdrawalMigration);
const extras=['reception-delegation-requests','reception-delegation-decisions','reception-provisioning-requests','reception-function-boundaries'];
if(reactivation)extras.push('reception-staff-reactivation','reception-staff-lifecycle','reception-scope-lifecycle');
if(provenance)extras.push('reception-delegation-api','reception-staff-reactivation','reception-staff-lifecycle','reception-scope-lifecycle');
if(withdrawal)extras.push('reception-access-provenance');
if(!red)for(const name of extras){
 const p='supabase/tests/'+name+'.test.sql';
 // Historical modes must use the catalog matching their installed API surface.
 if(name==='reception-function-boundaries'&&!withdrawal)sources.set(p,git(['show',(provenance?'0dbe1d8':'b3e9879')+':'+p]));
 else if(['reception-function-boundaries','reception-staff-reactivation','reception-delegation-api','reception-access-provenance'].includes(name))capture(p);
 else sources.set(p,git(['show',baseline+':'+p]));
}
let started=false,network=false,report;
try{
 ok(docker(['network','create','--internal','--label','cortex.test.run='+prefix,prefix]));network=true;
 ok(docker(['run','--detach','--pull=never','--name',db,'--label','cortex.test.run='+prefix,'--network',prefix,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));started=true;
 let ready=false;for(let n=0;n<60;n++){if(docker(['exec',db,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(done=>setTimeout(done,300));}assert.ok(ready);
 const sql=s=>docker(['exec','-i',db,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],"set statement_timeout='20s';set lock_timeout='3s';\n"+s);
 const batch=[sources.get('supabase/tests/bootstrap.sql'),...paths.flatMap(p=>['\\connect postgres postgres',sources.get(p)])].join('\n');ok(sql(batch));
 if(!red||provenance)ok(sql(sources.get(migration)));
 if(provenance&&(!red||withdrawal))ok(sql(sources.get(provenanceMigration)));
 if(withdrawal&&!red)ok(sql(sources.get(withdrawalMigration)));
 const result=sql(sources.get(suite));
 if(red){assert.notEqual(result.status,0);assert.match(result.stderr,/42883/);report={red:true,missingAuthenticatedApi:true};}
 else{ok(result);for(const name of extras)ok(sql(sources.get('supabase/tests/'+name+'.test.sql')));report={passed:true,suites:[suite,...extras.map(n=>'supabase/tests/'+n+'.test.sql')]};}
 if(types){
  const generated=ok(docker(['run','--rm','--pull=never','--name',meta,'--label','cortex.test.run='+prefix,'--network','container:'+db,
   '--env','PG_META_DB_HOST=127.0.0.1','--env','PG_META_GENERATE_TYPES=typescript','--env','PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public',
   '--env','PG_META_POSTGREST_VERSION=12','--env','PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true','public.ecr.aws/supabase/postgres-meta:v0.95.2']));
  assert.ok(generated.includes('export type Database')&&generated.includes(withdrawal?'reception_delegation_withdrawal':provenance?'reception_staff_permissions':'reception_decide_delegation'));
  writeFileSync('src/integrations/supabase/types.ts',generated.trimEnd()+'\n');report.generatedTypes=true;
 }
 for(const path of overlays)assert.equal(readFileSync(path,'utf8'),sources.get(path),'Test source changed during execution: '+path);
 report={...report,syntheticOnly:true,baseline,migrations:paths.length+(red&&!provenance?0:1)+(provenance&&(!red||withdrawal)?1:0)+(withdrawal&&!red?1:0),sources:[...sources].map(([path,source])=>({path,sha256:createHash('sha256').update(source).digest('hex')}))};
}finally{
 const metaState=docker(['inspect','--format','{{index .Config.Labels "cortex.test.run"}}',meta]);
 if(metaState.status===0){assert.equal(metaState.stdout.trim(),prefix);ok(docker(['rm','--force','--volumes',meta]));}assert.notEqual(docker(['inspect',meta]).status,0);
 if(started){assert.equal(ok(docker(['inspect','--format','{{index .Config.Labels "cortex.test.run"}}',db])).trim(),prefix);ok(docker(['rm','--force','--volumes',db]));assert.notEqual(docker(['inspect',db]).status,0);}
 if(network){assert.equal(ok(docker(['network','inspect','--format','{{index .Labels "cortex.test.run"}}',prefix])).trim(),prefix);ok(docker(['network','rm',prefix]));assert.notEqual(docker(['network','inspect',prefix]).status,0);}
}
report.cleanupVerified=true;
const folder='docs/reviews/2026-11-05/'+(withdrawal?'reception-card-withdrawal':provenance?'reception-access-provenance':reactivation?'reception-staff-reactivation':'reception-delegation-api');mkdirSync(folder,{recursive:true});writeFileSync(folder+'/'+(red?'RED':'SQL')+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({red,passed:report.passed,missingAuthenticatedApi:report.missingAuthenticatedApi,migrations:report.migrations,suites:report.suites,cleanupVerified:true},null,2));
