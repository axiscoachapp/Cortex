import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PatientManagement from './PatientManagement';

const mocks = vi.hoisted(() => ({ result: { data: [] as unknown[], error: null as unknown }, update: vi.fn(), filters: vi.fn(), toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' }, loading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ImportPatientsModal', () => ({ ImportPatientsModal: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = { select: () => query, order: () => query, update: (value: unknown) => { mocks.update(value); return query; }, eq: (key: string, value: unknown) => { mocks.filters(key, value); return query; }, maybeSingle: async () => ({ data: null, error: null }), range: (from: number) => Promise.resolve(from === 0 ? mocks.result : { data: [], error: null }),
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
  it('retains edited demographics when another session changed the patient', async () => {
    mocks.result.data = [{ id: 'ana', name: 'Ana Silva', age: 35, revision: 7, last_visit: '2026-05-01', status: 'novo' }];
    renderDirectory();
    await screen.findAllByText('Ana Silva');
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar paciente' })[0]);
    await userEvent.type(screen.getByLabelText('Nome *'), ' Atualizada');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.filters).toHaveBeenCalledWith('revision', 7);
    expect(screen.getByLabelText('Nome *')).toHaveValue('Ana Silva Atualizada');
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Paciente atualizado com sucesso!' }));
  });
});

vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: (dirty: boolean) => (next: boolean) => next || !dirty || window.confirm('Descartar alterações?') }));
