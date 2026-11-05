import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const args=process.argv.slice(2),fixed=args.includes('--expect-fixed'),sourceArg=args.find(a=>a.startsWith('--source='));
assert.ok(sourceArg&&/^--source=[0-9a-f]{40}$/.test(sourceArg)&&args.every(a=>a===sourceArg||a==='--expect-fixed')&&new Set(args).size===args.length);
const baseline=sourceArg.slice(9),ownPath='scripts/test-validate-contract-review.mjs',hash=s=>createHash('sha256').update(s).digest('hex'),ownHash=hash(readFileSync(ownPath));
const path='supabase/functions/validate-prescription/index.ts';
const result=spawnSync('git',['show',baseline+':'+path],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4*1024*1024});assert.equal(result.status,0,result.stderr);
const source=result.stdout,start=source.indexOf('const UUID = '),end=source.indexOf('import { fetchWithDeadline',start);
assert.ok(start>=0&&end>start,'Unexpected validator helper boundary');
const isolated=source.slice(start,end)+'\nexport {signedFileOf};';assert.ok(!/^import\s/m.test(isolated));
const js=ts.transpileModule(isolated,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {signedFileOf}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const user='11111111-1111-4111-8111-111111111111',rx='22222222-2222-4222-8222-222222222222';
const cases=['44444444-4444-4444-8444-444444444444','44444444-4444-4444-4444-444444444444'].map(operation=>{
 const candidate=`rx/${user}/${rx}/signed-${operation}.pdf`;let accepted=false,refusal=null;
 try{accepted=signedFileOf({status:'signed',signature_verified_at:'2026-11-05T03:00:00Z',signed_storage_path:candidate,user_id:user,id:rx})===candidate;}
 catch(e){refusal=e.constructor.name;}
 return {operation,canonicalHexUuid:/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(operation),accepted,refusal};
});
assert.equal(cases[0].accepted,true);assert.equal(cases[1].canonicalHexUuid,true);assert.equal(cases[1].accepted,fixed);
if(!fixed)assert.equal(cases[1].refusal,'SignatureIncomplete');
assert.equal(hash(readFileSync(ownPath)),ownHash);
const directory='docs/reviews/2026-11-05/validar-format-review';mkdirSync(directory,{recursive:true});
writeFileSync(directory+(fixed?'/path-fixed.json':'/path-counterexample.json'),JSON.stringify({syntheticOnly:true,sourceBaseline:baseline,scope:'isolated actual signedFileOf helper; producer UUID acceptance reviewed by schema inspection',httpIntegration:false,externalCalls:false,ownSource:{path:ownPath,sha256:ownHash},source:{path,sha256:hash(source)},cases},null,2)+'\n');
process.stdout.write(JSON.stringify({cases,externalCalls:false})+'\n');
