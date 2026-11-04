import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentModal } from './AppointmentModal';
import type { Appointment, Patient } from '@/types/patient';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remove: vi.fn().mockResolvedValue({ error: null }),
  update: vi.fn(),
  eq: vi.fn(),
  saved: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query={update:mocks.update,eq:mocks.eq,select:()=>query,maybeSingle:mocks.saved};
      mocks.update.mockReturnValue(query);mocks.eq.mockReturnValue(query);
      return query;
    },
    functions: { invoke: mocks.invoke },
  },
}));

const appointment: Appointment = {
  id: 'appointment-a',
  userId: 'doctor',
  patientId: null,
  title: 'Consulta de teste',
  startTime: new Date('2099-05-01T12:00:00Z'),
  endTime: new Date('2099-05-01T12:30:00Z'),
  status: 'agendado',
  type: 'retorno',
  reminderSent: false,
  revision: 3,
  googleEventId: 'event-a',
};

function renderAppointment(withPatient = false, receptionManaged = false) {
  const onOpenChange = vi.fn();
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
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppointmentModal
        open
        onOpenChange={onOpenChange}
        appointment={{ ...appointment, patientId: withPatient ? patient.id : null, receptionManaged }}
        patients={withPatient ? [patient] : []}
        userId="doctor"
        googleConnected
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe('Appointment removal and unsaved changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saved.mockResolvedValue({data:{id:'appointment-a'},error:null});
  });
  it('offers an explicit WhatsApp link after a blocked popup without claiming delivery', async () => {
    mocks.invoke.mockResolvedValue({ data: { waLink: 'https://wa.me/5511999999999?text=teste' }, error: null });
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderAppointment(true);
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(await screen.findByRole('link', { name: 'Abrir WhatsApp para revisar e enviar' })).toHaveAttribute(
      'href',
      'https://wa.me/5511999999999?text=teste',
    );
    expect(screen.getByRole('status')).toHaveTextContent(/só será enviado quando/i);
  });

  it('does not cancel an appointment when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAppointment();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar agendamento' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Consulta de teste'));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('cancels the exact local revision while retaining the row before Google synchronization', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finishSync: (result: { error: null }) => void;
    mocks.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSync = resolve;
        }),
    );
    renderAppointment();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar agendamento' }));
    await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('sync-google-calendar',expect.objectContaining({body:expect.objectContaining({action:'update'})})));
    expect(mocks.update).toHaveBeenCalledWith({status:'cancelado'});
    expect(mocks.eq).toHaveBeenCalledWith('revision',3);
    finishSync!({ error: null });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('does not synchronize a stale local cancellation over a receptionist reschedule',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);mocks.saved.mockResolvedValue({data:null,error:null});renderAppointment();
    await userEvent.click(screen.getByRole('button',{name:'Cancelar agendamento'}));
    await waitFor(()=>expect(mocks.saved).toHaveBeenCalled());expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('keeps an edited appointment open if discard is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onOpenChange = renderAppointment();
    await userEvent.type(screen.getByLabelText('Observações'), 'Novo detalhe');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Observações')).toHaveValue('Novo detalhe');
  });

  it('keeps the receptionist-confirmed patient fixed and saves edits for that patient', async () => {
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
    renderAppointment(true, true);
    expect(screen.getByRole('combobox', { name: 'Paciente' })).toBeDisabled();
    expect(screen.getByText(/Para trocar o paciente, cancele este agendamento/)).toBeVisible();
    await userEvent.type(screen.getByLabelText('Observações'), 'Detalhe sintético');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 'patient', notes: 'Detalhe sintético',
    })));
  });

  it('keeps the patient selector available for appointments without reception context', () => {
    renderAppointment(true);
    expect(screen.getByRole('combobox', { name: 'Paciente' })).toBeEnabled();
    expect(screen.queryByText(/Para trocar o paciente, cancele este agendamento/)).not.toBeInTheDocument();
  });
});

vi.mock('@/hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: (dirty: boolean) => (next: boolean) => next || !dirty || window.confirm('Descartar alterações?'),
}));
