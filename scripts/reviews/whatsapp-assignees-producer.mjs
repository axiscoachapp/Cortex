// Frozen producer, in-memory dependencies, no network or product edits.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const baseline=process.argv[2];
assert.ok(process.argv.length===3||process.argv.length===4);assert.match(baseline??'',/^[0-9a-f]{40}$/);
assert.ok(process.argv[3]===undefined||process.argv[3]==='--directory-guard');
const directoryGuard=process.argv[3]==='--directory-guard';
const sources=[];
const source=path=>{const text=execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8',windowsHide:true});sources.push({path,sha256:createHash('sha256').update(text).digest('hex')});return text;};
const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
let handler=source('supabase/functions/_shared/whatsappHandlers.ts');
for(const name of ['psc','whatsapp','whatsappFlow'])handler=handler.replaceAll(`'./${name}.ts'`,JSON.stringify(moduleUrl(source(`supabase/functions/_shared/${name}.ts`))));
source('supabase/functions/_shared/whatsappDeps.ts');
source('supabase/migrations/20261104130000_controlled_prescription.sql');
source('docs/product/whatsapp/CONTRATO.md');
const {apiHandler}=await import(moduleUrl(handler));
const userId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinicId='11111111-1111-4111-8111-111111111111';
let rows=[],caller={userId:userId(900),clinicId,admin:true,reception:false};
const calls=[],checks=[];
const deps={corsHeaders:{},authorize:async()=>caller,authFailure:()=>null,config:{},store:{assignees:async(clinic,after,limit)=>{
  assert.equal(clinic,clinicId);calls.push({after,limit});
  return rows.filter(r=>after===null||r.user_id>after).slice(0,limit);
}}};
async function request(body){const response=await apiHandler(new Request('https://example.invalid/api',{method:'POST',body:JSON.stringify(body)}),deps);return {status:response.status,data:await response.json()};}
rows=[{user_id:userId(1),name:'Equipe sintética A',role:'reception'},{user_id:userId(2),name:'Equipe sintética B',role:'admin'}];
let response=await request({action:'assignees',limit:1});
assert.equal(response.status,200);assert.deepEqual(response.data,{items:[{userId:userId(1),name:rows[0].name,role:'reception',ambiguous:false}],nextBefore:`a1.${userId(1)}`});
response=await request({action:'assignees',limit:1,before:response.data.nextBefore});
assert.equal(response.status,200);assert.equal(response.data.items[0].userId,userId(2));assert.equal(response.data.nextBefore,null);
checks.push({case:'two_explicit_pages',passed:true});
rows=[{user_id:userId(1),name:' Equipe sintética ',role:'reception'},{user_id:userId(2),name:'EQUIPE SINTÉTICA',role:'admin'}];
response=await request({action:'assignees'});assert.equal(response.status,200);assert.ok(response.data.items.every(r=>r.ambiguous));checks.push({case:'case_and_space_collision_control',passed:true});
for(const body of [{action:'assignees',limit:0},{action:'assignees',limit:51},{action:'assignees',before:'bad'}]){
  const before=calls.length;response=await request(body);assert.equal(response.status,400);assert.equal(calls.length,before);
}checks.push({case:'invalid_limits_and_cursor',passed:true});
caller={...caller,admin:false};const before=calls.length;response=await request({action:'assignees'});assert.equal(response.status,403);assert.equal(calls.length,before);checks.push({case:'ordinary_clinical_caller_denied_before_store',passed:true});caller={...caller,admin:true};
rows=Array.from({length:501},(_,i)=>({user_id:userId(i+1),name:`Equipe sintética ${i+1}`,role:'reception'}));
rows[0].name=rows[500].name='Nome sintético repetido';
const first=await request({action:'assignees',limit:1});
const last=await request({action:'assignees',limit:1,before:`a1.${userId(500)}`});
assert.equal(first.status,200);assert.equal(last.status,200);assert.equal(first.data.items[0].name,last.data.items[0].name);
checks.push({case:'collision_after_global_scan_500',passed:first.data.items[0].ambiguous===true&&last.data.items[0].ambiguous===true,eligibleRows:501,displayNamesEqual:true,flags:[first.data.items[0].ambiguous,last.data.items[0].ambiguous]});
rows=[{user_id:userId(1),name:'A'.repeat(256)+'X',role:'admin'},{user_id:userId(2),name:'A'.repeat(256)+'Y',role:'admin'}];
response=await request({action:'assignees'});assert.equal(response.status,200);assert.equal(response.data.items.length,2);
assert.equal(response.data.items[0].name,response.data.items[1].name);
checks.push({case:'collision_after_display_truncation',passed:response.data.items.every(r=>r.ambiguous===true),inputNameLengths:rows.map(r=>r.name.length),displayNameLength:response.data.items[0].name.length,displayNamesEqual:true,flags:response.data.items.map(r=>r.ambiguous)});
if(directoryGuard){
  rows=Array.from({length:5000},(_,i)=>({user_id:userId(i+1),name:`Equipe sintética ${i+1}`,role:'reception'}));
  response=await request({action:'assignees',limit:1});
  assert.equal(response.status,200);assert.equal(response.data.items[0].ambiguous,false);checks.push({case:'complete_directory_5000_positive',passed:true});
  rows.push({user_id:userId(5001),name:'Equipe sintética 5001',role:'reception'});
  response=await request({action:'assignees',limit:1});
  assert.equal(response.status,503);assert.equal(response.data.code,'directory_unavailable');assert.equal('items' in response.data,false);
  checks.push({case:'directory_5001_unavailable_without_partial_page',passed:true});
}
const report={baseline,directoryGuard,syntheticOnly:true,networkCalls:0,accepted:checks.every(c=>c.passed),checks,calls,sources,limits:'Frozen production apiHandler with fake authorization/store. Store models the documented eligible sorted rows and requested limit; no real Auth/SQL/PostgREST eligibility or UI proof.'};
const folder='docs/reviews/2026-11-07/whatsapp-assignees';mkdirSync(folder,{recursive:true});writeFileSync(folder+(directoryGuard?'/PRODUCER_'+baseline.slice(0,7).toUpperCase()+'.json':'/PRODUCER.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({accepted:report.accepted,checks:checks.length,failed:checks.filter(c=>!c.passed)}));if(!report.accepted)process.exitCode=1;
