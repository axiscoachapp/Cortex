// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGemini, embedText, embedBatch, uploadToGeminiFiles } from '../../supabase/functions/_shared/gemini';
import { fetchWithDeadline } from '../../supabase/functions/_shared/http';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('AI kill switch at the final provider boundary',()=>{
  it('blocks generation, embeddings and upload before any network or database work',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=>undefined}});
    const request=vi.fn();vi.stubGlobal('fetch',request);
    const from=vi.fn();
    for(const action of [()=>callGemini('key',[{text:'Synthetic private text'}]),()=>embedText('key','Synthetic private text'),()=>embedBatch('key',['Synthetic private text']),()=>uploadToGeminiFiles('key',new ArrayBuffer(0),'audio/webm',{db:{from},userId:'doctor',patientId:'patient'})]) await expect(action()).rejects.toThrow(/IA.*indisponível|IA.*desativada/);
    expect(request).not.toHaveBeenCalled();expect(from).not.toHaveBeenCalled();
  });
  it('also blocks legacy direct generation URLs while permitting provider cleanup',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'false'}});
    const request=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',request);
    await expect(fetchWithDeadline('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=secret',{method:'POST'})).rejects.toThrow(/IA/);
    expect((await fetchWithDeadline('https://generativelanguage.googleapis.com/v1beta/files/synthetic?key=secret',{method:'DELETE'})).status).toBe(204);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('records only PHI-free operation metadata for provider failures',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'true'}});
    const log=vi.spyOn(console,'info').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private upstream body',{status:503})));
    await expect(callGemini('secret-key',[{text:'Synthetic patient-name clinical content'}])).rejects.toThrow();
    const records=log.mock.calls.map(args=>JSON.parse(String(args[0])));
    expect(records).toContainEqual(expect.objectContaining({operation_id:expect.any(String),operation:'generate',status:'failed',http_status:503,duration_ms:expect.any(Number)}));
    expect(JSON.stringify(records)).not.toMatch(/patient-name|clinical content|private upstream|secret-key|generativelanguage/);
  });
  it('records incomplete model output against its operation without logging the output',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'true'}});const log=vi.spyOn(console,'info').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Synthetic private incomplete note'}]}}]}))));
    await expect(callGemini('key',[])).rejects.toThrow(/Referência/);
    expect(log.mock.calls.map(args=>JSON.parse(String(args[0])))).toContainEqual(expect.objectContaining({event:'model_response_invalid',error_code:'incomplete_or_invalid_output',operation_id:expect.any(String)}));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private incomplete note');
  });
});
