import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WelcomeDashboard } from './WelcomeDashboard';
import type { Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/SpecialtySettingsSheet', () => ({ SpecialtySettingsSheet: () => null }));
vi.mock('@/components/OnboardingCard', () => ({ OnboardingCard: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query = { select: () => query, eq: () => query, gte: () => query, lte: () => query, order: () => query,
      range: async (from: number) => ({ error: null, data: from ? [] : [{ id: 'appointment', patient_id: 'patient', title: 'Consulta teste', start_time: new Date(Date.now()+3600000).toISOString(), end_time: new Date(Date.now()+5400000).toISOString(), status: 'agendado', type: 'retorno', notes: null, reminder_sent: false }] }),
    }; return query;
  }, functions: { invoke: mocks.invoke },
} }));
const patient: Patient = { id: 'patient', name: 'Pessoa de teste', age: 40, profession: '', status: 'retorno', lastVisit: '2026-05-01', diagnoses: [], medications: [], allergies: [], phone: '+5511999999999' };
const renderDashboard = (person = patient) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><WelcomeDashboard patients={[person]} userId="doctor" onSelectPatient={vi.fn()} onNewConsultation={vi.fn()} /></MemoryRouter></QueryClientProvider>);

describe('WhatsApp reminder preparation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps the reminder pending and exposes a clickable link when a popup is blocked', async () => {
    mocks.invoke.mockResolvedValue({ data: { waLink: 'https://wa.me/5511999999999?text=teste' }, error: null });
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderDashboard();
    await userEvent.click(await screen.findByRole('button', { name: 'Lembrar' }));
    expect(await screen.findByRole('link', { name: 'Abrir WhatsApp para Pessoa de teste' })).toHaveAttribute('href', 'https://wa.me/5511999999999?text=teste');
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
