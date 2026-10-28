import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PatientManagement from './PatientManagement';

const mocks = vi.hoisted(() => ({ result: { data: [] as unknown[], error: null as unknown } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' }, loading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ImportPatientsModal', () => ({ ImportPatientsModal: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = { select: () => query, order: () => query, range: (from: number) => Promise.resolve(from === 0 ? mocks.result : { data: [], error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.result).then(resolve) };
  return query;
} } }));

function renderDirectory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><PatientManagement /></MemoryRouter></QueryClientProvider>);
}

describe('Patient directory', () => {
  beforeEach(() => { mocks.result = { data: [], error: null }; });

  it('shows a retryable load error instead of claiming no patients exist', async () => {
    mocks.result = { data: [], error: new Error('offline') };
    renderDirectory();
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível carregar/i);
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    expect(screen.queryByText('Nenhum paciente cadastrado')).not.toBeInTheDocument();
  });

  it('searches all loaded patients and opens their chart without starting a consultation', async () => {
    mocks.result.data = [
      { id: 'ana', name: 'Ana Silva', age: 35, last_visit: '2026-05-01', status: 'novo' },
      { id: 'bia', name: 'Beatriz Santos', age: 40, last_visit: '2026-05-02', status: 'retorno' },
    ];
    renderDirectory();
    await screen.findAllByText('Ana Silva');
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar pacientes/i }), 'Beatriz');
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /abrir prontuário de Beatriz Santos/i })[0]).toHaveAttribute('href', '/?patient=bia');
  });
});
