// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as http from '../../supabase/functions/_shared/http';
import * as storage from '../../supabase/functions/_shared/storage';
const user='11111111-1111-4111-8111-111111111111',draftId='22222222-2222-4222-8222-222222222222',exportId='33333333-3333-4333-8333-333333333333';
function database() {
  const row:Record<string,unknown>={id:draftId,audio_storage_path:`consultations/${user}/${draftId}.webm`};
  const remove=vi.fn(async()=>({error:null as unknown})),download=vi.fn(async()=>({data:new Blob(['PDF']),error:null}));
  const deleted=vi.fn();
  const db={row,remove,download,deleted,rpc:vi.fn(async()=>({data:row as unknown,error:null as unknown})),
    storage:{from:()=>({remove,download,createSignedUrl:async()=>({data:{signedUrl:'https://document.invalid'},error:null})})},
    auth:{admin:{getUserById:async()=>({data:{user:{email:'synthetic@example.invalid'}},error:null})}},
    from:(table:string)=>{
      if(table==='user_settings') throw new Error('Mutable settings must not be read for historical issuance');
      let deleting=false;
      const q={select:()=>q,eq:()=>q,gt:()=>q,delete:()=>{deleting=true;return q;},maybeSingle:async()=>({data:row,error:null}),
        then:(resolve:(value:{data:unknown;error:null})=>unknown)=>{if(deleting)deleted(table);return Promise.resolve(resolve({data:row,error:null}));}};
      return q;
    }};
  return db;
}
function load(name:string,db:ReturnType<typeof database>) {
  let run!:(request:Request)=>Promise<Response>;
  const source=readFileSync(new URL(`../../supabase/functions/${name}/index.ts`,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const modules:Record<string,unknown>={'../_shared/http.ts':http,'../_shared/storage.ts':storage,'../_shared/auth.ts':{requireUser:async()=>({userId:user}),AuthError:class extends Error{}},'../_shared/providerFiles.ts':{retryProviderCleanup:async()=>{}}};
  const require=(id:string)=>{if(id.includes('/http/server.ts'))return{serve:(fn:typeof run)=>{run=fn;}};if(id.includes('@supabase/supabase-js'))return{createClient:()=>db};if(id in modules)return modules[id];throw new Error(`Unexpected ${id}`);};
  new Function('require','exports','Deno',compiled)(require,{}, {env:{get:()=> 'synthetic'}});
  return (body:object={},query='')=>run(new Request(`https://edge.invalid/${query}`,{method:query?'GET':'POST',body:query?undefined:JSON.stringify(body)}));
}
describe('privacy edge regressions',()=>{
  it('retains draft metadata if audio removal fails and allows a later retry',async()=>{
    const db=database();db.remove.mockResolvedValueOnce({error:new Error('offline')});const invoke=load('discard-consultation',db);
    expect((await invoke({draftId})).status).toBe(503);expect(db.deleted).not.toHaveBeenCalled();
    expect((await invoke({draftId})).status).toBe(200);expect(db.deleted).toHaveBeenCalledWith('consultation_drafts');
    expect(db.rpc).toHaveBeenCalledWith('begin_consultation_discard',{p_user_id:user,p_draft_id:draftId});
  });
  it('reads historical issuer identity exclusively from the immutable snapshot',async()=>{
    const db=database();Object.assign(db.row,{user_id:user,storage_path:`rx/${user}/${draftId}.pdf`,secret_code:'code',status:'generated',issuance_verified_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00Z',issuance_snapshot:{prescriber:{doctor_name:'Original Doctor',crm_number:'123',crm_uf:'PR'},pdf_sha256:'a'.repeat(64),template_version:'v1'}});
    const response=await load('validate-prescription',db)({},`?id=${draftId}&code=code&_format=application%2Fvalidador-iti%2Bjson`);
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({emissor:{nome:'Original Doctor',crm:'123',uf:'PR'},sha256:'a'.repeat(64)});
  });
  it('does not invent issuance identity for a legacy document',async()=>{
    const db=database();Object.assign(db.row,{user_id:user,storage_path:`rx/${user}/${draftId}.pdf`,secret_code:'code',status:'generated',issuance_verified_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00Z'});
    expect((await load('validate-prescription',db)({},`?id=${draftId}&code=code`)).status).toBe(409);
  });
  it('creates one server snapshot rather than paginating mutable tables',async()=>{
    const db=database();db.rpc.mockResolvedValue({data:{version:2,exportId,tables:{patients:[]},files:[]},error:null});
    const response=await load('export-user-data',db)({action:'manifest'});
    expect(response.status).toBe(200);expect(db.rpc).toHaveBeenCalledWith('create_data_export_snapshot',{p_user_id:user});
  });
  it('rejects an unauthorized/stale export file before storage download',async()=>{
    const db=database();db.rpc.mockResolvedValue({data:false,error:null});
    expect((await load('export-user-data',db)({action:'file',exportId,bucket:'audio-recordings',path:db.row.audio_storage_path})).status).toBe(409);expect(db.download).not.toHaveBeenCalled();
  });
  it('rejects an object changed while its bytes were being downloaded',async()=>{
    const db=database();db.rpc.mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce({data:false,error:null});
    expect((await load('export-user-data',db)({action:'file',exportId,bucket:'audio-recordings',path:db.row.audio_storage_path})).status).toBe(409);expect(db.download).toHaveBeenCalledTimes(1);
  });
  it('returns conflict instead of completeness when rows changed during export',async()=>{
    const db=database();db.rpc.mockResolvedValue({data:false,error:null});
    expect((await load('export-user-data',db)({action:'complete',exportId})).status).toBe(409);
  });
});
