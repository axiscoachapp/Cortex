// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadToGeminiFiles } from '../../supabase/functions/_shared/gemini';
const uri='https://generativelanguage.googleapis.com/v1beta/files/synthetic-upload';
function database() {
  const tables:Record<string,Array<Record<string,unknown>>>={};
  return {tables,from:(table:string)=>({
    upsert:async(row:object)=>{(tables[table]??=[]).push({...row});return{error:null};},
    delete:()=>{const filters:Record<string,string>={};const q={eq:(key:string,value:string)=>{filters[key]=value;return q;},limit:()=>q,
      then:(resolve:(result:{error:null})=>unknown)=>{tables[table]=(tables[table]??[]).filter(row=>!Object.entries(filters).every(([key,value])=>row[key]===value));return Promise.resolve(resolve({error:null}));}};return q;},
  })};
}
beforeEach(()=>{vi.stubGlobal('Deno',{env:{get:()=> 'true'}});vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('durable provider upload admission',()=>{
  it('registers the upload before sending source bytes and converts it to exact cleanup identity',async()=>{
    const db=database();const fetch=vi.fn().mockResolvedValueOnce(new Response('',{headers:{'X-Goog-Upload-URL':'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=synthetic'}})).mockImplementationOnce(async()=>{
      expect(db.tables.provider_upload_leases).toHaveLength(1);
      return new Response(JSON.stringify({file:{uri}}));
    });vi.stubGlobal('fetch',fetch);
    expect(await uploadToGeminiFiles('key',new ArrayBuffer(3),'audio/webm',{db,userId:'doctor',patientId:'patient'})).toBe(uri);
    expect(db.tables.provider_upload_leases).toHaveLength(0);
    expect(db.tables.provider_file_cleanup).toEqual([expect.objectContaining({file_name:'files/synthetic-upload',patient_id:'patient'})]);
    const init=JSON.parse(fetch.mock.calls[0][1].body);
    expect(init.file.display_name).toMatch(/^cortex-upload-[a-f0-9-]{36}$/);
  });
  it('retains an unresolved obligation when source transfer has an unknown result',async()=>{
    const db=database();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('',{headers:{'X-Goog-Upload-URL':'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=synthetic'}})).mockRejectedValueOnce(new Error('connection lost')));
    await expect(uploadToGeminiFiles('key',new ArrayBuffer(3),'audio/webm',{db,userId:'doctor',patientId:'patient'})).rejects.toThrow();
    expect(db.tables.provider_upload_leases).toHaveLength(1);
  });
  it('clears initialization-only obligations when no source bytes were sent',async()=>{
    const db=database();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:403})));
    await expect(uploadToGeminiFiles('key',new ArrayBuffer(3),'audio/webm',{db,userId:'doctor',patientId:'patient'})).rejects.toThrow();
    expect(db.tables.provider_upload_leases).toHaveLength(0);
  });
});
