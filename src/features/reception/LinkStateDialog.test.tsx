import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from './accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { LinkStateDialog } from './LinkStateDialog';
// The shared Radix checkbox measures itself inside a form; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const mocks=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),close:vi.fn(),saved:vi.fn()}));
vi.mock('./api',()=>({receptionApi:{linkEdit:mocks.read,setLinkActive:mocks.write}}));
const actor='11111111-1111-4111-8111-111111111111',clinic='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',patient='22222222-2222-4222-8222-222222222222',doctor='33333333-3333-4333-8333-333333333333';
const original={contactId:contact,patientId:patient,doctorId:doctor,patientName:'Beneficiário sintético',dateOfBirth:'2000-01-02',doctorName:'Médico sintético',relationship:'guardian',revision:1,active:true,patientAvailable:true,doctorActive:true};
const access={actorId:actor,kind:'clinical' as const,active:true,admin:true,clinic:{id:clinic,name:'Clínica sintética'},staff:[],doctors:[]};
function mount(targetActive=false){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const tree=(admin=true)=><QueryClientProvider client={client}><ClinicAccessContext.Provider value={{...access,admin}}><LinkStateDialog contactId={contact} patientId={patient} doctorId={doctor} contactName="Contato sintético" targetActive={targetActive} onClose={mocks.close} onSaved={mocks.saved}/></ClinicAccessContext.Provider></QueryClientProvider>;
 return {...render(tree()),client,tree};
}
const submit=()=>screen.getByRole('button',{name:'Suspender ligação'});
async function confirm(){fireEvent.click(await screen.findByRole('checkbox',{name:/Conferi o contato/}));}
describe('administrative link state review',()=>{
 beforeEach(()=>{vi.restoreAllMocks();vi.resetAllMocks();mocks.read.mockResolvedValue(original);mocks.write.mockResolvedValue(2);});
 it('requires named review and sends only the frozen identity, revision and explicit target',async()=>{
  mount();await screen.findByText(original.patientName);expect(screen.getByText(original.doctorName)).toBeVisible();expect(screen.getByText('Responsável')).toBeVisible();expect(submit()).toBeDisabled();await confirm();fireEvent.click(submit());
  await waitFor(()=>expect(mocks.saved).toHaveBeenCalledOnce());expect(mocks.write).toHaveBeenCalledWith(contact,patient,1,false);
 });
 it('allows suspension with an archived patient and inactive physician',async()=>{
  mocks.read.mockResolvedValue({...original,patientAvailable:false,doctorActive:false});mount();await confirm();expect(submit()).toBeEnabled();fireEvent.click(submit());await waitFor(()=>expect(mocks.write).toHaveBeenCalledOnce());
 });
 it.each(['patientAvailable','doctorActive'])('blocks reactivation if %s is false',async field=>{
  mocks.read.mockResolvedValue({...original,active:false,[field]:false});mount(true);await screen.findByText(original.patientName);expect(screen.getByRole('checkbox')).toBeDisabled();expect(screen.getByRole('button',{name:'Reativar ligação'})).toBeDisabled();expect(mocks.write).not.toHaveBeenCalled();
 });
 it('reactivates an available link with fresh human confirmation',async()=>{
  mocks.read.mockResolvedValue({...original,active:false,revision:4});mocks.write.mockResolvedValue(5);mount(true);await confirm();fireEvent.click(screen.getByRole('button',{name:'Reativar ligação'}));await waitFor(()=>expect(mocks.saved).toHaveBeenCalledOnce());expect(mocks.write).toHaveBeenCalledWith(contact,patient,4,true);
 });
 it('blocks duplicate submission and all exits while the write is pending',async()=>{
  mocks.write.mockReturnValue(new Promise(()=>{}));mount();await confirm();fireEvent.click(submit());fireEvent.click(screen.getByRole('button',{name:'Salvando…'}));fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  const alert=vi.spyOn(window,'alert').mockImplementation(()=>{});expect(confirmSessionExit()).toBe(false);expect(mocks.write).toHaveBeenCalledOnce();expect(mocks.close).not.toHaveBeenCalled();alert.mockRestore();
 });
 it('locks an ambiguous result until explicit recovery and never toggles an achieved target back',async()=>{
  mocks.write.mockRejectedValue(new Error('Resposta perdida'));mount();await confirm();fireEvent.click(submit());await screen.findByText('Resposta perdida');expect(submit()).toBeDisabled();expect(screen.getByRole('checkbox')).toBeChecked();
  vi.spyOn(window,'confirm').mockReturnValue(true);mocks.read.mockResolvedValue({...original,active:false,revision:2});fireEvent.click(screen.getByRole('button',{name:'Descartar e recarregar'}));
  await screen.findByText('A ligação já está suspensa. Nada foi alterado.');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(mocks.write).toHaveBeenCalledOnce();expect(mocks.saved).not.toHaveBeenCalled();
 });
 it('requires consent and a new confirmation after recovery of a conflicting revision',async()=>{
  mocks.write.mockRejectedValue(new Error('Revisão alterada'));mount();await confirm();fireEvent.click(submit());await screen.findByText('Revisão alterada');
  const ask=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);mocks.read.mockResolvedValue({...original,revision:3});const recover=screen.getByRole('button',{name:'Descartar e recarregar'});fireEvent.click(recover);expect(mocks.read).toHaveBeenCalledTimes(1);fireEvent.click(recover);
  await waitFor(()=>expect(screen.getByRole('checkbox')).not.toBeChecked());expect(submit()).toBeDisabled();mocks.write.mockResolvedValue(4);await confirm();fireEvent.click(submit());await waitFor(()=>expect(mocks.saved).toHaveBeenCalledOnce());expect(mocks.write).toHaveBeenLastCalledWith(contact,patient,3,false);expect(ask).toHaveBeenCalledTimes(2);
 });
 it('never silently adopts a background revision or shows the stale form after a read failure',async()=>{
  const view=mount();await confirm();mocks.read.mockResolvedValue({...original,revision:2});await act(async()=>{await view.client.invalidateQueries({queryKey:['reception']});});await waitFor(()=>expect(submit()).toBeDisabled());expect(screen.getByRole('checkbox')).toBeChecked();
  mocks.read.mockRejectedValue(new Error('Permissão retirada'));await act(async()=>{await view.client.invalidateQueries({queryKey:['reception']});});await screen.findByText('Permissão retirada');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(mocks.write).not.toHaveBeenCalled();
 });
 it('rejects a different physician and suppresses late callbacks after loss of access',async()=>{
  mocks.read.mockResolvedValue({...original,doctorId:patient});const invalid=mount();await screen.findByText(/não corresponde/);expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();invalid.unmount();
  let finish!:(value:number)=>void;mocks.read.mockResolvedValue(original);mocks.write.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const view=mount();await confirm();fireEvent.click(submit());view.rerender(view.tree(false));await act(async()=>{finish(2);});expect(mocks.saved).not.toHaveBeenCalled();expect(mocks.close).not.toHaveBeenCalled();
 });
 it('starts a fresh read after access is lost and restored instead of reusing an old pending snapshot',async()=>{
  let old!:(value:unknown)=>void;mocks.read.mockReturnValueOnce(new Promise(resolve=>{old=resolve;})).mockResolvedValue({...original,revision:3});const view=mount();view.rerender(view.tree(false));view.rerender(view.tree());await confirm();await act(async()=>{old(original);});fireEvent.click(submit());await waitFor(()=>expect(mocks.write).toHaveBeenCalledWith(contact,patient,3,false));
 });
 it('treats an unexpected success revision as ambiguous and blocks an automatic retry',async()=>{
  mocks.write.mockResolvedValue(1);mount();await confirm();fireEvent.click(submit());await screen.findByText(/não pôde ser confirmada/);expect(submit()).toBeDisabled();expect(mocks.saved).not.toHaveBeenCalled();
 });
 it('cannot recover through a read-error retry while a write is still pending',async()=>{
  mocks.write.mockReturnValue(new Promise(()=>{}));const view=mount();await confirm();fireEvent.click(submit());mocks.read.mockRejectedValue(new Error('Leitura interrompida'));
  await act(async()=>{await view.client.invalidateQueries({queryKey:['reception']});});await screen.findByText('Leitura interrompida');mocks.read.mockResolvedValue({...original,active:false,revision:2});
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(mocks.read).toHaveBeenCalledTimes(2);expect(mocks.close).not.toHaveBeenCalled();
  vi.spyOn(window,'alert').mockImplementation(()=>{});expect(confirmSessionExit()).toBe(false);expect(mocks.write).toHaveBeenCalledOnce();
 });
 it('blocks exits during recovery and preserves the original confirmation on a failed read',async()=>{
  let reject!:(error:Error)=>void;mount();await confirm();vi.spyOn(window,'confirm').mockReturnValue(true);mocks.read.mockReturnValue(new Promise((_,fail)=>{reject=fail;}));
  fireEvent.click(screen.getByRole('button',{name:'Descartar e recarregar'}));fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));vi.spyOn(window,'alert').mockImplementation(()=>{});expect(confirmSessionExit()).toBe(false);expect(mocks.close).not.toHaveBeenCalled();
  await act(async()=>{reject(new Error('Sem acesso'));});await screen.findByText('Sem acesso');expect(screen.getAllByRole('checkbox',{hidden:true})[0]).toBeChecked();expect(screen.getAllByRole('checkbox',{hidden:true})[0]).not.toBeVisible();expect(mocks.write).not.toHaveBeenCalled();
 });
 // Round 3, R 26 / R 30: the shared no-access notice and dialog frame.
 it('tells a non-admin what they cannot do and who can grant it, without reading the link',async()=>{
  const view=mount();view.rerender(view.tree(false));
  expect(screen.getByRole('alert')).toHaveTextContent('Sua conta não pode suspender nem reativar esta ligação.');
  expect(screen.getByRole('alert')).toHaveTextContent('Quem pode liberar: o administrador da clínica.');
 });
 it('names the dialog like its button and puts "Cancelar" before the primary',async()=>{
  mount();await screen.findByText(original.patientName);
  expect(screen.getByRole('heading',{name:'Suspender ligação'})).toBeInTheDocument();
  const cancel=screen.getByRole('button',{name:'Cancelar'});
  expect(cancel.compareDocumentPosition(submit())&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('button',{name:'Descartar e recarregar'})).toBeInTheDocument();
 });
});
