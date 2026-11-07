import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
const sources=[],calls=[],checks=[],unexpected=[];
const digest=s=>createHash('sha256').update(s).digest('hex');
const read=path=>{const s=readFileSync(path,'utf8');sources.push({path,sha256:digest(s)});return s;};
const moduleUrl=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const id='33333333-3333-4333-8333-333333333333',page={id,name:'Contato sintético',phone:'Telefone sintético',revision:4};
let mode='success',controller,started,observedSignal;
const memoryFetch=async(resource,init)=>{
 const request=new Request(resource,init),url=new URL(request.url);
 if(url.origin!=='http://127.0.0.1:9999'||url.pathname!=='/rest/v1/rpc/reception_contact_edit'){unexpected.push({method:request.method,path:url.pathname});throw new Error('Unexpected synthetic SDK route');}
 assert.equal(request.method,'POST');const body=await request.json();assert.deepEqual(body,{p_contact:id});calls.push({method:request.method,path:url.pathname,body});observedSignal=request.signal;
 if(mode==='lost')throw new TypeError('PRIVATE SYNTHETIC FETCH');
 if(mode==='late')controller.abort();
 if(mode==='hold')return await new Promise((resolve,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});started();if(request.signal.aborted)reject(request.signal.reason);});
 const status=mode==='forbidden'?403:200;
 const data=mode==='forbidden'?{code:'42501',message:'PRIVATE SYNTHETIC',details:null,hint:null}:mode==='wrong'?{...page,id:'bad'}:mode==='extra'?{...page,secret:'PRIVATE SYNTHETIC'}:page;
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
const client=createClient('http://127.0.0.1:9999','synthetic-not-a-key',{global:{fetch:memoryFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),slot='__cortexContactCorrectionReadSdk_'+process.pid;globalThis[slot]=client;
try{
 const clientUrl=moduleUrl('export const supabase=globalThis['+JSON.stringify(slot)+'];');
 const contractsUrl=moduleUrl(read('src/features/reception/contracts.ts').replace("'zod'",JSON.stringify(import.meta.resolve('zod'))));
 const errorsUrl=moduleUrl(read('src/features/reception/accessErrors.ts'));
 let source=read('src/features/reception/api.ts');for(const [from,to]of [["'zod'",JSON.stringify(import.meta.resolve('zod'))],["'@/integrations/supabase/client'",JSON.stringify(clientUrl)],["'./contracts'",JSON.stringify(contractsUrl)],["'./accessErrors'",JSON.stringify(errorsUrl)]]){assert.equal(source.split(from).length,2);source=source.replace(from,to);}
 const {receptionApi,ReceptionError}=await import(moduleUrl(source));
 for(const sample of [{mode:'success',code:null},{mode:'forbidden',code:'42501'},{mode:'wrong',code:'INVALID_RESPONSE'},{mode:'extra',code:'INVALID_RESPONSE'},{mode:'lost',code:''}]){
  mode=sample.mode;controller=new AbortController();const before=calls.length;
  if(sample.code!==null){const error=await receptionApi.contactEdit(id,controller.signal).catch(e=>e);assert.ok(error instanceof ReceptionError);assert.equal(error.code,sample.code);assert.ok(!error.message.includes('PRIVATE'));}
  else{assert.deepEqual(await receptionApi.contactEdit(id,controller.signal),page);controller.abort();assert.equal(observedSignal.aborted,true);}
  assert.equal(calls.length,before+1);checks.push({case:mode,calls:1,outcome:sample.code??'page'});
 }
 const before=calls.length;controller=new AbortController();controller.abort();await assert.rejects(receptionApi.contactEdit(id,controller.signal),e=>e.code==='cancelled');assert.equal(calls.length,before);checks.push({case:'pre-aborted',calls:0,outcome:'cancelled'});
 mode='late';controller=new AbortController();await assert.rejects(receptionApi.contactEdit(id,controller.signal),e=>e.code==='cancelled');assert.equal(calls.length,before+1);checks.push({case:mode,calls:1,outcome:'cancelled'});
 mode='hold';controller=new AbortController();const began=new Promise(resolve=>{started=resolve;});const pending=receptionApi.contactEdit(id,controller.signal);await began;controller.abort();await assert.rejects(pending,e=>e.code==='cancelled');assert.equal(observedSignal.aborted,true);assert.equal(calls.length,before+2);checks.push({case:'in-flight-aborted',calls:1,outcome:'cancelled'});
 mode='success';const legacyBefore=calls.length;assert.deepEqual(await receptionApi.contactEdit(id),page);assert.equal(calls.length,legacyBefore+1);checks.push({case:'without-caller-signal',calls:1,outcome:'same DTO and deadline'});
 const stable=sources.every(s=>digest(readFileSync(s.path,'utf8'))===s.sha256);assert.equal(stable,true);assert.deepEqual(unexpected,[]);
 const report={syntheticOnly:true,nativeNetworkCalls:0,sdkVersion:JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json','utf8')).version,checks,calls,unexpected,sources,sourceHashesStable:stable,limits:'Installed client and PostgREST transport only; no real DB/Auth/permissions, records or booking.'};mkdirSync('docs/reviews/2026-11-07/contact-correction-reads',{recursive:true});writeFileSync('docs/reviews/2026-11-07/contact-correction-reads/SDK.json',JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({checks:checks.length,calls:calls.length,sourceHashesStable:stable,unexpected:unexpected.length})+'\n');
}finally{delete globalThis[slot];}
