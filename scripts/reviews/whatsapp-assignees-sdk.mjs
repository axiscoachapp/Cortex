// Real installed SDK, in-memory fetch, immutable source snapshots.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';

const sources=[],calls=[],unexpected=[],checks=[];
const digest=text=>createHash('sha256').update(text).digest('hex');
const read=path=>{const text=readFileSync(path,'utf8');sources.push({path,sha256:digest(text)});return text;};
const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row={userId:id(1),name:'Equipe sintética A',role:'reception',ambiguous:false};
const other={...row,userId:id(2),name:'Equipe sintética B',role:'admin',ambiguous:true};
let mode='success',controller,signalObserved,started;
const memoryFetch=async(resource,init)=>{
  const request=new Request(resource,init),url=new URL(request.url);
  if(url.origin!=='http://127.0.0.1:9999'||url.pathname!=='/functions/v1/whatsapp-api'){
    unexpected.push({method:request.method,path:url.pathname});throw new Error('Unexpected memory SDK resource');
  }
  const body=await request.json();calls.push({method:request.method,path:url.pathname,body});
  try{
    assert.equal(request.method,'POST');
    assert.deepEqual(body,mode==='next'?{action:'assignees',before:`a1.${id(2)}`,limit:1}:{action:'assignees',before:null,limit:50});
  }catch(error){unexpected.push({kind:'request-contract',method:request.method,path:url.pathname});throw error;}
  if(mode==='lost')throw new TypeError('SYNTHETIC PRIVATE detail');
  if(mode==='in-flight'){
    signalObserved=request.signal;started();return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(new DOMException('Synthetic abort','AbortError')),{once:true}));
  }
  if(mode==='late')controller.abort();
  const status=mode==='forbidden'?403:200;
  const data=status===403?{code:'forbidden',error:'SYNTHETIC PRIVATE detail'}
    :mode==='empty'?{items:[],nextBefore:null}
    :mode==='next'?{items:[{...row,userId:id(3)}],nextBefore:null}
    :mode==='ambiguous'?{items:[{...row,name:' Mesmo nome ',ambiguous:true},{...other,name:'MESMO NOME',ambiguous:true}],nextBefore:null}
    :mode==='collision'?{items:[{...row,name:' Mesmo nome '},{...other,name:'MESMO NOME',ambiguous:false}],nextBefore:null}
    :mode==='extra'?{items:[{...row,email:'synthetic@example.invalid'}],nextBefore:null}
    :mode==='reversed'?{items:[other,row],nextBefore:null}
    :mode==='wrong-cursor'?{items:[row],nextBefore:`a1.${id(99)}`}
    :mode==='overflow'?{items:Array.from({length:51},(_,i)=>({...row,userId:id(i+1),name:`Equipe sintética ${i+1}`})),nextBefore:null}
    :{items:[row,other],nextBefore:`a1.${id(2)}`};
  return new Response(mode==='truncated'?'{"items":[':JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
const client=createClient('http://127.0.0.1:9999','synthetic-not-a-key',{global:{fetch:memoryFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const slot='__cortexAssigneesSdk_'+process.pid;globalThis[slot]=client;
try{
  const clientUrl=moduleUrl('export const supabase=globalThis['+JSON.stringify(slot)+'];');
  const errorsUrl=moduleUrl(read('src/lib/functionErrors.ts'));
  let source=read('src/features/reception/whatsappAssignees.ts');
  for(const [from,to] of [["'@/integrations/supabase/client'",JSON.stringify(clientUrl)],["'@/lib/functionErrors'",JSON.stringify(errorsUrl)],["'zod'",JSON.stringify(import.meta.resolve('zod'))]]){
    assert.equal(source.split(from).length,2);source=source.replace(from,to);
  }
  const {readWhatsAppAssignees,WhatsAppAssigneeReadError}=await import(moduleUrl(source));
  for(const sample of [
    {mode:'success'},{mode:'next'},{mode:'empty'},{mode:'ambiguous'},
    {mode:'collision',code:'INVALID_RESPONSE'},{mode:'extra',code:'INVALID_RESPONSE'},
    {mode:'reversed',code:'INVALID_RESPONSE'},{mode:'wrong-cursor',code:'INVALID_RESPONSE'},
    {mode:'overflow',code:'INVALID_RESPONSE'},{mode:'forbidden',code:'forbidden'},
    {mode:'lost',code:'unavailable'},{mode:'truncated',code:'unavailable'},
  ]){
    mode=sample.mode;const before=calls.length;
    if(sample.code){const error=await readWhatsAppAssignees().catch(error=>error);assert.ok(error instanceof WhatsAppAssigneeReadError);assert.equal(error.code,sample.code);assert.ok(!error.message.includes('SYNTHETIC PRIVATE'));}
    else{
      const result=await readWhatsAppAssignees(mode==='next'?{before:`a1.${id(2)}`,limit:1}:{});
      assert.equal(result.items.length,mode==='empty'?0:mode==='next'?1:2);
      if(mode==='success'){assert.deepEqual(result,{items:[row,other],nextBefore:`a1.${id(2)}`});}
      if(mode==='ambiguous')assert.ok(result.items.every(r=>r.ambiguous));
    }
    assert.equal(calls.length,before+1);checks.push({case:mode,calls:1,outcome:sample.code??'page'});
  }
  const before=calls.length;
  await assert.rejects(readWhatsAppAssignees({clinicId:id(1)}),error=>error.code==='invalid');assert.equal(calls.length,before);checks.push({case:'authority-input',calls:0,outcome:'invalid'});
  controller=new AbortController();controller.abort();await assert.rejects(readWhatsAppAssignees({},controller.signal),error=>error.code==='cancelled');assert.equal(calls.length,before);checks.push({case:'pre-aborted',calls:0,outcome:'cancelled'});
  mode='late';controller=new AbortController();await assert.rejects(readWhatsAppAssignees({},controller.signal),error=>error.code==='cancelled');assert.equal(calls.length,before+1);checks.push({case:'late',calls:1,outcome:'cancelled'});
  mode='in-flight';controller=new AbortController();const ready=new Promise(resolve=>{started=resolve;});const pending=readWhatsAppAssignees({},controller.signal);await ready;assert.equal(signalObserved.aborted,false);controller.abort();await assert.rejects(pending,error=>error.code==='cancelled');assert.equal(signalObserved.aborted,true);assert.equal(calls.length,before+2);checks.push({case:'in-flight',calls:1,outcome:'cancelled'});
  const sourceHashesStable=sources.every(x=>digest(readFileSync(x.path,'utf8'))===x.sha256);assert.equal(sourceHashesStable,true);assert.deepEqual(unexpected,[]);
  const report={syntheticOnly:true,nativeNetworkCalls:0,sdkVersion:JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json','utf8')).version,checks,calls,sources,sourceHashesStable,unexpected,limits:'Installed FunctionsClient with memory fetch only. No UI, global roster completeness, real Auth/SQL/eligibility, transfer or Meta.'};
  writeFileSync('docs/reviews/2026-11-07/whatsapp-assignees/SDK.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,calls:calls.length,sourceHashesStable,unexpected:unexpected.length}));
}finally{delete globalThis[slot];}
