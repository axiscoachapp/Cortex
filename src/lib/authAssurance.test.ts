// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Expected boundary shape; the deployment module is loaded with a Deno stub
// below so it does not become a frontend runtime/type dependency.
type ExpectedSessionContext = {userId:string;sessionId:string;aal:'aal1'|'aal2';exp:number};

function load(factors: Array<{status:string}>=[], appMetadata: Record<string, unknown> = {}, userId='doctor', userMetadata: Record<string, unknown> = {}) {
  const getUser=vi.fn(async():Promise<{data:{user:Record<string,unknown>|null};error:unknown}>=>({data:{user:{id:userId,email:'conta@example.invalid',created_at:'2026-11-10T12:00:00Z',factors,app_metadata:appMetadata,user_metadata:userMetadata}},error:null as unknown}));
  const source=readFileSync(new URL('../../supabase/functions/_shared/auth.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string,unknown>={};
  const createClient=vi.fn(()=>({auth:{getUser}}));
  const require=(id:string)=>id.includes('@supabase/supabase-js')?{createClient}:{fetchWithDeadline:vi.fn()};
  new Function('require','exports','Deno',compiled)(require,exports,{env:{get:()=> 'synthetic'}});
  return {getUser,createClient,requireUser:exports.requireUser as (request:Request, options?:{allowReception?:boolean})=>Promise<{userId:string}>,
    requireUserContext:exports.requireUserContext as (request:Request, options?:{allowReception?:boolean})=>Promise<ExpectedSessionContext>,
    requirePendingPasswordCaller:exports.requirePendingPasswordCaller as (request:Request)=>Promise<Record<string, unknown>>,
    authResponse:exports.authResponse as (error:unknown, cors:Record<string,string>)=>Response};
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

describe('pending temporary password on the Edge',()=>{
  const actor='c7100000-0000-4000-8000-000000000002',session='c7110000-0000-4000-8000-000000000001';
  const claims=(overrides:Record<string,unknown>={})=>({sub:actor,session_id:session,role:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+3600,...overrides});
  const flagged={must_change_password:true,temporary_password_expires_at:'2026-11-14T12:00:00Z'};
  const refused={status:403,code:'password_change_required'};

  it('refuses every requireUser and requireUserContext path while the server flag is set, with a machine-readable code',async()=>{
    const {requireUser,requireUserContext,authResponse}=load([],flagged,actor);
    const error=await requireUser(request(claims({app_metadata:flagged}))).catch(e=>e);
    expect(error).toMatchObject(refused);
    await expect(requireUserContext(request(claims({app_metadata:flagged})))).rejects.toMatchObject(refused);
    await expect(requireUser(request(claims({app_metadata:flagged})),{allowReception:true})).rejects.toMatchObject(refused);
    const response=authResponse(error,{});
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({error:'Troque a senha temporária para continuar.',code:'password_change_required'});
  });
  it('keeps refusing a token issued before the change (old claim) even after Auth cleared the flag',async()=>{
    const {requireUser}=load([],{password_set_by_owner_at:'2026-11-11T12:00:00Z'},actor);
    await expect(requireUser(request(claims({app_metadata:flagged})))).rejects.toMatchObject(refused);
    await expect(requireUser(request(claims({app_metadata:{password_set_by_owner_at:'2026-11-11T12:00:00Z'}})))).resolves.toEqual({userId:actor});
  });
  it('refuses when the live account is flagged even if the presented claim is not',async()=>{
    await expect(load([],flagged,actor).requireUser(request(claims()))).rejects.toMatchObject(refused);
  });
  it('treats the legacy user_metadata flag (accounts created before the change) as pending too',async()=>{
    const {requireUser}=load([],{},actor,{must_change_password:true});
    await expect(requireUser(request(claims({user_metadata:{must_change_password:true}})))).rejects.toMatchObject(refused);
  });
  it('leaves accounts without a temporary password untouched, including a cleared legacy flag',async()=>{
    await expect(load([],{},actor).requireUser(request(claims()))).resolves.toEqual({userId:actor});
    await expect(load([],{password_set_by_owner_at:'x'},actor,{must_change_password:false}).requireUser(request(claims({user_metadata:{must_change_password:false}})))).resolves.toEqual({userId:actor});
  });
  it('refuses a flagged reception account and keeps the reception and MFA rules once the flag is gone',async()=>{
    await expect(load([],{account_type:'reception',...flagged},actor).requireUser(request(claims({app_metadata:{account_type:'reception',...flagged}})),{allowReception:true})).rejects.toMatchObject(refused);
    await expect(load([],{account_type:'reception',...flagged},actor).requireUser(request(claims()))).rejects.toMatchObject(refused);
    await expect(load([],{account_type:'reception'},actor).requireUser(request(claims()))).rejects.toMatchObject({status:403});
    await expect(load([{status:'verified'}],{},actor).requireUser(request(claims()))).rejects.toMatchObject({status:403,mfaRequired:true});
    await expect(load([{status:'verified'}],{},actor).requireUser(request(claims({aal:'aal2'})))).resolves.toEqual({userId:actor});
  });
  it('lets only change-initial-password through, still after Auth verification and the MFA rule',async()=>{
    const {requirePendingPasswordCaller,getUser}=load([],{account_type:'reception',...flagged},actor);
    const req=request(claims({app_metadata:flagged}));
    await expect(requirePendingPasswordCaller(req)).resolves.toEqual({
      userId:actor,email:'conta@example.invalid',createdAt:'2026-11-10T12:00:00Z',
      appMetadata:{account_type:'reception',...flagged},userMetadata:{},
      accessToken:req.headers.get('Authorization')!.slice('Bearer '.length),
    });
    expect(getUser).toHaveBeenCalledTimes(1);
    await expect(load([{status:'verified'}],flagged,actor).requirePendingPasswordCaller(request(claims()))).rejects.toMatchObject({status:403,mfaRequired:true});
    const invalid=load([],flagged,actor);
    invalid.getUser.mockResolvedValue({data:{user:null},error:new Error('invalid signature')});
    await expect(invalid.requirePendingPasswordCaller(request(claims()))).rejects.toMatchObject({status:401});
  });
});
