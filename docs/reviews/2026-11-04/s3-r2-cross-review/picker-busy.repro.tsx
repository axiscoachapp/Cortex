import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrescriptionTemplatePicker } from '@/components/PrescriptionTemplatePicker';

vi.mock('@/hooks/useDocumentSnippets', () => ({ useDocumentSnippets: () => ({
  snippets: [{ id: 'synthetic-model', name: 'Modelo sintético', revision: 1, items: [{ name: 'Item sintético B', dosage: '1', instructions: 'x' }] }],
  isLoading: false, isError: false, retry: vi.fn(), saveSnippet: vi.fn(), archiveSnippet: vi.fn(), isSaving: false,
}) }));

it('does not apply a pending template after generation disables the picker', async () => {
  const onApply = vi.fn(), selected = [{ name: 'Item sintético A' }];
  const user = userEvent.setup();
  const view = render(<PrescriptionTemplatePicker selected={selected} onApply={onApply} />);
  await user.selectOptions(screen.getByLabelText('Modelos de receita'), 'synthetic-model');
  view.rerender(<PrescriptionTemplatePicker selected={selected} onApply={onApply} disabled />);
  await user.click(screen.getByRole('button', { name: 'Substituir a seleção' }));
  expect(onApply).not.toHaveBeenCalled();
});
