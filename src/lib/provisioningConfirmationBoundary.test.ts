// @vitest-environment node
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadConfirmationBoundary} from '../../scripts/test-provisioning-confirmation-boundary.mjs';

const actor='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222';
const operation='33333333-3333-4333-8333-333333333333',target='44444444-4444-4444-8444-444444444444',clinic='55555555-5555-4555-8555-555555555555';
const claims=(extra:object={})=>({sub:actor,session_id:session,role:'authenticated',aal:'aal2',exp:Math.floor(Date.now()/1000)+3600,...extra});
const request=(extra:object={})=>new Request('https://edge.synthetic.invalid',{headers:{Authorization:'Bearer e30.'+btoa(JSON.stringify(claims(extra)))+'.synthetic'}});
const input={operationId:operation};
const row=(extra:object={})=>({operation_id:operation,planned_user_id:target,clinic_id:clinic,actor_id:actor,session_id:session,phase:'confirmed',expires_at:new Date(Date.now()+300000).toISOString(),...extra});
const compile=(path:string)=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(factors:Array<{status:string}>=[],metadata:object={}){
 const getUser=vi.fn(async()=>({data:{user:{id:actor,factors,app_metadata:metadata}},error:null}));
 const createClient=vi.fn(()=>({auth:{getUser}}));
 const confirm=loadConfirmationBoundary({authSource:compile('../../supabase/functions/_shared/auth.ts'),boundarySource:compile('../../scripts/prototypes/provisioning-confirmation-boundary.ts'),createClient});
 return {confirm,getUser,createClient};
}
afterEach(()=>vi.restoreAllMocks());

describe('server confirmation boundary, laboratory only',()=>{
 it('takes the authority from the same verified bearer and projects a frozen administrative result',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(Date.now());
  const {confirm,getUser,createClient}=load(),req=request();
  const commit=vi.fn(async args=>{expect(Object.isFrozen(args)).toBe(true);return row({secret:'must not escape',factor_id:'private'});});
  const result=await confirm(req,input,commit);
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(createClient).toHaveBeenCalledWith('synthetic','synthetic',expect.objectContaining({global:expect.objectContaining({headers:{Authorization:req.headers.get('Authorization')}})}));
  expect(commit).toHaveBeenCalledExactlyOnceWith({operationId:operation,actorId:actor,sessionId:session,aal:'aal2',exp:claims().exp});
  expect(result).toEqual({operationId:operation,plannedUserId:target,clinicId:clinic,expiresAt:expect.any(String)});
  expect(Object.isFrozen(result)).toBe(true);expect(JSON.stringify(result)).not.toContain('must not escape');
 });
 it.each([
  ['missing bearer',()=>new Request('https://edge.synthetic.invalid'),[],{},401],
  ['different sub',()=>request({sub:target}),[],{},401],
  ['AAL1 without factor',()=>request({aal:'aal1'}),[],{},403],
  ['AAL1 with verified factor',()=>request({aal:'aal1'}),[{status:'verified'}],{},403],
  ['reception account',()=>request(),[],{account_type:'reception'},403],
  ['service token',()=>request({role:'service_role'}),[],{},401],
 ] as const)('refuses %s before SQL',async(_name,req,factors,metadata,status)=>{
  const commit=vi.fn(),{confirm}=load([...factors],metadata);
  await expect(confirm(req(),input,commit)).rejects.toMatchObject({status});expect(commit).not.toHaveBeenCalled();
 });
 it.each([null,[],true,{}, {operationId:1},{operationId:'not-a-uuid'},...['actorId','sessionId','clinicId','plannedUserId','aal','exp','finish'].map(key=>({...input,[key]:'forged'}))])('refuses malformed or authority-bearing input %#',async value=>{
  const commit=vi.fn();await expect(load().confirm(request(),value,commit)).rejects.toMatchObject({code:'invalid_request'});expect(commit).not.toHaveBeenCalled();
 });
 it('does not execute input getters',async()=>{
  const getter=vi.fn(()=>operation),value=Object.defineProperty({},'operationId',{get:getter,enumerable:true}),commit=vi.fn();
  await expect(load().confirm(request(),value,commit)).rejects.toMatchObject({code:'invalid_request'});expect(getter).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
 });
 it.each([{phase:'prepared'},{operation_id:target},{actor_id:target},{session_id:target},{planned_user_id:'bad'},{clinic_id:'bad'},{expires_at:'bad'},{expires_at:new Date(1).toISOString()}])('refuses an unconfirmed or divergent database result %#',async extra=>{
  const commit=vi.fn(async()=>row(extra));await expect(load().confirm(request(),input,commit)).rejects.toMatchObject({code:'unavailable'});expect(commit).toHaveBeenCalledTimes(1);
 });
 it.each([['42501','not_authorized'],['22023','conflict'],['40001','retry'],['XX000','unavailable']])('maps SQL %s without leaking raw errors or retrying',async(code,expected)=>{
  const commit=vi.fn(async()=>{throw Object.assign(new Error('private server detail'),{code});});
  const error=await load().confirm(request(),input,commit).catch(e=>e);
  expect(error).toMatchObject({code:expected});expect(error.message).not.toContain('private server detail');expect(error.cause).toBeUndefined();expect(commit).toHaveBeenCalledTimes(1);
 });
 it.each(['intent','bearer'])('refuses a late %s response after the port may have committed',async mode=>{
  const start=Date.now();vi.spyOn(Date,'now').mockReturnValue(start);
  const commit=vi.fn(async()=>{const result=row({expires_at:new Date(start+(mode==='intent'?300:7200)*1000).toISOString()});vi.mocked(Date.now).mockReturnValue(start+(mode==='intent'?301:3601)*1000);return result;});
  await expect(load().confirm(request(),input,commit)).rejects.toMatchObject({code:'unavailable'});expect(commit).toHaveBeenCalledTimes(1);
 });
});
