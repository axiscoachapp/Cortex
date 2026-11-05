import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DelegationPermissions from './DelegationPermissions';
import { ClinicAccessContext } from './accessContext';
const mocks = vi.hoisted(() => ({ list: vi.fn(), request: vi.fn(), change: vi.fn(), teamDoctors: vi.fn(), actor: '33333333-3333-4333-8333-333333333333' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('./delegationApi', () => ({ delegationApi: { list: mocks.list, request: mocks.request, change: mocks.change } }));
vi.mock('./api', () => ({ receptionApi: { teamDoctors: mocks.teamDoctors } }));
const clinic = '11111111-1111-4111-8111-111111111111', staff = '22222222-2222-4222-8222-222222222222';
const doctor = '33333333-3333-4333-8333-333333333333', request = '44444444-4444-4444-8444-444444444444';
const row = { id: request, clinicId: clinic, clinicName: 'Clínica sintética', staffId: staff, staffName: 'Recepção sintética', doctorId: doctor, doctorName: 'Médico sintético', createdAt: '2026-11-05T12:00:00.123456+00:00', state: 'pending', revision: 1, capabilityVersion: 'clinic_reception_v1', effective: false, canDecide: true, canCancel: false, canRevoke: false };
function mount(admin = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (id = mocks.actor) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[admin ? `/permissoes-recepcao?clinica=${clinic}` : '/permissoes-recepcao']}><ClinicAccessContext.Provider value={{ actorId: id, kind: 'clinical', active: true, admin, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [{ id: staff, name: 'Recepção sintética', active: true, doctorIds: [] }] }}><DelegationPermissions /></ClinicAccessContext.Provider></MemoryRouter></QueryClientProvider>;
  return { ...render(view()), client, view };
}
describe('physician reception permissions', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.actor = doctor; mocks.list.mockResolvedValue({ canManage: false, items: [row], nextCursor: null }); mocks.change.mockResolvedValue({}); mocks.request.mockResolvedValue({}); mocks.teamDoctors.mockResolvedValue([{ id: doctor, name: 'Médico sintético', specialty: null }]); });
  it('requires an explicit confirmation of the displayed staff, clinic and administrative scope', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Aprovar acesso' }));
    expect(mocks.change).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Recepção sintética');
    expect(screen.getByRole('dialog')).toHaveTextContent('prontuários');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith({ requestId: request, revision: 1, action: 'approve', operationId: expect.any(String) }));
  });
  it('keeps the same operation after a lost reply', async () => {
    mocks.change.mockRejectedValueOnce(new Error('Resposta perdida.')).mockResolvedValue({});
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Recusar pedido' }));
    await screen.findByText('Resposta perdida.'); fireEvent.click(screen.getByRole('button', { name: 'Recusar pedido' }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(2));
    expect(mocks.change.mock.calls[0][0].operationId).toBe(mocks.change.mock.calls[1][0].operationId);
  });
  it('does not let an administrator approve on behalf of another physician', async () => {
    mocks.list.mockResolvedValue({ canManage: true, items: [{ ...row, canDecide: false, canCancel: true }], nextCursor: null });
    mount(true); await screen.findByRole('button', { name: 'Cancelar pedido' });
    expect(screen.queryByRole('button', { name: 'Aprovar acesso' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Conta de recepção'), { target: { value: staff } });
    await screen.findByRole('option', { name: 'Médico sintético' });
    fireEvent.change(screen.getByLabelText('Médico responsável'), { target: { value: doctor } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido ao médico' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith({ clinicId: clinic, staffId: staff, doctorId: doctor, operationId: expect.any(String) }));
  });
  it('hides stale actions after a failed refresh', async () => {
    mount(); await screen.findByRole('button', { name: 'Aprovar acesso' });
    mocks.list.mockRejectedValue(new Error('Permissão indisponível.'));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar lista' }));
    await screen.findByText('Permissão indisponível.');
    expect(screen.queryByRole('button', { name: 'Aprovar acesso' })).not.toBeInTheDocument();
  });
  it('uses the unmodified composite cursor to fetch the next page', async () => {
    const cursor = { createdAt: row.createdAt, id: row.id };
    mocks.list.mockResolvedValueOnce({ canManage: false, items: [row], nextCursor: cursor }).mockResolvedValue({ canManage: false, items: [], nextCursor: null });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais pedidos' }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ clinicId: null, cursor }));
  });
  it('shows approval and operational effectiveness separately, with explicit withdrawal', async () => {
    mocks.list.mockResolvedValue({ canManage: false, items: [{ ...row, state: 'approved', canDecide: false, canRevoke: true }], nextCursor: null });
    mount(); expect(await screen.findByText('Sem acesso ativo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revogar acesso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ action: 'revoke', revision: 1 })));
  });
  it('does not retain another actor’s rows in a shared query client', async () => {
    const result = mount(); await screen.findByRole('button', { name: 'Aprovar acesso' });
    mocks.list.mockImplementation(() => new Promise(() => {})); mocks.actor = '55555555-5555-4555-8555-555555555555';
    result.rerender(result.view(mocks.actor));
    expect(screen.queryByText('Recepção sintética')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar acesso' })).not.toBeInTheDocument();
  });
  it('submits a decision only once while the response is pending', async () => {
    mocks.change.mockImplementation(() => new Promise(() => {}));
    mount(); const button = await screen.findByRole('button', { name: 'Recusar pedido' });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.change).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });
  it('refreshes a revision conflict without automatically approving the next revision', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Aprovar acesso' }));
    mocks.list.mockResolvedValue({ canManage: false, items: [{ ...row, revision: 2 }], nextCursor: null });
    mocks.change.mockRejectedValue(Object.assign(new Error('Atualize e revise.'), { code: '40001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }));
    await screen.findByText('Atualize e revise.');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.change).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar acesso' }));
    mocks.change.mockResolvedValue({});
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(2));
    expect(mocks.change.mock.calls[1][0].revision).toBe(2);
    expect(mocks.change.mock.calls[1][0].operationId).not.toBe(mocks.change.mock.calls[0][0].operationId);
  });
});
