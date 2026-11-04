import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrescriptionTemplatePicker } from './PrescriptionTemplatePicker';

const hook = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock('@/hooks/useDocumentSnippets', () => ({ useDocumentSnippets: () => hook.value }));

const template = {
  id: 'snippet-1',
  name: 'Infecção urinária',
  revision: 3,
  items: [{ name: 'Medicamento sintético A', dosage: '1 comprimido', instructions: 'de 12 em 12 horas' }],
};
const base = () => ({
  snippets: [template],
  isLoading: false,
  isError: false,
  retry: vi.fn(),
  saveSnippet: vi.fn().mockResolvedValue({ id: 'snippet-2', revision: 1 }),
  archiveSnippet: vi.fn().mockResolvedValue(undefined),
  isSaving: false,
});

describe('PrescriptionTemplatePicker', () => {
  beforeEach(() => {
    hook.value = base();
  });

  it('applies the chosen template items', async () => {
    const onApply = vi.fn();
    render(<PrescriptionTemplatePicker selected={[]} onApply={onApply} />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Modelos de receita'), 'snippet-1');
    expect(onApply).toHaveBeenCalledWith(template.items, 'replace');
    expect(screen.getByRole('status')).toHaveTextContent('Modelo "Infecção urinária" aplicado. Revise antes de gerar.');
  });

  it('asks before touching a selection, and cancel keeps it', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <PrescriptionTemplatePicker
        selected={[{ name: 'Medicamento sintético A' }, { name: 'Medicamento sintético Z' }]}
        onApply={onApply}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Modelos de receita'), 'snippet-1');
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Como aplicar o modelo' })).toHaveTextContent(
      'Há 2 medicamentos selecionados: Medicamento sintético A, Medicamento sintético Z. Como aplicar o modelo "Infecção urinária"?',
    );
    await user.click(screen.getByRole('button', { name: 'Manter a seleção' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Como aplicar o modelo' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Modelos de receita'), 'snippet-1');
    await user.click(screen.getByRole('button', { name: 'Substituir a seleção' }));
    expect(onApply).toHaveBeenLastCalledWith(template.items, 'replace');
    expect(screen.getByRole('status')).toHaveTextContent('no lugar de 2 medicamentos, que ficaram desmarcados na lista');

    await user.selectOptions(screen.getByLabelText('Modelos de receita'), 'snippet-1');
    await user.click(screen.getByRole('button', { name: 'Adicionar aos selecionados' }));
    expect(onApply).toHaveBeenLastCalledWith(template.items, 'add');
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it('saves the current selection under a name', async () => {
    const user = userEvent.setup();
    render(
      <PrescriptionTemplatePicker
        selected={[{ name: ' Medicamento sintético B ', dosage: '5 ml', instructions: 'à noite' }]}
        onApply={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Salvar como modelo/ }));
    await user.type(screen.getByLabelText('Nome do novo modelo'), '  Tosse  ');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(hook.value.saveSnippet).toHaveBeenCalledWith({
      name: 'Tosse',
      items: [{ name: 'Medicamento sintético B', dosage: '5 ml', instructions: 'à noite' }],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Modelo "Tosse" salvo.');
  });

  it('keeps the name and shows the server message when saving fails', async () => {
    hook.value = { ...base(), saveSnippet: vi.fn().mockRejectedValue(new Error('Limite de modelos atingido; arquive os que não usa')) };
    const user = userEvent.setup();
    render(<PrescriptionTemplatePicker selected={[{ name: 'Medicamento sintético B' }]} onApply={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Salvar como modelo/ }));
    await user.type(screen.getByLabelText('Nome do novo modelo'), 'Tosse');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Limite de modelos atingido');
    expect(screen.getByLabelText('Nome do novo modelo')).toHaveValue('Tosse');
  });

  it('cannot save an empty or unnamed selection', () => {
    render(<PrescriptionTemplatePicker selected={[{ name: '  ' }]} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Salvar como modelo/ })).toBeDisabled();
  });

  it('archives the applied template with its current revision after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<PrescriptionTemplatePicker selected={[]} onApply={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Modelos de receita'), 'snippet-1');
    await user.click(screen.getByRole('button', { name: 'Arquivar o modelo "Infecção urinária"' }));
    expect(confirm).toHaveBeenCalled();
    expect(hook.value.archiveSnippet).toHaveBeenCalledWith(template);
    expect(await screen.findByRole('status')).toHaveTextContent('arquivado');
    confirm.mockRestore();
  });

  it('says when there are no templates and offers retry on load failure', async () => {
    const retry = vi.fn();
    hook.value = { ...base(), snippets: [], isError: true, retry };
    render(<PrescriptionTemplatePicker selected={[]} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Modelos de receita')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Nenhum modelo salvo' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalled();
  });
});
