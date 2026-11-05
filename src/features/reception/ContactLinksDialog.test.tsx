import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess, LinkEdit } from './contracts';
import { ContactLinksDialog } from './ContactLinksDialog';
const mocks = vi.hoisted(() => ({ page: vi.fn(), close: vi.fn(), editor: vi.fn(), state: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { contactLinks: mocks.page } }));
vi.mock('./LinkRelationshipDialog', () => ({ LinkRelationshipDialog: (props: { patientId: string; doctorId: string; contactId: string; onClose: () => void; onSaved: () => void }) => {
  mocks.editor(props); return <div role="dialog"><p>Editor sintético</p><button onClick={props.onClose}>Cancelar edição sintética</button><button onClick={props.onSaved}>Salvar edição sintética</button></div>;
} }));
const actor='11111111-1111-4111-8111-111111111111',clinic='66666666-6666-4666-8666-666666666666',contact='77777777-7777-4777-8777-777777777777',otherContact='88888888-8888-4888-8888-888888888888';
vi.mock('./LinkStateDialog',()=>({LinkStateDialog:(props:{onClose:()=>void;onSaved:()=>void})=>{mocks.state(props);return <div role="dialog"><button onClick={props.onClose}>Voltar do estado sintético</button><button onClick={props.onSaved}>Salvar estado sintético</button></div>;}}));
const first: LinkEdit={contactId:contact,patientId:'22222222-2222-4222-8222-222222222222',doctorId:'33333333-3333-4333-8333-333333333333',patientName:'Beneficiário sintético A',dateOfBirth:'2000-01-02',doctorName:'Médico sintético A',relationship:'guardian',revision:1,active:true,patientAvailable:true,doctorActive:true};
const second: LinkEdit={...first,patientId:'44444444-4444-4444-8444-444444444444',patientName:'Beneficiário sintético B',doctorName:'Médico sintético B',doctorId:'55555555-5555-4555-8555-555555555555',relationship:'family'};
const access: ClinicAccess={actorId:actor,kind:'clinical',active:true,admin:true,clinic:{id:clinic,name:'Clínica sintética'},doctors:[],staff:[]};
function mount(options: {admin?:boolean; cached?:boolean}={}) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  if(options.cached)client.setQueryData(['reception',actor,'contact-links',clinic,contact],{pages:[{items:[first],nextCursor:null}],pageParams:[null]});
  const tree=(id=contact,value:ClinicAccess={...access,admin:options.admin??true})=><QueryClientProvider client={client}><ClinicAccessContext.Provider value={value}><ContactLinksDialog contactId={id} contactName="Contato sintético" onClose={mocks.close}/></ClinicAccessContext.Provider></QueryClientProvider>;
  return {...render(tree()),client,tree};
}
const edit = (row=first) => screen.getByRole('button',{name:'Corrigir relação de '+row.patientName});
describe('administrative contact links dialog',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.page.mockResolvedValue({items:[first],nextCursor:null});});
  it('loads only the first page and retrieves more through its cursor',async()=>{
    mocks.page.mockImplementation((_clinic,_contact,after)=>Promise.resolve(after?{items:[second],nextCursor:null}:{items:[first],nextCursor:first.patientId}));
    mount();await screen.findByText(first.patientName);expect(screen.getByText(first.doctorName)).toBeVisible();expect(screen.getByText('02/01/2000')).toBeVisible();expect(screen.getByText('Responsável')).toBeVisible();
    expect(mocks.page).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'Carregar mais vínculos'}));await screen.findByText(second.patientName);
    expect(mocks.page).toHaveBeenLastCalledWith(clinic,contact,first.patientId,50);expect(screen.queryByRole('button',{name:'Carregar mais vínculos'})).not.toBeInTheDocument();expect(screen.getByText('2 vínculos carregados')).toBeVisible();
  });
  it('opens the existing editor with exact identities and returns to the list on cancel or save',async()=>{
    mount();await screen.findByText(first.patientName);fireEvent.click(edit());expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();
    expect(mocks.editor).toHaveBeenLastCalledWith(expect.objectContaining({contactId:contact,patientId:first.patientId,doctorId:first.doctorId}));
    fireEvent.click(screen.getByRole('button',{name:'Cancelar edição sintética'}));await screen.findByText(first.patientName);fireEvent.click(edit());fireEvent.click(screen.getByRole('button',{name:'Salvar edição sintética'}));
    expect(await screen.findByText('Relação administrativa corrigida.')).toBeVisible();expect(mocks.close).not.toHaveBeenCalled();
  });
  it('keeps unavailable beneficiaries visible and prevents their correction',async()=>{
    mocks.page.mockResolvedValue({items:[{...first,patientAvailable:false},{...second,doctorActive:false}],nextCursor:null});mount();await screen.findByText(first.patientName);
    expect(edit()).toBeDisabled();expect(edit(second)).toBeDisabled();expect(screen.getByText('Paciente indisponível')).toBeVisible();expect(screen.getByText('Médico indisponível')).toBeVisible();
  });
  it('opens explicit state targets with exact identities and refreshes the list even on return without a new write',async()=>{
    mount();await screen.findByText(first.patientName);fireEvent.click(screen.getByRole('button',{name:'Suspender vínculo de '+first.patientName}));
    expect(mocks.state).toHaveBeenLastCalledWith(expect.objectContaining({contactId:contact,patientId:first.patientId,doctorId:first.doctorId,targetActive:false}));
    mocks.page.mockResolvedValue({items:[{...first,active:false}],nextCursor:null});fireEvent.click(screen.getByRole('button',{name:'Voltar do estado sintético'}));await screen.findByRole('button',{name:'Reativar vínculo de '+first.patientName});expect(mocks.page).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button',{name:'Reativar vínculo de '+first.patientName}));expect(mocks.state).toHaveBeenLastCalledWith(expect.objectContaining({targetActive:true}));fireEvent.click(screen.getByRole('button',{name:'Salvar estado sintético'}));await screen.findByText('Vínculo reativado.');
  });
  it('permits suspension for unavailable people but refuses their reactivation',async()=>{
    mocks.page.mockResolvedValue({items:[{...first,doctorActive:false},{...second,active:false,patientAvailable:false}],nextCursor:null});mount();await screen.findByText(first.patientName);
    expect(screen.getByRole('button',{name:'Suspender vínculo de '+first.patientName})).toBeEnabled();expect(screen.getByRole('button',{name:'Reativar vínculo de '+second.patientName})).toBeDisabled();
  });
  it('does not read or render cached patients for a non-admin',()=>{
    mount({admin:false,cached:true});expect(mocks.page).not.toHaveBeenCalled();expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();
  });
  it('withholds a cached list until the fresh mount read succeeds, then hides it on failure',async()=>{
    let fail!:(error:Error)=>void;mocks.page.mockReturnValue(new Promise((_,reject)=>{fail=reject;}));mount({cached:true});expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();
    await act(async()=>{fail(new Error('Permissão retirada'));});expect(await screen.findByText('Permissão retirada')).toBeVisible();expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();expect(screen.queryByText(/Nenhum vínculo/)).not.toBeInTheDocument();
    mocks.page.mockResolvedValue({items:[first],nextCursor:null});fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));expect(await screen.findByText(first.patientName)).toBeVisible();
  });
  it('hides rows and correction actions when loading the next page is refused',async()=>{
    mocks.page.mockResolvedValueOnce({items:[first],nextCursor:first.patientId}).mockRejectedValueOnce(new Error('Sem permissão para continuar'));mount();await screen.findByText(first.patientName);fireEvent.click(screen.getByRole('button',{name:'Carregar mais vínculos'}));
    await screen.findByText('Sem permissão para continuar');expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Corrigir relação/})).not.toBeInTheDocument();
  });
  it('separates empty results from failures',async()=>{
    mocks.page.mockResolvedValue({items:[],nextCursor:null});mount();expect(await screen.findByText('Nenhum vínculo administrativo neste contato.')).toBeVisible();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('does not show a delayed page from the previous contact after switching context',async()=>{
    let finish!:(value:unknown)=>void;mocks.page.mockImplementation((_clinic,id)=>id===contact?new Promise(resolve=>{finish=resolve;}):Promise.resolve({items:[{...second,contactId:otherContact}],nextCursor:null}));
    const view=mount();view.rerender(view.tree(otherContact));await screen.findByText(second.patientName);await act(async()=>{finish({items:[first],nextCursor:null});});expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();
  });
  it('removes the editor when administrative access is lost',async()=>{
    const view=mount();await screen.findByText(first.patientName);fireEvent.click(edit());view.rerender(view.tree(contact,{...access,admin:false}));await waitFor(()=>expect(screen.queryByText('Editor sintético')).not.toBeInTheDocument());
  });
  it('starts a new read after authority is lost and restored instead of reusing a pending response',async()=>{
    let finishOld!:(value:unknown)=>void,finishNew!:(value:unknown)=>void;
    mocks.page.mockReturnValueOnce(new Promise(resolve=>{finishOld=resolve;})).mockReturnValueOnce(new Promise(resolve=>{finishNew=resolve;}));
    const view=mount();await waitFor(()=>expect(mocks.page).toHaveBeenCalledTimes(1));view.rerender(view.tree(contact,{...access,admin:false}));view.rerender(view.tree());
    await waitFor(()=>expect(mocks.page).toHaveBeenCalledTimes(2));await act(async()=>{finishOld({items:[first],nextCursor:null});});expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();
    await act(async()=>{finishNew({items:[second],nextCursor:null});});expect(await screen.findByText(second.patientName)).toBeVisible();expect(screen.queryByText(first.patientName)).not.toBeInTheDocument();
  });
});
