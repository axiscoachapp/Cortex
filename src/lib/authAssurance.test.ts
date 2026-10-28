// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function load(factors: Array<{status:string}>=[]) {
  const getUser=vi.fn(async()=>({data:{user:{id:'doctor',factors}},error:null as unknown}));
  const source=readFileSync(new URL('../../supabase/functions/_shared/auth.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string,unknown>={};
  const require=(id:string)=>id.includes('@supabase/supabase-js')?{createClient:()=>({auth:{getUser}})}:{fetchWithDeadline:vi.fn()};
  new Function('require','exports','Deno',compiled)(require,exports,{env:{get:()=> 'synthetic'}});
  return {getUser,requireUser:exports.requireUser as (request:Request)=>Promise<{userId:string}>};
}
const request=(claims:object)=>new Request('https://edge.invalid',{headers:{Authorization:`Bearer e30.${btoa(JSON.stringify(claims))}.synthetic-signature`}});
describe('authenticated Edge MFA assurance',()=>{
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
    getUser.mockResolvedValue({data:{user:{id:'doctor',factors:[]}},error:new Error('invalid signature')});
    await expect(requireUser(request({sub:'doctor',aal:'aal2'}))).rejects.toMatchObject({status:401});
  });
});
