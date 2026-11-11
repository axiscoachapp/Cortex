import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WithdrawDelegation } from './WithdrawDelegation';
// The shared Radix checkbox measures itself inside a form; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const mocks=vi.hoisted(()=>({withdrawal:vi.fn(),change:vi.fn(),onRevoked:vi.fn()}));
vi.mock('./delegationApi',()=>({delegationApi:{withdrawal:mocks.withdrawal,change:mocks.change}}));
const clinic='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',doctor='33333333-3333-4333-8333-333333333333',request='44444444-4444-4444-8444-444444444444';
const review={id:request,clinicId:clinic,clinicName:'Clínica sintética',staffId:staff,staffName:'Recepção sintética',doctorId:doctor,doctorName:'Médico sintético',revision:2,state:'approved',capabilityVersion:'clinic_reception_v1'};
function mount(){return render(<WithdrawDelegation actorId={doctor} clinicId={clinic} staffId={staff} doctorId={doctor} requestId={request} doctorName="Nome antigo" disabled={false} onRevoked={mocks.onRevoked} />);}
async function open(){fireEvent.click(screen.getByRole('button',{name:'Revogar aprovação de Nome antigo'}));await screen.findByText('Médico sintético');}
describe('explicit withdrawal from staff card',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.withdrawal.mockResolvedValue(review);mocks.change.mockResolvedValue({id:request,state:'revoked',revision:3,capabilityVersion:'clinic_reception_v1'});mocks.onRevoked.mockResolvedValue(undefined);});
 it('loads the current server review and makes no write on opening or cancelling',async()=>{
  mount();await open();expect(mocks.withdrawal).toHaveBeenCalledWith(request);expect(screen.getByRole('dialog')).toHaveTextContent('Clínica sintética');expect(screen.getByRole('dialog')).toHaveTextContent('Recepção sintética');expect(mocks.change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(mocks.change).not.toHaveBeenCalled();
 });
 it('uses the fetched revision and preserves operation on lost reply',async()=>{
  mocks.change.mockRejectedValueOnce(new Error('Resposta não confirmada.')).mockResolvedValue({id:request,state:'revoked',revision:3});
  mount();await open();fireEvent.click(screen.getByRole('button',{name:'Confirmar revogação'}));await screen.findByText('Resposta não confirmada.');fireEvent.click(screen.getByRole('button',{name:'Confirmar revogação'}));
  await waitFor(()=>expect(mocks.onRevoked).toHaveBeenCalledTimes(1));expect(mocks.change).toHaveBeenCalledTimes(2);
  expect(mocks.change.mock.calls[0][0]).toEqual({requestId:request,revision:2,action:'revoke',operationId:expect.any(String)});
  expect(mocks.change.mock.calls[1][0]).toEqual(mocks.change.mock.calls[0][0]);
 });
 it('closes a stale review and refreshes without writing another revision automatically',async()=>{
  mocks.change.mockRejectedValue(Object.assign(new Error('Atualize os acessos.'),{code:'40001'}));
  mount();await open();fireEvent.click(screen.getByRole('button',{name:'Confirmar revogação'}));
  await waitFor(()=>expect(mocks.onRevoked).toHaveBeenCalledTimes(1));expect(mocks.change).toHaveBeenCalledTimes(1);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 });
 it('refuses a response for another staff identity',async()=>{
  mocks.withdrawal.mockResolvedValue({...review,staffId:doctor});mount();fireEvent.click(screen.getByRole('button',{name:/Revogar aprovação/}));
  await screen.findByText(/não corresponde/);expect(screen.getByRole('button',{name:'Confirmar revogação'})).toBeDisabled();expect(mocks.change).not.toHaveBeenCalled();
 });
 it('ignores a delayed review after unmounting',async()=>{
  let finish!:(value:unknown)=>void;mocks.withdrawal.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const view=mount();fireEvent.click(screen.getByRole('button',{name:/Revogar aprovação/}));view.unmount();await act(async()=>{finish(review);});expect(mocks.change).not.toHaveBeenCalled();expect(mocks.onRevoked).not.toHaveBeenCalled();
 });
 it('does not confirm a different request returned by the writer',async()=>{
  mocks.change.mockResolvedValue({id:doctor,state:'revoked',revision:3});mount();await open();fireEvent.click(screen.getByRole('button',{name:'Confirmar revogação'}));
  await screen.findByText(/Não foi possível confirmar a revogação/);expect(mocks.onRevoked).not.toHaveBeenCalled();
 });
 it('sends one write while a confirmation is already in progress',async()=>{
  mocks.change.mockImplementation(()=>new Promise(()=>{}));mount();await open();
  const button=screen.getByRole('button',{name:'Confirmar revogação'});fireEvent.click(button);fireEvent.click(button);
  expect(mocks.change).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();
 });
 it('does not publish a delayed write result after the card unmounts',async()=>{
  let finish!:(value:unknown)=>void;mocks.change.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const view=mount();await open();fireEvent.click(screen.getByRole('button',{name:'Confirmar revogação'}));view.unmount();
  await act(async()=>{finish({id:request,state:'revoked',revision:3});});expect(mocks.onRevoked).not.toHaveBeenCalled();
 });
});
