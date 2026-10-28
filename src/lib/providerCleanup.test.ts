// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginProviderUpload, cleanupGeminiFile, geminiFileName, trackGeminiFile, retryProviderCleanup } from '../../supabase/functions/_shared/providerFiles';

const uri='https://generativelanguage.googleapis.com/v1beta/files/synthetic-123';
function client() {
  const rows: Array<Record<string,unknown>>=[];
  const db={ rows, failInsert:false, failDelete:false, from:()=>({
    upsert: async (row:object)=>{ if(!db.failInsert) rows.push({...row}); return {error:db.failInsert ? new Error('offline'):null}; },
    delete:()=>{const filters:Record<string,string>={}; const q={eq:(key:string,value:string)=>{filters[key]=value;return q;},limit:()=>q,
      then:(resolve:(value:{error:Error|null})=>unknown)=>Promise.resolve().then(()=>{if(!db.failDelete) rows.splice(0,rows.length,...rows.filter(row=>!Object.entries(filters).every(([key,value])=>row[key]===value)));return resolve({error:db.failDelete?new Error('offline'):null});})};return q;},
    select:()=>{const filters:Record<string,string>={};const q={eq:(key:string,value:string)=>{filters[key]=value;return q;},limit:()=>q,
      then:(resolve:(value:{data:typeof rows;error:null})=>unknown)=>Promise.resolve(resolve({data:rows.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)),error:null}))};return q;},
  })};
  return db;
}
afterEach(()=>vi.unstubAllGlobals());
describe('exact provider file lifecycle',()=>{
  it('rejects arbitrary provider URLs before any external request',()=>{
    for(const value of ['https://evil.invalid/v1beta/files/file','https://generativelanguage.googleapis.com/v1beta/files/../secret','https://generativelanguage.googleapis.com/v1beta/files/id?secret=1']) expect(()=>geminiFileName(value)).toThrow();
  });
  it('registers the patient-linked identity and retains failed cleanup for retry',async()=>{
    const db=client(); const request=vi.fn().mockResolvedValue(new Response('',{status:503})); vi.stubGlobal('fetch',request);
    await trackGeminiFile('key',uri,db,'doctor','patient');
    expect(db.rows).toEqual([expect.objectContaining({user_id:'doctor',patient_id:'patient',file_name:'files/synthetic-123'})]);
    expect(await cleanupGeminiFile('key',uri,db,'doctor')).toBe(false);
    expect(db.rows).toHaveLength(1);
    request.mockResolvedValueOnce(new Response(null,{status:204}));
    await retryProviderCleanup(db,'doctor','key','patient');
    expect(db.rows).toHaveLength(0);
    expect(request).toHaveBeenLastCalledWith(expect.stringContaining('/v1beta/files/synthetic-123?key=key'),expect.objectContaining({method:'DELETE'}));
  });
  it('treats an already-absent provider file as successful idempotent cleanup',async()=>{
    const db=client();await trackGeminiFile('key',uri,db,'doctor','patient');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:404})));
    expect(await cleanupGeminiFile('key',uri,db,'doctor')).toBe(true);
    expect(db.rows).toHaveLength(0);
  });
  it('fails closed if tracking cannot be persisted and attempts immediate removal',async()=>{
    const db=client();db.failInsert=true;const request=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',request);
    await expect(trackGeminiFile('key',uri,db,'doctor','patient')).rejects.toThrow(/registrar/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('blocks deletion completion if external cleanup remains unresolved',async()=>{
    const db=client();await trackGeminiFile('key',uri,db,'doctor','patient');
    await expect(retryProviderCleanup(db,'doctor',undefined,'patient')).rejects.toThrow(/pendentes/);
    expect(db.rows).toHaveLength(1);
  });
  it('refuses to contact the provider unless the pre-upload lease is persisted',async()=>{
    const db=client();db.failInsert=true;
    await expect(beginProviderUpload({db,userId:'doctor',patientId:'patient'})).rejects.toThrow(/registrar o envio/);
  });
});
