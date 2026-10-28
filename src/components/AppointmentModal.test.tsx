import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentModal } from './AppointmentModal';
import type { Appointment, Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), remove: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => ({ delete: () => ({ eq: mocks.remove }) }),
  functions: { invoke: mocks.invoke },
} }));

const appointment: Appointment = {
  id: 'appointment-a', userId: 'doctor', patientId: null, title: 'Consulta de teste',
  startTime: new Date('2099-05-01T12:00:00Z'), endTime: new Date('2099-05-01T12:30:00Z'),
  status: 'agendado', type: 'retorno', reminderSent: false, googleEventId: 'event-a',
};

function renderAppointment(withPatient = false) {
  const onOpenChange = vi.fn();
  const patient: Patient = { id: 'patient', name: 'Pessoa de teste', age: 40, profession: '', status: 'retorno', lastVisit: '2026-05-01', diagnoses: [], medications: [], allergies: [], phone: '+5511999999999' };
  render(<QueryClientProvider client={new QueryClient()}><AppointmentModal open onOpenChange={onOpenChange} appointment={withPatient ? { ...appointment, patientId: patient.id } : appointment} patients={withPatient ? [patient] : []} userId="doctor" googleConnected onSaved={vi.fn()} /></QueryClientProvider>);
  return onOpenChange;
}

describe('Appointment removal and unsaved changes', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('offers an explicit WhatsApp link after a blocked popup without claiming delivery', async () => {
    mocks.invoke.mockResolvedValue({ data: { waLink: 'https://wa.me/5511999999999?text=teste' }, error: null });
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderAppointment(true);
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(await screen.findByRole('link', { name: 'Abrir WhatsApp para revisar e enviar' })).toHaveAttribute('href', 'https://wa.me/5511999999999?text=teste');
    expect(screen.getByRole('status')).toHaveTextContent(/só será enviado quando/i);
  });

  it('does not delete an appointment when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAppointment();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir agendamento' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Consulta de teste'));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('retains the local appointment until Google confirms deletion', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finishSync: (result: { error: null }) => void;
    mocks.invoke.mockImplementation(() => new Promise(resolve => { finishSync = resolve; }));
    renderAppointment();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir agendamento' }));
    expect(mocks.invoke).toHaveBeenCalledWith('sync-google-calendar', expect.any(Object));
    expect(mocks.remove).not.toHaveBeenCalled();
    finishSync!({ error: null });
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('id', 'appointment-a'));
  });

  it('keeps an edited appointment open if discard is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onOpenChange = renderAppointment();
    await userEvent.type(screen.getByLabelText('Observações'), 'Novo detalhe');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Observações')).toHaveValue('Novo detalhe');
  });
});

vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: (dirty: boolean) => (next: boolean) => next || !dirty || window.confirm('Descartar alterações?') }));
