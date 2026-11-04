import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receptionApi } from './api';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),reply:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc}}));
const clinic='11111111-1111-4111-8111-111111111111';
const doctor={id:'22222222-2222-4222-8222-222222222222',name:'Médico sintético',specialty:null};
describe('team directory boundary',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockReturnValue({abortSignal:mocks.reply});});
 it('uses a separate management projection',async()=>{
  mocks.reply.mockResolvedValue({data:[doctor],error:null});
  expect(await receptionApi.teamDoctors(clinic)).toEqual([doctor]);
  expect(mocks.rpc).toHaveBeenCalledWith('reception_team_doctors',{p_clinic:clinic});
 });
 it('rejects patient or clinical fields',async()=>{
  mocks.reply.mockResolvedValue({data:[{...doctor,patients:[]}],error:null});
  await expect(receptionApi.teamDoctors(clinic)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 });
 it('rejects unbounded results',async()=>{
  mocks.reply.mockResolvedValue({data:Array(201).fill(doctor),error:null});
  await expect(receptionApi.teamDoctors(clinic)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 });
 it('keeps forbidden distinct from an empty directory',async()=>{
  mocks.reply.mockResolvedValue({data:null,error:{code:'42501'}});
  await expect(receptionApi.teamDoctors(clinic)).rejects.toMatchObject({code:'42501'});
 });
});
