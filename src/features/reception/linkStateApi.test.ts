import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receptionApi } from './api';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reply: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
const contact='11111111-1111-4111-8111-111111111111',patient='22222222-2222-4222-8222-222222222222';
describe('administrative link state API',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockReturnValue({abortSignal:mocks.reply});});
  it.each([false,true])('sends only immutable IDs, expected revision and explicit target %s',async active=>{
    mocks.reply.mockResolvedValue({data:3,error:null});expect(await receptionApi.setLinkActive(contact,patient,2,active)).toBe(3);
    expect(mocks.rpc).toHaveBeenCalledWith('reception_set_link_active',{p_contact:contact,p_patient:patient,p_revision:2,p_active:active});
  });
  it.each([0,null,false])('rejects invalid revision response %s',async data=>{
    mocks.reply.mockResolvedValue({data,error:null});await expect(receptionApi.setLinkActive(contact,patient,2,false)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it.each(['40001','42501'])('preserves the failure %s without retrying or pretending success',async code=>{
    mocks.reply.mockResolvedValue({data:null,error:{code,message:'Synthetic state refusal'}});await expect(receptionApi.setLinkActive(contact,patient,2,false)).rejects.toMatchObject({code});expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
