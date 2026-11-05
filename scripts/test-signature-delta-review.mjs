import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// A bounded review, never a production test target or a global GREEN verdict.
const options=process.argv.slice(2),authFixture=options.includes('--auth-fixture'),fenceReview=options.includes('--session-fence'),generateTypes=options.includes('--generate-types'),resolved=options.includes('--resolved')||authFixture||fenceReview;
assert.ok(options.every(a=>['--resolved','--auth-fixture','--session-fence','--generate-types'].includes(a)||/^--source=[0-9a-f]{40}$/.test(a))&&new Set(options).size===options.length);
assert.ok(!generateTypes||fenceReview);assert.ok(!(fenceReview&&authFixture));
const sourceArgs=options.filter(a=>a.startsWith('--source='));assert.ok(sourceArgs.length<=1);
assert.ok(!process.env.DOCKER_HOST,'Refusing inherited Docker target');
const required=r=>{assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout.trim();};
const raw=(command,args,input)=>spawnSync(command,args,{input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:24*1024*1024});
const git=args=>required(raw('git',args));
const baseline=git(['rev-parse',sourceArgs[0]?.slice(9)||'HEAD']);assert.match(baseline,/^[0-9a-f]{40}$/);
const get=path=>git(['show',baseline+':'+path]);
const hash=s=>createHash('sha256').update(s).digest('hex');
const typesPath='src/integrations/supabase/types.ts',typesBeforeHash=generateTypes?hash(readFileSync(typesPath)):null;
const runnerPath='scripts/test-signature-delta-review.mjs',probePath='supabase/tests/prototypes/signature-late-failure.sql';
const runnerHash=hash(readFileSync(runnerPath)),probeWorktreeHash=hash(readFileSync(probePath)),probe=fenceReview?readFileSync(probePath,'utf8'):get(probePath);
const racePath='scripts/test-signature-fence-review.mjs',raceSource=fenceReview?readFileSync(racePath,'utf8'):null;
const fenceModule=fenceReview?await import('data:text/javascript;base64,'+Buffer.from(raceSource).toString('base64')):null;
const fixturePaths=authFixture?['supabase/tests/bootstrap.sql','supabase/tests/auth-session-fixture.test.sql','scripts/test-provisioning-clinic-authority.mjs']:[];
const fixtureSources=fixturePaths.map(path=>({path,sha256:hash(readFileSync(path))}));
const migrations=git(['ls-tree','-r','--name-only',baseline,'--','supabase/migrations']).split('\n').filter(p=>p.endsWith('.sql')).sort().map(path=>({path,source:get(path)}));
const suitePaths=authFixture||fenceReview?git(['ls-tree','-r','--name-only',baseline,'--','supabase/tests']).split('\n').filter(p=>/^supabase\/tests\/[^/]+\.test\.sql$/.test(p))
 :['supabase/tests/digital-signature.test.sql','supabase/tests/reference-catalogs.test.sql','supabase/tests/document-snippets.test.sql'];
const suites=suitePaths.filter(p=>!authFixture||p!=='supabase/tests/auth-session-fixture.test.sql').map(path=>({path,source:get(path)}));
if(authFixture)suites.push({path:'supabase/tests/auth-session-fixture.test.sql',source:readFileSync('supabase/tests/auth-session-fixture.test.sql','utf8')});
suites.sort((a,b)=>a.path.localeCompare(b.path));
const bootstrap=authFixture?readFileSync('supabase/tests/bootstrap.sql','utf8'):get('supabase/tests/bootstrap.sql'),helper=get('scripts/test-signature-concurrency.mjs');
const fixtureModule=authFixture?await import('data:text/javascript;base64,'+Buffer.from(readFileSync('scripts/test-provisioning-clinic-authority.mjs','utf8')).toString('base64')):null;
if(authFixture){
 for(const source of [bootstrap,get('supabase/tests/bootstrap.sql')])assert.ok(!/CREATE (?:TABLE|TYPE) auth\./.test(fixtureModule.nativeApplicationBootstrap(source)));
 const declaration="CREATE TYPE auth.aal_level AS ENUM ('aal1','aal2','aal3');";
 assert.throws(()=>fixtureModule.nativeApplicationBootstrap(bootstrap.replace(declaration,'')));
 assert.throws(()=>fixtureModule.nativeApplicationBootstrap(bootstrap+'\n'+declaration));
}
const regulatedPath='supabase/functions/_shared/regulatedMedications.ts',regulated=get(regulatedPath);
const moduleOf=async source=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const current=await moduleOf(regulated),prior=await moduleOf(git(['show','7f699c4:supabase/functions/_shared/regulatedMedications.ts']));
const vectors=['Clonazepam\u200bSOS 2 mg','Amoxicilina\u200bVO 500 mg','Clonaze\u00adpam\u200bSOS','Rivo\u00adtril\u200bSOS','Ácido\u200bval\u00adproico\u200bVO','Cipro\u00adfloxacina\u200b500mg',
 'Tramadol 1\u200b50 mg','Tramadol 150\u200b.0 mg','Tramadol 150.\u200b0 mg','Tramadol 150\u200b,0 mg','Tramadol 150.0 mg','Clonazepamsos','Clona zepam'];
const detectorProbes=vectors.map(input=>({input,prior:prior.controlledFindings(input),current:current.controlledFindings(input),antimicrobials:current.antimicrobialsIn(input)}));
assert.deepEqual(current.controlledSubstancesIn(vectors[0]),['clonazepam']);
assert.deepEqual(current.antimicrobialsIn(vectors[1]),['amoxicilina']);
assert.equal(current.controlledFindings(vectors[6])[0].form,'notificacao_a');
if(resolved)for(const input of vectors.slice(7,11))assert.equal(current.controlledFindings(input)[0].form,'notificacao_a','Decimal Cf regression');
const context=localDockerEndpoint();
function localDockerEndpoint(){const name=required(raw('docker',['context','show']));return JSON.parse(required(raw('docker',['context','inspect',name,'--format','{{json .Endpoints.docker.Host}}'])));}
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(context)||/^unix:\/\//.test(context),'Expected local Docker');
process.env.DOCKER_HOST=context;
for(const key of ['DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete process.env[key];
const docker=(args,input)=>raw('docker',['--host',context,...args],input);
const owner=randomUUID(),container='cortex-signature-review-'+owner.slice(0,8),network=container+'-internal',meta=container+'-meta';
const sql=source=>required(docker(['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],`set statement_timeout='${authFixture||fenceReview?45:15}s';set lock_timeout='3s';`+source));
let containerPlanned=false,networkPlanned=false,metaPlanned=false,failure,report,directory,helperPath,types;
try{
 directory=mkdtempSync(join(tmpdir(),'cortex-signature-review-'));helperPath=join(directory,'signature.mjs');writeFileSync(helperPath,helper);
 const {testSignatureConcurrency}=await import(pathToFileURL(helperPath).href);
 networkPlanned=true;required(docker(['network','create','--internal','--label','cortex.test.owner='+owner,network]));
 containerPlanned=true;required(docker(['run','--detach','--pull=never','--name',container,'--network',network,'--label','cortex.test.owner='+owner,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']));
 let ready=false;for(let n=0;n<60;n++){if(docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
 sql(bootstrap);for(const {source} of migrations)sql(source);
 const fixtureProjection=authFixture?fixtureModule.assertAuthFixtureProjection(sql):undefined;
 for(const {path,source} of suites){sql(source);process.stdout.write('Passed '+path+'\n');}
 if(authFixture){
  // A preexisting column grant must fail the probe; its temporary positive
  // control must never erase that grant and turn the negative check green.
  const probe=suites.find(s=>s.path==='supabase/tests/auth-session-fixture.test.sql').source;
  const poisoned=probe.replace('\nbegin;','\nbegin;\ngrant select(id) on auth.sessions to service_role;');
  assert.notEqual(poisoned,probe,'Fixture ACL fault was not injected');
  const fault=docker(['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],"set statement_timeout='15s';set lock_timeout='3s';"+poisoned);
  assert.notEqual(fault.status,0,'Fixture accepted a preexisting Auth column grant');
  assert.match(fault.stderr,/P0004: Client received Auth column privileges/,'Unexpected fixture ACL fault');
  assert.equal(sql("select has_any_column_privilege('service_role','auth.sessions','select')"),'f','Fixture fault did not roll back');
 }
 const lateFailure=JSON.parse(sql(probe));
 assert.equal(lateFailure.length,fenceReview?5:2);
 // Historical mode pins the counterexample; resolved mode requires the
 // old failure to leave attempt 2 untouched. Neither is a global verdict.
 assert.deepEqual(lateFailure.find(r=>r.destination==='ambiguous'),resolved
  ? {destination:'ambiguous',refusal:'P4094',resulting_state:'ambiguous',attempts:2,cleanup:false}
  : {destination:'ambiguous',refusal:null,resulting_state:'failed',attempts:2,cleanup:true});
 assert.deepEqual(lateFailure.find(r=>r.destination==='stored'),{destination:'stored',refusal:'22023',resulting_state:'stored',attempts:2,cleanup:false});
 if(fenceReview){
  for(const expected of [
   {destination:'ambiguous_psc_revoked',refusal:null,resulting_state:'cancelled_by_revocation',attempts:2,cleanup:true},
   {destination:'prepared_after_ambiguous',refusal:'22023',resulting_state:'ambiguous',attempts:2,cleanup:false},
   {destination:'complete_after_cancelled',refusal:'P4093',resulting_state:'cancelled_by_revocation',attempts:2,cleanup:true},
  ])assert.deepEqual(lateFailure.find(r=>r.destination===expected.destination),expected,'Frozen fence counterexample changed');
 }
 const oauth=fenceReview?await fenceModule.reviewOauthFence({sql,container,context}):undefined;
 await testSignatureConcurrency(container);
 if(generateTypes){
  metaPlanned=true;
  types=required(docker(['run','--pull=never','--name',meta,'--label','cortex.test.owner='+owner,'--network','container:'+container,
   '--env','PG_META_DB_HOST=127.0.0.1','--env','PG_META_GENERATE_TYPES=typescript','--env','PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public',
   '--env','PG_META_POSTGREST_VERSION=12','--env','PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true','public.ecr.aws/supabase/postgres-meta:v0.95.2']));
  assert.ok(types.includes('export type Database'));
 }
 report={syntheticOnly:true,sourceBaseline:baseline,migrations:migrations.length,sqlSuites:suites.map(s=>s.path),
  sqlSourceDigest:hash([bootstrap,...migrations.map(m=>m.source),...suites.map(s=>s.source)].join('\n')),
  helperSha256:hash(helper),regulatedSourceSha256:hash(regulated),probeSource:{path:probePath,sha256:hash(probe),origin:fenceReview?'worktree':'git baseline'},ownSources:[{path:runnerPath,sha256:runnerHash},...(fenceReview?[{path:probePath,sha256:hash(probe)},{path:racePath,sha256:hash(raceSource)}]:[]),...fixtureSources],
  detectorPriorBaseline:git(['rev-parse','7f699c4']),detectorProbes,lateFailure,signatureConcurrencyPassed:true,
  fullSqlMatrixRun:false,allSqlSuitesRun:authFixture||fenceReview,lateFailureResolved:resolved,reviewResolved:false,ownedInternalNetwork:true,publishedPorts:false,
  ...(fenceReview?{oauthFenceReview:oauth,staleAttemptAfterPscRevocation:lateFailure.find(r=>r.destination==='ambiguous_psc_revoked'),...(types?{generatedTypesSha256:hash(types+'\n'),typesDestinationBeforeSha256:typesBeforeHash}:{} )}:{}),
  ...(authFixture?{fixtureProjectionVerified:true,fixtureProjection,fixtureColumnAclNegativeControlPassed:true,bootstrapOverlaySha256:hash(bootstrap),fixtureStatementTimeoutSeconds:45}:{} )};
}catch(error){failure=error;}finally{
 for(const [kind,name,planned] of [['container',meta,metaPlanned],['container',container,containerPlanned],['network',network,networkPlanned]]){
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
if(failure){if(failure.stack)failure.stack=failure.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'frozen:signature-review');throw failure;}
assert.equal(hash(readFileSync(runnerPath)),runnerHash,'Runner changed during execution');
assert.equal(hash(readFileSync(probePath)),probeWorktreeHash,'Probe changed during execution');
if(fenceReview)assert.equal(hash(readFileSync(racePath,'utf8')),hash(raceSource),'Fence probe changed during execution');
for(const source of fixtureSources)assert.equal(hash(readFileSync(source.path)),source.sha256,'Fixture source changed during execution');
report.cleanupVerified=true;
const artifactDirectory=fenceReview?'docs/reviews/2026-11-05/signature-session-fence-review':authFixture?'docs/reviews/2026-11-05/native-session-fixture':resolved?'docs/reviews/2026-11-04/signature-handlers-review':'docs/reviews/2026-11-04/signature-delta-review';
mkdirSync(artifactDirectory,{recursive:true});
if(types){assert.equal(hash(readFileSync(typesPath)),typesBeforeHash,'Types destination changed during review; refusing overwrite');writeFileSync(typesPath,types+'\n');}
writeFileSync(join(artifactDirectory,resolved?'sql-verification.json':'verification.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({migrations:report.migrations,sqlSuites:report.sqlSuites,lateFailure:report.lateFailure,cleanupVerified:true})+'\n');
