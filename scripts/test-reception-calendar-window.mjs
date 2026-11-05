import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
const red=process.argv.includes('--red');assert.ok(process.argv.slice(2).every(arg=>arg==='--red')&&process.argv.length<=3);assert.ok(!process.env.DOCKER_HOST,'No Docker host override');
const raw=(name,args,input)=>spawnSync(name,args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024}),ok=result=>{assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout;};
const git=args=>ok(raw('git',args)),baseline=git(['rev-parse','dc3e99368dd5481504819dafa6911035381a8829']).trim();
const context=ok(raw('docker',['context','show'])).trim(),endpoint=JSON.parse(ok(raw('docker',['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}'])));assert.match(endpoint,/^(npipe:\/{2,}\.\/pipe\/[^/]+|unix:\/\/\/.*)$/);
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,input)=>spawnSync('docker',['--host',endpoint,...args],{input,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
const migration='supabase/migrations/20261105260000_reception_calendar_window.sql',suite='supabase/tests/reception-calendar-window.test.sql',runner='scripts/test-reception-calendar-window.mjs';
const paths=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).trim().split('\n').filter(path=>path.endsWith('.sql')).sort(),sources=new Map(paths.map(path=>[path,git(['show',baseline+':'+path])]));
sources.set('supabase/tests/bootstrap.sql',git(['show',baseline+':supabase/tests/bootstrap.sql']));for(const path of [suite,runner,...(red?[]:[migration])])sources.set(path,readFileSync(path,'utf8'));
const suites=['reception-invalid-intervals','reception-calendar','reception-appointment-changes','reception-clinic-boundary','reception-appointment-identity','reception-link-state','reception-link-state-permissions','reception-function-boundaries','reception-scope-lifecycle'];
for(const name of suites){const path='supabase/tests/'+name+'.test.sql';sources.set(path,git(['show',baseline+':'+path]));}
const name='cortex-calendar-window-'+randomUUID().slice(0,8),db=name+'-db';let network=false,container=false,report;
try{
 ok(docker(['network','create','--internal','--label','cortex.test.run='+name,name]));network=true;
 ok(docker(['run','--detach','--pull=never','--name',db,'--network',name,'--label','cortex.test.run='+name,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));container=true;
 let ready=false;for(let i=0;i<60;i++){if(docker(['exec',db,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(done=>setTimeout(done,300));}assert.ok(ready);
 const sql=(source,seconds=20)=>docker(['exec','-i',db,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],`set statement_timeout='${seconds}s';set lock_timeout='3s';\n`+source);
 ok(sql([sources.get('supabase/tests/bootstrap.sql'),...paths.flatMap(path=>['\\connect postgres postgres',sources.get(path)])].join('\n')));
 if(!red)ok(sql(sources.get(migration)));
 const started=Date.now(),result=sql(sources.get(suite),60),windowSuiteMs=Date.now()-started;
 if(red){assert.notEqual(result.status,0);assert.match(result.stderr,/P0004: Zero interval at lower bound was hidden/);report={red:true,boundaryRecordHidden:true,error:result.stderr.trim().slice(0,1800)};}
 else{ok(result);for(const name of suites)ok(sql(sources.get('supabase/tests/'+name+'.test.sql')));report={passed:true,suites:[suite,...suites.map(name=>'supabase/tests/'+name+'.test.sql')],windowSuiteMs};}
 for(const path of [suite,runner,...(red?[]:[migration])])assert.equal(readFileSync(path,'utf8'),sources.get(path));
 report={...report,syntheticOnly:true,baseline,migrations:paths.length+(red?0:1),sources:[...sources].map(([path,source])=>({path,sha256:createHash('sha256').update(source).digest('hex')}))};
}finally{
 if(container){assert.equal(ok(docker(['inspect','--format','{{index .Config.Labels "cortex.test.run"}}',db])).trim(),name);ok(docker(['rm','--force','--volumes',db]));assert.notEqual(docker(['inspect',db]).status,0);}
 if(network){assert.equal(ok(docker(['network','inspect','--format','{{index .Labels "cortex.test.run"}}',name])).trim(),name);ok(docker(['network','rm',name]));assert.notEqual(docker(['network','inspect',name]).status,0);}
}
const folder='docs/reviews/2026-11-05/calendar-window';mkdirSync(folder,{recursive:true});writeFileSync(folder+'/'+(red?'RED':'SQL')+'.json',JSON.stringify({...report,cleanupVerified:true},null,2)+'\n');console.log(JSON.stringify({red,passed:report.passed,boundaryRecordHidden:report.boundaryRecordHidden,migrations:report.migrations,suites:report.suites,windowSuiteMs:report.windowSuiteMs,cleanupVerified:true}));
