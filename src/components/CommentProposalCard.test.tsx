import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentProposalCard } from './CommentProposalCard';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

const proposal = {
  allergies: ['Penicilina'],
  medicationsAdd: [{ name: 'Losartana', dosage: '50 mg' }],
  medicationsRemove: ['Captopril'],
  diagnoses: [],
  addendum: '',
  longTermNote: '',
  summary: '',
};

describe('CommentProposalCard', () => {
  it('applies only the items the physician kept checked', async () => {
    mocks.invoke.mockResolvedValue({ data: { applied: true, summary: 'Alergias adicionadas: Penicilina' }, error: null });
    const onApplied = vi.fn();
    render(
      <CommentProposalCard
        patientId="p1"
        comment="alergia a penicilina"
        proposal={proposal}
        expectedRevision={4}
        onApplied={onApplied}
      />,
    );
    // Nothing is written while the card is only displayed.
    expect(mocks.invoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText(/Suspender medicação: Captopril/));
    await userEvent.click(screen.getByLabelText(/Adicionar\/alterar medicação: Losartana/));
    await userEvent.click(screen.getByRole('button', { name: /Aplicar selecionados \(1\)/ }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('Alergias adicionadas: Penicilina'));
    const body = mocks.invoke.mock.calls[0][1].body;
    expect(body).toMatchObject({ mode: 'apply', expectedRevision: 4, patientId: 'p1' });
    expect(body.approved.allergies).toEqual(['Penicilina']);
    expect(body.approved.medicationsAdd).toEqual([]);
    expect(body.approved.medicationsRemove).toEqual([]);
  });

  it('discarding writes nothing', async () => {
    mocks.invoke.mockClear();
    render(
      <CommentProposalCard patientId="p1" comment="x" proposal={proposal} expectedRevision={1} onApplied={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByText(/Nada foi alterado/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
