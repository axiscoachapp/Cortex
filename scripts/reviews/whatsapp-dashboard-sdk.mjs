// Installed FunctionsClient, synthetic in-memory transport, no native requests.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';

const sources=[],calls=[],unexpected=[],checks=[];
const digest=text=>createHash('sha256').update(text).digest('hex');
const read=path=>{const text=readFileSync(path,'utf8');sources.push({path,sha256:digest(text)});return text;};
const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={from:'2026-11-01T00:00:00Z',to:'2026-11-07T00:00:00Z'};
const owner={userId:id(1),name:'Equipe sintética A',role:'reception',ambiguous:false,openCount:2};
const other={...owner,userId:id(2),name:'Equipe sintética B',role:'admin',ambiguous:true,openCount:1};
const sample=()=>({schemaVersion:1,asOf:'2026-11-07T12:00:00.000Z',window:{from:'2026-11-01T00:00:00.000Z',to:'2026-11-07T00:00:00.000Z',timeZone:'America/Sao_Paulo'},coverage:'latest_cycle_only',cohort:{incomingCycles:4,withHumanSend:2,withoutHumanSend:2,medianFirstHumanSendSeconds:600,closedWithoutHumanSend:1},openNow:{total:4,unassigned:1,assignedToIneligible:0,owners:{items:[owner,other],nextBefore:null}},unavailable:{abandonment:'no_explicit_event',appointments:'scoped_source_required'}});
let mode='success',controller,started,signalObserved;
const memoryFetch=async(resource,init)=>{
  const request=new Request(resource,init),url=new URL(request.url);
  if(url.origin!=='http://127.0.0.1:9999'||url.pathname!=='/functions/v1/whatsapp-api'){
    unexpected.push({kind:'resource',method:request.method,path:url.pathname});throw new Error('Unexpected memory resource');
  }
  const body=await request.json();calls.push({method:request.method,path:url.pathname,body});
  try{
    assert.equal(request.method,'POST');assert.deepEqual(body,{action:'dashboard',from:sample().window.from,to:sample().window.to,before:mode==='next'?`a1.${id(1)}`:null,limit:mode==='first'||mode==='next'?1:50});
  }catch(error){unexpected.push({kind:'request-contract',method:request.method,path:url.pathname});throw error;}
  if(mode==='lost')throw new TypeError('SYNTHETIC PRIVATE transport detail');
  if(mode==='in-flight'){signalObserved=request.signal;started();return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(new DOMException('Synthetic abort','AbortError')),{once:true}));}
  if(mode==='late')controller.abort();
  let data=sample();
  if(mode==='first')data.openNow.owners={items:[owner],nextBefore:`a1.${id(1)}`};
  if(mode==='next')data.openNow.owners={items:[other],nextBefore:null};
  if(mode==='empty'){
    data.cohort={incomingCycles:0,withHumanSend:0,withoutHumanSend:0,medianFirstHumanSendSeconds:null,closedWithoutHumanSend:0};
    data.openNow={total:0,unassigned:0,assignedToIneligible:0,owners:{items:[],nextBefore:null}};
  }
  if(mode==='denominators')data.cohort.incomingCycles=5;
  if(mode==='false-zero')data.cohort={incomingCycles:4,withHumanSend:0,withoutHumanSend:4,medianFirstHumanSendSeconds:0,closedWithoutHumanSend:1};
  if(mode==='wrong-window')data.window.from='2026-11-02T00:00:00.000Z';
  if(mode==='extra')data.patientId=id(999);
  if(mode==='wrong-cursor')data.openNow.owners.nextBefore=`a1.${id(99)}`;
  if(mode==='dropped-owner')data.openNow.owners={items:[owner],nextBefore:null};
  if(mode==='overflow')data.openNow={total:52,unassigned:1,assignedToIneligible:0,owners:{items:Array.from({length:51},(_,i)=>({...owner,userId:id(i+1),name:`Equipe sintética ${i+1}`,openCount:1})),nextBefore:null}};
  if(mode==='wrong-coverage')data.coverage='all_history';
  if(mode==='invented-availability')data.unavailable.appointments=0;
  const status=mode==='forbidden'?403:mode==='directory_unavailable'?503:200;
  if(status!==200)data={code:mode,error:'SYNTHETIC PRIVATE detail'};
  return new Response(mode==='truncated'?'{"cohort":':JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
const client=createClient('http://127.0.0.1:9999','synthetic-not-a-key',{global:{fetch:memoryFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const slot='__cortexDashboardSdk_'+process.pid;globalThis[slot]=client;
try{
  const clientUrl=moduleUrl('export const supabase=globalThis['+JSON.stringify(slot)+'];'),errorUrl=moduleUrl(read('src/lib/functionErrors.ts'));
  let source=read('src/features/reception/whatsappDashboard.ts');
  for(const [from,to] of [["'@/integrations/supabase/client'",JSON.stringify(clientUrl)],["'@/lib/functionErrors'",JSON.stringify(errorUrl)],["'zod'",JSON.stringify(import.meta.resolve('zod'))]]){assert.equal(source.split(from).length,2);source=source.replace(from,to);}
  const {readWhatsAppDashboard,WhatsAppDashboardReadError}=await import(moduleUrl(source));
  for(const test of [
    {mode:'success'},{mode:'first'},{mode:'next'},{mode:'empty'},
    ...['denominators','false-zero','wrong-window','extra','wrong-cursor','dropped-owner','overflow','wrong-coverage','invented-availability'].map(mode=>({mode,code:'INVALID_RESPONSE'})),
    {mode:'forbidden',code:'forbidden'},{mode:'directory_unavailable',code:'directory_unavailable'},{mode:'lost',code:'unavailable'},{mode:'truncated',code:'unavailable'},
  ]){
    mode=test.mode;const before=calls.length,args=mode==='next'?{...input,before:`a1.${id(1)}`,limit:1}:mode==='first'?{...input,limit:1}:input;
    if(test.code){const error=await readWhatsAppDashboard(args).catch(error=>error);assert.ok(error instanceof WhatsAppDashboardReadError);assert.equal(error.code,test.code);assert.ok(!error.message.includes('SYNTHETIC PRIVATE'));}
    else{
      const result=await readWhatsAppDashboard(args);
      if(mode==='success')assert.deepEqual(result,sample());
      if(mode==='empty'){assert.equal(result.cohort.medianFirstHumanSendSeconds,null);assert.equal(result.unavailable.appointments,'scoped_source_required');}
      if(mode==='first'){assert.equal(result.openNow.total,4);assert.deepEqual(result.openNow.owners,{items:[owner],nextBefore:`a1.${id(1)}`});}
      if(mode==='next'){assert.equal(result.openNow.total,4);assert.deepEqual(result.openNow.owners,{items:[other],nextBefore:null});}
    }
    assert.equal(calls.length,before+1);checks.push({case:mode,calls:1,outcome:test.code??'aggregate'});
  }
  const before=calls.length;
  for(const [name,args] of [['impossible-date',{from:'2026-02-30T00:00:00Z',to:'2026-03-03T00:00:00Z'}],['boolean-limit',{...input,limit:true}],['authority',{...input,clinicId:id(999)}]]){
    await assert.rejects(readWhatsAppDashboard(args),error=>error.code==='invalid');assert.equal(calls.length,before);checks.push({case:name,calls:0,outcome:'invalid'});
  }
  controller=new AbortController();controller.abort();await assert.rejects(readWhatsAppDashboard(input,controller.signal),error=>error.code==='cancelled');assert.equal(calls.length,before);checks.push({case:'pre-aborted',calls:0,outcome:'cancelled'});
  mode='late';controller=new AbortController();await assert.rejects(readWhatsAppDashboard(input,controller.signal),error=>error.code==='cancelled');assert.equal(calls.length,before+1);checks.push({case:'late',calls:1,outcome:'cancelled'});
  mode='in-flight';controller=new AbortController();const ready=new Promise(resolve=>{started=resolve;}),pending=readWhatsAppDashboard(input,controller.signal);await ready;assert.equal(signalObserved.aborted,false);controller.abort();await assert.rejects(pending,error=>error.code==='cancelled');assert.equal(signalObserved.aborted,true);assert.equal(calls.length,before+2);checks.push({case:'in-flight',calls:1,outcome:'cancelled'});
  assert.deepEqual(unexpected,[]);const sourceHashesStable=sources.every(x=>digest(readFileSync(x.path,'utf8'))===x.sha256);assert.ok(sourceHashesStable);
  const report={syntheticOnly:true,nativeNetworkCalls:0,sdkVersion:JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json','utf8')).version,checks,calls,unexpected,sources,sourceHashesStable,limits:'Installed FunctionsClient only, memory fetch; no UI,real Auth/SQL/clinical data or commands. Owner pages are separate snapshots, not concatenated totals.'};
  writeFileSync('docs/reviews/2026-11-07/whatsapp-dashboard/SDK.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,calls:calls.length,sourceHashesStable,unexpected:unexpected.length}));
}finally{delete globalThis[slot];}
