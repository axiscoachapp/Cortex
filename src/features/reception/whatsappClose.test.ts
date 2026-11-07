import {beforeEach,describe,expect,it,vi} from 'vitest';
import {closeWhatsAppConversation,WhatsAppCloseError,type WhatsAppCloseInput} from './whatsappClose';
import {WhatsAppClaimError} from './whatsappClaim';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
const conversationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const input={conversationId,revision:7,status:'open' as const,assignedTo:actor},receipt={revision:8,status:'closed',assignedTo:actor};
describe('close own WhatsApp conversation adapter',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.invoke.mockResolvedValue({data:receipt,error:null});});
  it('sends only close and its revision tuple, stripping local owner and status context',async()=>{
    const signal=new AbortController().signal;expect(await closeWhatsAppConversation(input,actor,signal)).toEqual(receipt);expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api',{body:{action:'act',operation:'close',conversationId,revision:7},signal});
  });
  it('accepts UUID casing but retains canonical transport',async()=>{await closeWhatsAppConversation({...input,conversationId:conversationId.toUpperCase(),assignedTo:actor.toUpperCase()},actor.toUpperCase());expect(mocks.invoke.mock.calls[0][1].body.conversationId).toBe(conversationId);});
  it.each([0,2147483646])('accepts incrementable PostgreSQL revisions (%i)',async revision=>{mocks.invoke.mockResolvedValue({data:{...receipt,revision:revision+1},error:null});expect((await closeWhatsAppConversation({...input,revision},actor)).revision).toBe(revision+1);});
  it.each([{...input,assignedTo:other},{...input,assignedTo:null},{...input,assignedTo:'invalid'},{...input,conversationId:'invalid'},{...input,revision:-1},{...input,revision:1.5},{...input,revision:2147483647},{...input,revision:NaN},{...input,actorId:actor},{...input,clinicId:other},{...input,targetUserId:other},{...input,operation:'reopen'},{...input,action:'send'},{...input,status:'closed'},{...input,status:null},{conversationId,revision:7,assignedTo:actor},{...input,targetId:other},{...input,queue:'agenda'}])('rejects ownership mismatch, malformed tuple and injected authority (%j)',async value=>{
    await expect(closeWhatsAppConversation(value as WhatsAppCloseInput,actor)).rejects.toMatchObject({code:'invalid',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('normalizes the preserved owner in the receipt',async()=>{mocks.invoke.mockResolvedValue({data:{...receipt,assignedTo:actor.toUpperCase()},error:null});expect((await closeWhatsAppConversation(input,actor)).assignedTo).toBe(actor);});
  it('rejects invalid expected actor before transport',async()=>{await expect(closeWhatsAppConversation(input,'invalid')).rejects.toMatchObject({code:'invalid',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();});
  it.each([{...receipt,revision:7},{...receipt,revision:9},{...receipt,status:'open'},{...receipt,assignedTo:null},{...receipt,assignedTo:other},{...receipt,assignedTo:'invalid'},{...receipt,revision:8.5},{...receipt,extra:'PRIVATE SYNTHETIC DETAIL'},null,[]])('requires the exact closed receipt with unchanged owner (%j)',async data=>{
    mocks.invoke.mockResolvedValue({data,error:null});await expect(closeWhatsAppConversation(input,actor)).rejects.toMatchObject({code:'INVALID_RESPONSE',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['stale','forbidden','not_found','not_connected','server_not_ready','invalid','unrecognized','__proto__','toString'])('maps errors without raw details or automatic retry (%s)',async code=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({code,error:'PRIVATE SYNTHETIC DETAIL'}),{status:409})}});const error=await closeWhatsAppConversation(input,actor).catch(error=>error);expect(error).toBeInstanceOf(WhatsAppCloseError);expect(error).toBeInstanceOf(WhatsAppClaimError);expect(error.needsRefresh).toBe(true);expect(error.code).toBe(['unrecognized','__proto__','toString'].includes(code)?'unavailable':code);expect(error.message).not.toContain('PRIVATE');expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('marks a lost response unresolved and does not retry',async()=>{mocks.invoke.mockRejectedValue(new Error('PRIVATE SYNTHETIC FETCH'));await expect(closeWhatsAppConversation(input,actor)).rejects.toMatchObject({code:'unavailable',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);});
  it('does not send after pre-cancellation',async()=>{const controller=new AbortController();controller.abort();await expect(closeWhatsAppConversation(input,actor,controller.signal)).rejects.toMatchObject({code:'cancelled',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();});
  it('prioritizes cancellation during error body parsing',async()=>{const controller=new AbortController();mocks.invoke.mockResolvedValue({data:null,error:{context:{json:async()=>{controller.abort();return {code:'stale'};}}}});await expect(closeWhatsAppConversation(input,actor,controller.signal)).rejects.toMatchObject({code:'cancelled',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);});
  it('does not adopt a receipt after late cancellation',async()=>{const controller=new AbortController();mocks.invoke.mockImplementation(async()=>{controller.abort();return {data:receipt,error:null};});await expect(closeWhatsAppConversation(input,actor,controller.signal)).rejects.toMatchObject({code:'cancelled',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);});
});
