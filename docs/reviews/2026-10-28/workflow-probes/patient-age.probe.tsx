import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewConsultationModal } from '../../../../src/components/NewConsultationModal';

it('reproduces unknown optional age being submitted as zero', async () => {
  const start = vi.fn().mockResolvedValue(undefined);
  render(<NewConsultationModal open onOpenChange={vi.fn()} patients={[]} onStartConsultation={start} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Novo Paciente' }));
  await user.type(screen.getByLabelText(/nome do paciente/i), 'Synthetic Unknown Age');
  await user.type(screen.getByLabelText(/queixa principal/i), 'Synthetic follow-up');
  expect(screen.getByLabelText('Idade')).toHaveValue(null);
  await user.click(screen.getByRole('button', { name: 'Iniciar Consulta' }));
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(start.mock.calls[0][1]).toMatchObject({ name: 'Synthetic Unknown Age', age: 0 });
});
