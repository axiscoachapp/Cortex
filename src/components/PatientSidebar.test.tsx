import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientSidebar } from './PatientSidebar';

vi.mock('./WorkspaceMenu', () => ({ WorkspaceMenu: () => null }));
vi.mock('@/features/reception/accessContext', () => ({ useClinicAccess: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'gte', 'lte', 'order']) query[op] = () => query;
      query.range = async () => ({ data: [], error: null });
      return query;
    },
  },
}));
afterEach(cleanup);

const renderSidebar = (openConsultation?: { name: string; onReturn: () => void }) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PatientSidebar patients={[]} selectedPatient={null} onSelectPatient={vi.fn()} userId="doctor" homeActive openConsultation={openConsultation} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('PatientSidebar', () => {
  it('shows "Voltar à consulta" while a consultation is open behind Início', async () => {
    const onReturn = vi.fn();
    renderSidebar({ name: 'Paciente sintética', onReturn });
    await userEvent.click(screen.getByRole('button', { name: 'Voltar à consulta de Paciente sintética' }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('has no return entry without an open consultation', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /Voltar à consulta/ })).not.toBeInTheDocument();
  });
});
