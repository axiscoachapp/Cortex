import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
 render(<QueryClientProvider client={client}><MemoryRouter><ClinicAccessContext.Provider value={access}><TeamSettings/></ClinicAccessContext.Provider></MemoryRouter></QueryClientProvider>);
 return client;
}
describe('management directory separate from authorized agendas',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.teamDoctors.mockResolvedValue([a,b]);mocks.updateStaff.mockResolvedValue(true);});
 it('can manage doctor B without exposing B in the operational agenda list',async()=>{
  mount();
  expect(await screen.findAllByText(b.name)).toHaveLength(2);
  expect(mocks.teamDoctors).toHaveBeenCalledWith(clinic);
  const card=screen.getByRole('button',{name:'Salvar permissões'}).closest('article')!;
  expect(within(card).getByRole('checkbox',{name:a.name})).toBeDisabled();
  expect(within(card).getByRole('checkbox',{name:b.name})).toBeEnabled();
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
  expect(screen.getByRole('button',{name:'Reativar conta'})).toBeDisabled();
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
 it('preserves the creation draft and withholds credentials when provisioning is unconfirmed',async()=>{
  const message='Não foi possível confirmar a criação. A conta pode existir; confira a equipe.';
  mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:message}),{status:503})}});
  mount();await screen.findAllByText(a.name);
  const form=screen.getByRole('button',{name:'Criar conta com acesso restrito'}).closest('form')!;
  fireEvent.change(screen.getByLabelText('Nome da secretária'),{target:{value:'Conta sintética'}});
  fireEvent.change(screen.getByLabelText('E-mail exclusivo da conta'),{target:{value:'staff@example.invalid'}});
  fireEvent.click(within(form).getByRole('checkbox',{name:a.name}));
  fireEvent.click(screen.getByRole('button',{name:'Criar conta com acesso restrito'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText('Nome da secretária')).toHaveValue('Conta sintética');
  expect(screen.getByLabelText('E-mail exclusivo da conta')).toHaveValue('staff@example.invalid');
  expect(within(form).getByRole('checkbox',{name:a.name})).toBeChecked();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });
 it('reactivates with an empty scope list even if the old card carried agendas',async()=>{
  mount({inactive:true});
  const button=await screen.findByRole('button',{name:'Reativar conta'});
  await waitFor(()=>expect(button).toBeEnabled());
  const card=button.closest('article')!;
  expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(card).toHaveTextContent('As agendas anteriores não serão restauradas');
  fireEvent.click(button);
  await waitFor(()=>expect(mocks.updateStaff).toHaveBeenCalledWith(staff,[],true));
  expect(await screen.findByRole('status')).toHaveTextContent('Conta reativada, sem agendas');
  expect(screen.getByRole('link',{name:'Pedidos de acesso e aprovações médicas'})).toHaveAttribute('href',`/permissoes-recepcao?clinica=${clinic}`);
 });
 it('does not report reactivation success after a refused or unconfirmed update',async()=>{
  mocks.updateStaff.mockResolvedValue(false);
  mount({inactive:true});
  const button=await screen.findByRole('button',{name:'Reativar conta'});
  await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
 });
 it('preserves the reactivation path after a transport failure without restoring old scopes',async()=>{
  mocks.updateStaff.mockRejectedValueOnce(new Error('Resposta não confirmada.')).mockResolvedValue(true);
  mount({inactive:true});
  const button=await screen.findByRole('button',{name:'Reativar conta'});
  await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
  await screen.findByText('Resposta não confirmada.');fireEvent.click(button);
  await waitFor(()=>expect(mocks.updateStaff).toHaveBeenCalledTimes(2));
  expect(mocks.updateStaff.mock.calls).toEqual([[staff,[],true],[staff,[],true]]);
  expect(await screen.findByRole('status')).toHaveTextContent('Conta reativada, sem agendas');
 });
});
