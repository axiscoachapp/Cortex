import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readWhatsAppAssignees,WhatsAppAssigneeReadError,type WhatsAppAssigneeReadInput} from './whatsappAssignees';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row={userId:id(1),name:'Equipe sintética A',role:'reception' as const,ambiguous:false};
const other={...row,userId:id(2),name:'Equipe sintética B',role:'admin' as const};
const cursor=`a1.${id(1)}`;
describe('read the delivered assignees catalogue without granting transfer authority',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.invoke.mockResolvedValue({data:{items:[row,other],nextBefore:null},error:null});});
  it('sends only the bounded read body and preserves literal labels and roles',async()=>{
    expect(await readWhatsAppAssignees()).toEqual({items:[row,other],nextBefore:null});
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api',{body:{action:'assignees',before:null,limit:50},signal:undefined});
  });
  it('echoes a complete cursor, explicit limit and caller signal without authority fields',async()=>{
    const signal=new AbortController().signal;mocks.invoke.mockResolvedValue({data:{items:[other],nextBefore:`a1.${id(2)}`},error:null});
    expect(await readWhatsAppAssignees({before:cursor,limit:1},signal)).toEqual({items:[other],nextBefore:`a1.${id(2)}`});
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api',{body:{action:'assignees',before:cursor,limit:1},signal});
  });
  it('accepts an empty page without asserting channel state or a complete roster',async()=>{
    mocks.invoke.mockResolvedValue({data:{items:[],nextBefore:null},error:null});expect(await readWhatsAppAssignees()).toEqual({items:[],nextBefore:null});
  });
  it('retains an ambiguity flag even without a visible matching name',async()=>{
    const item={...row,name:'  Équipe <b>sintética</b>  ',ambiguous:true};mocks.invoke.mockResolvedValue({data:{items:[item],nextBefore:null},error:null});
    expect((await readWhatsAppAssignees()).items).toEqual([item]);
  });
  it('accepts NFC/case/space-equivalent names only when every visible person is marked ambiguous',async()=>{
    const items=[{...row,name:' Équipe sintética ',ambiguous:true},{...other,name:'E\u0301QUIPE SINTÉTICA',ambiguous:true}];mocks.invoke.mockResolvedValue({data:{items,nextBefore:null},error:null});
    expect((await readWhatsAppAssignees()).items).toEqual(items);
  });
  it('accepts fifty ordered distinct rows without slicing or silently sorting them',async()=>{
    const items=Array.from({length:50},(_,i)=>({...row,userId:id(i+1),name:`Equipe sintética ${i+1}`}));mocks.invoke.mockResolvedValue({data:{items,nextBefore:`a1.${id(50)}`},error:null});
    expect((await readWhatsAppAssignees()).items).toEqual(items);
  });
  it('accepts the 256-character label boundary literally',async()=>{
    const item={...row,name:'A'.repeat(256)};mocks.invoke.mockResolvedValue({data:{items:[item],nextBefore:null},error:null});expect((await readWhatsAppAssignees()).items).toEqual([item]);
  });
  it.each([
    {limit:0},{limit:-1},{limit:51},{limit:1.5},{limit:NaN},{limit:Infinity},{limit:'1'},{limit:null},
    {before:''},{before:'a1.invalid'},{before:`a1.${id(1)}\n`},{before:`a2.${id(1)}`},{before:`a1.${id(1)}.extra`},{before:'a'.repeat(1000)},
    {actorId:id(1)},{clinicId:id(1)},{conversationId:id(1)},{targetUserId:id(1)},{action:'act'},null,[],
  ])('rejects invalid input or extra authority before transport (%#)',async input=>{
    await expect(readWhatsAppAssignees(input as WhatsAppAssigneeReadInput)).rejects.toMatchObject({code:'invalid'});expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each([
    null,[],{}, {items:null,nextBefore:null},{items:[row]}, {items:[row],nextBefore:null,clinicId:id(3)},
    {items:[],nextBefore:cursor},{items:[row],nextBefore:`a1.${id(2)}`},{items:[row],nextBefore:'a1.invalid'},
    {items:[row,row],nextBefore:null},{items:[other,row],nextBefore:null},
    {items:Array.from({length:51},(_,i)=>({...row,userId:id(i+1),name:`Equipe sintética ${i+1}`})),nextBefore:null},
  ])('rejects malformed page, cursor association, duplicates, order and overflow (%#)',async data=>{
    mocks.invoke.mockResolvedValue({data,error:null});await expect(readWhatsAppAssignees()).rejects.toMatchObject({code:'INVALID_RESPONSE'});expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    {userId:'invalid'},{name:''},{name:' \n '},{name:null},{name:'A'.repeat(257)},{role:'doctor'},{role:null},
    {ambiguous:null},{ambiguous:'false'},{ambiguous:undefined},{email:'synthetic@example.invalid'},{phone:'SYNTHETIC'},{clinicId:id(3)},
  ])('rejects malformed rows and excess private data (%#)',async patch=>{
    mocks.invoke.mockResolvedValue({data:{items:[{...row,...patch}],nextBefore:null},error:null});await expect(readWhatsAppAssignees()).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it.each([[false,false],[true,false],[false,true]])('refuses contradictory ambiguity flags for visibly identical names (%#)',async flags=>{
    mocks.invoke.mockResolvedValue({data:{items:[{...row,name:' Équipe sintética ',ambiguous:flags[0]},{...other,name:'E\u0301QUIPE SINTÉTICA',ambiguous:flags[1]}],nextBefore:null},error:null});
    await expect(readWhatsAppAssignees()).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('refuses a page larger than the requested limit',async()=>{await expect(readWhatsAppAssignees({limit:1})).rejects.toMatchObject({code:'INVALID_RESPONSE'});});
  it('refuses rows at or before the requested cursor',async()=>{await expect(readWhatsAppAssignees({before:cursor})).rejects.toMatchObject({code:'INVALID_RESPONSE'});});
  it('refuses a repeated next cursor even when a newer row is present',async()=>{
    mocks.invoke.mockResolvedValue({data:{items:[other],nextBefore:cursor},error:null});await expect(readWhatsAppAssignees({before:cursor})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it.each(['forbidden','not_connected','server_not_ready','directory_unavailable','not_found','invalid','unavailable','future','__proto__','toString'])('maps known errors safely without automatic retry (%s)',async code=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({code,error:'PRIVATE SYNTHETIC DETAIL'}),{status:403})}});
    const error=await readWhatsAppAssignees().catch(error=>error);expect(error).toBeInstanceOf(WhatsAppAssigneeReadError);expect(error.code).toBe(['future','__proto__','toString'].includes(code)?'unavailable':code);expect(error.message).not.toContain('PRIVATE');expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('handles transport failure with a local generic error',async()=>{mocks.invoke.mockRejectedValue(new Error('PRIVATE SYNTHETIC FETCH'));const error=await readWhatsAppAssignees().catch(error=>error);expect(error).toMatchObject({code:'unavailable'});expect(error.message).not.toContain('PRIVATE');expect(mocks.invoke).toHaveBeenCalledTimes(1);});
  it('does not call transport for a pre-aborted read',async()=>{const controller=new AbortController();controller.abort();await expect(readWhatsAppAssignees({},controller.signal)).rejects.toMatchObject({code:'cancelled'});expect(mocks.invoke).not.toHaveBeenCalled();});
  it('rejects a late success when transport ignored cancellation',async()=>{const controller=new AbortController();mocks.invoke.mockImplementation(async()=>{controller.abort();return {data:{items:[row],nextBefore:null},error:null};});await expect(readWhatsAppAssignees({},controller.signal)).rejects.toMatchObject({code:'cancelled'});});
  it('prioritizes caller cancellation on transport rejection',async()=>{const controller=new AbortController();mocks.invoke.mockImplementation(async()=>{controller.abort();throw new Error('PRIVATE SYNTHETIC FETCH');});await expect(readWhatsAppAssignees({},controller.signal)).rejects.toMatchObject({code:'cancelled'});});
  it('prioritizes cancellation during error-body parsing',async()=>{const controller=new AbortController();mocks.invoke.mockResolvedValue({data:null,error:{context:{json:async()=>{controller.abort();return {code:'forbidden'};}}}});await expect(readWhatsAppAssignees({},controller.signal)).rejects.toMatchObject({code:'cancelled'});});
});
