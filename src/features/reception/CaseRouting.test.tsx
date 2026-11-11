import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from './accessContext';
import { CaseWorkspace } from './CaseWorkspace';
import type { ClinicAccess, ReceptionCase } from './contracts';
const mocks=vi.hoisted(()=>({update:vi.fn()}));
vi.mock('./api',()=>({receptionApi:{updateCase:mocks.update}}));
vi.mock('./useCaseDraft',()=>({useCaseDraft:()=>({body:'',setBody:vi.fn(),flush:vi.fn(),dirty:false,saving:false,acceptSaved:vi.fn()})}));
vi.mock('./BookingDialog',()=>({BookingDialog:()=>null}));
const actor='11111111-1111-4111-8111-111111111111',clinic='66666666-6666-4666-8666-666666666666',doctor='88888888-8888-4888-8888-888888888888';
const access:ClinicAccess={actorId:actor,kind:'reception',active:true,admin:false,clinic:{id:clinic,name:'Clínica sintética'},doctors:[{id:doctor,name:'Médico sintético',specialty:null}],staff:[]};
const receptionCase:ReceptionCase={id:'99999999-9999-4999-8999-999999999999',clinicId:clinic,contactId:'77777777-7777-4777-8777-777777777777',contactName:'Contato sintético',phone:'',doctorId:null,subject:'Pedido administrativo sintético',kind:'return',status:'assigned',assignedTo:actor,revision:3,createdAt:'2026-11-05T18:00:00Z',beneficiaries:[{id:'22222222-2222-4222-8222-222222222222',name:'Beneficiário sintético',dateOfBirth:null,doctorId:doctor,relationship:'self'}],eligibleAssignees:[],notes:[],noteCount:0,draft:{body:'',revision:0}};
function mount(data=receptionCase){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const tree=(value=access,current=data)=><MemoryRouter><QueryClientProvider client={client}><ClinicAccessContext.Provider value={value}><CaseWorkspace data={current}/></ClinicAccessContext.Provider></QueryClientProvider></MemoryRouter>;
 const view={...render(tree()),tree};
 // Routing and transfer live under "Mais ações".
 const more=screen.queryByRole('button',{name:'Mais ações'});if(more)fireEvent.click(more);
 return view;
}
describe('routing from a human-owned administrative case',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.update.mockResolvedValue(4);});
 it('fills a draft choice on suggestion click and writes the case only after Encaminhar',async()=>{
  mount();expect(screen.getByLabelText('Encaminhar para médico')).toHaveValue('');expect(mocks.update).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Selecionar Médico sintético'}));
  expect(screen.getByLabelText('Encaminhar para médico')).toHaveValue(doctor);expect(mocks.update).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Encaminhar'}));await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith(receptionCase.id,3,'route',{doctorId:doctor}));
 });
 it('refuses to route a draft choice that is no longer in the authorized agendas',async()=>{
  const view=mount();fireEvent.click(screen.getByRole('button',{name:'Selecionar Médico sintético'}));view.rerender(view.tree({...access,doctors:[]}));expect(screen.getByRole('button',{name:'Encaminhar'})).toBeDisabled();expect(screen.getByText(/médico deixou de estar disponível/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Encaminhar'}));expect(mocks.update).not.toHaveBeenCalled();
 });
 it('keeps both the draft selector and suggestion locked while the explicit route is pending',async()=>{
  let finish!:(value:number)=>void;mocks.update.mockReturnValue(new Promise(resolve=>{finish=resolve;}));mount();fireEvent.click(screen.getByRole('button',{name:'Selecionar Médico sintético'}));fireEvent.click(screen.getByRole('button',{name:'Encaminhar'}));
  await waitFor(()=>expect(screen.getByLabelText('Encaminhar para médico')).toBeDisabled());expect(screen.getByRole('button',{name:'Selecionar Médico sintético'})).toBeDisabled();expect(mocks.update).toHaveBeenCalledOnce();await act(async()=>{finish(4);});
 });
 it('provides no routing controls for a case owned by someone else or already closed',()=>{
  const view=mount({...receptionCase,assignedTo:'55555555-5555-4555-8555-555555555555'});expect(screen.queryByRole('button',{name:'Encaminhar'})).not.toBeInTheDocument();view.rerender(view.tree(access,{...receptionCase,status:'resolved'}));expect(screen.queryByRole('button',{name:'Selecionar Médico sintético'})).not.toBeInTheDocument();expect(mocks.update).not.toHaveBeenCalled();
 });
});
