import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readWhatsAppDashboard,WhatsAppDashboardReadError,type WhatsAppDashboardInput} from './whatsappDashboard';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={from:'2026-11-01T00:00:00Z',to:'2026-11-07T00:00:00Z'};
const owner={userId:id(1),name:'Equipe sintética A',role:'reception' as const,ambiguous:false,openCount:2};
const data=()=>({schemaVersion:1,asOf:'2026-11-07T12:00:00.000Z',window:{from:'2026-11-01T00:00:00.000Z',to:'2026-11-07T00:00:00.000Z',timeZone:'America/Sao_Paulo'},coverage:'latest_cycle_only',cohort:{incomingCycles:4,withHumanSend:2,withoutHumanSend:2,medianFirstHumanSendSeconds:600,closedWithoutHumanSend:1},openNow:{total:3,unassigned:1,assignedToIneligible:0,owners:{items:[owner],nextBefore:null as string|null}},unavailable:{abandonment:'no_explicit_event',appointments:'scoped_source_required'}});
describe('read the agreed K2 aggregate without deriving missing metrics or authority',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.invoke.mockResolvedValue({data:data(),error:null});});
  it('sends only canonical dates and bounded paging and retains the complete DTO',async()=>{
    expect(await readWhatsAppDashboard(input)).toEqual(data());expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api',{body:{action:'dashboard',from:data().window.from,to:data().window.to,before:null,limit:50},signal:undefined});
  });
  it('normalizes valid offsets once while forwarding the opaque cursor, limit and signal',async()=>{
    const signal=new AbortController().signal,page={...data(),openNow:{total:3,unassigned:1,assignedToIneligible:0,owners:{items:[{...owner,userId:id(2)}],nextBefore:null}}};
    mocks.invoke.mockResolvedValue({data:page,error:null});expect(await readWhatsAppDashboard({from:'2026-11-01T03:00:00+03:00',to:input.to,before:`a1.${id(1)}`,limit:1},signal)).toEqual(page);
    expect(mocks.invoke.mock.calls[0][1]).toEqual({body:{action:'dashboard',from:data().window.from,to:data().window.to,before:`a1.${id(1)}`,limit:1},signal});
  });
  it('preserves null without inventing a zero median, abandonment or appointment counts',async()=>{
    const page={...data(),cohort:{incomingCycles:0,withHumanSend:0,withoutHumanSend:0,medianFirstHumanSendSeconds:null,closedWithoutHumanSend:0}};
    mocks.invoke.mockResolvedValue({data:page,error:null});expect(await readWhatsAppDashboard(input)).toEqual(page);
  });
  it('accepts a measured zero median when a human sample exists',async()=>{const page={...data(),cohort:{...data().cohort,medianFirstHumanSendSeconds:0}};mocks.invoke.mockResolvedValue({data:page,error:null});expect((await readWhatsAppDashboard(input)).cohort.medianFirstHumanSendSeconds).toBe(0);});
  it('keeps a partial owner page separate from the complete totals',async()=>{
    const page={...data(),openNow:{...data().openNow,total:8,owners:{items:[owner],nextBefore:`a1.${id(1)}`}}};mocks.invoke.mockResolvedValue({data:page,error:null});expect(await readWhatsAppDashboard(input)).toEqual(page);
  });
  it('accepts fifty ordered owners and literal labels/ambiguity without sorting by workload',async()=>{
    const items=Array.from({length:50},(_,i)=>({...owner,userId:id(i+1),name:`Equipe sintética ${i+1}`,openCount:1}));
    items[1]={...items[1],name:' <b>Equipe</b> sintética ',ambiguous:true};
    const page={...data(),openNow:{total:51,unassigned:1,assignedToIneligible:0,owners:{items,nextBefore:null}}};mocks.invoke.mockResolvedValue({data:page,error:null});expect((await readWhatsAppDashboard(input)).openNow.owners.items).toEqual(items);
  });
  it('accepts visible repeated names only with both ambiguity flags set',async()=>{
    const items=[{...owner,name:' Équipe ',ambiguous:true},{...owner,userId:id(2),name:'E\u0301QUIPE',ambiguous:true}];
    const page={...data(),openNow:{total:5,unassigned:1,assignedToIneligible:0,owners:{items,nextBefore:null}}};mocks.invoke.mockResolvedValue({data:page,error:null});expect((await readWhatsAppDashboard(input)).openNow.owners.items).toEqual(items);
  });
  it('accepts safe integer count boundaries without coercing their type',async()=>{
    const max=Number.MAX_SAFE_INTEGER,page={...data(),cohort:{incomingCycles:max,withHumanSend:0,withoutHumanSend:max,medianFirstHumanSendSeconds:null,closedWithoutHumanSend:0},openNow:{total:max,unassigned:max,assignedToIneligible:0,owners:{items:[],nextBefore:null}}};
    mocks.invoke.mockResolvedValue({data:page,error:null});expect(await readWhatsAppDashboard(input)).toEqual(page);
  });
  it.each([
    {from:'2024-02-29T00:00:00Z',to:'2024-03-01T00:00:00Z'},
    {from:'2026-10-01T00:00:00Z',to:'2026-11-01T00:00:00Z'},
  ])('accepts a real leap day and the exact 31-day boundary (%#)',async value=>{
    const page={...data(),window:{...data().window,from:new Date(value.from).toISOString(),to:new Date(value.to).toISOString()}};
    mocks.invoke.mockResolvedValue({data:page,error:null});expect(await readWhatsAppDashboard(value)).toEqual(page);
  });
  it('accepts a response whose asOf equals the requested end',async()=>{
    const page={...data(),asOf:data().window.to};mocks.invoke.mockResolvedValue({data:page,error:null});expect(await readWhatsAppDashboard(input)).toEqual(page);
  });
  it('captures the requested period instead of rereading a caller object after await',async()=>{
    const mutable={...input};mocks.invoke.mockImplementation(async()=>{mutable.from='2026-11-03T00:00:00Z';return {data:data(),error:null};});
    expect(await readWhatsAppDashboard(mutable)).toEqual(data());expect(mocks.invoke.mock.calls[0][1].body.from).toBe(data().window.from);
  });
  it.each([
    {...input,from:'2026-02-30T00:00:00Z',to:'2026-03-03T00:00:00Z'},{...input,from:'2025-02-29T00:00:00Z',to:'2025-03-03T00:00:00Z'},
    {...input,from:'2026-11-01'},{...input,from:'invalid'},{...input,from:input.to},{...input,from:input.to,to:input.from},
    {...input,from:'2026-10-01T00:00:00Z'},{...input,limit:0},{...input,limit:51},{...input,limit:1.5},{...input,limit:true},{...input,limit:'2'},{...input,limit:[2]},{...input,limit:NaN},{...input,limit:Infinity},
    {...input,before:''},{...input,before:'a1.invalid'},{...input,before:`a1.${id(1)}\n`},
    {...input,clinicId:id(100)},{...input,actorId:id(100)},{...input,role:'admin'},{...input,patientId:id(100)},{...input,action:'act'},null,[],{},
  ])('rejects invalid dates/types/range/authority before transport (%#)',async value=>{
    await expect(readWhatsAppDashboard(value as WhatsAppDashboardInput)).rejects.toMatchObject({code:'invalid'});expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each([
    null,[],{}, {...data(),schemaVersion:2},{...data(),coverage:'all_history'},{...data(),clinicId:id(100)},
    {...data(),window:{...data().window,timeZone:'UTC'}},{...data(),window:{...data().window,from:'2026-11-02T00:00:00Z'}},
    {...data(),window:{...data().window,to:'2026-11-06T00:00:00Z'}},{...data(),asOf:'2026-11-06T23:59:59Z'},
    {...data(),asOf:'2026-02-30T00:00:00Z'},{...data(),unavailable:{abandonment:0,appointments:0}},
    {...data(),cohort:{...data().cohort,incomingCycles:5}},{...data(),cohort:{...data().cohort,closedWithoutHumanSend:3}},
    {...data(),cohort:{...data().cohort,medianFirstHumanSendSeconds:null}},{...data(),cohort:{incomingCycles:0,withHumanSend:0,withoutHumanSend:0,medianFirstHumanSendSeconds:0,closedWithoutHumanSend:0}},
    {...data(),cohort:{...data().cohort,medianFirstHumanSendSeconds:-1}},{...data(),cohort:{...data().cohort,medianFirstHumanSendSeconds:1.5}},
    {...data(),cohort:{...data().cohort,incomingCycles:'4'}},{...data(),cohort:{...data().cohort,incomingCycles:Number.MAX_SAFE_INTEGER+1}},
    {...data(),cohort:{...data().cohort,withHumanSend:-1}},{...data(),cohort:{...data().cohort,withoutHumanSend:1.5}},
    {...data(),cohort:{...data().cohort,messageBody:'SYNTHETIC PRIVATE'}},
    {...data(),openNow:{...data().openNow,total:2}},{...data(),openNow:{...data().openNow,total:4}},
    {...data(),openNow:{...data().openNow,unassigned:-1}},{...data(),openNow:{...data().openNow,assignedToIneligible:'0'}},
    {...data(),openNow:{...data().openNow,owners:{items:[],nextBefore:`a1.${id(1)}`}}},
    {...data(),openNow:{...data().openNow,owners:{items:[owner],nextBefore:`a1.${id(2)}`}}},
    {...data(),openNow:{...data().openNow,owners:{items:[owner,owner],nextBefore:null}}},
    {...data(),openNow:{...data().openNow,owners:{items:[{...owner,userId:id(2)},owner],nextBefore:null}}},
  ])('rejects malformed, inconsistent, mismatched or overly broad responses (%#)',async page=>{
    mocks.invoke.mockResolvedValue({data:page,error:null});await expect(readWhatsAppDashboard(input)).rejects.toMatchObject({code:'INVALID_RESPONSE'});expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([{userId:'invalid'},{name:''},{name:'   '},{name:'A'.repeat(257)},{role:'doctor'},{ambiguous:'false'},{openCount:0},{openCount:-1},{openCount:1.5},{openCount:Number.MAX_SAFE_INTEGER+1},{patientId:id(999)},{email:'synthetic@example.invalid'}])('rejects malformed owner rows (%#)',async patch=>{
    mocks.invoke.mockResolvedValue({data:{...data(),openNow:{...data().openNow,owners:{items:[{...owner,...patch}],nextBefore:null}}},error:null});await expect(readWhatsAppDashboard(input)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('refuses an over-limit page while retaining otherwise valid totals',async()=>{
    const items=[owner,{...owner,userId:id(2),name:'Equipe sintética B'}];mocks.invoke.mockResolvedValue({data:{...data(),openNow:{total:5,unassigned:1,assignedToIneligible:0,owners:{items,nextBefore:null}}},error:null});await expect(readWhatsAppDashboard({...input,limit:1})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('refuses 51 otherwise valid ordered owners rather than slicing them',async()=>{
    const items=Array.from({length:51},(_,i)=>({...owner,userId:id(i+1),name:`Equipe sintética ${i+1}`,openCount:1}));
    mocks.invoke.mockResolvedValue({data:{...data(),openNow:{total:52,unassigned:1,assignedToIneligible:0,owners:{items,nextBefore:null}}},error:null});
    await expect(readWhatsAppDashboard(input)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('refuses owners at or before the requested cursor',async()=>{await expect(readWhatsAppDashboard({...input,before:`a1.${id(1)}`})).rejects.toMatchObject({code:'INVALID_RESPONSE'});});
  it('refuses duplicate visible labels with false flags',async()=>{
    const items=[owner,{...owner,userId:id(2)}];mocks.invoke.mockResolvedValue({data:{...data(),openNow:{total:5,unassigned:1,assignedToIneligible:0,owners:{items,nextBefore:null}}},error:null});await expect(readWhatsAppDashboard(input)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it.each(['forbidden','invalid','directory_unavailable','server_not_ready','unavailable','future','__proto__','toString'])('maps errors without raw details or automatic retry (%s)',async code=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({code,error:'SYNTHETIC PRIVATE DETAIL'}),{status:403})}});const error=await readWhatsAppDashboard(input).catch(error=>error);expect(error).toBeInstanceOf(WhatsAppDashboardReadError);expect(error.code).toBe(['future','__proto__','toString'].includes(code)?'unavailable':code);expect(error.message).not.toContain('PRIVATE');expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('maps transport failure safely',async()=>{mocks.invoke.mockRejectedValue(new Error('SYNTHETIC PRIVATE FETCH'));const error=await readWhatsAppDashboard(input).catch(error=>error);expect(error).toMatchObject({code:'unavailable'});expect(error.message).not.toContain('PRIVATE');expect(mocks.invoke).toHaveBeenCalledTimes(1);});
  it('prevents a pre-aborted request',async()=>{const c=new AbortController();c.abort();await expect(readWhatsAppDashboard(input,c.signal)).rejects.toMatchObject({code:'cancelled'});expect(mocks.invoke).not.toHaveBeenCalled();});
  it('refuses a late success even when transport ignored abort',async()=>{const c=new AbortController();mocks.invoke.mockImplementation(async()=>{c.abort();return {data:data(),error:null};});await expect(readWhatsAppDashboard(input,c.signal)).rejects.toMatchObject({code:'cancelled'});});
  it('prioritizes cancellation when the transport rejects',async()=>{const c=new AbortController();mocks.invoke.mockImplementation(async()=>{c.abort();throw new Error('SYNTHETIC PRIVATE FETCH');});await expect(readWhatsAppDashboard(input,c.signal)).rejects.toMatchObject({code:'cancelled'});});
  it('prioritizes cancellation during error parsing',async()=>{const c=new AbortController();mocks.invoke.mockResolvedValue({data:null,error:{context:{json:async()=>{c.abort();return {code:'forbidden'};}}}});await expect(readWhatsAppDashboard(input,c.signal)).rejects.toMatchObject({code:'cancelled'});});
});
