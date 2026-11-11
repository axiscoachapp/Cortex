import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamSettings from './TeamSettings';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess } from './contracts';
// The shared checkbox measures itself inside a form.
globalThis.ResizeObserver??=class{observe(){}unobserve(){}disconnect(){}} as unknown as typeof ResizeObserver;
const mocks=vi.hoisted(()=>({teamDoctors:vi.fn(),updateStaff:vi.fn(),invoke:vi.fn(),permissions:vi.fn()}));
vi.mock('./api',()=>({receptionApi:{teamDoctors:mocks.teamDoctors,updateStaff:mocks.updateStaff}}));
vi.mock('./delegationApi',()=>({delegationApi:{permissions:mocks.permissions}}));
vi.mock('./WithdrawDelegation',()=>({WithdrawDelegation:({doctorName}:{doctorName:string})=><button type="button">Revogar aprovação de {doctorName}</button>}));
vi.mock('./StaffAccessProvenance',()=>({StaffAccessProvenance:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
const a={id:'11111111-1111-4111-8111-111111111111',name:'Doutor A sintético',specialty:null};
const b={id:'22222222-2222-4222-8222-222222222222',name:'Doutor B sintético',specialty:null};
const legacy={doctorId:'22222222-2222-4222-8222-222222222222',doctorName:'Doutor B sintético',source:'legacy' as const,requestId:null,effective:true};
const clinic='33333333-3333-4333-8333-333333333333',staff='44444444-4444-4444-8444-444444444444';
function mount({cached=false,inactive=false,embedded=false,admin=true}={}) {
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 if(cached)client.setQueryData(['reception','team-doctors',clinic,a.id],[a,b],{updatedAt:1});
 const access:ClinicAccess={kind:'clinical',active:true,admin,actorId:a.id,clinic:{id:clinic,name:'Clínica sintética'},doctors:[a],staff:[{id:staff,name:'Secretária sintética',active:!inactive,doctorIds:[b.id]}]};
 const view=(value:ClinicAccess)=><QueryClientProvider client={client}><MemoryRouter><ClinicAccessContext.Provider value={value}>{embedded?<main><h1>Configurações</h1><TeamSettings embedded/></main>:<TeamSettings/>}</ClinicAccessContext.Provider></MemoryRouter></QueryClientProvider>;
 const result=render(view(access));
 return {...result,access,changeContext:(value:ClinicAccess)=>result.rerender(view(value))};
}
describe('management directory separate from authorized agendas',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.teamDoctors.mockResolvedValue([a,b]);mocks.updateStaff.mockResolvedValue(true);mocks.permissions.mockResolvedValue({items:[legacy],nextCursor:null});});
 it('embeds an administrator section with nested headings while preserving scope updates',async()=>{
  mount({embedded:true});await screen.findAllByText(b.name);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getByRole('region',{name:'Equipe da recepção'})).toBeVisible();
  expect(screen.getByRole('heading',{name:'Equipe da recepção',level:2})).toBeVisible();
  expect(screen.getByRole('heading',{name:'Nova conta',level:3})).toBeVisible();
  expect(screen.getByRole('heading',{name:'Contas cadastradas',level:3})).toBeVisible();
  expect(mocks.updateStaff).not.toHaveBeenCalled();expect(mocks.invoke).not.toHaveBeenCalled();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Salvar agendas'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Salvar agendas'}));
  await waitFor(()=>expect(mocks.updateStaff).toHaveBeenCalledWith(staff,[b.id],true));
 });
 it('does not expose or query the administrative directory to an embedded non-admin',()=>{
  mount({embedded:true,admin:false});
  expect(screen.getByRole('alert')).toHaveTextContent('só para o administrador');
  expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
  expect(screen.queryByText('Secretária sintética')).not.toBeInTheDocument();
  expect(mocks.teamDoctors).not.toHaveBeenCalled();expect(mocks.updateStaff).not.toHaveBeenCalled();expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it.each(['actor','clinic'])('clears temporary credentials when embedded %s changes',async change=>{
  mocks.invoke.mockResolvedValue({data:{success:true,email:'staff@example.invalid',temporaryPassword:'synthetic-temporary-password-only'},error:null});
  const result=mount({embedded:true});await screen.findAllByText(a.name);
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Conta sintética'}});
  fireEvent.change(screen.getByLabelText('E-mail de acesso'),{target:{value:'staff@example.invalid'}});
  const form=screen.getByRole('button',{name:'Criar conta'}).closest('form')!;
  fireEvent.click(within(form).getByRole('checkbox',{name:a.name}));
  fireEvent.click(screen.getByRole('button',{name:'Criar conta'}));
  await screen.findByRole('dialog');
  result.changeContext({...result.access,...(change==='actor'?{actorId:b.id}:{clinic:{id:'55555555-5555-4555-8555-555555555555',name:'Outra clínica sintética'}})});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });
 it.each(['actor','clinic','admin'])('clears the embedded creation draft on %s context replacement',async change=>{
  const result=mount({embedded:true});await screen.findAllByText(a.name);
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Conta sintética'}});
  fireEvent.change(screen.getByLabelText('E-mail de acesso'),{target:{value:'staff@example.invalid'}});
  const form=screen.getByRole('button',{name:'Criar conta'}).closest('form')!;
  fireEvent.click(within(form).getByRole('checkbox',{name:a.name}));
  result.changeContext({...result.access,...(change==='actor'?{actorId:b.id}:change==='clinic'?{clinic:{id:'55555555-5555-4555-8555-555555555555',name:'Outra clínica sintética'}}:{admin:false})});
  if(change==='admin'){expect(screen.getByRole('alert')).toHaveTextContent('só para o administrador');result.changeContext(result.access);}
  await screen.findAllByText(a.name);
  expect(screen.getByLabelText('Nome')).toHaveValue('');
  expect(screen.getByLabelText('E-mail de acesso')).toHaveValue('');
  const nextForm=screen.getByRole('button',{name:'Criar conta'}).closest('form')!;
  expect(within(nextForm).getByRole('checkbox',{name:a.name})).not.toBeChecked();
  expect(mocks.invoke).not.toHaveBeenCalled();expect(mocks.updateStaff).not.toHaveBeenCalled();
 });
 it('can manage doctor B without exposing B in the operational agenda list',async()=>{
  mount();
  expect(await screen.findAllByText(b.name)).toHaveLength(2);
  expect(mocks.teamDoctors).toHaveBeenCalledWith(clinic);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Salvar agendas'})).toBeEnabled());
  const card=screen.getByRole('button',{name:'Salvar agendas'}).closest('article')!;
  expect(within(card).getByRole('checkbox',{name:a.name})).toBeDisabled();
  // A doctor the account cannot get from this list says why.
  expect(within(card).getByRole('checkbox',{name:a.name})).toHaveAccessibleDescription(`Depende da aprovação de ${a.name}. Use Pedir acesso a uma agenda.`);
  expect(within(card).getByRole('checkbox',{name:b.name})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Salvar agendas'}));
  await waitFor(()=>expect(mocks.updateStaff).toHaveBeenCalledWith(staff,[b.id],true));
 });
 it('blocks scope changes during a directory failure but permits deactivation',async()=>{
  mocks.teamDoctors.mockRejectedValue(new Error('Diretório indisponível.'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Diretório indisponível');
  expect(screen.getByRole('button',{name:'Salvar agendas'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Criar conta'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Desativar acesso'}));
  const dialog=await screen.findByRole('alertdialog',{name:'Desativar acesso'});
  expect(mocks.updateStaff).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button',{name:'Desativar acesso'}));
  await waitFor(()=>expect(mocks.updateStaff).toHaveBeenCalledWith(staff,[],false));
 });
 it('asks before deactivating and lists what the account loses',async()=>{
  mount();await screen.findAllByText(b.name);
  fireEvent.click(screen.getByRole('button',{name:'Desativar acesso'}));
  const dialog=await screen.findByRole('alertdialog',{name:'Desativar acesso'});
  expect(dialog).toHaveTextContent('Secretária sintética');
  expect(dialog).toHaveTextContent('deixa de entrar no Cortex');
  expect(dialog).toHaveTextContent('cada médico precisa aprovar de novo');
  expect(dialog).toHaveTextContent('voltam para a fila, sem responsável');
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancelar'}));
  await waitFor(()=>expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(mocks.updateStaff).not.toHaveBeenCalled();
 });
 it('shows an agenda the doctor approved as a read-only row with its revoke action, and keeps it when saving',async()=>{
  mocks.permissions.mockResolvedValue({items:[{doctorId:b.id,doctorName:b.name,source:'physician_approval',requestId:'55555555-5555-4555-8555-555555555555',effective:true}],nextCursor:null});
  mount();
  expect(await screen.findByRole('button',{name:`Revogar aprovação de ${b.name}`})).toBeVisible();
  expect(screen.getByText('Aprovado pelo médico')).toBeVisible();
  const card=screen.getByRole('button',{name:`Revogar aprovação de ${b.name}`}).closest('article')!;
  expect(within(card).queryByRole('checkbox',{name:b.name})).not.toBeInTheDocument();
  // Nothing left to edit from the list: no save button that would always fail.
  expect(within(card).queryByRole('button',{name:'Salvar agendas'})).not.toBeInTheDocument();
  expect(mocks.permissions).toHaveBeenCalledWith({clinicId:clinic,staffId:staff,limit:100});
 });
 it('locks the agenda list when who authorized it cannot be checked',async()=>{
  mocks.permissions.mockRejectedValue(new Error('SYNTHETIC'));
  mount();
  expect(await screen.findByText('Não foi possível conferir quem autorizou as agendas desta conta.')).toBeVisible();
  expect(screen.getByRole('button',{name:'Salvar agendas'})).toBeDisabled();
 });
 it('gives a receptionist without permission a heading, one sentence and a way back',()=>{
  mount({admin:false});
  expect(screen.getByRole('heading',{name:'Equipe da recepção',level:1})).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Esta página é só para o administrador da clínica.');
  expect(screen.getByRole('link',{name:'Voltar aos atendimentos'})).toHaveAttribute('href','/recepcao');
 });
 it('explains a disabled "Criar conta" next to it',async()=>{
  mount();await screen.findAllByText(b.name);
  expect(screen.getByRole('button',{name:'Criar conta'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Criar conta'})).toHaveAccessibleDescription('Preencha nome, e-mail e ao menos uma agenda.');
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Conta sintética'}});
  fireEvent.change(screen.getByLabelText('E-mail de acesso'),{target:{value:'staff@example.invalid'}});
  expect(screen.getByRole('button',{name:'Criar conta'})).toHaveAccessibleDescription('Escolha ao menos uma agenda.');
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
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Conta sintética'}});
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
  await screen.findAllByText(b.name);
  expect(screen.getByLabelText('Nome')).toHaveValue('Conta sintética');
 });
 it('preserves the creation draft and withholds credentials when provisioning is unconfirmed',async()=>{
  const message='Não foi possível confirmar a criação. A conta pode existir; confira a equipe.';
  mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:message}),{status:503})}});
  mount();await screen.findAllByText(a.name);
  const form=screen.getByRole('button',{name:'Criar conta'}).closest('form')!;
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Conta sintética'}});
  fireEvent.change(screen.getByLabelText('E-mail de acesso'),{target:{value:'staff@example.invalid'}});
  fireEvent.click(within(form).getByRole('checkbox',{name:a.name}));
  fireEvent.click(screen.getByRole('button',{name:'Criar conta'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText('Nome')).toHaveValue('Conta sintética');
  expect(screen.getByLabelText('E-mail de acesso')).toHaveValue('staff@example.invalid');
  expect(within(form).getByRole('checkbox',{name:a.name})).toBeChecked();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });
 it('re-issues a temporary password only after confirmation and shows it once',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  mocks.invoke.mockResolvedValue({data:{success:true,email:'staff@example.invalid',temporaryPassword:'NovaSenhaTemp2X'},error:null});
  mount();await screen.findAllByText(b.name);
  fireEvent.click(screen.getByRole('button',{name:'Nova senha temporária'}));
  expect(mocks.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Nova senha temporária'}));
  const dialog=await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('NovaSenhaTemp2X');
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('reissue-temporary-password',{body:{userId:staff}});
  confirm.mockRestore();
 });
 it('explains a refused re-issue (the owner already chose a password)',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);
  const message='Esta pessoa já definiu a própria senha. Por segurança, o administrador não pode trocá-la.';
  mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:message,code:'password_owned'}),{status:409})}});
  mount();await screen.findAllByText(b.name);
  fireEvent.click(screen.getByRole('button',{name:'Nova senha temporária'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  vi.mocked(window.confirm).mockRestore();
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
  expect(screen.getByRole('link',{name:'Pedir acesso a uma agenda'})).toHaveAttribute('href',`/permissoes-recepcao?clinica=${clinic}`);
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
