import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from './accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { LinkRelationshipDialog } from './LinkRelationshipDialog';
const mocks=vi.hoisted(()=>({linkEdit:vi.fn(),update:vi.fn(),close:vi.fn(),saved:vi.fn()}));
vi.mock('./api',()=>({receptionApi:{linkEdit:mocks.linkEdit,updateLinkRelationship:mocks.update}}));
const clinic='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',contact='33333333-3333-4333-8333-333333333333',patient='44444444-4444-4444-8444-444444444444',doctor='55555555-5555-4555-8555-555555555555';
const original={contactId:contact,patientId:patient,doctorId:doctor,patientName:'Beneficiário sintético',dateOfBirth:'2000-01-02',doctorName:'Médico sintético',relationship:'guardian',revision:1,active:true,patientAvailable:true,doctorActive:true};
function mount(admin=true,cached=false){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 if(cached)client.setQueryData(['reception',actor,'link-edit',clinic,contact,patient,doctor],original);
 const view=<QueryClientProvider client={client}><ClinicAccessContext.Provider value={{kind:'clinical',active:true,admin,actorId:actor,clinic:{id:clinic,name:'Clínica sintética'},staff:[],doctors:[]}}><LinkRelationshipDialog contactId={contact} patientId={patient} doctorId={doctor} contactName="Contato sintético" onClose={mocks.close} onSaved={mocks.saved} /></ClinicAccessContext.Provider></QueryClientProvider>;
 return {...render(view),client};
}
async function edit(){fireEvent.change(await screen.findByLabelText('Relação do contato com o beneficiário'),{target:{value:'family'}});}
function confirm(){fireEvent.click(screen.getByRole('checkbox',{name:/Conferi o contato/}));}
describe('administrative relationship editor',()=>{
 beforeEach(()=>{vi.restoreAllMocks();vi.resetAllMocks();mocks.linkEdit.mockResolvedValue(original);mocks.update.mockResolvedValue(2);});
 it('confirms contact, beneficiary and physician before changing only the relationship',async()=>{
  mount();await edit();expect(screen.getByText('Beneficiário sintético')).toBeInTheDocument();expect(screen.getByText('Médico sintético')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Salvar relação'})).toBeDisabled();confirm();fireEvent.click(screen.getByRole('button',{name:'Salvar relação'}));
  await waitFor(()=>expect(mocks.saved).toHaveBeenCalledOnce());expect(mocks.update).toHaveBeenCalledWith(contact,patient,1,'family');
 });
 it('resets human confirmation when the selection changes',async()=>{
  mount();await edit();confirm();fireEvent.change(screen.getByLabelText('Relação do contato com o beneficiário'),{target:{value:'other'}});expect(screen.getByRole('button',{name:'Salvar relação'})).toBeDisabled();
 });
 it('preserves the draft and its baseline after a conflict or background refetch',async()=>{
  const {client}=mount();await edit();mocks.linkEdit.mockResolvedValue({...original,relationship:'self',revision:2});await act(async()=>{await client.invalidateQueries({queryKey:['reception']});});
  mocks.update.mockRejectedValue(new Error('O vínculo mudou.'));confirm();fireEvent.click(screen.getByRole('button',{name:'Salvar relação'}));await screen.findByText('O vínculo mudou.');
  expect(screen.getByLabelText('Relação do contato com o beneficiário')).toHaveValue('family');expect(mocks.update).toHaveBeenCalledWith(contact,patient,1,'family');expect(mocks.saved).not.toHaveBeenCalled();
 });
 it('replaces the draft only after explicit recovery consent and resets its confirmation',async()=>{
  mount();await edit();const ask=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);mocks.linkEdit.mockResolvedValue({...original,relationship:'self',revision:2});
  fireEvent.click(screen.getByRole('button',{name:'Recuperar relação do servidor'}));expect(mocks.linkEdit).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'Recuperar relação do servidor'}));
  await waitFor(()=>expect(screen.getByLabelText('Relação do contato com o beneficiário')).toHaveValue('self'));expect(screen.getByRole('checkbox',{name:/Conferi o contato/})).not.toBeChecked();expect(mocks.update).not.toHaveBeenCalled();ask.mockRestore();
 });
 it('hides but preserves input during a failed snapshot refresh',async()=>{
  const {client}=mount();await edit();mocks.linkEdit.mockRejectedValue(new Error('Sem permissão.'));await act(async()=>{await client.invalidateQueries({queryKey:['reception']});});
  await screen.findByText('Sem permissão.');const select=screen.getByLabelText('Relação do contato com o beneficiário');expect(select).toHaveValue('family');expect(select).not.toBeVisible();
  mocks.linkEdit.mockResolvedValue({...original,revision:2});fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(select).toBeVisible());expect(select).toHaveValue('family');
 });
 it('blocks session exit and duplicate saves during a pending correction',async()=>{
  mocks.update.mockImplementation(()=>new Promise(()=>{}));mount();await edit();confirm();const save=screen.getByRole('button',{name:'Salvar relação'});fireEvent.click(save);fireEvent.click(save);
  const alert=vi.spyOn(window,'alert').mockImplementation(()=>{});expect(confirmSessionExit()).toBe(false);expect(mocks.update).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Salvando…'})).toBeDisabled();alert.mockRestore();
 });
 it('disables correction for unavailable patient or physician',async()=>{
  mocks.linkEdit.mockResolvedValue({...original,doctorActive:false});mount();await screen.findByText('Médico sintético');expect(screen.getByLabelText('Relação do contato com o beneficiário')).toBeDisabled();expect(screen.getByRole('button',{name:'Salvar relação'})).toBeDisabled();
 });
 it('withholds the snapshot for non-admins and refuses a response for another beneficiary',async()=>{
  const view=mount(false);expect(mocks.linkEdit).not.toHaveBeenCalled();view.unmount();mocks.linkEdit.mockResolvedValue({...original,patientId:doctor});mount();await screen.findByText(/não corresponde/);expect(screen.queryByRole('button',{name:'Salvar relação'})).not.toBeInTheDocument();
 });
 it('suppresses a delayed correction result after the editor is unmounted',async()=>{
  let finish!:(value:number)=>void;mocks.update.mockReturnValue(new Promise<number>(resolve=>{finish=resolve;}));const view=mount();await edit();confirm();fireEvent.click(screen.getByRole('button',{name:'Salvar relação'}));view.unmount();await act(async()=>{finish(2);});expect(mocks.saved).not.toHaveBeenCalled();expect(mocks.close).not.toHaveBeenCalled();
 });
 it('waits for a fresh initial read before freezing the editable baseline',async()=>{
  let finish!:(value:unknown)=>void;mocks.linkEdit.mockReturnValue(new Promise(resolve=>{finish=resolve;}));mount(true,true);
  expect(screen.queryByLabelText('Relação do contato com o beneficiário')).not.toBeInTheDocument();
  await act(async()=>{finish({...original,relationship:'self',revision:2});});
  expect(await screen.findByLabelText('Relação do contato com o beneficiário')).toHaveValue('self');
  await edit();confirm();mocks.update.mockResolvedValue(3);fireEvent.click(screen.getByRole('button',{name:'Salvar relação'}));
  await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(contact,patient,2,'family'));
 });
 it('disables an existing draft when a refresh marks the physician unavailable',async()=>{
  const {client}=mount();await edit();confirm();mocks.linkEdit.mockResolvedValue({...original,doctorActive:false});
  await act(async()=>{await client.invalidateQueries({queryKey:['reception']});});
  await screen.findByText(/Vínculo, beneficiário ou médico indisponível/);
  expect(screen.getByLabelText('Relação do contato com o beneficiário')).toHaveValue('family');expect(screen.getByRole('button',{name:'Salvar relação'})).toBeDisabled();
 });
 it('locks editing and session exit until explicit recovery finishes',async()=>{
  mount();await edit();let finish!:(value:unknown)=>void;mocks.linkEdit.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  vi.spyOn(window,'confirm').mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Recuperar relação do servidor'}));
  expect(await screen.findByRole('button',{name:'Recuperando vínculo…'})).toBeDisabled();expect(screen.getByLabelText('Relação do contato com o beneficiário')).toBeDisabled();
  const alert=vi.spyOn(window,'alert').mockImplementation(()=>{});expect(confirmSessionExit()).toBe(false);alert.mockRestore();
  await act(async()=>{finish({...original,relationship:'self',revision:2});});
  await waitFor(()=>expect(screen.getByLabelText('Relação do contato com o beneficiário')).toHaveValue('self'));expect(screen.getByLabelText('Relação do contato com o beneficiário')).toBeEnabled();expect(mocks.update).not.toHaveBeenCalled();
 });
});
