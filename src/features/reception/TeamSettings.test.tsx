import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamSettings from './TeamSettings';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess } from './contracts';
const mocks=vi.hoisted(()=>({teamDoctors:vi.fn(),updateStaff:vi.fn(),invoke:vi.fn()}));
vi.mock('./api',()=>({receptionApi:{teamDoctors:mocks.teamDoctors,updateStaff:mocks.updateStaff}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
const a={id:'11111111-1111-4111-8111-111111111111',name:'Doutor A sintético',specialty:null};
const b={id:'22222222-2222-4222-8222-222222222222',name:'Doutor B sintético',specialty:null};
const clinic='33333333-3333-4333-8333-333333333333',staff='44444444-4444-4444-8444-444444444444';
function mount({cached=false,inactive=false}={}) {
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 if(cached)client.setQueryData(['reception','team-doctors',clinic,a.id],[a,b],{updatedAt:1});
 const access:ClinicAccess={kind:'clinical',active:true,admin:true,actorId:a.id,clinic:{id:clinic,name:'Clínica sintética'},doctors:[a],staff:[{id:staff,name:'Secretária sintética',active:!inactive,doctorIds:[b.id]}]};
 render(<QueryClientProvider client={client}><ClinicAccessContext.Provider value={access}><TeamSettings/></ClinicAccessContext.Provider></QueryClientProvider>);
 return client;
}
describe('management directory separate from authorized agendas',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.teamDoctors.mockResolvedValue([a,b]);mocks.updateStaff.mockResolvedValue(true);});
 it('can manage doctor B without exposing B in the operational agenda list',async()=>{
  mount();
  expect(await screen.findAllByText(b.name)).toHaveLength(2);
  expect(mocks.teamDoctors).toHaveBeenCalledWith(clinic);
  fireEvent.click(screen.getByRole('button',{name:'Salvar permissões'}));
  await waitFor(()=>expect(mocks.updateStaff).toHaveBeenCalledWith(staff,[b.id],true));
 });
 it('blocks scope changes during a directory failure but permits deactivation',async()=>{
  mocks.teamDoctors.mockRejectedValue(new Error('Diretório indisponível.'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Diretório indisponível');
  expect(screen.getByRole('button',{name:'Salvar permissões'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Criar conta com acesso restrito'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Desativar acesso'}));
  await waitFor(()=>expect(mocks.updateStaff).toHaveBeenCalledWith(staff,[],false));
 });
 it('does not reuse cached choices to reactivate after a failed refetch',async()=>{
  mocks.teamDoctors.mockRejectedValue(new Error('Permissão revogada.'));
  mount({cached:true,inactive:true});
  expect(await screen.findByRole('alert')).toHaveTextContent('Permissão revogada');
  expect(screen.queryByText(b.name)).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Reativar com estas agendas'})).toBeDisabled();
  expect(mocks.updateStaff).not.toHaveBeenCalled();
 });
 it('preserves entered data while retrying the directory',async()=>{
  mocks.teamDoctors.mockRejectedValueOnce(new Error('Diretório indisponível.')).mockResolvedValue([a,b]);
  mount();await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Nome da secretária'),{target:{value:'Conta sintética'}});
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
  await screen.findAllByText(b.name);
  expect(screen.getByLabelText('Nome da secretária')).toHaveValue('Conta sintética');
 });
});
