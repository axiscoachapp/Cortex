import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WelcomeDashboard } from './WelcomeDashboard';
import type { Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/SpecialtySettingsSheet', () => ({ SpecialtySettingsSheet: () => null }));
vi.mock('@/components/OnboardingCard', () => ({ OnboardingCard: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        lte: () => query,
        order: () => query,
        range: async (from: number) => ({
          error: null,
          data: from
            ? []
            : [
                {
                  id: 'appointment',
                  patient_id: 'patient',
                  title: 'Consulta teste',
                  start_time: new Date(Date.now() + 3600000).toISOString(),
                  end_time: new Date(Date.now() + 5400000).toISOString(),
                  status: 'agendado',
                  type: 'retorno',
                  notes: null,
                  reminder_sent: false,
                },
              ],
        }),
      };
      return query;
    },
    functions: { invoke: mocks.invoke },
  },
}));
const patient: Patient = {
  id: 'patient',
  name: 'Pessoa de teste',
  age: 40,
  profession: '',
  status: 'retorno',
  lastVisit: '2026-05-01',
  diagnoses: [],
  medications: [],
  allergies: [],
  phone: '+5511999999999',
};
const renderDashboard = (person = patient) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <WelcomeDashboard patients={[person]} userId="doctor" onSelectPatient={vi.fn()} onNewConsultation={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('WhatsApp reminder preparation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps the reminder pending and exposes a clickable link when a popup is blocked', async () => {
    mocks.invoke.mockResolvedValue({ data: { waLink: 'https://wa.me/5511999999999?text=teste' }, error: null });
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderDashboard();
    await userEvent.click(await screen.findByRole('button', { name: 'Lembrar' }));
    expect(await screen.findByRole('link', { name: 'Abrir WhatsApp para Pessoa de teste' })).toHaveAttribute(
      'href',
      'https://wa.me/5511999999999?text=teste',
    );
    expect(screen.getByRole('heading', { name: /lembretes pendentes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lembrar' })).toBeEnabled();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Lembrete enviado!' }));
  });
  it('removes an email reminder from the pending list only after confirmed success', async () => {
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
    renderDashboard({ ...patient, phone: undefined, email: 'review@example.invalid' });
    await userEvent.click(await screen.findByRole('button', { name: 'Lembrar' }));
    expect(screen.queryByRole('heading', { name: /lembretes pendentes/i })).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Lembrete enviado por email!' });
  });
  it('keeps an email reminder pending when the server does not confirm delivery', async () => {
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
    renderDashboard({ ...patient, phone: undefined, email: 'review@example.invalid' });
    await userEvent.click(await screen.findByRole('button', { name: 'Lembrar' }));
    expect(screen.getByRole('heading', { name: /lembretes pendentes/i })).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Erro ao enviar lembrete' }));
  });
});

describe('dashboard date labels', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  // M 25: one format and one term for the last visit, from src/lib/dates.ts.
  it.each([
    ['2026-10-06', 'Última consulta: 06/10/2026 · há 30 dias'],
    ['2026-09-06', 'Última consulta: 06/09/2026 · há 2 meses'],
    [null, 'Sem consulta registrada'],
  ])('labels a visit on %s as %s', (lastVisit, expected) => {
    renderDashboard({ ...patient, status: 'novo', phone: undefined, lastVisit });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('keeps the phone header to one line: greeting · short date, then "Iniciar atendimento"', () => {
    renderDashboard();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Boa (tarde|noite)|^Bom dia/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('· qui, 5 nov');
    expect(screen.getByRole('button', { name: 'Iniciar atendimento' })).toHaveClass('w-full');
    expect(screen.queryByRole('button', { name: /Sair/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Alternar área de trabalho' })).toBeNull();
  });

  it('capitalizes only the start of the date sentence', () => {
    renderDashboard();
    expect(screen.getByText('Quinta-feira, 5 de novembro')).toBeInTheDocument();
  });
});

describe('open consultation behind Início', () => {
  it('offers the way back to the consultation that is still open', async () => {
    const onReturn = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <WelcomeDashboard patients={[patient]} userId="doctor" onSelectPatient={vi.fn()} onNewConsultation={vi.fn()}
            openConsultation={{ name: 'Pessoa de teste', onReturn }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Voltar à consulta de Pessoa de teste' }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('does not show zeros or an open "Primeiros passos" while patients load or fail', () => {
    const dashboard = (patientsState: 'loading' | 'error' | 'ready', patients: Patient[] = []) => (
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <WelcomeDashboard patients={patients} userId="doctor" onSelectPatient={vi.fn()} onNewConsultation={vi.fn()} patientsState={patientsState} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(dashboard('loading'));
    const counters = screen.getByRole('region', { name: 'Seu cadastro de pacientes' });
    expect(within(counters).queryByText('0')).not.toBeInTheDocument();
    expect(within(counters).getAllByText('…')).toHaveLength(3);
    expect(screen.queryByText('Primeiros passos no consultório')).not.toBeInTheDocument();
    rerender(dashboard('error'));
    expect(within(counters).getAllByText('—')).toHaveLength(3);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar seus dados.');
    rerender(dashboard('ready'));
    expect(screen.getByText('Primeiros passos no consultório')).toBeInTheDocument();
    // Every step done: the card renders nothing, so neither does its disclosure.
    rerender(dashboard('ready', [patient]));
    expect(screen.queryByText('Primeiros passos no consultório')).not.toBeInTheDocument();
  });

  it('shows nothing about a consultation when none is open', () => {
    renderDashboard();
    expect(screen.queryByRole('button', { name: /Voltar à consulta/ })).not.toBeInTheDocument();
  });
});

describe('one banner when the page data fails', () => {
  it('retries the patients from the single banner', async () => {
    const retry = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <WelcomeDashboard patients={[]} userId="doctor" onSelectPatient={vi.fn()} onNewConsultation={vi.fn()} patientsState="error" onRetryPatients={retry} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const banner = screen.getByRole('alert');
    await userEvent.click(within(banner).getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
