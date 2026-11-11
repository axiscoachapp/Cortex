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

describe('legacy team array conflict',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockReturnValue({abortSignal:mocks.reply});});
 it('explains a physician approval conflict without automatically retrying the stale list',async()=>{
  mocks.reply.mockResolvedValue({data:null,error:{code:'40001',message:'Approved delegation requires explicit withdrawal'}});
  await expect(receptionApi.updateStaff(doctor.id,[],true)).rejects.toMatchObject({
   code:'40001',message:'Uma das agendas foi aprovada pelo médico e não sai por esta lista. Use Revogar aprovação ao lado do nome do médico.',
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it.each(['Custody changed concurrently; retry the transaction','Approved delegation requires explicit withdrawal: internal detail'])('keeps other conflicts generic (%s)',async message=>{
  mocks.reply.mockResolvedValue({data:null,error:{code:'40001',message}});
  await expect(receptionApi.updateStaff(doctor.id,[],true)).rejects.toMatchObject({code:'40001',message:'Os dados mudaram em outra tela. Atualize antes de tentar novamente.'});
 });
 it('does not reuse the team message for another RPC',async()=>{
  mocks.reply.mockResolvedValue({data:null,error:{code:'40001',message:'Approved delegation requires explicit withdrawal'}});
  await expect(receptionApi.teamDoctors(clinic)).rejects.toMatchObject({code:'40001',message:'Os dados mudaram em outra tela. Atualize antes de tentar novamente.'});
 });
});

describe('authenticated legacy grant cut',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockReturnValue({abortSignal:mocks.reply});});
 it('explains that a new scope requires physician approval and never retries',async()=>{
  mocks.reply.mockResolvedValue({data:null,error:{code:'42501',message:'Authenticated legacy delegation requires physician approval'}});
  await expect(receptionApi.updateStaff(doctor.id,[doctor.id],true)).rejects.toMatchObject({code:'42501',
   message:'Novos acessos dependem da aprovação do médico. A lista antiga não pode criar nem restaurar permissões.'});
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it.each(['Authenticated legacy delegation requires physician approval: internal detail','Delegation physician approval required'])('keeps other denials generic (%s)',async message=>{
  mocks.reply.mockResolvedValue({data:null,error:{code:'42501',message}});
  await expect(receptionApi.updateStaff(doctor.id,[doctor.id],true)).rejects.toMatchObject({code:'42501',message:'Você não tem mais permissão para esta ação. Atualize a página.'});
 });
 it('does not use the grant explanation for another RPC',async()=>{
  mocks.reply.mockResolvedValue({data:null,error:{code:'42501',message:'Authenticated legacy delegation requires physician approval'}});
  await expect(receptionApi.teamDoctors(clinic)).rejects.toMatchObject({code:'42501',message:'Você não tem mais permissão para esta ação. Atualize a página.'});
 });
});
