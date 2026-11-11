import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionCalendar from './ReceptionCalendar';
import { ClinicAccessContext } from './accessContext';
import { clinicDay } from './dates';
import type { ReceptionAppointment } from './contracts';
const mocks=vi.hoisted(()=>({read:vi.fn(),change:vi.fn(),busy:vi.fn()}));
vi.mock('./api',()=>({receptionApi:{appointments:mocks.read,changeAppointment:mocks.change,busyIntervals:mocks.busy}}));
vi.mock('./BookingDialog',()=>({BookingDialog:()=>null}));
const clinic='66666666-6666-4666-8666-666666666666',doctor='88888888-8888-4888-8888-888888888888',day=clinicDay(new Date().toISOString());
const original:ReceptionAppointment={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',doctorId:doctor,patientId:null,contactId:'77777777-7777-4777-8777-777777777777',caseId:null,patientName:'Beneficiário sintético',startTime:day+'T12:00:00Z',endTime:day+'T12:30:00Z',type:'retorno',status:'agendado',revision:3,checkedInAt:null,googleSyncStatus:'idle'};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ClinicAccessContext.Provider value={{actorId:'11111111-1111-4111-8111-111111111111',kind:'reception',active:true,admin:false,clinic:{id:clinic,name:'Clínica sintética'},doctors:[{id:doctor,name:'Médico sintético',specialty:null}],staff:[]}}><ReceptionCalendar/></ClinicAccessContext.Provider></QueryClientProvider>);}
async function card(){return (await screen.findByRole('heading',{name:original.patientName})).closest('article')!;}
async function menu(row:HTMLElement){await userEvent.click(within(row).getByRole('button',{name:/^Mais ações/}));return screen.getAllByRole('menuitem').map(item=>item.textContent);}
async function cancelFromMenu(row:HTMLElement){await userEvent.click(within(row).getByRole('button',{name:/^Mais ações/}));await userEvent.click(screen.getByRole('menuitem',{name:'Cancelar agendamento'}));return screen.getByRole('alertdialog');}
describe('legacy interval presentation in reception calendar',()=>{
 beforeEach(()=>{vi.restoreAllMocks();vi.resetAllMocks();mocks.read.mockResolvedValue({items:[original],blocks:[]});mocks.change.mockResolvedValue(4);mocks.busy.mockResolvedValue([]);});
 it.each(['zero','reverse','infinite_end'])('marks %s interval and offers only historical cancellation',async kind=>{
  mocks.read.mockResolvedValue({items:[{...original,endTime:kind==='zero'?original.startTime:kind==='reverse'?day+'T11:00:00Z':'infinity'}],blocks:[]});mount();const row=await card();
  expect(within(row).getByText('Horário cadastrado inválido')).toBeVisible();expect(within(row).queryByRole('button',{name:'Registrar chegada'})).not.toBeInTheDocument();
  expect(await menu(row)).toEqual(['Cancelar agendamento']);expect(mocks.change).not.toHaveBeenCalled();expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
 });
 it('keeps an invalid start separate from dated rows without inventing the selected date',async()=>{
  mocks.read.mockResolvedValue({items:[{...original,startTime:'-infinity'}, {...original,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',patientName:'Reserva válida sintética'}],blocks:[]});mount();
  const undated=await screen.findByRole('region',{name:'Reservas sem data válida de início'});expect(within(undated).getByRole('heading',{name:original.patientName})).toBeVisible();expect(within(undated).queryByRole('heading',{name:'Reserva válida sintética'})).not.toBeInTheDocument();expect(await screen.findByRole('heading',{name:'Reserva válida sintética'})).toBeVisible();expect(screen.getByLabelText('Data da agenda')).toHaveValue(day);expect(mocks.change).not.toHaveBeenCalled();
 });
 it('asks before cancelling and sends the original ID/revision without replacement dates',async()=>{
  mocks.read.mockResolvedValue({items:[{...original,endTime:'infinity'}],blocks:[]});mount();const row=await card();
  let dialog=await cancelFromMenu(row);expect(dialog).toHaveTextContent('horário inválido');expect(dialog).not.toHaveTextContent('Invalid Date');
  await userEvent.click(within(dialog).getByRole('button',{name:'Manter agendamento'}));expect(mocks.change).not.toHaveBeenCalled();
  dialog=await cancelFromMenu(row);await userEvent.click(within(dialog).getByRole('button',{name:'Cancelar agendamento'}));
  await waitFor(()=>expect(mocks.change).toHaveBeenCalledWith(clinic,original.id,3,'cancel'));expect(mocks.change).toHaveBeenCalledOnce();
 });
 it('keeps valid appointment actions and the reschedule form',async()=>{
  mount();const row=await card();expect(within(row).queryByText('Horário cadastrado inválido')).not.toBeInTheDocument();expect(within(row).getByText('09:00–09:30')).toBeVisible();expect(within(row).getByRole('button',{name:'Registrar chegada'})).toBeEnabled();
  await userEvent.click(within(row).getByRole('button',{name:/^Mais ações/}));await userEvent.click(screen.getByRole('menuitem',{name:'Remarcar'}));
  expect(screen.getByRole('heading',{name:'Remarcar'})).toBeVisible();expect(screen.getByLabelText('Nova data')).toHaveValue(day);expect(mocks.change).not.toHaveBeenCalled();
 });
 it.each(['cancelado','realizado'] as const)('preserves %s history without suggesting another cancellation',async status=>{
  mocks.read.mockResolvedValue({items:[{...original,status,endTime:'infinity'}],blocks:[]});mount();const row=within(await card());expect(row.getByText('Horário cadastrado inválido')).toBeVisible();expect(row.queryByRole('button')).not.toBeInTheDocument();expect(row.queryByText(/Para corrigir, cancele/)).not.toBeInTheDocument();expect(mocks.change).not.toHaveBeenCalled();
 });
 it('blocks repeated cancellation while pending and shows the failure on the row',async()=>{
  let reject!:(error:Error)=>void;mocks.change.mockReturnValue(new Promise((_,fail)=>{reject=fail;}));mocks.read.mockResolvedValue({items:[{...original,endTime:'infinity'}],blocks:[]});mount();const row=await card();
  const dialog=await cancelFromMenu(row);await userEvent.click(within(dialog).getByRole('button',{name:'Cancelar agendamento'}));
  await waitFor(()=>expect(within(row).getByRole('button',{name:/^Mais ações/})).toBeDisabled());expect(mocks.change).toHaveBeenCalledOnce();
  await act(async()=>{reject(new Error('Revisão alterada'));});expect(await within(row).findByText('Revisão alterada')).toBeVisible();expect(within(row).getByText('Horário cadastrado inválido')).toBeVisible();
 });
});
