import {beforeEach,describe,expect,it,vi} from 'vitest';
import {claimWhatsAppConversation} from './whatsappClaim';

const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
const conversationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const input={conversationId,revision:7},receipt={revision:8,status:'open',assignedTo:actor};
describe('claim WhatsApp conversation boundary',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.invoke.mockResolvedValue({data:receipt,error:null});});
  it('sends only assign, conversation and revision, with actor kept out of the body',async()=>{
    const signal=new AbortController().signal;expect(await claimWhatsAppConversation(input,actor,signal)).toEqual(receipt);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api',{body:{action:'act',operation:'assign',...input},signal});
  });
  it('normalizes UUID casing without widening the request',async()=>{
    await claimWhatsAppConversation({...input,conversationId:conversationId.toUpperCase()},actor.toUpperCase());expect(mocks.invoke.mock.calls[0][1].body.conversationId).toBe(conversationId);
  });
  it.each([0,2147483646])('accepts incrementable PostgreSQL revisions (%i)',async revision=>{mocks.invoke.mockResolvedValue({data:{...receipt,revision:revision+1},error:null});expect((await claimWhatsAppConversation({...input,revision},actor)).revision).toBe(revision+1);});
  it.each([{...input,conversationId:'invalid'}, {...input,revision:-1}, {...input,revision:1.5}, {...input,revision:2147483647}, {...input,revision:Number.MAX_SAFE_INTEGER}, {...input,revision:NaN}, {...input,actorId:actor}, {...input,clinicId:other}, {...input,targetUserId:other}, {...input,operation:'close'}, {...input,action:'send'}])('refuses malformed input and injected authority before transport (%j)',async value=>{
    await expect(claimWhatsAppConversation(value,actor)).rejects.toMatchObject({code:'invalid',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('refuses invalid expected actor before transport',async()=>{await expect(claimWhatsAppConversation(input,'invalid')).rejects.toMatchObject({code:'invalid',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();});
  it.each([{...receipt,revision:7},{...receipt,revision:9},{...receipt,status:'closed'},{...receipt,assignedTo:other},{...receipt,assignedTo:null},{...receipt,extra:'PRIVATE SYNTHETIC DATA'},null,[]])('requires an exact self-assignment receipt (%j)',async data=>{
    mocks.invoke.mockResolvedValue({data,error:null});await expect(claimWhatsAppConversation(input,actor)).rejects.toMatchObject({code:'INVALID_RESPONSE',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['stale','forbidden','not_found','not_connected','server_not_ready','invalid','unrecognized'])('maps a server refusal without raw details or retry (%s)',async code=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({code,error:'PRIVATE SYNTHETIC DATA'}),{status:409})}});
    const error=await claimWhatsAppConversation(input,actor).catch(error=>error);expect(error.needsRefresh).toBe(true);expect(error.code).toBe(code==='unrecognized'?'unavailable':code);expect(error.message).not.toContain('PRIVATE');expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('treats a lost response as unresolved and never retries',async()=>{mocks.invoke.mockRejectedValue(new Error('PRIVATE SYNTHETIC FETCH'));await expect(claimWhatsAppConversation(input,actor)).rejects.toMatchObject({code:'unavailable',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);});
  it('does not send an already cancelled command',async()=>{const controller=new AbortController();controller.abort();await expect(claimWhatsAppConversation(input,actor,controller.signal)).rejects.toMatchObject({code:'cancelled',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();});
  it('does not adopt a receipt after cancellation once the command started',async()=>{
    const controller=new AbortController();mocks.invoke.mockImplementation(async()=>{controller.abort();return {data:receipt,error:null};});await expect(claimWhatsAppConversation(input,actor,controller.signal)).rejects.toMatchObject({code:'cancelled',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
