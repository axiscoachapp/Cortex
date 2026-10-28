// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as storage from '../../supabase/functions/_shared/storage';
import * as oauth from '../../supabase/functions/_shared/oauth';
import * as reminders from '../../supabase/functions/_shared/reminders';
import * as quota from '../../supabase/functions/_shared/quota';
import * as http from '../../supabase/functions/_shared/http';
import * as deletion from '../../supabase/functions/_shared/deletion';
import * as providerFiles from '../../supabase/functions/_shared/providerFiles';

type Row = Record<string, unknown>;
const user = '11111111-1111-4111-8111-111111111111';
const patient = '22222222-2222-4222-8222-222222222222';
const rxId = '33333333-3333-4333-8333-333333333333';
const exportId = '44444444-4444-4444-8444-444444444444';
const issuanceSnapshot = {prescriber:{doctor_name:'Original Doctor',crm_number:'123',crm_uf:'PR'},patient:{name:'Synthetic'},pdf_sha256:'a'.repeat(64),template_version:'v1',issued_at:'2026-01-01T00:00:00Z'};
const snapshot = (tables:Record<string,Row[]>) => ({version:2,exportId,userId:user,exportedAt:'2026-10-28T12:00:00Z',expiresAt:'2026-10-28T13:00:00Z',tables,files:[]});

function fakeDatabase(seed: Record<string, Row[]> = {}, maximumRows = Infinity) {
  const tables = structuredClone(seed);
  const updates: Row[] = [];
  const reads: string[] = [];
  const download = vi.fn(async () => ({ data: new Blob(['PDF']), error: null }));
  const createSignedUrl = vi.fn(async () => ({ data: {signedUrl:'https://example.invalid/pdf'},error:null }));
  const remove = vi.fn(async () => ({data:[],error:null as unknown}));
  const list = vi.fn(async () => ({data:[],error:null as unknown}));
  const deleteUser = vi.fn(async () => ({data:null,error:null}));
  return {tables,updates,reads,download,createSignedUrl,remove,list,deleteUser,
    storage: {from: () => ({download,createSignedUrl,remove,list})},
    auth: {admin:{deleteUser,getUserById:async()=>({data:{user:{id:user,email:'doctor@example.invalid'}},error:null})}},
    rpc: vi.fn(async () => ({data:true as unknown,error:null as unknown})),
    from(table: string) {
      reads.push(table);
      const filters: Array<(row:Row)=>boolean> = []; let patch:Row|undefined; let insert:Row|undefined;
      let start=0; let end=Infinity; let sortColumn='id';
      const execute = () => {
        if (insert) { (tables[table] ??= []).push(insert); updates.push(insert); }
        const rows = (tables[table] ?? []).filter(row=>filters.every(filter=>filter(row)))
          .sort((a,b)=>String(a[sortColumn]).localeCompare(String(b[sortColumn]))).slice(start,Math.min(end+1,start+maximumRows));
        if(patch) rows.forEach(row=>{Object.assign(row,patch);updates.push(patch!);});
        return {data:rows,error:null};
      };
      const query = {
        select: (_columns?:string) => query,
        eq: (field:string,value:unknown) => {filters.push(row=>row[field]===value);return query;},
        is: (field:string,value:unknown) => {filters.push(row=>(row[field] ?? null)===value);return query;},
        order: (column:string) => {sortColumn=column;return query;},
        range: (from:number,to:number) => {start=from;end=to;return query;},
        limit: (count:number) => {end=Math.min(end,start+count-1);return query;},
        update: (value:Row) => {patch=value;return query;},
        upsert: (value:Row) => {insert=value;return query;},
        single: async () => {const result=execute();return {...result,data:result.data[0] ?? null};},
        maybeSingle: async () => {const result=execute();return {...result,data:result.data[0] ?? null};},
        then: (resolve:(value:ReturnType<typeof execute>)=>unknown) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
}

/** Execute the actual edge handler with network/database boundaries replaced.
 * This does not assert on source strings or call remote APIs. */
function loadHandler(name:string, db: ReturnType<typeof fakeDatabase>, fetchStub = vi.fn(async () => {throw new Error('Unexpected network request');})) {
  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`,import.meta.url),'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let handler: (req:Request)=>Promise<Response>;
  const modules:Record<string,unknown> = {
    '../_shared/storage.ts':storage, '../_shared/oauth.ts':oauth, '../_shared/reminders.ts':reminders, '../_shared/quota.ts':quota,
    '../_shared/auth.ts':{requireUser:async()=>({userId:user}),AuthError:class extends Error {},authResponse:()=>new Response(null,{status:401})},
    '../_shared/http.ts':{...http,fetchWithDeadline:fetchStub},
    '../_shared/deletion.ts':deletion,
    '../_shared/providerFiles.ts':providerFiles,
    '../_shared/gemini.ts':{uploadToGeminiFiles:fetchStub,callGemini:fetchStub,parseModelObject:fetchStub},
  };
  const env:Record<string,string> = {SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',GEMINI_API_KEY:'synthetic',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'synthetic',ALLOWED_ORIGIN:'https://cortex.example'};
  const require = (id:string) => {
    if(id.includes('/http/server.ts')) return {serve:(fn:typeof handler)=>{handler=fn;}};
    if(id.includes('@supabase/supabase-js')) return {createClient:()=>db};
    if(id in modules) return modules[id];
    throw new Error(`Unsupported test dependency ${id}`);
  };
  new Function('require','exports','Deno','fetch',compiled)(require,{}, {env:{get:(key:string)=>env[key]}},fetchStub);
  return (request:Request)=>handler(request);
}

describe('security endpoint regressions',()=>{
  it('returns the complete SQL snapshot without repaginating mutable tables under the API row cap',async()=>{
    const rows=Array.from({length:251},(_,i)=>({id:String(i).padStart(4,'0'),user_id:user}));
    const db=fakeDatabase({patients:rows,user_integration_status:[]},100);
    db.rpc.mockResolvedValueOnce({data:snapshot({patients:rows}),error:null});
    const response=await loadHandler('export-user-data',db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({action:'manifest'})}));
    expect(response.status).toBe(200);
    expect((await response.json()).tables.patients).toHaveLength(251);
    expect(db.rpc).toHaveBeenCalledWith('create_data_export_snapshot',{p_user_id:user});
    expect(db.reads).not.toContain('patients');
  });
  it('does not reserve paid quota when document storage download fails',async()=>{
    const db=fakeDatabase({patient_files:[{id:'file',user_id:user,patient_id:patient,storage_path:`patients/${user}/${patient}/file.pdf`,mime_type:'application/pdf',size_bytes:3}],patients:[{id:patient,user_id:user}]});
    db.download.mockResolvedValue({data:null as unknown as Blob,error:{message:'offline'} as never});
    const response=await loadHandler('analyze-document',db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({fileId:'file'})}));
    expect(response.status).toBe(500); expect(db.rpc).not.toHaveBeenCalled();
  });
  it('never downloads a prescription path that aliases a different bucket',async()=>{
    const db=fakeDatabase({prescriptions:[{id:rxId,user_id:user,secret_code:'ABC',status:'generated',issuance_verified_at:'2026-01-01',expires_at:'2099-01-01',storage_path:'../patient-files/secret.pdf'}]});
    const response=await loadHandler('validate-prescription',db)(new Request(`https://edge.invalid?id=${rxId}&code=ABC`));
    expect(response.status).toBe(500);
    expect(db.download).not.toHaveBeenCalled();
    expect(db.createSignedUrl).not.toHaveBeenCalled();
  });
  it('does not mint a download URL for an expired prescription manifest',async()=>{
    const db=fakeDatabase({prescriptions:[{id:rxId,user_id:user,secret_code:'ABC',status:'generated',issuance_verified_at:'2000-01-01',expires_at:'2001-01-01',storage_path:`rx/${user}/${rxId}.pdf`}]});
    const response=await loadHandler('validate-prescription',db)(new Request(`https://edge.invalid?id=${rxId}&code=ABC&_format=application%2Fvalidador-iti%2Bjson`));
    expect(response.status).toBe(410); expect(db.createSignedUrl).not.toHaveBeenCalled();
  });
  it('does not label an unattested signature as verified even when issuance has a valid identity snapshot',async()=>{
    const db=fakeDatabase({prescriptions:[{id:rxId,user_id:user,secret_code:'ABC',status:'signed',signed_at:'2026-01-01',issuance_verified_at:'2026-01-01',issuance_snapshot:issuanceSnapshot,signature_verified_at:null,expires_at:'2099-01-01',storage_path:`rx/${user}/${rxId}.pdf`}]});
    const response=await loadHandler('validate-prescription',db)(new Request(`https://edge.invalid?id=${rxId}&code=ABC&_format=application%2Fvalidador-iti%2Bjson`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status:'gerada_sem_assinatura',assinadaEm:null});
  });
  it('quarantines legacy forged future expiry without serving or signing a download URL',async()=>{
    const db=fakeDatabase({prescriptions:[{id:rxId,user_id:user,secret_code:'ABC',status:'generated',created_at:'2098-01-01',expires_at:'2099-01-01',issuance_verified_at:null,storage_path:`rx/${user}/${rxId}.pdf`}]});
    const handler=loadHandler('validate-prescription',db);
    for(const format of ['', '&_format=application%2Fvalidador-iti%2Bjson']) {
      const response=await handler(new Request(`https://edge.invalid?id=${rxId}&code=ABC${format}`));
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({status:'unverified'});
    }
    expect(db.download).not.toHaveBeenCalled(); expect(db.createSignedUrl).not.toHaveBeenCalled();
  });
  it('rejects an appointment referencing another owner’s patient',async()=>{
    const db=fakeDatabase({appointments:[{id:'appointment',user_id:user,patient_id:patient,status:'agendado',start_time:'2099-01-01T12:00:00Z'}],patients:[{id:patient,user_id:'victim',name:'Private',phone:'11999998888'}]});
    const response=await loadHandler('send-appointment-reminder',db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({appointmentId:'appointment',type:'whatsapp'})}));
    expect(response.status).toBe(404); expect(await response.text()).not.toContain('Private');
  });
  it('generates WhatsApp link without falsely recording delivery',async()=>{
    const db=fakeDatabase({appointments:[{id:'appointment',user_id:user,patient_id:patient,status:'agendado',start_time:'2030-01-01T12:00:00Z',type:'retorno'}],patients:[{id:patient,user_id:user,name:'Paciente',phone:'+55 11 99999-8888'}]});
    const response=await loadHandler('send-appointment-reminder',db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({appointmentId:'appointment',type:'whatsapp'})}));
    expect(response.status).toBe(200);
    expect((await response.json()).waLink).toContain('wa.me/5511999998888?');
    expect(db.updates).toEqual([]);
  });
  it('retains account metadata when storage cleanup cannot complete',async()=>{
    const db=fakeDatabase(); db.list.mockResolvedValue({data:[],error:{message:'offline'}});
    const response=await loadHandler('delete-user-data',db)(new Request('https://edge.invalid',{method:'POST'}));
    expect(response.status).toBe(503); expect(db.deleteUser).not.toHaveBeenCalled();
    expect(db.tables.account_deletion_requests).toEqual([{user_id:user}]);
  });
  it.each(['delete-user-data','delete-patient'])('blocks %s before storage or metadata changes when legacy relations cross owners',async(name)=>{
    const db=fakeDatabase({patients:[{id:patient,user_id:user,deletion_requested_at:null}]});
    db.rpc.mockResolvedValue({data:null,error:{code:'P4090',message:'Legacy ownership conflict'}});
    const response=await loadHandler(name,db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({patientId:patient})}));
    expect(response.status).toBe(409);
    expect(db.list).not.toHaveBeenCalled(); expect(db.remove).not.toHaveBeenCalled();
    expect(db.deleteUser).not.toHaveBeenCalled(); expect(db.updates).toEqual([]);
  });
  it('rejects an invalid OAuth transaction before contacting Google',async()=>{
    const db=fakeDatabase(); const network=vi.fn(async()=>{throw new Error('Must not call Google');});
    const response=await loadHandler('google-oauth-callback',db,network)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({code:'attacker-code',state:'a'.repeat(43),redirectUri:'https://cortex.example/google-oauth-callback'})}));
    expect(response.status).toBe(400); expect(network).not.toHaveBeenCalled();
  });
  it('requests the authenticated owner snapshot and never queries raw OAuth secrets or foreign tables',async()=>{
    const ownPatients=Array.from({length:1201},(_,i)=>({id:String(i).padStart(5,'0'),user_id:user}));
    const db=fakeDatabase({patients:[...ownPatients,{id:'foreign',user_id:'victim'}],
      user_integration_status:[{user_id:user,google_connected:true}],
      user_integrations:[{user_id:user,google_refresh_token:'DO_NOT_EXPORT'}],
    });
    db.rpc.mockResolvedValueOnce({data:snapshot({patients:ownPatients,user_integration_status:[{user_id:user,google_connected:true}],clinical_record_revisions:[],knowledge_chunks:[]}),error:null});
    const response=await loadHandler('export-user-data',db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({action:'manifest',userId:'victim'})}));
    expect(response.status).toBe(200);
    const manifest=await response.json();
    expect(manifest.userId).toBe(user); expect(manifest.tables.patients).toHaveLength(1201);
    expect(JSON.stringify(manifest)).not.toContain('DO_NOT_EXPORT');
    expect(manifest.tables).toHaveProperty('clinical_record_revisions');
    expect(manifest.tables).toHaveProperty('knowledge_chunks');
    expect(db.rpc).toHaveBeenCalledWith('create_data_export_snapshot',{p_user_id:user});
    expect(db.reads).not.toContain('user_integrations');
  });
  it('returns actual bytes for an owned private export file',async()=>{
    const db=fakeDatabase();
    const response=await loadHandler('export-user-data',db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({action:'file',exportId,bucket:'prescriptions',path:`rx/${user}/${rxId}.pdf`})}));
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(await response.text()).toBe('PDF');
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenNthCalledWith(1,'check_export_file',{p_user_id:user,p_export_id:exportId,p_bucket:'prescriptions',p_path:`rx/${user}/${rxId}.pdf`});
  });
  it('rejects cross-user and normalization aliases in file exports',async()=>{
    const db=fakeDatabase(); const handler=loadHandler('export-user-data',db);
    for(const path of [`rx/${patient}/${rxId}.pdf`,`rx/${user}/../${patient}/secret.pdf`]) {
      const response=await handler(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({action:'file',exportId,bucket:'prescriptions',path})}));
      expect(response.status).toBe(403);
    }
    expect(db.download).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('retains account metadata when an interrupted provider upload cannot be reconciled',async()=>{
    const db=fakeDatabase({provider_upload_leases:[{id:'pending',user_id:user,patient_id:patient,created_at:'2026-01-01'}]});
    const response=await loadHandler('delete-user-data',db)(new Request('https://edge.invalid',{method:'POST'}));
    expect(response.status).toBe(503);expect(db.list).not.toHaveBeenCalled();expect(db.deleteUser).not.toHaveBeenCalled();
    expect(db.tables.account_deletion_requests).toEqual([{user_id:user}]);
    expect(db.tables.provider_upload_leases).toHaveLength(1);
  });
  it('fails closed when a consistent server snapshot cannot be created',async()=>{
    const db=fakeDatabase();db.rpc.mockResolvedValueOnce({data:null,error:{message:'snapshot unavailable'}});
    const response=await loadHandler('export-user-data',db)(new Request('https://edge.invalid',{method:'POST',body:JSON.stringify({action:'manifest'})}));
    expect(response.status).toBe(503);expect(db.download).not.toHaveBeenCalled();
  });
});
