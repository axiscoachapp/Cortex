import {beforeEach,describe,expect,it,vi} from 'vitest';
import {releaseWhatsAppConversation,WhatsAppReleaseError,type WhatsAppReleaseInput} from './whatsappRelease';
import {WhatsAppClaimError} from './whatsappClaim';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
const conversationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const input={conversationId,revision:7,assignedTo:actor},receipt={revision:8,status:'open',assignedTo:null};
describe('release own WhatsApp conversation adapter',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.invoke.mockResolvedValue({data:receipt,error:null});});
  it('sends only unassign and its CAS tuple, stripping local owner context',async()=>{
    const signal=new AbortController().signal;expect(await releaseWhatsAppConversation(input,actor,signal)).toEqual(receipt);expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('whatsapp-api',{body:{action:'act',operation:'unassign',conversationId,revision:7},signal});
  });
  it('accepts UUID casing but retains canonical transport',async()=>{await releaseWhatsAppConversation({...input,conversationId:conversationId.toUpperCase(),assignedTo:actor.toUpperCase()},actor.toUpperCase());expect(mocks.invoke.mock.calls[0][1].body.conversationId).toBe(conversationId);});
  it.each([0,2147483646])('accepts incrementable PostgreSQL revisions (%i)',async revision=>{mocks.invoke.mockResolvedValue({data:{...receipt,revision:revision+1},error:null});expect((await releaseWhatsAppConversation({...input,revision},actor)).revision).toBe(revision+1);});
  it.each([{...input,assignedTo:other},{...input,assignedTo:null},{...input,assignedTo:'invalid'},{...input,conversationId:'invalid'},{...input,revision:-1},{...input,revision:1.5},{...input,revision:2147483647},{...input,revision:NaN},{...input,actorId:actor},{...input,clinicId:other},{...input,targetUserId:other},{...input,operation:'close'},{...input,action:'send'}])('rejects ownership mismatch, malformed tuple and injected authority (%j)',async value=>{
    await expect(releaseWhatsAppConversation(value as WhatsAppReleaseInput,actor)).rejects.toMatchObject({code:'invalid',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('rejects invalid expected actor before transport',async()=>{await expect(releaseWhatsAppConversation(input,'invalid')).rejects.toMatchObject({code:'invalid',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();});
  it.each([{...receipt,revision:7},{...receipt,revision:9},{...receipt,status:'closed'},{...receipt,assignedTo:actor},{...receipt,assignedTo:other},{...receipt,extra:'PRIVATE SYNTHETIC DETAIL'},null,[]])('requires the exact released-open receipt (%j)',async data=>{
    mocks.invoke.mockResolvedValue({data,error:null});await expect(releaseWhatsAppConversation(input,actor)).rejects.toMatchObject({code:'INVALID_RESPONSE',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['stale','forbidden','not_found','not_connected','server_not_ready','invalid','unrecognized'])('maps errors without raw details or automatic retry (%s)',async code=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({code,error:'PRIVATE SYNTHETIC DETAIL'}),{status:409})}});const error=await releaseWhatsAppConversation(input,actor).catch(error=>error);expect(error).toBeInstanceOf(WhatsAppReleaseError);expect(error).toBeInstanceOf(WhatsAppClaimError);expect(error.needsRefresh).toBe(true);expect(error.code).toBe(code==='unrecognized'?'unavailable':code);expect(error.message).not.toContain('PRIVATE');expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('marks a lost response unresolved and does not retry',async()=>{mocks.invoke.mockRejectedValue(new Error('PRIVATE SYNTHETIC FETCH'));await expect(releaseWhatsAppConversation(input,actor)).rejects.toMatchObject({code:'unavailable',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);});
  it('does not send after pre-cancellation',async()=>{const controller=new AbortController();controller.abort();await expect(releaseWhatsAppConversation(input,actor,controller.signal)).rejects.toMatchObject({code:'cancelled',needsRefresh:false});expect(mocks.invoke).not.toHaveBeenCalled();});
  it('does not adopt a receipt after late cancellation',async()=>{const controller=new AbortController();mocks.invoke.mockImplementation(async()=>{controller.abort();return {data:receipt,error:null};});await expect(releaseWhatsAppConversation(input,actor,controller.signal)).rejects.toMatchObject({code:'cancelled',needsRefresh:true});expect(mocks.invoke).toHaveBeenCalledTimes(1);});
});
