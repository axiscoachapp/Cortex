import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalListEditor, type ClinicalListKind } from './ClinicalListEditor';
import type { Patient } from '@/types/patient';

const api = vi.hoisted(() => ({
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  updateResult: { data: { id: 'patient-A' }, error: null } as { data: unknown; error: unknown },
  fresh: { revision: 8, allergies: ['Látex'], diagnoses: [], medications: [] } as Record<string, unknown>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      let current: { patch: Record<string, unknown>; filters: Array<[string, unknown]> } | null = null;
      const q = {
        update: (patch: Record<string, unknown>) => {
          current = { patch, filters: [] };
          api.updates.push(current);
          return q;
        },
        select: () => q,
        eq: (column: string, value: unknown) => {
          current?.filters.push([column, value]);
          return q;
        },
        maybeSingle: async () => api.updateResult,
        single: async () => ({ data: api.fresh, error: null }),
      };
      return q;
    },
  },
}));

const patient: Patient = {
  id: 'patient-A',
  name: 'Paciente Sintética',
  age: 40,
  revision: 7,
  profession: '',
  lastVisit: null,
  status: 'retorno',
  allergies: ['Dipirona'],
  diagnoses: [{ code: 'N94.6', description: 'Dismenorreia' }],
  medications: [
    { name: 'Ibuprofeno', dosage: '600 mg', instructions: '8/8h', startedAt: '2026-01-01T00:00:00Z', note: 'último registro em 01/01/2026' },
  ],
};

function open(kind: ClinicalListKind, onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ClinicalListEditor kind={kind} patient={patient} userId="doctor" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

beforeEach(() => {
  api.updates = [];
  api.updateResult = { data: { id: 'patient-A' }, error: null };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('ClinicalListEditor', () => {
  it('records an allergy without the AI, guarded by the patient revision', async () => {
    const user = userEvent.setup();
    const onOpenChange = open('allergies');
    expect(screen.getByRole('dialog', { name: 'Editar alergias' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar alergia' }));
    const fields = screen.getAllByLabelText('Alergia');
    await user.type(fields[1], 'Penicilina');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.updates[0].patch).toEqual({ allergies: ['Dipirona', 'Penicilina'] });
    expect(api.updates[0].filters).toEqual([
      ['id', 'patient-A'],
      ['revision', 7],
    ]);
  });

  it('corrects a diagnosis', async () => {
    const user = userEvent.setup();
    open('diagnoses');
    const description = screen.getByLabelText('Diagnóstico');
    await user.clear(description);
    await user.type(description, 'Endometriose');
    await user.clear(screen.getByLabelText('CID (opcional)'));
    await user.type(screen.getByLabelText('CID (opcional)'), 'N80');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.updates).toHaveLength(1));
    expect(api.updates[0].patch).toEqual({ diagnoses: [{ code: 'N80', description: 'Endometriose' }] });
  });

  it('asks before removing a medication and keeps its start date when edited', async () => {
    const user = userEvent.setup();
    open('medications');
    await user.clear(screen.getByLabelText('Dose'));
    await user.type(screen.getByLabelText('Dose'), '400 mg');
    await user.click(screen.getByRole('button', { name: 'Remover Ibuprofeno' }));
    expect(screen.getByRole('alertdialog', { name: 'Remover Ibuprofeno?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manter' }));
    expect(screen.getByLabelText('Medicamento')).toHaveValue('Ibuprofeno');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.updates).toHaveLength(1));
    expect(api.updates[0].patch).toEqual({
      // The start date and the note are not edited here: they survive the save.
      medications: [
        { name: 'Ibuprofeno', dosage: '400 mg', instructions: '8/8h', startedAt: '2026-01-01T00:00:00Z', note: 'último registro em 01/01/2026' },
      ],
    });
  });

  it('saves a note with the diagnosis and leaves it out when empty', async () => {
    const user = userEvent.setup();
    open('diagnoses');
    await user.type(screen.getByLabelText('Observação (opcional)'), 'desde 2019, em uso de anticoncepcional');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.updates).toHaveLength(1));
    expect(api.updates[0].patch).toEqual({
      diagnoses: [{ code: 'N94.6', description: 'Dismenorreia', note: 'desde 2019, em uso de anticoncepcional' }],
    });
  });

  it('removes an entry only after confirmation', async () => {
    const user = userEvent.setup();
    open('allergies');
    await user.click(screen.getByRole('button', { name: 'Remover Dipirona' }));
    await user.click(screen.getByRole('button', { name: 'Remover' }));
    expect(screen.queryByLabelText('Alergia')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhuma alergia registrada.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.updates[0]?.patch).toEqual({ allergies: [] }));
  });

  it('keeps the edit and shows the saved list when the chart changed elsewhere', async () => {
    const user = userEvent.setup();
    api.updateResult = { data: null, error: null };
    const onOpenChange = open('allergies');
    await user.type(screen.getByLabelText('Alergia'), ' sódica');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('alterado em outra tela');
    expect(screen.getByText(/Lista atual salva:/).parentElement).toHaveTextContent('Látex');
    expect(screen.getByLabelText('Alergia')).toHaveValue('Dipirona sódica');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Saving again uses the revision that was just shown.
    api.updateResult = { data: { id: 'patient-A' }, error: null };
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.updates[1].filters).toContainEqual(['revision', 8]);
  });
});
