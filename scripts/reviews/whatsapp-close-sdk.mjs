// Real installed SDK + immutable adapter snapshot; fetch stays entirely in memory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';

const sources=[];
const read=path=>{const source=readFileSync(path,'utf8');sources.push({path,sha256:createHash('sha256').update(source).digest('hex')});return source;};
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const conversationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const input={conversationId,revision:7,status:'open',assignedTo:actor},receipt={revision:8,status:'closed',assignedTo:actor},calls=[],unexpected=[],checks=[];
let mode='success',lateController;
const memoryFetch=async(resource,init)=>{
  const request=new Request(resource,init),url=new URL(request.url);
  if(url.origin!=='http://127.0.0.1:9999'||url.pathname!=='/functions/v1/whatsapp-api'){unexpected.push({method:request.method,path:url.pathname});throw new Error('Unexpected synthetic SDK resource');}
  assert.equal(request.method,'POST');const body=await request.json();calls.push({method:request.method,path:url.pathname,body});assert.deepEqual(body,{action:'act',operation:'close',conversationId,revision:input.revision});
  if(mode==='lost')throw new TypeError('SYNTHETIC PRIVATE network detail');
  if(mode==='cancel-after')lateController.abort();
  const status=mode==='stale'?409:mode==='forbidden'?403:200;
  const data=mode==='stale'||mode==='forbidden'?{code:mode,error:'SYNTHETIC PRIVATE response detail'}:mode==='wrong-owner'?{...receipt,assignedTo:other}:mode==='wrong-status'?{...receipt,status:'open'}:mode==='extra'?{...receipt,extra:'SYNTHETIC PRIVATE data'}:receipt;
  return new Response(mode==='truncated'?'\u007b"revision":8,':JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
const client=createClient('http://127.0.0.1:9999','synthetic-not-a-key',{global:{fetch:memoryFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const slot='__cortexCloseSdk_'+process.pid;globalThis[slot]=client;
try{
  const clientUrl=moduleUrl('export const supabase=globalThis['+JSON.stringify(slot)+'];');
  const errorsUrl=moduleUrl(read('src/lib/functionErrors.ts'));
  let baseSource=read('src/features/reception/whatsappClaim.ts');
  for(const [from,to] of [["'@/integrations/supabase/client'",JSON.stringify(clientUrl)],["'@/lib/functionErrors'",JSON.stringify(errorsUrl)],["'zod'",JSON.stringify(import.meta.resolve('zod'))]]){assert.equal(baseSource.split(from).length,2);baseSource=baseSource.replace(from,to);}
  const baseUrl=moduleUrl(baseSource);
  let source=read('src/features/reception/whatsappClose.ts');assert.equal(source.split("'./whatsappClaim'").length,2);source=source.replace("'./whatsappClaim'",JSON.stringify(baseUrl));
  for(const [from,to] of [["'@/integrations/supabase/client'",JSON.stringify(clientUrl)],["'@/lib/functionErrors'",JSON.stringify(errorsUrl)],["'zod'",JSON.stringify(import.meta.resolve('zod'))]]){assert.equal(source.split(from).length,2);source=source.replace(from,to);}
  const {closeWhatsAppConversation,WhatsAppCloseError}=await import(moduleUrl(source));
  for(const sample of [{mode:'success',code:null},{mode:'stale',code:'stale'},{mode:'forbidden',code:'forbidden'},{mode:'wrong-owner',code:'INVALID_RESPONSE'},{mode:'wrong-status',code:'INVALID_RESPONSE'},{mode:'extra',code:'INVALID_RESPONSE'},{mode:'truncated',code:'unavailable'},{mode:'lost',code:'unavailable'}]){
    mode=sample.mode;const before=calls.length;
    if(sample.code){const error=await closeWhatsAppConversation(input,actor).catch(error=>error);assert.ok(error instanceof WhatsAppCloseError);assert.equal(error.code,sample.code);assert.equal(error.needsRefresh,true);assert.ok(!error.message.includes('SYNTHETIC PRIVATE'));}
    else assert.deepEqual(await closeWhatsAppConversation(input,actor),receipt);
    assert.equal(calls.length,before+1);checks.push({case:mode,commands:1,result:sample.code??'receipt-accepted',needsRefresh:!!sample.code});
  }
  const before=calls.length,preCancelled=new AbortController();preCancelled.abort();
  await assert.rejects(closeWhatsAppConversation(input,actor,preCancelled.signal),error=>error.code==='cancelled'&&!error.needsRefresh);
  await assert.rejects(closeWhatsAppConversation({...input,targetUserId:other},actor),error=>error.code==='invalid'&&!error.needsRefresh);
  await assert.rejects(closeWhatsAppConversation({...input,assignedTo:other},actor),error=>error.code==='invalid'&&!error.needsRefresh);
  await assert.rejects(closeWhatsAppConversation({...input,status:'closed'},actor),error=>error.code==='invalid'&&!error.needsRefresh);
  assert.equal(calls.length,before);checks.push({case:'pre-cancelled, closed snapshot, foreign owner and injected target',commands:0});
  mode='cancel-after';lateController=new AbortController();await assert.rejects(closeWhatsAppConversation(input,actor,lateController.signal),error=>error.code==='cancelled'&&error.needsRefresh);assert.equal(calls.length,before+1);checks.push({case:mode,commands:1,result:'cancelled',needsRefresh:true});
  assert.deepEqual(unexpected,[]);for(const entry of sources)assert.equal(createHash('sha256').update(readFileSync(entry.path,'utf8')).digest('hex'),entry.sha256);
  const report={completed:true,syntheticOnly:true,realNetwork:false,sdkVersion:JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json','utf8')).version,sourceMode:'immutable in-memory snapshot; hashes stable before/after',sources,commands:calls.length,checks,unexpected,limits:'Adapter/SDK transport only. No UI/server authorization/SQL CAS/idempotency/RLS/Meta proof.'};
  const out=resolve('docs/reviews/2026-11-07/whatsapp-close/SDK.json');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({completed:true,commands:calls.length,checks:checks.length,realNetwork:false})+'\n');
}finally{delete globalThis[slot];client.auth.stopAutoRefresh();}
