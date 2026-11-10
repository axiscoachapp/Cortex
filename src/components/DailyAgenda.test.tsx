import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DailyAgenda, type DailyAppointment } from './DailyAgenda';
import type { Patient } from '@/types/patient';
const patient: Patient = { id: 'synthetic-patient', name: 'Paciente sintético', age: null, profession: '', status: 'novo', lastVisit: null, diagnoses: [], medications: [], allergies: [] };
const appointment: DailyAppointment = { id: 'synthetic-appointment', patient_id: patient.id, title: 'Consulta sintética', start_time: '2026-11-10T12:00:00Z', end_time: '2026-11-10T12:30:00Z', type: 'novo', status: 'confirmado', notes: null, reminder_sent: false };
const mount = (over: Partial<React.ComponentProps<typeof DailyAgenda>> = {}) => {
  const props = { appointments: [appointment], patients: [patient], loading: false, error: false, onRetry: vi.fn(), onOpenAgenda: vi.fn(), onSelectPatient: vi.fn(), ...over };
  render(<DailyAgenda {...props} />);
  return props;
};
describe('daily clinical agenda', () => {
  it('opens exactly the selected patient and appointment without creating an appointment', async () => {
    const props = mount();
    await userEvent.click(screen.getByRole('button', { name: /Paciente sintético/ }));
    expect(props.onSelectPatient).toHaveBeenCalledExactlyOnceWith(patient, appointment.id);
    expect(props.onOpenAgenda).not.toHaveBeenCalled();
  });
  it('does not open a clinical record for an unlinked appointment', () => {
    mount({ patients: [] });
    expect(screen.getByRole('button', { name: /Consulta sintética/ })).toBeDisabled();
    expect(screen.getByText('Sem paciente vinculado')).toBeVisible();
  });
  it('distinguishes failed reads from a genuinely empty day', async () => {
    const props = mount({ appointments: [], error: true });
    expect(screen.queryByText('Seu dia ainda está livre')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });
  it('offers an explicit agenda action for an empty day', async () => {
    const props = mount({ appointments: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Agendar consulta' }));
    expect(props.onOpenAgenda).toHaveBeenCalledOnce();
    expect(props.onSelectPatient).not.toHaveBeenCalled();
  });
});
