// Round 3, R 12 / M 31: one vocabulary for status and type, from src/lib/appointmentStatus.ts.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { appointmentStatus, appointmentTypeLabel } from '@/lib/appointmentStatus';
import { StatusChip } from './AppointmentStatusChip';
import { DayAgenda } from './DayAgenda';
import { typeLabels } from './agendaTime';
import { clinicDay, clinicTimestamp } from './dates';
import type { ReceptionAppointment } from './contracts';

const day = clinicDay(new Date().toISOString());
const doctor = '88888888-8888-4888-8888-888888888888';
const item = (over: Partial<ReceptionAppointment> = {}): ReceptionAppointment => ({
  id: '11111111-1111-4111-8111-111111111111', doctorId: doctor, patientId: null, contactId: null, caseId: null, patientName: 'Paciente sintética',
  startTime: clinicTimestamp(day, '09:00'), endTime: clinicTimestamp(day, '09:30'), type: 'urgencia', status: 'agendado', revision: 1,
  checkedInAt: null, googleSyncStatus: 'idle', ...over,
});

describe('appointment status and type in reception', () => {
  it('uses the app-wide type names', () => {
    expect(typeLabels).toEqual(appointmentTypeLabel);
  });

  it.each(['agendado', 'confirmado', 'realizado', 'cancelado'] as const)('labels %s with the shared word and look', status => {
    render(<StatusChip appointment={{ status, checkedInAt: null }} />);
    const chip = screen.getByText(appointmentStatus[status].label);
    for (const name of appointmentStatus[status].badge.split(' ')) expect(chip).toHaveClass(name);
  });

  it('shows arrival as "Chegou" with the time, only while the appointment is open', () => {
    const arrived = clinicTimestamp(day, '08:52');
    const { rerender } = render(<StatusChip appointment={{ status: 'confirmado', checkedInAt: arrived }} />);
    expect(screen.getByText('Chegou 08:52')).toBeInTheDocument();
    rerender(<StatusChip appointment={{ status: 'realizado', checkedInAt: arrived }} />);
    expect(screen.getByText('Realizado')).toBeInTheDocument();
  });

  it('gives the compact day list the same type and status words as the card', () => {
    render(<DayAgenda day={day} doctor={doctor} items={[item(), item({ id: '22222222-2222-4222-8222-222222222222', status: 'cancelado', startTime: clinicTimestamp(day, '10:00'), endTime: clinicTimestamp(day, '10:30') })]} blocks={[]} busy={[]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Encaixe');
    expect(rows[0]).toHaveTextContent('Agendado');
    expect(rows[1]).toHaveTextContent('Encaixe');
    expect(rows[1]).toHaveTextContent('Cancelado');
  });
});
