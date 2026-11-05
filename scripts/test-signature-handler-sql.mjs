import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const args=process.argv.slice(2);assert.ok(args.length===1&&/^--source=[0-9a-f]{40}$/.test(args[0]));
const baseline=args[0].slice(9),runner='scripts/test-signature-handler-sql.mjs',probe='supabase/tests/prototypes/signature-handler-resume.sql';
const hash=s=>createHash('sha256').update(s).digest('hex'),own=[runner,probe].map(path=>({path,sha256:hash(readFileSync(path))}));
const raw=(cmd,args,input)=>spawnSync(cmd,args,{input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});
const required=r=>{assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout.trim();};
const git=args=>required(raw('git',args)),get=path=>git(['show',baseline+':'+path]);
const bootstrap=get('supabase/tests/bootstrap.sql');
const migrations=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).split('\n').filter(p=>p.endsWith('.sql')).sort().map(path=>({path,source:get(path)}));
const source=readFileSync(probe,'utf8');assert.ok(!process.env.DOCKER_HOST);
const context=required(raw('docker',['context','show']));
const endpoint=JSON.parse(required(raw('docker',['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint)||/^unix:\/\//.test(endpoint));
const env={...process.env};for(const key of ['DOCKER_CONTEXT','DOCKER_HOST','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,input)=>spawnSync('docker',['--host',endpoint,...args],{input,encoding:'utf8',windowsHide:true,env,timeout:60000,maxBuffer:16*1024*1024});
const owner=randomUUID(),container='cortex-handler-review-'+owner.slice(0,8),network=container+'-internal';
const sql=s=>required(docker(['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],"set statement_timeout='20s';set lock_timeout='3s';"+s));
let networkPlanned=false,containerPlanned=false,failure,rows;
try{
 networkPlanned=true;required(docker(['network','create','--internal','--label','cortex.test.owner='+owner,network]));
 containerPlanned=true;required(docker(['run','--detach','--pull=never','--name',container,'--network',network,'--label','cortex.test.owner='+owner,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));
 let ready=false;for(let n=0;n<60;n++){if(docker(['exec',container,'pg_isready','-U','postgres']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
 sql(bootstrap);for(const m of migrations)sql(m.source);
 rows=JSON.parse(sql(source));
 assert.deepEqual(rows,[{observed:'ambiguous',token_refusal:'P4031',advance_refusal:null,state_after:'ambiguous',new_reservation_refusal:'P4093'},{observed:'prepared',token_refusal:'P4031',advance_refusal:'22023',state_after:'prepared',new_reservation_refusal:'P4093'}]);
}catch(error){failure=error;}finally{
 for(const [kind,name,planned] of [['container',container,containerPlanned],['network',network,networkPlanned]]){
  if(!planned)continue;
  const format=kind==='container'?'{{index .Config.Labels "cortex.test.owner"}}':'{{index .Labels "cortex.test.owner"}}',r=docker([kind,'inspect',name,'--format',format]);
  if(r.status!==0&&/no such (object|container|network)|network .* not found/i.test(r.stderr))continue;
  if(r.status!==0||r.stdout.trim()!==owner){failure||=new Error('Refusing unowned cleanup');continue;}
  if(docker(kind==='container'?['rm','--force','--volumes',name]:['network','rm',name]).status!==0)failure||=new Error('Owned cleanup failed');
  const absent=docker([kind,'inspect',name]);if(absent.status===0||!/no such (object|container|network)|network .* not found/i.test(absent.stderr))failure||=new Error('Resource removal unverified');
 }
}
if(failure)throw failure;
for(const s of own)assert.equal(hash(readFileSync(s.path)),s.sha256);
const directory='docs/reviews/2026-11-05/signature-handler-boundaries';mkdirSync(directory,{recursive:true});
writeFileSync(directory+'/sql-resume.json',JSON.stringify({syntheticOnly:true,sourceBaseline:baseline,migrations:migrations.length,sqlSuitesRun:0,sqlSourceDigest:hash([bootstrap,...migrations.map(m=>m.source)].join('\n')),ownSources:own,rows,cleanupVerified:true,ownedInternalNetwork:true,publishedPorts:false,nativeAuthHttp:false,realProvider:false},null,2)+'\n');
process.stdout.write(JSON.stringify({migrations:migrations.length,rows,cleanupVerified:true})+'\n');
