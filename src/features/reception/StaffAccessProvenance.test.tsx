import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffAccessProvenance } from './StaffAccessProvenance';
const mocks=vi.hoisted(()=>({permissions:vi.fn()}));
vi.mock('./delegationApi',()=>({delegationApi:{permissions:mocks.permissions}}));
const clinic='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',doctor='33333333-3333-4333-8333-333333333333';
const row={doctorId:doctor,doctorName:'Médico sintético',source:'legacy',requestId:null,effective:true};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><StaffAccessProvenance actorId={doctor} clinicId={clinic} staffId={staff} staffName="Recepção sintética" /></MemoryRouter></QueryClientProvider>);}
describe('administrative access provenance',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.permissions.mockResolvedValue({items:[row],nextCursor:null});});
 it('loads only on demand and separates active legacy access from proven physician approval',async()=>{
  mount();expect(mocks.permissions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Conferir origem dos acessos de Recepção sintética'}));
  expect(await screen.findByText('Legado: anuência não comprovada')).toBeInTheDocument();
  expect(screen.getByText('Acesso ativo')).toBeInTheDocument();
  expect(screen.queryByText('Aprovação médica vinculada')).not.toBeInTheDocument();
  expect(mocks.permissions).toHaveBeenCalledWith({clinicId:clinic,staffId:staff,after:null});
 });
 it('shows proven approval with a link to the separate request/withdrawal workflow',async()=>{
  mocks.permissions.mockResolvedValue({items:[{...row,source:'physician_approval',requestId:doctor}],nextCursor:null});
  mount();fireEvent.click(screen.getByRole('button',{name:/Conferir origem/}));
  await screen.findByText('Aprovação médica vinculada');
  expect(screen.getByRole('link',{name:'Ver pedidos e revogações da clínica'})).toHaveAttribute('href',`/permissoes-recepcao?clinica=${clinic}`);
 });
 it('does not keep cached rows after a denied refresh',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:/Conferir origem/}));await screen.findByText('Médico sintético');
  mocks.permissions.mockRejectedValue(new Error('Permissão indisponível.'));
  fireEvent.click(screen.getByRole('button',{name:'Atualizar origem dos acessos'}));
  await screen.findByText('Permissão indisponível.');expect(screen.queryByText('Médico sintético')).not.toBeInTheDocument();
 });
 it('uses the server cursor and does not label an unverified reference as an approval',async()=>{
  mocks.permissions.mockResolvedValueOnce({items:[row],nextCursor:doctor}).mockResolvedValue({items:[{...row,doctorId:staff,doctorName:'Outro médico sintético',source:'unverified',effective:false}],nextCursor:null});
  mount();fireEvent.click(screen.getByRole('button',{name:/Conferir origem/}));fireEvent.click(await screen.findByRole('button',{name:'Carregar mais acessos'}));
  await waitFor(()=>expect(mocks.permissions).toHaveBeenLastCalledWith({clinicId:clinic,staffId:staff,after:doctor}));
  expect(await screen.findByText('Referência de aprovação não validada')).toBeInTheDocument();
  expect(screen.getByText('Sem acesso ativo')).toBeInTheDocument();
 });
});
