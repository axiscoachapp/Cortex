import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const redOnly=process.argv.includes('--red'),sourceArg=process.argv.slice(2).find(a=>a.startsWith('--source='));
assert.ok(process.argv.slice(2).every(a=>a==='--red'||/^--source=[0-9a-f]{40}$/.test(a))&&process.argv.length<=4
 &&process.argv.slice(2).filter(a=>a==='--red').length<=1&&process.argv.slice(2).filter(a=>a.startsWith('--source=')).length<=1);
assert.ok(!process.env.DOCKER_HOST,'No inherited Docker target');
const required=r=>{assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout.trim();};
const raw=(cmd,args,input)=>spawnSync(cmd,args,{input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:24*1024*1024});
const git=args=>required(raw('git',args)),hash=s=>createHash('sha256').update(s).digest('hex');
const baseline=git(['rev-parse',sourceArg?.slice(9)||'HEAD']);assert.match(baseline,/^[0-9a-f]{40}$/);
const get=path=>git(['show',baseline+':'+path]);
const paths=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).split('\n').filter(p=>p.endsWith('.sql')).sort();
const migrations=paths.map(path=>({path,source:get(path)})),bootstrap=get('supabase/tests/bootstrap.sql');
const ownPath='scripts/test-provisioning-membership-generation.mjs',ownHash=hash(readFileSync(ownPath));
const prototypePath='supabase/tests/prototypes/provisioning-membership-generation.sql',helperPath='scripts/test-provisioning-membership-generation-cases.mjs';
const prototype=redOnly?'':readFileSync(prototypePath,'utf8'),helper=redOnly?'':readFileSync(helperPath,'utf8');
const ownSources=[{path:ownPath,sha256:ownHash},...(!redOnly?[{path:prototypePath,sha256:hash(prototype)},{path:helperPath,sha256:hash(helper)}]:[])];
const suites=redOnly?[]:['supabase/tests/reception-provisioning-requests.test.sql','supabase/tests/reception-delegation-requests.test.sql'].map(path=>({path,source:get(path)}));
const name=required(raw('docker',['context','show']));
const endpoint=JSON.parse(required(raw('docker',['context','inspect',name,'--format','{{json .Endpoints.docker.Host}}'])));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(endpoint)||/^unix:\/\//.test(endpoint),'Expected local Docker');
process.env.DOCKER_HOST=endpoint;for(const key of ['DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete process.env[key];
const docker=(args,input)=>raw('docker',['--host',endpoint,...args],input);
const owner=randomUUID(),container='cortex-membership-'+owner.slice(0,8),network=container+'-internal';
const psql=['--host',endpoint,'exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const bounds="set statement_timeout='12s';set lock_timeout='3s';";
const result=source=>docker(psql.slice(2),bounds+source),sql=source=>required(result(source));
const service="set local request.jwt.claim.role='service_role';";
const admin='a2810000-0000-4000-8000-000000000001',other='a2810000-0000-4000-8000-000000000002';
const children=[];
function session(){
 const application='membership-'+randomUUID(),child=spawn('docker',psql,{windowsHide:true});let stdout='',stderr='',ended=false,completed;
 child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});child.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',status=>resolve({status,stdout,stderr}));});
 done.then(r=>{completed=r;},()=>{});done.catch(()=>{});children.push({child,done});
 child.stdin.write(bounds+`set application_name='${application}';\n`);
 return {application,send:q=>child.stdin.write(q+'\n'),
  held:async()=>{for(let n=0;n<100;n++){const m=/GEN_HELD=(\d+)/.exec(stdout);if(m)return Number(m[1]);if(completed)throw new Error(stderr);await new Promise(r=>setTimeout(r,40));}throw new Error('Holder missed its barrier');},
  completed:()=>completed,
  end:async q=>{if(!ended){ended=true;child.stdin.end(q+'\n');}let timer;try{return await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error('Owned SQL session timeout'));},18000);})]);}finally{clearTimeout(timer);}},
 };
}
let networkPlanned=false,containerPlanned=false,failure,report,cleanupVerified=true;
const cleanupFailed=message=>{cleanupVerified=false;failure||=new Error(message);};
try{
 networkPlanned=true;required(docker(['network','create','--internal','--label','cortex.test.owner='+owner,network]));
 containerPlanned=true;required(docker(['run','--detach','--pull=never','--name',container,'--network',network,'--label','cortex.test.owner='+owner,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));
 let ready=false;for(let n=0;n<60;n++){if(docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
 sql(bootstrap);for(const {source} of migrations)sql(source);
 sql(`insert into auth.users(id,email) values('${admin}','generation-admin@example.invalid'),('${other}','generation-other@example.invalid');`);
 const createClinic=actor=>sql(`begin;set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';select public.create_clinic('Synthetic authority');commit;`);
 const clinic=createClinic(admin),otherClinic=createClinic(other);assert.match(clinic,/^[0-9a-f-]{36}$/);assert.match(otherClinic,/^[0-9a-f-]{36}$/);
 const current=()=>sql(`begin;${service}select cortex_private.reception_provisioning_admin('${clinic}','${admin}');commit;`);
 assert.equal(current(),admin);
 const common={syntheticOnly:true,labOnly:true,sourceBaseline:baseline,migrations:migrations.length,sqlSourceDigest:hash([bootstrap,...migrations.map(m=>m.source),...suites.map(s=>s.source)].join('\n')),ownSources,productionFix:false};
 if(redOnly){
  sql(`update public.clinic_members set role='doctor' where clinic_id='${clinic}' and user_id='${admin}';update public.clinic_members set role='admin' where clinic_id='${clinic}' and user_id='${admin}';`);
  const accepted=current()===admin;
  report={...common,redOnly:true,currentGuardInitiallyAllowed:true,currentGuardAllowsAfterRoleABA:accepted};
  assert.equal(accepted,false,'RED: current-only candidate accepted old authority after role ABA');
 }else{
  const {exerciseMembershipGeneration}=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'));
  const evidence=await exerciseMembershipGeneration({sql,result,session,required,prototype,admin,other,clinic,otherClinic});
  for(const {path,source} of suites){sql(source);process.stdout.write('Passed '+path+'\n');}
  report={...common,...evidence,sqlSuites:suites.map(s=>s.path),membershipGenerationProofPassed:true,nativeAuthRun:false,
   notCovered:['native Auth/session/MFA composition','credential generation and recovery','production intent ledger/custody/install/upgrade','provisioning grants and app cutover']};
 }
}catch(error){failure=error;}finally{
 for(const {child} of children){child.stdin.destroy();child.kill();}
 await Promise.allSettled(children.map(async({done})=>{let timer;try{await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{clearTimeout(timer);}}));
 for(const [kind,resource,planned] of [['container',container,containerPlanned],['network',network,networkPlanned]]){
  if(!planned)continue;
  const format=kind==='container'?'{{index .Config.Labels "cortex.test.owner"}}':'{{index .Labels "cortex.test.owner"}}';
  const found=docker([kind,'inspect',resource,'--format',format]);
  if(found.status!==0&&/no such (object|container|network)|network .* not found/i.test(found.stderr))continue;
  if(found.status!==0||found.stdout.trim()!==owner){cleanupFailed('Refusing unowned cleanup');continue;}
  if(docker(kind==='container'?['rm','--force','--volumes',resource]:['network','rm',resource]).status!==0)cleanupFailed('Owned cleanup failed');
  const absent=docker([kind,'inspect',resource]);if(absent.status===0||!/no such (object|container|network)|network .* not found/i.test(absent.stderr))cleanupFailed('Cleanup unverified');
 }
}
if(report){
 for(const source of ownSources)assert.equal(hash(readFileSync(source.path)),source.sha256,'Tested source changed during execution');report.cleanupVerified=cleanupVerified;
 mkdirSync('docs/reviews/2026-11-04/provisioning-membership-generation',{recursive:true});
 writeFileSync('docs/reviews/2026-11-04/provisioning-membership-generation/'+(redOnly?'RED':'verification')+'.json',JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify(report)+'\n');
}
if(failure){if(failure.stack)failure.stack=failure.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'snapshot:membership-cases');throw failure;}
