import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentComposerModal } from '../../../../src/components/DocumentComposerModal';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => { throw new Error('Network access is forbidden in this review probe'); } } }));

it('reproduces certificate duration beyond the displayed maximum reaching generation', async () => {
  const generate = vi.fn().mockResolvedValue(undefined);
  render(<DocumentComposerModal open onOpenChange={vi.fn()} isGenerating={false} onGenerate={generate}
    patient={{ id: 'synthetic', name: 'Synthetic Patient', age: 40, profession: '', lastVisit: '2026-10-28', status: 'novo', medications: [], diagnoses: [], allergies: [] }} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Atestado médico/ }));
  const days = screen.getByRole('spinbutton', { name: 'Dias de afastamento' });
  await user.clear(days); await user.type(days, '366');
  expect((days as HTMLInputElement).validity.rangeOverflow).toBe(true);
  expect(screen.getByRole('button', { name: 'Gerar documento' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Gerar documento' }));
  await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  expect(generate.mock.calls[0][0]).toMatchObject({ docType: 'atestado', content: { days: 366 } });
});
