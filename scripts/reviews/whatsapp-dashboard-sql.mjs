// Frozen C4 source, owned disposable local Docker, no published database or external network.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {cleanupOwnedContainer} from './whatsapp-k6-cleanup.mjs';
import {dashboardCases} from './whatsapp-dashboard-cases.mjs';

const args=process.argv.slice(2);
assert.ok(args.every(x=>/^--(baseline=[0-9a-f]{40}|run=[a-z0-9-]+)$/.test(x))&&new Set(args.map(x=>x.split('=')[0])).size===args.length,'Use one baseline and run');
const baseline=args.find(x=>x.startsWith('--baseline='))?.slice(11),run=args.find(x=>x.startsWith('--run='))?.slice(6);
assert.match(baseline??'',/^[0-9a-f]{40}$/);assert.match(run??'',/^[a-z0-9-]+$/);
const folder=resolve('docs/reviews/2026-11-07/whatsapp-dashboard',run);await mkdir(resolve(folder,'..'),{recursive:true});await mkdir(folder);
const command=(binary,values,input)=>spawnSync(binary,values,{input,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
const required=r=>{assert.equal(r.status,0,r.stderr||r.error?.message||r.stdout);return r.stdout;};
const sources=[],cache=new Map();
const source=path=>{if(cache.has(path))return cache.get(path);const text=required(command('git',['show',`${baseline}:${path}`]));sources.push({path,sha256:createHash('sha256').update(text).digest('hex')});cache.set(path,text);return text;};
const runtimePaths=['scripts/reviews/whatsapp-dashboard-sql.mjs','scripts/reviews/whatsapp-dashboard-cases.mjs','scripts/reviews/whatsapp-k6-cleanup.mjs'];
const runtimeSources=await Promise.all(runtimePaths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const docker=(values,input)=>command('docker',['--context','desktop-linux',...values],input);
assert.equal(JSON.parse(required(docker(['context','inspect','desktop-linux','--format','{{json .Endpoints.docker.Host}}'])).trim()),'npipe:////./pipe/dockerDesktopLinuxEngine');
const image=required(docker(['image','inspect','pgvector/pgvector:pg16','--format','{{.Id}}'])).trim();assert.match(image,/^sha256:[0-9a-f]{64}$/);
const name='cortex-k6-wa-'+randomUUID().slice(0,8);let id=null;
const sql=text=>docker(['exec','-i',id,'psql','-U','postgres','-v','ON_ERROR_STOP=1','--quiet'],"set statement_timeout='15s';set lock_timeout='10s';\n"+text);
const report={baseline,syntheticOnly:true,completed:false,accepted:false,image,migrations:0,suites:[],cases:[],sources,runtimeSources,cleanupVerified:false,failure:null};
try{
  id=required(docker(['run','--detach','--rm','--name',name,'--network','none','--env','POSTGRES_HOST_AUTH_METHOD=trust',image])).trim();assert.match(id,/^[0-9a-f]{64}$/);
  let ready=false;for(let n=0;n<60;n++){if(docker(['exec',id,'pg_isready','-U','postgres']).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready,'Local disposable PostgreSQL not ready');
  required(sql(source('supabase/tests/bootstrap.sql')));
  const paths=required(command('git',['ls-tree','-r','--name-only',baseline,'--','supabase/migrations'])).trim().split('\n').filter(p=>p.endsWith('.sql')).sort();
  for(const path of paths){required(sql(source(path)));report.migrations++;}
  for(const path of ['supabase/tests/whatsapp.test.sql','supabase/tests/whatsapp-dashboard.test.sql']){const r=sql(source(path));report.suites.push({path,passed:r.status===0,error:r.status===0?null:r.stderr});}
  const original=source('supabase/tests/whatsapp-dashboard.test.sql'),marker='do $$ declare a uuid; rec uuid';assert.ok(original.includes(marker),'Frozen synthetic seed marker changed');
  const seed=original.slice(0,original.indexOf(marker))+`create function pg_temp.sqlstate_of(q text) returns text language plpgsql as $$begin execute q;return 'ok';exception when others then return SQLSTATE;end $$;\n`;
  for(const [caseName,body] of dashboardCases){const r=sql(seed+body+'\nrollback;');const error=r.stderr?.match(/(?:ERROR|CONTEXT):[^\n]*/g)?.join('\n')??r.stderr;const category=r.status===0?'pass':error.includes('K2_')?'contract_failure':'fixture_failure';report.cases.push({name:caseName,passed:r.status===0,category,error:r.status===0?null:error});console.log(JSON.stringify(report.cases.at(-1)));}
  for(const x of runtimeSources)assert.equal(createHash('sha256').update(await readFile(x.path)).digest('hex'),x.sha256,'Executor changed during run');
  report.completed=!report.cases.some(c=>c.category==='fixture_failure');report.accepted=report.completed&&report.suites.every(s=>s.passed)&&report.cases.every(c=>c.passed);
}catch(error){report.failure=error.message;}
finally{report.cleanup=cleanupOwnedContainer({docker,name,id});report.cleanupVerified=report.cleanup.verified;report.accepted=report.accepted&&report.cleanupVerified;await writeFile(resolve(folder,'SQL.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({completed:report.completed,accepted:report.accepted,migrations:report.migrations,cases:report.cases.length,failed:report.cases.filter(c=>!c.passed),cleanupVerified:report.cleanupVerified,failure:report.failure}));
if(!report.accepted)process.exitCode=1;
