import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewConsultationModal as Modal } from './NewConsultationModal';

const rows = [
  { id: 'maria-id', name: 'Maria Silva', age: 40 },
  { id: 'ana-id', name: 'Ana Paula', age: 31 },
];
const state = vi.hoisted(() => ({ term: '' }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        is: () => query,
        ilike: (_column: string, pattern: string) => { state.term = pattern.replace(/%/g, '').toLowerCase(); return query; },
        order: () => query,
        limit: async () => ({ data: rows.filter(row => row.name.toLowerCase().includes(state.term)), error: null }),
      };
      return query;
    },
  },
}));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: () => () => true }));

function renderModal(onStart: React.ComponentProps<typeof Modal>['onStartConsultation']) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Modal open onOpenChange={vi.fn()} patients={[]} onStartConsultation={onStart} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('NewConsultationModal patient selection', () => {
  it('starts for the patient the doctor selected and can see', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const user = renderModal(onStart);
    await user.type(screen.getByLabelText('Buscar paciente'), 'Maria');
    await user.click(await screen.findByRole('option', { name: /Maria Silva/ }));
    await user.type(screen.getByLabelText(/queixa principal/i), 'Dor pélvica');
    await user.click(screen.getByRole('button', { name: 'Iniciar Consulta' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('maria-id', undefined, 'Dor pélvica'));
  });

  it('never starts for a previously selected patient hidden by a new search', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const user = renderModal(onStart);
    const search = screen.getByLabelText('Buscar paciente');
    await user.type(search, 'Maria');
    await user.click(await screen.findByRole('option', { name: /Maria Silva/ }));
    await user.clear(search);
    await user.type(search, 'Ana');
    await screen.findByRole('option', { name: /Ana Paula/ });
    await waitFor(() => expect(screen.queryByRole('option', { name: /Maria Silva/ })).not.toBeInTheDocument());
    expect(screen.getByRole('option', { name: /Ana Paula/ })).toHaveAttribute('aria-selected', 'false');
    await user.type(screen.getByLabelText(/queixa principal/i), 'Dor pélvica');
    const submit = screen.getByRole('button', { name: 'Iniciar Consulta' });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(onStart).not.toHaveBeenCalled();

    // Choosing the visible patient enables the start for that patient only.
    await user.click(screen.getByRole('option', { name: /Ana Paula/ }));
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('ana-id', undefined, 'Dor pélvica'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
