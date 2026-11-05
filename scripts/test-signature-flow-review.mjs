import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';

// In-memory counterexamples over an immutable source tree, no services or keys saved.
const options=process.argv.slice(2),resolved=options.includes('--resolved'),sourceArg=options.find(a=>a.startsWith('--source='));
assert.ok(sourceArg&&/^--source=[0-9a-f]{40}$/.test(sourceArg)&&options.every(a=>a===sourceArg||a==='--resolved')&&new Set(options).size===options.length);
const baseline=sourceArg.slice(9),ownPath='scripts/test-signature-flow-review.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex'),ownHash=hash(readFileSync(ownPath));
const paths=['src/lib/signatureFlow.test.ts','src/test/syntheticPki.ts',...['pades','psc','signatureFlow'].map(n=>'supabase/functions/_shared/'+n+'.ts')];
const sources=new Map(paths.map(path=>{const r=spawnSync('git',['show',baseline+':'+path],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);return [path,r.stdout];}));
const testPath=paths[0];let test=sources.get(testPath);assert.ok(test.includes('\ndescribe('));
test=test.slice(0,test.indexOf('\ndescribe('));
const vitest="import { beforeAll, beforeEach, describe, expect, it } from 'vitest';";assert.ok(test.includes(vitest));
test=test.replace(vitest,`let initializePki,initializeWorld;
const beforeAll=f=>{initializePki=f;},beforeEach=f=>{initializeWorld=f;};
const expect=actual=>({toBe:expected=>{if(actual!==expected)throw new Error('Synthetic fixture condition failed');}});`);
test+=`
await initializePki();
await initializeWorld();
const positive=await signDocument(world.ports,world.request);
if(positive.status!=='completed'||world.db.audit.length!==1)throw new Error('Normal control failed');
await initializeWorld();
const a=gate(),b=gate();
world.psc.answer=async call=>{await(call===1?a:b).wait;return call===1?'sign':'reject';};
const first=signDocument(world.ports,world.request);await until(()=>world.pscCalls===1);
const second=signDocument(world.ports,{...world.request,humanRetry:true});await until(()=>world.pscCalls===2);
b.open();const secondResult=await second;
const before={state:opOf().state,attempt:opOf().psc_attempts,cleanup:opOf().cleanup_pending,objects:world.storage.size};
a.open();const firstResult=await first;
const after={state:opOf().state,attempt:opOf().psc_attempts,cleanup:opOf().cleanup_pending,objects:world.storage.size,audit:world.db.audit.length};
await initializeWorld();
world.request.reason='Prescricao /ByteRange medica';
world.db.throwOnce.set('signature_complete',[rpcError('40001'),rpcError('40001'),rpcError('40001'),rpcError('40001')]);
let interrupted;
try{await signDocument(world.ports,world.request);}catch(e){interrupted=e.code;}
const stored={state:opOf().state,objects:world.storage.size,pscCalls:world.pscCalls};
const resumed=await signDocument(world.ports,world.request);
const removed={state:opOf().state,objects:world.storage.size,pscCalls:world.pscCalls,audit:world.db.audit.length};
${resolved?`
await initializeWorld();
const delayed=gate();let downloads=0;
world.beforeOriginal=async()=>{if(++downloads===1)await delayed.wait;};
const oldRequest=signDocument(world.ports,world.request).then(outcome=>({outcome}),error=>({error:error.code}));
await until(()=>downloads===1);
const newerCompleted=await signDocument(world.ports,world.request);
delayed.open();const olderPrepared=await oldRequest;
const terminalRace={newerCompleted:newerCompleted.status,olderPrepared,finalState:opOf().state,pscCalls:world.pscCalls,audit:world.db.audit.length};
`:''}
export const review={positive:positive.status,lateAnswer:{secondResult,before,firstResult,after},reasonByteRange:{interrupted,stored,resumed,removed}${resolved?',terminalRace':''}};
`;
// Only the test prefix is adapted. Imported implementation/PKI bytes come from git.
const modules=new Map([...sources].map(([path,source])=>['cortex-review:/'+path,source]));
modules.set('cortex-review:/'+testPath,test);
const hooks=registerHooks({
 resolve(specifier,context,next){
  if(specifier.startsWith('cortex-review:'))return {url:specifier,shortCircuit:true};
  if(context.parentURL?.startsWith('cortex-review:')&&specifier.startsWith('.')){
   let url=new URL(specifier,context.parentURL).href;if(!url.endsWith('.ts'))url+='.ts';
   assert.ok(modules.has(url),'Unexpected snapshot import');return {url,shortCircuit:true};
  }return next(specifier,context);
 },
 load(url,context,next){
  if(!url.startsWith('cortex-review:'))return next(url,context);
  assert.ok(modules.has(url));return {format:'module',shortCircuit:true,source:ts.transpileModule(modules.get(url),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
 },
});
let review;try{({review}=await import('cortex-review:/'+testPath));}finally{hooks.deregister();}
assert.deepEqual(review.lateAnswer.before,{state:'failed',attempt:2,cleanup:false,objects:0});
assert.deepEqual(review.lateAnswer.after,{state:'failed',attempt:2,cleanup:false,objects:resolved?0:1,audit:0});
assert.equal(review.reasonByteRange.interrupted,'40001');assert.equal(review.reasonByteRange.stored.state,'stored');
if(resolved){
 assert.equal(review.reasonByteRange.resumed.status,'completed');assert.equal(review.reasonByteRange.removed.objects,1);
 assert.equal(review.terminalRace.newerCompleted,'completed');assert.deepEqual(review.terminalRace.olderPrepared,{error:'22023'});
 assert.equal(review.terminalRace.finalState,'completed');assert.equal(review.terminalRace.pscCalls,1);assert.equal(review.terminalRace.audit,1);
}else {assert.equal(review.reasonByteRange.resumed.code,'stored_object_invalid');assert.equal(review.reasonByteRange.removed.objects,0);}
assert.equal(hash(readFileSync(ownPath)),ownHash);
const report={syntheticOnly:true,sourceBaseline:baseline,reviewResolved:false,priorCounterexamplesResolved:resolved,realDatabaseIntegration:false,externalCalls:false,
 ownSource:{path:ownPath,sha256:ownHash},sources:[...sources].map(([path,source])=>({path,sha256:hash(source)})),...review};
const directory=resolved?'docs/reviews/2026-11-05/signature-session-fence-review':'docs/reviews/2026-11-04/signature-delta-review';
mkdirSync(directory,{recursive:true});
writeFileSync(directory+'/memory.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(review,null,2)+'\n');
