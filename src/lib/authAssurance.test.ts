// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Expected boundary shape; the deployment module is loaded with a Deno stub
// below so it does not become a frontend runtime/type dependency.
type ExpectedSessionContext = {userId:string;sessionId:string;aal:'aal1'|'aal2';exp:number};

function load(factors: Array<{status:string}>=[], appMetadata: Record<string, unknown> = {}, userId='doctor') {
  const getUser=vi.fn(async()=>({data:{user:{id:userId,factors,app_metadata:appMetadata}},error:null as unknown}));
  const source=readFileSync(new URL('../../supabase/functions/_shared/auth.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string,unknown>={};
  const createClient=vi.fn(()=>({auth:{getUser}}));
  const require=(id:string)=>id.includes('@supabase/supabase-js')?{createClient}:{fetchWithDeadline:vi.fn()};
  new Function('require','exports','Deno',compiled)(require,exports,{env:{get:()=> 'synthetic'}});
  return {getUser,createClient,requireUser:exports.requireUser as (request:Request, options?:{allowReception?:boolean})=>Promise<{userId:string}>,
    requireUserContext:exports.requireUserContext as (request:Request, options?:{allowReception?:boolean})=>Promise<ExpectedSessionContext>};
}
const request=(claims:object)=>new Request('https://edge.invalid',{headers:{Authorization:`Bearer e30.${btoa(JSON.stringify(claims))}.synthetic-signature`}});
describe('authenticated Edge MFA assurance',()=>{
  it('blocks a dedicated reception account from clinical Edge functions', async () => {
    const { requireUser } = load([], { account_type: 'reception' });
    await expect(requireUser(request({sub:'doctor',aal:'aal1'}))).rejects.toMatchObject({status:403});
    await expect(requireUser(request({sub:'doctor',aal:'aal1'}), {allowReception:true})).resolves.toEqual({userId:'doctor'});
  });
  it('requires aal2 for an enrolled user after Auth validates identity',async()=>{
    const {getUser,requireUser}=load([{status:'verified'}]);
    await expect(requireUser(request({sub:'doctor',aal:'aal1'}))).rejects.toMatchObject({status:403});
    expect(getUser).toHaveBeenCalledTimes(1);
    await expect(requireUser(request({sub:'doctor',aal:'aal2'}))).resolves.toEqual({userId:'doctor'});
  });
  it('keeps accounts without a verified factor usable',async()=>{
    await expect(load([{status:'unverified'}]).requireUser(request({sub:'doctor',aal:'aal1'}))).resolves.toEqual({userId:'doctor'});
  });
  it('rejects malformed or identity-mismatched claims even if a stubbed Auth endpoint returned a user',async()=>{
    const {requireUser}=load();
    await expect(requireUser(new Request('https://edge.invalid',{headers:{Authorization:'Bearer malformed'}}))).rejects.toMatchObject({status:401});
    await expect(requireUser(request({sub:'other',aal:'aal2'}))).rejects.toMatchObject({status:401});
  });
  it('never treats self-asserted aal2 as valid when Auth rejects the token',async()=>{
    const {getUser,requireUser}=load([{status:'verified'}]);
    getUser.mockResolvedValue({data:{user:{id:'doctor',factors:[],app_metadata:{}}},error:new Error('invalid signature')});
    await expect(requireUser(request({sub:'doctor',aal:'aal2'}))).rejects.toMatchObject({status:401});
  });
});

describe('verified Edge session context',()=>{
  const actor='d3300000-0000-4000-8000-000000000001',session='d3310000-0000-4000-8000-000000000001';
  const claims=(overrides:Record<string,unknown>={})=>({sub:actor,session_id:session,role:'authenticated',aal:'aal2',exp:Math.floor(Date.now()/1000)+3600,...overrides});
  afterEach(()=>vi.useRealTimers());

  it('returns only typed context from the bearer after one successful Auth verification',async()=>{
    const {getUser,createClient,requireUserContext}=load([{status:'verified'}],{},actor),c=claims(),req=request(c);
    await expect(requireUserContext(req)).resolves.toEqual({userId:actor,sessionId:session,aal:'aal2',exp:c.exp});
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledExactlyOnceWith('synthetic','synthetic',{
      global:{headers:{Authorization:req.headers.get('Authorization')},fetch:expect.any(Function)},
    });
  });
  it('keeps the legacy return shape and accepts its established minimal claims',async()=>{
    await expect(load().requireUser(request({sub:'doctor',aal:'aal1'}))).resolves.toEqual({userId:'doctor'});
  });
  it('never accepts context from the request body instead of missing signed claims',async()=>{
    const c=claims({session_id:undefined});
    const req=new Request(request(c),{method:'POST',body:JSON.stringify({userId:actor,sessionId:session,aal:'aal2',exp:claims().exp})});
    await expect(load([],{},actor).requireUserContext(req)).rejects.toMatchObject({status:401});
  });
  it('ignores forged body identity and leaves the body unread for the handler',async()=>{
    const body={userId:'other',sessionId:'other',aal:'aal1',exp:1},c=claims();
    const req=new Request(request(c),{method:'POST',body:JSON.stringify(body)});
    await expect(load([],{},actor).requireUserContext(req)).resolves.toEqual({userId:actor,sessionId:session,aal:'aal2',exp:c.exp});
    await expect(req.json()).resolves.toEqual(body);
  });
  it.each([undefined,null,'',actor.replace(/-/g,''),'not-a-session',42,{}])('rejects malformed or missing session_id (%j)',async session_id=>{
    await expect(load([],{},actor).requireUserContext(request(claims({session_id})))).rejects.toMatchObject({status:401});
  });
  it.each([undefined,null,'aal3','aal0',2,{}])('rejects unknown or missing assurance (%j)',async aal=>{
    await expect(load([],{},actor).requireUserContext(request(claims({aal})))).rejects.toMatchObject({status:401});
  });
  it.each([undefined,null,'12345678900',0,-1,1.5,Number.MAX_SAFE_INTEGER+1])('rejects malformed expiry (%j)',async exp=>{
    await expect(load([],{},actor).requireUserContext(request(claims({exp})))).rejects.toMatchObject({status:401});
  });
  it('requires an authenticated role and a canonical verified user UUID',async()=>{
    await expect(load([],{},actor).requireUserContext(request(claims({role:'service_role'})))).rejects.toMatchObject({status:401});
    await expect(load().requireUserContext(request(claims({sub:'doctor'})))).rejects.toMatchObject({status:401});
  });
  it('keeps verification rejection authoritative even with plausible session claims',async()=>{
    const {getUser,requireUserContext}=load([],{},actor);
    getUser.mockResolvedValue({data:{user:{id:actor,factors:[],app_metadata:{}}},error:new Error('invalid signature')});
    await expect(requireUserContext(request(claims()))).rejects.toMatchObject({status:401});
  });
  it('rechecks expiry after the awaited verification and rejects the exact boundary',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T03:00:00Z'));
    const c=claims({exp:Math.floor(Date.now()/1000)+1}),{getUser,requireUserContext}=load([],{},actor);
    getUser.mockImplementation(async()=>{vi.setSystemTime(Date.now()+1000);return {data:{user:{id:actor,factors:[],app_metadata:{}}},error:null};});
    await expect(requireUserContext(request(c))).rejects.toMatchObject({status:401});
  });
  it('returns aal1 for an unenrolled actor without imposing the signature policy here',async()=>{
    const c=claims({aal:'aal1'});
    await expect(load([],{},actor).requireUserContext(request(c))).resolves.toEqual({userId:actor,sessionId:session,aal:'aal1',exp:c.exp});
  });
  it('preserves enrolled-factor and reception restrictions',async()=>{
    await expect(load([{status:'verified'}],{},actor).requireUserContext(request(claims({aal:'aal1'})))).rejects.toMatchObject({status:403,mfaRequired:true});
    const {requireUserContext}=load([],{account_type:'reception'},actor);
    await expect(requireUserContext(request(claims()))).rejects.toMatchObject({status:403});
    await expect(requireUserContext(request(claims()),{allowReception:true})).resolves.toMatchObject({userId:actor,sessionId:session});
  });
});
