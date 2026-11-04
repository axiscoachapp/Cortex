import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessGate } from './ClinicAccessGate';

const mocks = vi.hoisted(() => ({ access: vi.fn(), clinicalRender: vi.fn(), clinicalUnmount: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' }, signOut: vi.fn() }),
}));
vi.mock('./api', () => ({ receptionApi: { access: mocks.access } }));
const base = {
  kind: 'clinical',
  active: false,
  admin: false,
  actorId: '11111111-1111-4111-8111-111111111111',
  clinic: null,
  doctors: [],
  staff: [],
};
function Clinical() {
  mocks.clinicalRender();
  useEffect(() => () => mocks.clinicalUnmount(), []);
  return <p>Prontuário privado</p>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <ClinicAccessGate>
                <Clinical />
              </ClinicAccessGate>
            }
          />
          <Route path="/recepcao" element={<p>Ambiente da recepção</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
describe('reception routing before clinical components mount', () => {
  beforeEach(() => vi.resetAllMocks());
  it('redirects reception without mounting clinical data readers', async () => {
    mocks.access.mockResolvedValue({
      ...base,
      kind: 'reception',
      active: true,
      clinic: { id: base.actorId, name: 'Clínica' },
      doctors: [{ id: base.actorId, name: 'Médico', specialty: 'geral' }],
    });
    mount();
    expect(await screen.findByText('Ambiente da recepção')).toBeInTheDocument();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it('fails closed when role verification fails', async () => {
    mocks.access.mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('verificar seu acesso');
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
  it('preserves an existing standalone doctor workspace', async () => {
    mocks.access.mockResolvedValue(base);
    mount();
    expect(await screen.findByText('Prontuário privado')).toBeInTheDocument();
  });
  it('conceals an open workspace without destroying its draft state on background verification failure', async () => {
    mocks.access.mockResolvedValue(base);
    const { client } = mount();
    expect(await screen.findByText('Prontuário privado')).toBeVisible();
    mocks.access.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['clinic-access'] });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('verificar seu acesso');
    expect(screen.getByText('Prontuário privado')).not.toBeVisible();
    expect(mocks.clinicalUnmount).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue(base);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['clinic-access'] });
    });
    expect(await screen.findByText('Prontuário privado')).toBeVisible();
    expect(mocks.clinicalUnmount).not.toHaveBeenCalled();
  });
  it('does not turn offboarded staff into a standalone doctor', async () => {
    mocks.access.mockResolvedValue({ ...base, kind: 'reception' });
    mount();
    expect(await screen.findByText('Acesso de recepção indisponível')).toBeInTheDocument();
    expect(mocks.clinicalRender).not.toHaveBeenCalled();
  });
});
