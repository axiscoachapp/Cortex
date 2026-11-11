import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientSidebar } from './PatientSidebar';

vi.mock('@/features/reception/accessContext', () => ({ useClinicAccess: () => null }));
const rows = vi.hoisted(() => [
  { id: 'apt-1', patient_id: 'p1', title: 'Consulta', start_time: '2026-11-11T12:00:00Z', type: 'novo', status: 'agendado', patient: { id: 'p1', name: 'Paciente Um', status: 'novo', revision: 0 } },
  { id: 'apt-2', patient_id: 'p2', title: 'Consulta', start_time: '2026-11-11T13:00:00Z', type: 'urgencia', status: 'cancelado', patient: { id: 'p2', name: 'Paciente Dois', status: 'retorno', revision: 0 } },
]);
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'gte', 'lte', 'order']) query[op] = () => query;
      query.range = async (from: number) => ({ data: from ? [] : rows, error: null });
      return query;
    },
  },
}));
afterEach(cleanup);

const renderSidebar = (onSelectPatient = vi.fn(), onNewConsultation = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PatientSidebar patients={[]} selectedPatient={null} onSelectPatient={onSelectPatient} onNewConsultation={onNewConsultation} userId="doctor" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('PatientSidebar (today inside the app sidebar)', () => {
  it('labels status and type with the shared vocabulary', async () => {
    renderSidebar();
    expect(await screen.findByText('Primeira consulta · Agendado')).toBeInTheDocument();
    expect(screen.getByText('Encaixe · Cancelado')).toHaveClass('line-through');
  });

  it('is content, not a second navigation: no logo, area switcher or page links', async () => {
    renderSidebar();
    await screen.findByText('Paciente Um');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Alternar área de trabalho' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Configurações|Assistente|Início/ })).toBeNull();
  });

  it('opens the chosen appointment and starts a visit with the agreed words', async () => {
    const select = vi.fn(), start = vi.fn();
    renderSidebar(select, start);
    await userEvent.click(await screen.findByRole('button', { name: /Paciente Um/ }));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'apt-1');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));
    expect(start).toHaveBeenCalledOnce();
  });
});
