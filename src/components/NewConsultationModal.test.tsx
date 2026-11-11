import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewConsultationModal as Modal } from './NewConsultationModal';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        is: () => query,
        ilike: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
      };
      return query;
    },
  },
}));
// The patient search uses React Query.
function NewConsultationModal(props: React.ComponentProps<typeof Modal>) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <Modal {...props} />
    </QueryClientProvider>
  );
}

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});

function renderNewPatient(onStart = vi.fn()) {
  render(<NewConsultationModal open onOpenChange={vi.fn()} patients={[]} onStartConsultation={onStart} />);
  const user = userEvent.setup();
  return { user, onStart };
}

describe('New consultation submission', () => {
  it.each([['', null], ['0', 0], ['42', 42]])('preserves age %s without inventing a newborn', async (age, expected) => {
    const { user, onStart } = renderNewPatient();
    await user.click(screen.getByRole('button', { name: 'Novo paciente' }));
    await user.type(screen.getByLabelText('Nome'), 'Pessoa sintética');
    await user.type(screen.getByLabelText('Queixa principal'), 'Retorno');
    if (age) {
      await user.click(screen.getByRole('button', { name: /mais dados \(opcional\)/i }));
      await user.type(screen.getByLabelText(/^idade/i), age);
    }
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));
    expect(onStart).toHaveBeenCalledWith(null, expect.objectContaining({ age: expected }), 'Retorno');
  });

  it('keeps the entered patient and complaint when saving fails', async () => {
    const onOpenChange = vi.fn();
    const onStart = vi.fn().mockRejectedValue(new Error('offline'));
    render(<NewConsultationModal open onOpenChange={onOpenChange} patients={[]} onStartConsultation={onStart} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Novo paciente' }));
    await user.type(screen.getByLabelText('Nome'), 'Pessoa de teste');
    await user.type(screen.getByLabelText('Queixa principal'), 'Retorno de acompanhamento');
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Nome')).toHaveValue('Pessoa de teste');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/não foi possível iniciar o atendimento/i);
    // Above the footer buttons, and focused so it is read at once.
    expect(alert).toHaveFocus();
    expect(alert.compareDocumentPosition(screen.getByRole('button', { name: 'Cancelar' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Start-visit dialog layout and inline validation', () => {
  it('is titled like its trigger and asks only for name and complaint first', async () => {
    const { user } = renderNewPatient();
    expect(screen.getByRole('dialog', { name: 'Iniciar atendimento' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Novo paciente' }));
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.getByLabelText('Queixa principal')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: /mais dados \(opcional\)/i });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(/data de nascimento/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^cpf/i)).not.toBeInTheDocument();
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Data de nascimento (opcional)')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail (opcional)')).toBeInTheDocument();
  });

  it('keeps the primary enabled and, when something is missing, says it under the field and focuses it', async () => {
    const { user, onStart } = renderNewPatient();
    await user.click(screen.getByRole('button', { name: 'Novo paciente' }));
    const submit = screen.getByRole('button', { name: 'Iniciar atendimento' });
    expect(submit).toBeEnabled();
    expect(screen.queryByText(/informe um nome válido/i)).not.toBeInTheDocument();
    await user.click(submit);
    expect(onStart).not.toHaveBeenCalled();
    const name = screen.getByLabelText('Nome');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/informe um nome válido/i);
    expect(screen.getByLabelText('Queixa principal')).toHaveAccessibleDescription('Descreva a queixa principal.');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // The message follows the correction; the next missing field gets the focus.
    await user.type(name, 'Pessoa sintética');
    expect(name).not.toHaveAttribute('aria-invalid');
    await user.click(submit);
    expect(screen.getByLabelText('Queixa principal')).toHaveFocus();
  });

  it('opens "Mais dados" to show a problem in an optional field', async () => {
    const { user, onStart } = renderNewPatient();
    await user.click(screen.getByRole('button', { name: 'Novo paciente' }));
    await user.type(screen.getByLabelText('Nome'), 'Pessoa sintética');
    await user.type(screen.getByLabelText('Queixa principal'), 'Retorno');
    await user.click(screen.getByRole('button', { name: /mais dados \(opcional\)/i }));
    await user.type(screen.getByLabelText('CPF (opcional)'), '52998224724');
    await user.click(screen.getByRole('button', { name: /mais dados \(opcional\)/i }));
    expect(screen.queryByLabelText('CPF (opcional)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));
    expect(onStart).not.toHaveBeenCalled();
    const cpf = screen.getByLabelText('CPF (opcional)');
    expect(cpf).toHaveFocus();
    expect(cpf).toHaveAccessibleDescription(/CPF inválido/);
  });
});

vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: (dirty: boolean) => (next: boolean) => next || !dirty || window.confirm('Descartar alterações?') }));
