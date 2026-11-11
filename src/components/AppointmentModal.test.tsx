import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  insert: vi.fn(),
  inserted: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query={update:mocks.update,insert:mocks.insert,eq:mocks.eq,select:()=>query,maybeSingle:mocks.saved,single:mocks.inserted};
      mocks.update.mockReturnValue(query);mocks.eq.mockReturnValue(query);mocks.insert.mockReturnValue(query);
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
    await userEvent.type(screen.getByLabelText(/^Observações/), 'Novo detalhe');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText(/^Observações/)).toHaveValue('Novo detalhe');
  });

  it('keeps the receptionist-confirmed patient fixed and saves edits for that patient', async () => {
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
    renderAppointment(true, true);
    expect(screen.getByRole('combobox', { name: /^Paciente/ })).toBeDisabled();
    expect(screen.getByText(/Para trocar o paciente, cancele este agendamento/)).toBeVisible();
    await userEvent.type(screen.getByLabelText(/^Observações/), 'Detalhe sintético');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 'patient', notes: 'Detalhe sintético',
    })));
  });

  it('keeps the patient selector available for appointments without reception context', () => {
    renderAppointment(true);
    expect(screen.getByRole('combobox', { name: /^Paciente/ })).toBeEnabled();
    expect(screen.queryByText(/Para trocar o paciente, cancele este agendamento/)).not.toBeInTheDocument();
  });
});

vi.mock('@/hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: (dirty: boolean) => (next: boolean) => next || !dirty || window.confirm('Descartar alterações?'),
}));

function renderNew(props: Partial<React.ComponentProps<typeof AppointmentModal>> = {}) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppointmentModal open onOpenChange={onOpenChange} appointment={null} patients={[]} userId="doctor" googleConnected={false} onSaved={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe('Booking dialog layout and validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserted.mockResolvedValue({ data: { id: 'new-appointment' }, error: null });
  });

  it('uses the trigger words as titles', () => {
    renderNew();
    expect(screen.getByRole('dialog', { name: 'Novo agendamento' })).toBeVisible();
  });

  it('titles an existing appointment "Editar agendamento"', () => {
    renderAppointment();
    expect(screen.getByRole('dialog', { name: 'Editar agendamento' })).toBeVisible();
  });

  it('asks for patient, date, start, end and type before the other fields', () => {
    renderNew();
    const order = ['Paciente', 'Data', 'Início', 'Fim', 'Tipo', 'Título', 'Status', 'Observações'].map(
      (label) => screen.getByText(new RegExp(`^${label}`), { selector: 'label' }),
    );
    for (let i = 1; i < order.length; i++)
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('starts at the next half hour of clinic time, not the current minute', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T08:21:00Z')); // 05:21 in São Paulo
    try {
      renderNew();
      expect(screen.getByLabelText('Início')).toHaveValue('05:30');
      expect(screen.getByLabelText('Fim')).toHaveValue('06:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an existing appointment in clinic time', () => {
    renderAppointment();
    expect(screen.getByLabelText('Início')).toHaveValue('09:00');
    expect(screen.getByLabelText('Fim')).toHaveValue('09:30');
  });

  it('keeps the primary button enabled and puts the missing field message under the field, focused', async () => {
    renderNew();
    const submit = screen.getByRole('button', { name: 'Agendar' });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    const title = screen.getByLabelText('Título');
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('Escolha o paciente ou escreva um título.');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    await userEvent.type(title, 'Bloqueio');
    expect(title).not.toHaveAttribute('aria-invalid');
  });

  it('explains an end before the start under "Fim"', async () => {
    renderNew({ defaultStart: new Date('2026-11-12T12:00:00Z'), defaultEnd: new Date('2026-11-12T12:30:00Z') });
    await userEvent.type(screen.getByLabelText('Título'), 'Consulta sintética');
    const end = screen.getByLabelText('Fim');
    fireEvent.change(end, { target: { value: '08:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    expect(end).toHaveFocus();
    expect(end).toHaveAccessibleDescription('O fim deve ser depois do início.');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('saves the chosen clinic day and times as real instants', async () => {
    const onOpenChange = renderNew({ defaultStart: new Date('2026-11-12T12:00:00Z'), defaultEnd: new Date('2026-11-12T12:30:00Z') });
    await userEvent.type(screen.getByLabelText('Título'), 'Consulta sintética');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith([
      expect.objectContaining({ start_time: '2026-11-12T12:00:00.000Z', end_time: '2026-11-12T12:30:00.000Z', title: 'Consulta sintética', status: 'agendado' }),
    ]));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows a failed save above the buttons, focused, and keeps the dialog open', async () => {
    mocks.inserted.mockResolvedValue({ data: null, error: { message: 'duplicate key value violates constraint' } });
    const onOpenChange = renderNew({ defaultStart: new Date('2026-11-12T12:00:00Z') });
    await userEvent.type(screen.getByLabelText('Título'), 'Consulta sintética');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível salvar o agendamento. Os dados continuam aqui; tente de novo.');
    expect(alert).not.toHaveTextContent(/duplicate key/);
    await waitFor(() => expect(alert).toHaveFocus());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('says the patient list is missing instead of disabling the button', async () => {
    renderNew({ patientLookupUnavailable: true });
    const submit = screen.getByRole('button', { name: 'Agendar' });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(screen.getAllByRole('alert').some((node) => node.textContent?.includes('Recarregar pacientes'))).toBe(true));
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('shows a stale cancellation inline instead of a toast', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.saved.mockResolvedValue({ data: null, error: null });
    renderAppointment();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar agendamento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O agendamento mudou em outra tela');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('labels the type with the shared vocabulary', () => {
    renderNew();
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Retorno');
  });
});
