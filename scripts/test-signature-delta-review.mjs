import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// A bounded review, never a production test target or a global GREEN verdict.
assert.ok(process.argv.slice(2).every(a=>/^--source=[0-9a-f]{40}$/.test(a))&&process.argv.length<=3);
assert.ok(!process.env.DOCKER_HOST,'Refusing inherited Docker target');
const required=r=>{assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout.trim();};
const raw=(command,args,input)=>spawnSync(command,args,{input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:24*1024*1024});
const git=args=>required(raw('git',args));
const baseline=git(['rev-parse',process.argv[2]?.slice(9)||'HEAD']);assert.match(baseline,/^[0-9a-f]{40}$/);
const get=path=>git(['show',baseline+':'+path]);
const hash=s=>createHash('sha256').update(s).digest('hex');
const runnerPath='scripts/test-signature-delta-review.mjs',probePath='supabase/tests/prototypes/signature-late-failure.sql';
const runnerHash=hash(readFileSync(runnerPath)),probe=readFileSync(probePath,'utf8');
const migrations=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).split('\n').filter(p=>p.endsWith('.sql')).sort().map(path=>({path,source:get(path)}));
const suites=['supabase/tests/digital-signature.test.sql','supabase/tests/reference-catalogs.test.sql','supabase/tests/document-snippets.test.sql'].map(path=>({path,source:get(path)}));
const bootstrap=get('supabase/tests/bootstrap.sql'),helper=get('scripts/test-signature-concurrency.mjs');
const regulatedPath='supabase/functions/_shared/regulatedMedications.ts',regulated=get(regulatedPath);
const moduleOf=async source=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const current=await moduleOf(regulated),prior=await moduleOf(git(['show','7f699c4:supabase/functions/_shared/regulatedMedications.ts']));
const vectors=['Clonazepam\u200bSOS 2 mg','Amoxicilina\u200bVO 500 mg','Clonaze\u00adpam\u200bSOS','Rivo\u00adtril\u200bSOS','Ácido\u200bval\u00adproico\u200bVO','Cipro\u00adfloxacina\u200b500mg',
 'Tramadol 1\u200b50 mg','Tramadol 150\u200b.0 mg','Tramadol 150.\u200b0 mg','Tramadol 150\u200b,0 mg','Tramadol 150.0 mg','Clonazepamsos','Clona zepam'];
const detectorProbes=vectors.map(input=>({input,prior:prior.controlledFindings(input),current:current.controlledFindings(input),antimicrobials:current.antimicrobialsIn(input)}));
assert.deepEqual(current.controlledSubstancesIn(vectors[0]),['clonazepam']);
assert.deepEqual(current.antimicrobialsIn(vectors[1]),['amoxicilina']);
assert.equal(current.controlledFindings(vectors[6])[0].form,'notificacao_a');
const context=localDockerEndpoint();
function localDockerEndpoint(){const name=required(raw('docker',['context','show']));return JSON.parse(required(raw('docker',['context','inspect',name,'--format','{{json .Endpoints.docker.Host}}'])));}
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(context)||/^unix:\/\//.test(context),'Expected local Docker');
process.env.DOCKER_HOST=context;
for(const key of ['DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete process.env[key];
const docker=(args,input)=>raw('docker',['--host',context,...args],input);
const owner=randomUUID(),container='cortex-signature-review-'+owner.slice(0,8),network=container+'-internal';
const sql=source=>required(docker(['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],"set statement_timeout='15s';set lock_timeout='3s';"+source));
let containerPlanned=false,networkPlanned=false,failure,report,directory,helperPath;
try{
 directory=mkdtempSync(join(tmpdir(),'cortex-signature-review-'));helperPath=join(directory,'signature.mjs');writeFileSync(helperPath,helper);
 const {testSignatureConcurrency}=await import(pathToFileURL(helperPath).href);
 networkPlanned=true;required(docker(['network','create','--internal','--label','cortex.test.owner='+owner,network]));
 containerPlanned=true;required(docker(['run','--detach','--pull=never','--name',container,'--network',network,'--label','cortex.test.owner='+owner,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));
 let ready=false;for(let n=0;n<60;n++){if(docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
 sql(bootstrap);for(const {source} of migrations)sql(source);
 for(const {path,source} of suites){sql(source);process.stdout.write('Passed '+path+'\n');}
 const lateFailure=JSON.parse(sql(probe));
 assert.equal(lateFailure.length,2);
 // Pin the review counterexample rather than calling the whole run GREEN.
 assert.deepEqual(lateFailure.find(r=>r.destination==='ambiguous'),{destination:'ambiguous',refusal:null,resulting_state:'failed',attempts:2,cleanup:true});
 assert.equal(lateFailure.find(r=>r.destination==='stored').refusal,'22023');
 await testSignatureConcurrency(container);
 report={syntheticOnly:true,sourceBaseline:baseline,migrations:migrations.length,sqlSuites:suites.map(s=>s.path),
  sqlSourceDigest:hash([bootstrap,...migrations.map(m=>m.source),...suites.map(s=>s.source)].join('\n')),
  helperSha256:hash(helper),regulatedSourceSha256:hash(regulated),ownSources:[{path:runnerPath,sha256:runnerHash},{path:probePath,sha256:hash(probe)}],
  detectorPriorBaseline:git(['rev-parse','7f699c4']),detectorProbes,lateFailure,signatureConcurrencyPassed:true,
  fullSqlMatrixRun:false,reviewResolved:false,ownedInternalNetwork:true,publishedPorts:false};
}catch(error){failure=error;}finally{
 for(const [kind,name,planned] of [['container',container,containerPlanned],['network',network,networkPlanned]]){
  if(!planned)continue;
  const format=kind==='container'?'{{index .Config.Labels "cortex.test.owner"}}':'{{index .Labels "cortex.test.owner"}}';
  const inspected=docker([kind,'inspect',name,'--format',format]);
  if(inspected.status!==0&&/no such (object|container|network)|network .* not found/i.test(inspected.stderr))continue;
  if(inspected.status!==0||inspected.stdout.trim()!==owner){failure||=new Error('Refusing unowned cleanup');continue;}
  if(docker(kind==='container'?['rm','--force','--volumes',name]:['network','rm',name]).status!==0)failure||=new Error('Owned cleanup failed');
  const absent=docker([kind,'inspect',name]);if(absent.status===0||!/no such (object|container|network)|network .* not found/i.test(absent.stderr))failure||=new Error('Resource removal unverified');
 }
 if(helperPath)unlinkSync(helperPath);if(directory)rmdirSync(directory);
}
if(failure)throw failure;
assert.equal(hash(readFileSync(runnerPath)),runnerHash,'Runner changed during execution');
assert.equal(hash(readFileSync(probePath,'utf8')),hash(probe),'Probe changed during execution');
report.cleanupVerified=true;
mkdirSync('docs/reviews/2026-11-04/signature-delta-review',{recursive:true});
writeFileSync('docs/reviews/2026-11-04/signature-delta-review/verification.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({migrations:report.migrations,sqlSuites:report.sqlSuites,lateFailure:report.lateFailure,cleanupVerified:true})+'\n');
