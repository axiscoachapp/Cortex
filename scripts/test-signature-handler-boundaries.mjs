import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';

// Review only: real frozen handlers/adapters, in-memory Auth/SDK/PSC seams.
const options=process.argv.slice(2),arg=options.find(a=>a.startsWith('--source=')),valuesFixed=options.includes('--values-fixed'),edgesFixed=options.includes('--edges-fixed')||valuesFixed,fixed=options.includes('--fixed')||edgesFixed;
assert.ok(arg&&/^--source=[0-9a-f]{40}$/.test(arg)&&options.length===(fixed?2:1)&&options.every(a=>a===arg||a==='--fixed'||a==='--edges-fixed'||a==='--values-fixed'));
const baseline=arg.slice(9),ownPath='scripts/test-signature-handler-boundaries.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex'),ownHash=hash(readFileSync(ownPath));
const get=path=>{const r=spawnSync('git',['show',baseline+':'+path],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8*1024*1024});assert.equal(r.status,0);return r.stdout;};
const paths=['signatureDeps','signatureHandlers','auth','pades','psc','signatureFlow'].map(n=>'supabase/functions/_shared/'+n+'.ts');
if(fixed)paths.push('src/test/syntheticPki.ts');
const sources=new Map(paths.map(path=>[path,get(path)]));
const user='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222',rx='33333333-3333-4333-8333-333333333333',op='44444444-4444-4444-8444-444444444444';
const env={SUPABASE_URL:'https://db.synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only',SUPABASE_ANON_KEY:'synthetic-only',
 SIGNATURE_PSC_BASE_URL:'https://psc.synthetic.invalid/',SIGNATURE_PSC_CLIENT_ID:'synthetic-only',SIGNATURE_PSC_CLIENT_SECRET:'synthetic-only',SIGNATURE_PSC_REDIRECT_URI:'https://app.synthetic.invalid/callback',
 SIGNATURE_TOKEN_KEYS:'k1:'+Buffer.from(new Uint8Array(32).fill(5)).toString('base64'),SIGNATURE_POLICY_SHA256:'07'.repeat(32)};
const originalGlobals={Deno:globalThis.Deno,fetch:globalThis.fetch,sdk:globalThis.cortexReviewSdk};
let storageError=null,calls=[],verifier,providerCertificate='';
globalThis.Deno={env:{get:name=>env[name]}};
globalThis.cortexReviewSdk=()=>({
 auth:{getUser:async()=>({data:{user:{id:user,app_metadata:{},factors:[{status:'verified'}]}},error:null})},
 rpc:async(name,args)=>{calls.push({name,args});if(name==='signature_begin_authorization')verifier=args.p_verifier;return {data:name==='signature_consume_authorization'?verifier:name==='signature_revoke_session'?1:{active:true},error:null};},
 storage:{from:()=>({download:async()=>({data:storageError?null:new Blob(['synthetic']),error:storageError}),remove:async()=>({error:null})})},
 from:table=>{const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:table==='user_settings'?{prescriber_cpf:'52998224725'}:{doc_type:'receita_simples',issuance_snapshot:{prescriber:{crm_number:'00000',crm_uf:'PR'}}},error:null})};return chain;},
});
globalThis.fetch=async input=>{
 const url=new URL(input);assert.equal(url.origin,'https://psc.synthetic.invalid');
 const body=url.pathname==='/oauth/token'?{access_token:'synthetic-only',expires_in:3600,authorized_identification:'52998224725',authorized_identification_type:'CPF'}
  :url.pathname==='/oauth/certificate-discovery'?{certificates:[{alias:'synthetic',certificate:providerCertificate,certificate_chain:[]}]}:null;
 assert.ok(body,'Unexpected in-memory provider call');return new Response(JSON.stringify(body),{status:200});
};
const modules=new Map([...sources].map(([path,source])=>['cortex-boundary:/'+path,source]));
modules.set('cortex-boundary:/sdk.ts','export const createClient=(...args)=>globalThis.cortexReviewSdk(...args);');
modules.set('cortex-boundary:/supabase/functions/_shared/http.ts',"export const fetchWithDeadline=()=>{throw new Error('Review forbids network');};");
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='https://esm.sh/@supabase/supabase-js@2.86.0')return {url:'cortex-boundary:/sdk.ts',shortCircuit:true};
 if(specifier.startsWith('cortex-boundary:'))return {url:specifier,shortCircuit:true};
 if(context.parentURL?.startsWith('cortex-boundary:')&&specifier.startsWith('.')){let url=new URL(specifier,context.parentURL).href;if(!url.endsWith('.ts'))url+='.ts';assert.ok(modules.has(url));return {url,shortCircuit:true};}
 return next(specifier,context);
},load(url,context,next){if(!url.startsWith('cortex-boundary:'))return next(url,context);assert.ok(modules.has(url));return {format:'module',shortCircuit:true,source:ts.transpileModule(modules.get(url),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};}});
let report;
try{
 const {signatureDeps}=await import('cortex-boundary:/supabase/functions/_shared/signatureDeps.ts');
 const {signatureSessionHandler,signDocumentHandler}=await import('cortex-boundary:/supabase/functions/_shared/signatureHandlers.ts');
 const token=(aal,remaining=3600)=>[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:user,session_id:session,role:'authenticated',aal,exp:Math.floor(Date.now()/1000)+remaining})).toString('base64url'),'synthetic'].join('.');
 const req=(route,aal='aal2',body,method='POST')=>new Request('https://edge.synthetic.invalid/functions/v1/signature-session/'+route,{method,headers:{Authorization:'Bearer '+token(aal)},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const aal1=[],aal2Control=[];
 for(const route of ['state','revoke']){
  calls=[];const response=await signatureSessionHandler(req(route,'aal1',undefined,route==='state'?'GET':'POST'),signatureDeps());const body=await response.json();
  assert.equal(response.status,403);assert.equal(body.mfaRequired,true);assert.equal(calls.length,0);aal1.push({route,status:response.status,mfaRequired:true,rpcCalls:0});
  calls=[];const control=req(route,'aal2',undefined,route==='state'?'GET':'POST');if(fixed)control.headers.set('Authorization','Bearer '+token('aal2',60));
  const allowed=await signatureSessionHandler(control,signatureDeps());
  assert.equal(allowed.status,200);assert.deepEqual(calls.map(c=>c.name),[route==='state'?'signature_session_state':'signature_revoke_session']);aal2Control.push({route,status:allowed.status,rpcCalls:1,...(fixed?{jwtRemainingSeconds:60}:{})});
 }
 const storage=[];
 for(const [statusCode,message,missing] of [['404','Object not found',true],['503','Service unavailable',false],['500','Upstream object route not found',!fixed]]){
  storageError={status:Number(statusCode),statusCode,message};let returnedNull=false,threw=false;
  try{returnedNull=(await signatureDeps().storage.download('rx/synthetic.pdf'))===null;}catch{threw=true;}
  assert.equal(returnedNull,missing);assert.equal(threw,!missing);storage.push({statusCode,returnedNull,threw});
 }
 let realStorageSdk;
 if(fixed){
  const packagePath='node_modules/@supabase/storage-js/package.json';assert.equal(JSON.parse(readFileSync(packagePath)).version,'2.86.0');
  const {StorageClient}=await import('@supabase/storage-js');const cases=[];
  for(const status of [400,404,500]){
   const client=new StorageClient('https://storage.synthetic.invalid',{},async input=>{assert.ok(String(input).startsWith('https://storage.synthetic.invalid/'));return Response.json({statusCode:'404',message:'Object not found'},{status});});
   const {error}=await client.from('prescriptions').download('missing.pdf');assert.ok(error);assert.equal(error.name,'StorageUnknownError');
   assert.equal(error.status,undefined);assert.equal(error.statusCode,undefined);assert.equal(error.originalError.status,status);
   storageError=error;
   if(edgesFixed&&status!==500)assert.equal(await signatureDeps().storage.download('rx/synthetic.pdf'),null);
   else await assert.rejects(()=>signatureDeps().storage.download('rx/synthetic.pdf'),/Storage indisponível/);
   cases.push({httpStatus:status,errorName:error.name,structuredStatusAbsent:true,originalResponseStatus:error.originalError.status,adapterThrows:!edgesFixed||status===500,...(edgesFixed?{returnedNull:status!==500}:{})});
  }
  const sdkPaths=[packagePath,...['StorageClient.js','packages/StorageFileApi.js','packages/BlobDownloadBuilder.js','lib/fetch.js','lib/errors.js'].map(p=>'node_modules/@supabase/storage-js/dist/main/'+p)];
  realStorageSdk={version:'2.86.0',fetchInMemory:true,cases,sources:sdkPaths.map(path=>({path,sha256:hash(readFileSync(path))}))};
 }
 storageError=null;calls=[];
 const started=await signatureSessionHandler(req('start'),signatureDeps());assert.equal(started.status,200);
 const state=new URL((await started.json()).authorizeUrl).searchParams.get('state');
 const completed=await signatureSessionHandler(req('complete','aal2',{state,code:'synthetic'}),signatureDeps());assert.equal(completed.status,fixed?409:200);
 const activation=calls.find(c=>c.name==='signature_activate_session');
 let certificate,malformedCertificates,remainingDerCases;
 if(fixed){
  assert.equal(activation,undefined);assert.equal((await completed.json()).code,'certificate_invalid');
  const {RSA,syntheticCertificate}=await import('cortex-boundary:/src/test/syntheticPki.ts');
  const key=await crypto.subtle.generateKey(RSA,true,['sign','verify']);
  const der=await syntheticCertificate('Synthetic review','Synthetic review',key,key.privateKey,1);
  const {DER,tlv,readDer,derChildren,signerCertificateProblem}=await import('cortex-boundary:/supabase/functions/_shared/pades.ts');
  const [tbs,algorithm,signature]=derChildren(der,readDer(der));
  const badBits=signature.bytes.slice();badBits[signature.contentStart-signature.start]=255;
  malformedCertificates=[];
  for(const [name,bytes] of Object.entries({control:der,emptyOuterAlgorithm:DER.seq(tbs.bytes,DER.seq(),signature.bytes),emptySignatureValue:DER.seq(tbs.bytes,algorithm.bytes,tlv(0x03)),invalidUnusedBits:DER.seq(tbs.bytes,algorithm.bytes,badBits)})){
   const problem=await signerCertificateProblem(bytes,new Date());let x509Parsed=true;try{new X509Certificate(bytes);}catch{x509Parsed=false;}
   assert.equal(problem,edgesFixed&&name!=='control'?'certificate_invalid':null);assert.equal(x509Parsed,name==='control');
   providerCertificate=Buffer.from(bytes).toString('base64');calls=[];
   const malformedStart=await signatureSessionHandler(req('start'),signatureDeps());assert.equal(malformedStart.status,200);
   const malformedState=new URL((await malformedStart.json()).authorizeUrl).searchParams.get('state');
   const malformedComplete=await signatureSessionHandler(req('complete','aal2',{state:malformedState,code:'synthetic'}),signatureDeps());
   const refused=edgesFixed&&name!=='control';assert.equal(malformedComplete.status,refused?409:200);
   if(refused)assert.equal(calls.find(c=>c.name==='signature_activate_session'),undefined);
   else assert.equal(calls.find(c=>c.name==='signature_activate_session')?.args.p_cert_sha256,hash(bytes));
   malformedCertificates.push({name,helperProblem:problem,x509Parsed,completeStatus:malformedComplete.status,activationCalled:!refused});
  }
  if(edgesFixed){
   const fields=derChildren(der,tbs),offset=fields[0].tag===0xa0?1:0;remainingDerCases=[];
   const residues=valuesFixed?[
    ['primitiveSequence',tlv(0x10),null],['primitiveSet',tlv(0x11),null],
    ['bmpSurrogate',null,tlv(0x1e,Uint8Array.of(0xd8,0))],['universalSurrogate',null,tlv(0x1c,Uint8Array.of(0,0,0xd8,0))],['universalOutOfRange',null,tlv(0x1c,Uint8Array.of(0,0x11,0,0))],
   ]:[];
   const residueNames=new Set(residues.map(r=>r[0]));
   for(const [name,parameter,badName] of [
    ['nullWithContent',tlv(0x05,Uint8Array.of(0)),null],['emptyInteger',tlv(0x02),null],['nonminimalInteger',tlv(0x02,Uint8Array.of(0,1)),null],
    ['invalidUtf8Name',null,tlv(0x0c,Uint8Array.of(0xff))],['oddBmpName',null,tlv(0x1e,Uint8Array.of(0))],...residues,
   ]){
    const parts=fields.map(n=>n.bytes),alg=parameter?DER.seq(DER.oid('1.2.840.113549.1.1.11'),parameter):algorithm.bytes;
    parts[offset+1]=alg;if(badName)parts[offset+2]=DER.seq(DER.setOf(DER.seq(DER.oid('2.5.4.3'),badName)));
    const changedTbs=DER.seq(...parts),signed=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,changedTbs));
    const bytes=DER.seq(changedTbs,alg,tlv(0x03,Uint8Array.of(0),signed));let x509Parsed=true;try{new X509Certificate(bytes);}catch{x509Parsed=false;}
    const refused=valuesFixed&&!residueNames.has(name);
    const problem=await signerCertificateProblem(bytes,new Date());assert.equal(problem,refused?'certificate_invalid':null);assert.equal(x509Parsed,false);
    providerCertificate=Buffer.from(bytes).toString('base64');calls=[];
    const started=await signatureSessionHandler(req('start'),signatureDeps());assert.equal(started.status,200);
    const state=new URL((await started.json()).authorizeUrl).searchParams.get('state');
    const response=await signatureSessionHandler(req('complete','aal2',{state,code:'synthetic'}),signatureDeps());assert.equal(response.status,refused?409:200);
    if(refused)assert.equal(calls.find(c=>c.name==='signature_activate_session'),undefined);
    else assert.equal(calls.find(c=>c.name==='signature_activate_session')?.args.p_cert_sha256,hash(bytes));
    remainingDerCases.push({name,helperProblem:problem,x509Parsed,completeStatus:response.status,activationCalled:!refused});
   }
  }
  providerCertificate=Buffer.from(der).toString('base64');calls=[];
  const retryStart=await signatureSessionHandler(req('start'),signatureDeps());assert.equal(retryStart.status,200);
  const retryState=new URL((await retryStart.json()).authorizeUrl).searchParams.get('state');
  const positive=await signatureSessionHandler(req('complete','aal2',{state:retryState,code:'synthetic'}),signatureDeps());
  assert.equal(positive.status,200);assert.equal(calls.find(c=>c.name==='signature_activate_session')?.args.p_cert_sha256,hash(der));
  certificate={emptyHttpStatus:completed.status,emptyCertificateActivated:false,validRsaControlHttpStatus:positive.status};
 }else{
  assert.ok(activation);assert.equal(activation.args.p_cert_sha256,hash(new Uint8Array()));
  certificate={httpStatus:completed.status,active:(await completed.json()).active,emptyCertificateActivated:true};assert.equal(certificate.active,true);
 }

 let pulled=0,cancelled=false;const chunk=new TextEncoder().encode('x'.repeat(1024));
 const stream=new ReadableStream({pull(controller){if(pulled===100){controller.close();return;}pulled++;controller.enqueue(chunk);},cancel(){cancelled=true;}});
 const oversized=new Request('https://edge.synthetic.invalid/functions/v1/sign-document',{method:'POST',headers:{Authorization:'Bearer '+token('aal2')},body:stream,duplex:'half'});
 calls=[];const oversizedResponse=await signDocumentHandler(oversized,signatureDeps());assert.equal(oversizedResponse.status,400);
 if(fixed){assert.ok(pulled<=10);assert.equal(cancelled,true);assert.equal(calls.length,0);}else{assert.equal(pulled,100);assert.equal(cancelled,false);}

 const resumed=[];
 for(const observed of ['prepared','ambiguous']){
  const operation={operation_id:op,user_id:user,prescription_id:rx,state:observed,session_id:session,session_generation:1,psc_attempts:observed==='prepared'?0:1,prepared_pdf_sha256:'b'.repeat(64),to_be_signed_sha256:'c'.repeat(64),policy_oid:'synthetic',cleanup_pending:false};
  const deps=signatureDeps();const steps=[];
  deps.rpc=async(name,args)=>{steps.push(name);if(name==='signature_reserve')return {...operation};if(name==='signature_session_token')throw Object.assign(new Error(),{code:'P4031'});
   if(fixed&&name==='signature_close'){assert.equal(args.p_to,'cancelled_by_revocation');assert.deepEqual(args.p_data,{expectedState:observed,attempt:operation.psc_attempts});operation.state='cancelled_by_revocation';operation.cleanup_pending=observed==='ambiguous';return {...operation};}
   if(fixed&&name==='signature_cleanup_done'){operation.cleanup_pending=false;return null;}
   if(!fixed&&name==='signature_advance'){assert.equal(args.p_to,'prepared');assert.deepEqual(args.p_data,{});if(observed==='prepared')throw Object.assign(new Error(),{code:'22023'});return {...operation};}throw new Error('Unexpected memory SQL step');};
  const body={prescriptionId:rx,operationId:op,shownPdfSha256:'a'.repeat(64),humanRetry:true};
  const response=await signDocumentHandler(new Request('https://edge.synthetic.invalid/sign-document',{method:'POST',headers:{Authorization:'Bearer '+token('aal2')},body:JSON.stringify(body)}),deps);
  assert.equal(response.status,fixed?409:observed==='prepared'?400:202);
  if(fixed){assert.equal(operation.state,'cancelled_by_revocation');assert.equal(operation.cleanup_pending,false);}
  resumed.push({observed,status:response.status,response:await response.json(),mirroredStateAfter:operation.state,steps});
 }
 report={syntheticOnly:true,sourceBaseline:baseline,realHandlersAndAdapters:true,authSdkAndProviderInMemory:true,nativeAuthHttp:false,sqlIntegration:false,externalCalls:false,
  aal1VerifiedFactorRoutes:aal1,aal2RouteControls:aal2Control,storageClassification:storage,certificate,...(fixed?{malformedCertificates,realStorageSdk}:{}),...(edgesFixed?{remainingDerCases}:{}),bodyLimit:{advertisedBytes:8192,...(fixed?{bytesPulledIncludingPrefetch:pulled*1024}:{bytesConsumed:pulled*1024}),cancelled,httpStatus:oversizedResponse.status},
  resumeWithEndedPsc:{rpcBranchesMirroredFromSql:true,cases:resumed},sources:[...sources].map(([path,source])=>({path,sha256:hash(source)})),ownSource:{path:ownPath,sha256:ownHash}};
}finally{hooks.deregister();globalThis.fetch=originalGlobals.fetch;
 if(originalGlobals.Deno===undefined)delete globalThis.Deno;else globalThis.Deno=originalGlobals.Deno;
 if(originalGlobals.sdk===undefined)delete globalThis.cortexReviewSdk;else globalThis.cortexReviewSdk=originalGlobals.sdk;
}
assert.equal(hash(readFileSync(ownPath)),ownHash);
const directory='docs/reviews/2026-11-05/'+(valuesFixed?'signature-values-retest':edgesFixed?'signature-handler-edges-retest':fixed?'signature-handler-retest':'signature-handler-boundaries');mkdirSync(directory,{recursive:true});writeFileSync(directory+'/'+(fixed?'boundaries.json':'counterexamples.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({aal1Routes:report.aal1VerifiedFactorRoutes,aal2Controls:report.aal2RouteControls,storage:report.storageClassification,certificate:report.certificate,bodyLimit:report.bodyLimit,resume:report.resumeWithEndedPsc.cases})+'\n');
