import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CalendarPage from './Calendar';

const fixture = vi.hoisted(() => ({
  mobile: false,
  google: false,
  appointments: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ table: string; filters: Array<[string, string, unknown]> }>,
}));
vi.mock('@/components/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/SchedulingFollowups', () => ({ SchedulingFollowups: () => <section aria-label="Lista de espera e confirmações">acompanhamentos</section> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => fixture.mobile, isBelowMobileBreakpoint: () => fixture.mobile }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: () => ({ maybeSingle: async () => ({ data: { google_connected: fixture.google }, error: null }) }),
    functions: { invoke: vi.fn() },
    from: (table: string) => {
      const entry = { table, filters: [] as Array<[string, string, unknown]> };
      fixture.queries.push(entry);
      const query: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'gt', 'lt', 'is', 'order'])
        query[op] = (column: string, value: unknown) => {
          if (op !== 'select' && op !== 'order') entry.filters.push([op, column, value]);
          return query;
        };
      query.range = async (from: number) => ({
        data: from > 0 ? [] : table === 'appointments' ? fixture.appointments : [patientRow],
        error: null,
      });
      return query;
    },
  },
}));

const patientRow = { id: 'patient-1', user_id: 'doctor', name: 'Paciente Sintética', age: 40, status: 'retorno', medications: [], allergies: [], diagnoses: [] };
const appointment = (over: Record<string, unknown>) => ({
  id: 'appointment-1', user_id: 'doctor', patient_id: 'patient-1', clinic_id: null, title: 'Paciente Sintética — Retorno',
  start_time: '2026-11-11T12:00:00Z', end_time: '2026-11-11T12:30:00Z', type: 'retorno', status: 'agendado', notes: null,
  revision: 1, google_event_id: null, google_sync_status: 'none', google_sync_error: null, reminder_sent: false, ...over,
});

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
function mount(path = '/agenda') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <CalendarPage />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // react-big-calendar's slot selection asks the document what is under the pointer.
  document.elementFromPoint = () => null;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T15:21:00Z')); // Wednesday 12:21 in São Paulo
  fixture.mobile = false;
  fixture.google = false;
  fixture.appointments = [appointment({})];
  fixture.queries = [];
});
afterEach(() => vi.useRealTimers());

describe('doctor agenda toolbar', () => {
  it('puts navigation, the period, the views and the new appointment in one toolbar, without a description', async () => {
    mount();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Agenda: 9–15 de novembro');
    const toolbar = heading.parentElement!.parentElement!;
    for (const name of ['Período anterior', 'Hoje', 'Próximo período', 'Novo agendamento'])
      expect(within(toolbar).getByRole('button', { name })).toBeVisible();
    const views = within(toolbar).getByRole('group', { name: 'Visualização da agenda' });
    expect(within(views).getAllByRole('button').map((b) => b.textContent)).toEqual(['Dia', 'Semana', 'Mês', 'Lista de espera']);
    expect(screen.queryByText(/Seus horários, consultas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Acompanhamentos manuais/)).not.toBeInTheDocument();
  });

  it('reads the clinic week from Monday to Sunday and keeps rows booked by the reception', async () => {
    fixture.appointments = [appointment({ clinic_id: 'clinic-1', title: 'Reserva da recepção' })];
    mount();
    expect(await screen.findByText('Paciente Sintética')).toBeVisible();
    const read = fixture.queries.find((q) => q.table === 'appointments')!;
    expect(read.filters).toEqual([
      ['eq', 'user_id', 'doctor'],
      ['gt', 'end_time', '2026-11-09T03:00:00.000Z'],
      ['lt', 'start_time', '2026-11-16T03:00:00.000Z'],
    ]);
    const days = [...document.querySelectorAll('.rbc-time-header-content .rbc-header')].map((cell) => cell.textContent?.slice(0, 5));
    expect(days).toEqual(['SEG09', 'TER10', 'QUA11', 'QUI12', 'SEX13', 'SÁB14', 'DOM15']);
  });

  it('shows the patient name first and the clinic time on a second line', async () => {
    mount();
    const name = await screen.findByText('Paciente Sintética');
    expect(name.nextElementSibling).toHaveTextContent('09:00–09:30');
  });

  it('draws a cancelled appointment as a struck-through outline', async () => {
    fixture.appointments = [appointment({ status: 'cancelado' })];
    mount();
    const event = (await screen.findByText('Paciente Sintética')).closest('.rbc-event') as HTMLElement;
    expect(event.style.textDecoration).toBe('line-through');
    expect(event.style.outline).toContain('dashed');
  });

  it('shows 07:00 to 21:00 and widens for an earlier appointment', async () => {
    mount();
    await screen.findByText('Paciente Sintética');
    expect(screen.getByText('07:00')).toBeInTheDocument();
    expect(screen.getByText('20:00')).toBeInTheDocument();
    expect(screen.queryByText('06:00')).not.toBeInTheDocument();
    expect(screen.queryByText('21:00')).not.toBeInTheDocument();
  });

  it('widens the hours when an appointment starts before 07:00', async () => {
    fixture.appointments = [appointment({ start_time: '2026-11-11T09:30:00Z', end_time: '2026-11-11T10:00:00Z' })];
    mount();
    await screen.findByText('Paciente Sintética');
    expect(screen.getByText('06:00')).toBeInTheDocument();
  });

  it('ignores an early appointment outside the visible day', async () => {
    fixture.mobile = true;
    fixture.appointments = [appointment({}), appointment({ id: 'tomorrow', start_time: '2026-11-12T09:30:00Z', end_time: '2026-11-12T10:00:00Z' })];
    mount();
    await screen.findByText('Paciente Sintética');
    expect(screen.queryByText('06:00')).not.toBeInTheDocument();
  });

  it('opens the waiting list as a view instead of a card above the grid', async () => {
    mount();
    await screen.findByText('Paciente Sintética');
    expect(screen.queryByText('acompanhamentos')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lista de espera' }));
    expect(screen.getByText('acompanhamentos')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('?queue=scheduling');
    expect(screen.queryByText('Paciente Sintética')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lista de espera' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Dia' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^$/);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Agenda: Quarta, 11 de novembro');
  });

  it('keeps the old deep link to the waiting list', () => {
    mount('/agenda?queue=scheduling');
    expect(screen.getByText('acompanhamentos')).toBeVisible();
  });

  it('puts the legend under the grid and keeps a compact Google control with its state', async () => {
    mount();
    await screen.findByText('Paciente Sintética');
    const legend = screen.getByRole('list', { name: 'Legenda dos agendamentos' });
    const grid = document.querySelector('.rbc-calendar')!;
    expect(grid.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(legend).getByText('Cancelado')).toHaveClass('line-through');
    expect(await screen.findByRole('button', { name: 'Conectar Google Calendar' })).toBeVisible();
  });

  it('shows that Google Calendar is connected', async () => {
    fixture.google = true;
    mount();
    expect(await screen.findByText('Google Calendar conectado')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Conectar Google/ })).not.toBeInTheDocument();
  });

  it('moves by one week and back to today', async () => {
    mount();
    await screen.findByText('Paciente Sintética');
    await userEvent.click(screen.getByRole('button', { name: 'Próximo período' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('16–22 de novembro');
    await userEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('9–15 de novembro');
  });

  it('opens "Novo agendamento" at the next half hour', async () => {
    mount();
    await screen.findByText('Paciente Sintética');
    await userEvent.click(screen.getByRole('button', { name: 'Novo agendamento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo agendamento' });
    expect(within(dialog).getByLabelText('Início')).toHaveValue('12:30');
    expect(within(dialog).getByLabelText('Fim')).toHaveValue('13:00');
  });

  it('opens the day view on the phone with a view menu and the new appointment in two rows', async () => {
    fixture.mobile = true;
    mount();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Agenda: Quarta, 11 de novembro');
    expect(screen.getByRole('combobox', { name: 'Visualização da agenda' })).toHaveTextContent('Dia');
    expect(screen.getByRole('button', { name: 'Novo agendamento' })).toBeVisible();
    const read = fixture.queries.find((q) => q.table === 'appointments')!;
    await waitFor(() => expect(read.filters).toContainEqual(['gt', 'end_time', '2026-11-11T03:00:00.000Z']));
  });
});
