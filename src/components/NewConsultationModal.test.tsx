import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewConsultationModal } from './NewConsultationModal';

describe('New consultation submission', () => {
  it.each([['', null], ['0', 0], ['42', 42]])('preserves age %s without inventing a newborn', async (age, expected) => {
    const onStart = vi.fn();
    render(<NewConsultationModal open onOpenChange={vi.fn()} patients={[]} onStartConsultation={onStart} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Novo Paciente' }));
    await user.type(screen.getByLabelText(/nome do paciente/i), 'Pessoa sintética');
    if (age) await user.type(screen.getByLabelText(/^idade/i), age);
    await user.type(screen.getByLabelText(/queixa principal/i), 'Retorno');
    await user.click(screen.getByRole('button', { name: 'Iniciar Consulta' }));
    expect(onStart).toHaveBeenCalledWith(null, expect.objectContaining({ age: expected }), 'Retorno');
  });

  it('keeps the entered patient and complaint when saving fails', async () => {
    const onOpenChange = vi.fn();
    const onStart = vi.fn().mockRejectedValue(new Error('offline'));
    render(<NewConsultationModal open onOpenChange={onOpenChange} patients={[]} onStartConsultation={onStart} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Novo Paciente' }));
    await user.type(screen.getByLabelText(/nome do paciente/i), 'Pessoa de teste');
    await user.type(screen.getByLabelText(/queixa principal/i), 'Retorno de acompanhamento');
    await user.click(screen.getByRole('button', { name: 'Iniciar Consulta' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText(/nome do paciente/i)).toHaveValue('Pessoa de teste');
    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível iniciar/i);
  });
});

vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: (dirty: boolean) => (next: boolean) => next || !dirty || window.confirm('Descartar alterações?') }));
