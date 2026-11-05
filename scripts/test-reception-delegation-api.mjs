import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
const red=process.argv.includes('--red'),types=process.argv.includes('--types');assert.ok(process.argv.slice(2).every(a=>['--red','--types'].includes(a))&&!(red&&types));
assert.ok(!process.env.DOCKER_HOST,'No Docker host override');
const raw=(command,args,input)=>spawnSync(command,args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
const ok=r=>{assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;};
const git=args=>ok(raw('git',args));const baseline=git(['rev-parse','f716e68']).trim();
const context=ok(raw('docker',['context','show'])).trim(),endpoint=JSON.parse(ok(raw('docker',['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}'])));
assert.match(endpoint,/^(npipe:\/{2,}\.\/pipe\/[^/]+|unix:\/\/\/.*)$/);
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,input)=>spawnSync('docker',['--host',endpoint,...args],{input,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
const prefix='cortex-delegation-api-'+randomUUID().slice(0,8),db=prefix+'-db',meta=prefix+'-meta';
const migration='supabase/migrations/20261105200000_reception_delegation_api.sql',suite='supabase/tests/reception-delegation-api.test.sql';
const paths=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).trim().split('\n').filter(p=>p.endsWith('.sql')).sort();
const sources=new Map(paths.map(p=>[p,git(['show',baseline+':'+p])]));
sources.set('supabase/tests/bootstrap.sql',git(['show',baseline+':supabase/tests/bootstrap.sql']));
sources.set(suite,readFileSync(suite,'utf8'));if(!red)sources.set(migration,readFileSync(migration,'utf8'));
const extras=['reception-delegation-requests','reception-delegation-decisions','reception-provisioning-requests','reception-function-boundaries'];
if(!red)for(const name of extras){const p='supabase/tests/'+name+'.test.sql';sources.set(p,name==='reception-function-boundaries'?readFileSync(p,'utf8'):git(['show',baseline+':'+p]));}
let started=false,network=false,report;
try{
 ok(docker(['network','create','--internal','--label','cortex.test.run='+prefix,prefix]));network=true;
 ok(docker(['run','--detach','--pull=never','--name',db,'--label','cortex.test.run='+prefix,'--network',prefix,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));started=true;
 let ready=false;for(let n=0;n<60;n++){if(docker(['exec',db,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(done=>setTimeout(done,300));}assert.ok(ready);
 const sql=s=>docker(['exec','-i',db,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],"set statement_timeout='20s';set lock_timeout='3s';\n"+s);
 const batch=[sources.get('supabase/tests/bootstrap.sql'),...paths.flatMap(p=>['\\connect postgres postgres',sources.get(p)])].join('\n');ok(sql(batch));
 if(!red)ok(sql(sources.get(migration)));
 const result=sql(sources.get(suite));
 if(red){assert.notEqual(result.status,0);assert.match(result.stderr,/42883/);report={red:true,missingAuthenticatedApi:true};}
 else{ok(result);for(const name of extras)ok(sql(sources.get('supabase/tests/'+name+'.test.sql')));report={passed:true,suites:[suite,...extras.map(n=>'supabase/tests/'+n+'.test.sql')]};}
 if(types){
  const generated=ok(docker(['run','--rm','--pull=never','--name',meta,'--label','cortex.test.run='+prefix,'--network','container:'+db,
   '--env','PG_META_DB_HOST=127.0.0.1','--env','PG_META_GENERATE_TYPES=typescript','--env','PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public',
   '--env','PG_META_POSTGREST_VERSION=12','--env','PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true','public.ecr.aws/supabase/postgres-meta:v0.95.2']));
  assert.ok(generated.includes('export type Database')&&generated.includes('reception_decide_delegation'));
  writeFileSync('src/integrations/supabase/types.ts',generated.trimEnd()+'\n');report.generatedTypes=true;
 }
 for(const path of [suite,...(red?[]:[migration,'supabase/tests/reception-function-boundaries.test.sql'])])assert.equal(readFileSync(path,'utf8'),sources.get(path),'Test source changed during execution: '+path);
 report={...report,syntheticOnly:true,baseline,migrations:paths.length+(red?0:1),sources:[...sources].map(([path,source])=>({path,sha256:createHash('sha256').update(source).digest('hex')}))};
}finally{
 const metaState=docker(['inspect','--format','{{index .Config.Labels "cortex.test.run"}}',meta]);
 if(metaState.status===0){assert.equal(metaState.stdout.trim(),prefix);ok(docker(['rm','--force','--volumes',meta]));}assert.notEqual(docker(['inspect',meta]).status,0);
 if(started){assert.equal(ok(docker(['inspect','--format','{{index .Config.Labels "cortex.test.run"}}',db])).trim(),prefix);ok(docker(['rm','--force','--volumes',db]));assert.notEqual(docker(['inspect',db]).status,0);}
 if(network){assert.equal(ok(docker(['network','inspect','--format','{{index .Labels "cortex.test.run"}}',prefix])).trim(),prefix);ok(docker(['network','rm',prefix]));assert.notEqual(docker(['network','inspect',prefix]).status,0);}
}
report.cleanupVerified=true;
const folder='docs/reviews/2026-11-05/reception-delegation-api';mkdirSync(folder,{recursive:true});writeFileSync(folder+'/'+(red?'RED':'SQL')+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({red,passed:report.passed,missingAuthenticatedApi:report.missingAuthenticatedApi,migrations:report.migrations,suites:report.suites,cleanupVerified:true},null,2));
