import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
const red=process.argv.includes('--red'),metadataRed=process.argv.includes('--metadata-red');assert.ok(process.argv.slice(2).every(arg=>['--red','--metadata-red'].includes(arg))&&process.argv.length<=3);assert.ok(!process.env.DOCKER_HOST,'No Docker host override');
const raw=(name,args,input)=>spawnSync(name,args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
const ok=result=>{assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout;};
// Pin the predecessor so RED and migration counts remain reproducible after commit.
const git=args=>ok(raw('git',args)),baseline=git(['rev-parse','0a7681490afbaf29114d6c99a0c192b74b637f6a']).trim();
const context=ok(raw('docker',['context','show'])).trim(),endpoint=JSON.parse(ok(raw('docker',['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}'])));assert.match(endpoint,/^(npipe:\/{2,}\.\/pipe\/[^/]+|unix:\/\/\/.*)$/);
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,input)=>spawnSync('docker',['--host',endpoint,...args],{input,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
const migration='supabase/migrations/20261105250000_reception_legacy_cancellation.sql',suite='supabase/tests/reception-invalid-intervals.test.sql';
const paths=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).trim().split('\n').filter(path=>path.endsWith('.sql')).sort(),sources=new Map(paths.map(path=>[path,git(['show',baseline+':'+path])]));
sources.set('supabase/tests/bootstrap.sql',git(['show',baseline+':supabase/tests/bootstrap.sql']));sources.set(suite,readFileSync(suite,'utf8'));if(!red)sources.set(migration,readFileSync(migration,'utf8'));
const runnerPath='scripts/test-reception-invalid-intervals.mjs';sources.set(runnerPath,readFileSync(runnerPath,'utf8'));
const suites=['reception-calendar','reception-appointment-changes','reception-clinic-boundary','reception-appointment-identity','reception-link-state','reception-link-state-permissions','reception-function-boundaries','reception-scope-lifecycle'];
for(const name of suites){const path='supabase/tests/'+name+'.test.sql';sources.set(path,git(['show',baseline+':'+path]));}
const name='cortex-invalid-interval-'+randomUUID().slice(0,8),db=name+'-db';let network=false,container=false,report;
try{
 ok(docker(['network','create','--internal','--label','cortex.test.run='+name,name]));network=true;
 ok(docker(['run','--detach','--pull=never','--name',db,'--network',name,'--label','cortex.test.run='+name,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));container=true;
 let ready=false;for(let i=0;i<60;i++){if(docker(['exec',db,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(done=>setTimeout(done,300));}assert.ok(ready);
 const sql=source=>docker(['exec','-i',db,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],"set statement_timeout='20s';set lock_timeout='3s';\n"+source);
 ok(sql([sources.get('supabase/tests/bootstrap.sql'),...paths.flatMap(path=>['\\connect postgres postgres',sources.get(path)])].join('\n')));
 let metadataControl;
 if(!red){
  let source=sources.get(migration);
  if(metadataRed){
   const original=source;let replacements=0;
   source=source.replace(/changed:=[\s\S]*?(?=\n  new\.revision)/,part=>part.replace(/'google_sync_revision',/g,()=>{replacements++;return '';}));
   assert.equal(replacements,2,'Metadata control must remove only the two changed exclusions');assert.notEqual(source,original);
   metadataControl={originalSha256:createHash('sha256').update(original).digest('hex'),mutantSha256:createHash('sha256').update(source).digest('hex')};
  }ok(sql(source));
 }
 const result=sql(sources.get(suite));
 if(metadataRed){assert.notEqual(result.status,0,'Expected metadata classification regression');assert.match(result.stderr,/P0004: Cancelled metadata update changed business revision/);report={metadataRed:true,metadataControl,error:result.stderr.trim().slice(0,2600)};}
 else if(red){assert.notEqual(result.status,0,'Expected legacy cancellation failure');assert.match(result.stderr,/22023: Intervalo de horário inválido/);assert.match(result.stderr,/reception_change_appointment/);report={red:true,blockedCancellation:true,error:result.stderr.trim().slice(0,2600)};}
 else{ok(result);for(const name of suites)ok(sql(sources.get('supabase/tests/'+name+'.test.sql')));report={passed:true,suites:[suite,...suites.map(name=>'supabase/tests/'+name+'.test.sql')]};}
 assert.equal(readFileSync(suite,'utf8'),sources.get(suite));if(!red)assert.equal(readFileSync(migration,'utf8'),sources.get(migration));
 assert.equal(readFileSync(runnerPath,'utf8'),sources.get(runnerPath));
 report={...report,syntheticOnly:true,baseline,migrations:paths.length+(red?0:1),sources:[...sources].map(([path,source])=>({path,sha256:createHash('sha256').update(source).digest('hex')}))};
}finally{
 if(container){assert.equal(ok(docker(['inspect','--format','{{index .Config.Labels "cortex.test.run"}}',db])).trim(),name);ok(docker(['rm','--force','--volumes',db]));assert.notEqual(docker(['inspect',db]).status,0);}
 if(network){assert.equal(ok(docker(['network','inspect','--format','{{index .Labels "cortex.test.run"}}',name])).trim(),name);ok(docker(['network','rm',name]));assert.notEqual(docker(['network','inspect',name]).status,0);}
}
const folder='docs/reviews/2026-11-05/legacy-cancellation';mkdirSync(folder,{recursive:true});writeFileSync(folder+'/'+(metadataRed?'METADATA_RED':red?'RED':'SQL')+'.json',JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');console.log(JSON.stringify({red,metadataRed,passed:report.passed,blockedCancellation:report.blockedCancellation,migrations:report.migrations,suites:report.suites,cleanupVerified:true}));
