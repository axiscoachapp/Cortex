import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
const sources=[],calls=[],checks=[],unexpected=[];
const digest=s=>createHash('sha256').update(s).digest('hex');
const read=path=>{const s=readFileSync(path,'utf8');sources.push({path,sha256:digest(s)});return s;};
const moduleUrl=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const id='33333333-3333-4333-8333-333333333333',clinic='22222222-2222-4222-8222-222222222222',other='88888888-8888-4888-8888-888888888888',row={contactId:id,patientId:'44444444-4444-4444-8444-444444444444',doctorId:'55555555-5555-4555-8555-555555555555',patientName:'Beneficiário sintético',doctorName:'Médico sintético',dateOfBirth:null,relationship:'guardian',revision:4,active:true,patientAvailable:true,doctorActive:true},page={items:[row],nextCursor:null};
let mode='success',controller,started,observedSignal;
const memoryFetch=async(resource,init)=>{
 const request=new Request(resource,init),url=new URL(request.url);
 if(url.origin!=='http://127.0.0.1:9999'||url.pathname!=='/rest/v1/rpc/reception_contact_links'){unexpected.push({method:request.method,path:url.pathname});throw new Error('Unexpected synthetic SDK route');}
 assert.equal(request.method,'POST');const body=await request.json();assert.deepEqual(body,{p_clinic:clinic,p_contact:id,p_after:null,p_limit:50});calls.push({method:request.method,path:url.pathname,body});observedSignal=request.signal;
 if(mode==='lost')throw new TypeError('PRIVATE SYNTHETIC FETCH');
 if(mode==='late')controller.abort();
 if(mode==='hold')return await new Promise((resolve,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});started();if(request.signal.aborted)reject(request.signal.reason);});
 const status=mode==='forbidden'?403:200;
 const data=mode==='forbidden'?{code:'42501',message:'PRIVATE SYNTHETIC',details:null,hint:null}:mode==='wrong'?{...page,items:[{...row,patientId:'bad'}]}:mode==='extra'?{...page,secret:'PRIVATE SYNTHETIC'}:mode==='other-contact'?{...page,items:[{...row,contactId:other}]}:mode==='bad-cursor'?{...page,nextCursor:other}:mode==='unordered'?{...page,items:[{...row,patientId:other},row]}:mode==='over-limit'?{...page,items:Array.from({length:51},(_,index)=>({...row,patientId:'44444444-4444-4444-8444-'+String(index+1).padStart(12,'0')}))}:page;
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
const client=createClient('http://127.0.0.1:9999','synthetic-not-a-key',{global:{fetch:memoryFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),slot='__cortexContactLinkReadSdk_'+process.pid;globalThis[slot]=client;
try{
 const clientUrl=moduleUrl('export const supabase=globalThis['+JSON.stringify(slot)+'];');
 const contractsUrl=moduleUrl(read('src/features/reception/contracts.ts').replace("'zod'",JSON.stringify(import.meta.resolve('zod'))));
 const errorsUrl=moduleUrl(read('src/features/reception/accessErrors.ts'));
 let source=read('src/features/reception/api.ts');for(const [from,to]of [["'zod'",JSON.stringify(import.meta.resolve('zod'))],["'@/integrations/supabase/client'",JSON.stringify(clientUrl)],["'./contracts'",JSON.stringify(contractsUrl)],["'./accessErrors'",JSON.stringify(errorsUrl)]]){assert.equal(source.split(from).length,2);source=source.replace(from,to);}
 const {receptionApi,ReceptionError}=await import(moduleUrl(source));
 for(const sample of [{mode:'success',code:null},{mode:'forbidden',code:'42501'},{mode:'wrong',code:'INVALID_RESPONSE'},{mode:'extra',code:'INVALID_RESPONSE'},{mode:'other-contact',code:'INVALID_RESPONSE'},{mode:'bad-cursor',code:'INVALID_RESPONSE'},{mode:'unordered',code:'INVALID_RESPONSE'},{mode:'over-limit',code:'INVALID_RESPONSE'},{mode:'lost',code:''}]){
  mode=sample.mode;controller=new AbortController();const before=calls.length;
  if(sample.code!==null){const error=await receptionApi.contactLinks(clinic,id,null,50,controller.signal).catch(e=>e);assert.ok(error instanceof ReceptionError);assert.equal(error.code,sample.code);assert.ok(!error.message.includes('PRIVATE'));}
  else{assert.deepEqual(await receptionApi.contactLinks(clinic,id,null,50,controller.signal),page);controller.abort();assert.equal(observedSignal.aborted,true);}
  assert.equal(calls.length,before+1);checks.push({case:mode,calls:1,outcome:sample.code??'page'});
 }
 const before=calls.length;controller=new AbortController();controller.abort();await assert.rejects(receptionApi.contactLinks(clinic,id,null,50,controller.signal),e=>e.code==='cancelled');assert.equal(calls.length,before);checks.push({case:'pre-aborted',calls:0,outcome:'cancelled'});
 mode='late';controller=new AbortController();await assert.rejects(receptionApi.contactLinks(clinic,id,null,50,controller.signal),e=>e.code==='cancelled');assert.equal(calls.length,before+1);checks.push({case:mode,calls:1,outcome:'cancelled'});
 mode='hold';controller=new AbortController();const began=new Promise(resolve=>{started=resolve;});const pending=receptionApi.contactLinks(clinic,id,null,50,controller.signal);await began;controller.abort();await assert.rejects(pending,e=>e.code==='cancelled');assert.equal(observedSignal.aborted,true);assert.equal(calls.length,before+2);checks.push({case:'in-flight-aborted',calls:1,outcome:'cancelled'});
 mode='success';const legacyBefore=calls.length;assert.deepEqual(await receptionApi.contactLinks(clinic,id),page);assert.equal(calls.length,legacyBefore+1);checks.push({case:'without-caller-signal',calls:1,outcome:'same DTO and deadline'});
 const stable=sources.every(s=>digest(readFileSync(s.path,'utf8'))===s.sha256);assert.equal(stable,true);assert.deepEqual(unexpected,[]);
 const report={syntheticOnly:true,nativeNetworkCalls:0,sdkVersion:JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json','utf8')).version,checks,calls,unexpected,sources,sourceHashesStable:stable,limits:'Installed client and PostgREST transport only; no real DB/Auth/permissions, records or booking.'};mkdirSync('docs/reviews/2026-11-07/contact-link-reads',{recursive:true});writeFileSync('docs/reviews/2026-11-07/contact-link-reads/SDK.json',JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({checks:checks.length,calls:calls.length,sourceHashesStable:stable,unexpected:unexpected.length})+'\n');
}finally{delete globalThis[slot];}
