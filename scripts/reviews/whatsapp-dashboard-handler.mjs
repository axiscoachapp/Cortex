// Frozen production handler, synthetic authorization/store/RPC, never native network.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import ts from 'typescript';

const baseline=process.argv[2];assert.equal(process.argv.length,3);assert.match(baseline??'',/^[0-9a-f]{40}$/);
const sources=[];
const read=path=>{const text=execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8',windowsHide:true});sources.push({path,sha256:createHash('sha256').update(text).digest('hex')});return text;};
const url=text=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
let text=read('supabase/functions/_shared/whatsappHandlers.ts');for(const name of ['psc','whatsapp','whatsappFlow'])text=text.replaceAll(`'./${name}.ts'`,JSON.stringify(url(read(`supabase/functions/_shared/${name}.ts`))));
const {apiHandler}=await import(url(text));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(100),now=new Date('2026-11-07T12:00:00Z');
const base={action:'dashboard',from:'2026-11-01T00:00:00Z',to:'2026-11-07T00:00:00Z'};
const snapshot={cohort:{incomingCycles:3,withHumanSend:2,withoutHumanSend:1,medianFirstHumanSendSeconds:600,closedWithoutHumanSend:1},openNow:{total:4,unassigned:1,assignedToIneligible:1,owners:[{userId:id(1),openCount:1},{userId:id(2),openCount:1}]}};
let caller={userId:id(99),clinicId:clinic,admin:false,reception:true};
let directory=[{user_id:id(1),name:'Admin sintético',role:'admin'},{user_id:id(2),name:'Recepção sintética',role:'reception'}];
let current=snapshot;
const rpcCalls=[],directoryCalls=[],checks=[];
const deps={corsHeaders:{},authorize:async()=>caller,authFailure:()=>null,config:{},now:()=>now,
  rpc:async(name,args)=>{assert.equal(name,'whatsapp_dashboard');rpcCalls.push(args);return structuredClone(current);},
  store:{assignees:async(clinicId,after,limit)=>{assert.equal(clinicId,clinic);directoryCalls.push({after,limit});return directory.filter(r=>after===null||r.user_id>after).slice(0,limit);}}};
async function request(body){const response=await apiHandler(new Request('https://example.invalid/api',{method:'POST',body:JSON.stringify(body)}),deps);return {status:response.status,data:await response.json()};}
let response=await request(base);
assert.equal(response.status,200);assert.deepEqual(rpcCalls.at(-1),{p_clinic:clinic,p_from:'2026-11-01T00:00:00.000Z',p_to:'2026-11-07T00:00:00.000Z'});
assert.deepEqual(response.data,{schemaVersion:1,asOf:now.toISOString(),window:{from:'2026-11-01T00:00:00.000Z',to:'2026-11-07T00:00:00.000Z',timeZone:'America/Sao_Paulo'},coverage:'latest_cycle_only',cohort:snapshot.cohort,openNow:{total:4,unassigned:1,assignedToIneligible:1,owners:{items:directory.map((r,i)=>({userId:r.user_id,name:r.name,role:r.role,ambiguous:false,openCount:snapshot.openNow.owners[i].openCount})),nextBefore:null}},unavailable:{abandonment:'no_explicit_event',appointments:'scoped_source_required'}});
checks.push({case:'reception_server_clinic_and_exact_projection',passed:true});
caller={...caller,admin:true,reception:false};response=await request({...base,limit:1});assert.equal(response.status,200);assert.equal(response.data.openNow.total,4);assert.equal(response.data.openNow.owners.items.length,1);assert.equal(response.data.openNow.owners.nextBefore,`a1.${id(1)}`);
response=await request({...base,limit:1,before:`a1.${id(1)}`});assert.equal(response.status,200);assert.equal(response.data.openNow.owners.items[0].userId,id(2));assert.equal(response.data.openNow.owners.nextBefore,null);assert.equal(response.data.openNow.total,4);checks.push({case:'admin_explicit_owner_pages_preserve_complete_totals',passed:true});
directory=directory.slice(0,1);response=await request(base);assert.equal(response.status,200);assert.equal(response.data.openNow.assignedToIneligible,2);assert.equal(response.data.openNow.owners.items.length,1);checks.push({case:'vanished_owner_moves_to_ineligible',passed:true});
directory=[...directory,{user_id:id(2),name:'Recepção sintética',role:'reception'}];current={...snapshot,cohort:{incomingCycles:0,withHumanSend:0,withoutHumanSend:0,medianFirstHumanSendSeconds:null,closedWithoutHumanSend:0}};response=await request(base);assert.equal(response.status,200);assert.equal(response.data.cohort.medianFirstHumanSendSeconds,null);checks.push({case:'empty_cohort_preserves_null',passed:true});current=snapshot;
async function refusal(name,body){const beforeRpc=rpcCalls.length,beforeDirectory=directoryCalls.length;const r=await request(body);const passed=r.status===400&&rpcCalls.length===beforeRpc&&directoryCalls.length===beforeDirectory;checks.push({case:name,passed,category:passed?'pass':r.status===500?'fixture_failure':'contract_failure',status:r.status,rpcCalls:rpcCalls.length-beforeRpc,directoryCalls:directoryCalls.length-beforeDirectory,...(r.status===200?{returnedWindow:r.data.window,returnedOwnerCount:r.data.openNow.owners.items.length}:{})});}
for(const key of ['clinicId','clinic_id','actorId','userId','role','admin','reception','p_clinic'])await refusal('authority_'+key,{...base,[key]:key.includes('Id')?id(999):'synthetic'});
for(const [name,patch] of [
  ['date_only',{from:'2026-11-01'}],['reversed',{from:base.to,to:base.from}],['future',{to:'2026-11-07T12:00:00.001Z'}],
  ['over_31days',{from:'2026-10-01T00:00:00Z'}],['limit_zero',{limit:0}],['limit_51',{limit:51}],['limit_fraction',{limit:1.5}],['bad_cursor',{before:'invalid'}],
])await refusal(name,{...base,...patch});
caller={...caller,admin:false,reception:false};const before=rpcCalls.length;response=await request(base);assert.equal(response.status,403);assert.equal(rpcCalls.length,before);checks.push({case:'ordinary_doctor_denied_before_rpc',passed:true});caller={...caller,reception:true};
for(const [name,body] of [
  ['impossible_calendar_start',{...base,from:'2026-02-30T00:00:00Z',to:'2026-03-03T00:00:00Z'}],
  ['non_leap_calendar_start',{...base,from:'2025-02-29T00:00:00Z',to:'2025-03-03T00:00:00Z'}],
  ['boolean_limit',{...base,limit:true}],['string_limit',{...base,limit:'2'}],['array_limit',{...base,limit:[2]}],
])await refusal(name,body);
for(const [name,body] of [['valid_leap_day',{...base,from:'2024-02-29T00:00:00Z',to:'2024-03-01T00:00:00Z'}],['exact_31days',{...base,from:'2026-10-01T00:00:00Z',to:'2026-11-01T00:00:00Z'}]]){response=await request(body);assert.equal(response.status,200);checks.push({case:name,passed:true});}
const report={baseline,syntheticOnly:true,nativeNetworkCalls:0,completed:!checks.some(c=>c.category==='fixture_failure'),accepted:checks.every(c=>c.passed),checks,rpcCalls,directoryCalls,sources,limits:'Frozen apiHandler with mocked authorization, directory and aggregate RPC; no real Auth/SQL/clinic data. Invalid-input cases are independent from valid aggregate semantics.'};
mkdirSync('docs/reviews/2026-11-07/whatsapp-dashboard',{recursive:true});writeFileSync('docs/reviews/2026-11-07/whatsapp-dashboard/HANDLER.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({completed:report.completed,accepted:report.accepted,checks:checks.length,failed:checks.filter(c=>!c.passed)}));if(!report.accepted)process.exitCode=1;
