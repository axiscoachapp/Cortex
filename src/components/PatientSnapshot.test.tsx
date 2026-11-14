import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientSnapshot } from './PatientSnapshot';
import { allergyLabel } from '@/lib/allergyLabel';
import type { Patient } from '@/types/patient';

const api = vi.hoisted(() => ({ invoke: vi.fn(), readNotes: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: api.invoke },
  from: () => ({ select: () => ({ eq: () => ({ single: api.readNotes }) }) }),
} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('./PatientProfileDrawer', () => ({ PatientProfileDrawer: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const patient = (id: string): Patient => ({ id, name: id, age: 30, profession: '', lastVisit: '2026-10-27', status: 'retorno', diagnoses: [], medications: [], allergies: [] });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: string) => <QueryClientProvider client={queryClient}><PatientSnapshot patient={patient(id)} /></QueryClientProvider>;
  return { ...render(view('A')), view, queryClient };
}

beforeEach(() => {
  api.readNotes.mockReset().mockResolvedValue({ data: { clinical_notes: '' }, error: null });
});

describe('patient note ownership', () => {
  it('hides saved annotations after a read failure while retaining the extraction draft', async () => {
    api.readNotes.mockResolvedValue({ data: { clinical_notes: 'Anotação sintética salva' }, error: null });
    const { queryClient } = setup();
    await screen.findByText('Anotação sintética salva');
    await userEvent.type(screen.getByRole('textbox'), 'Rascunho sintético para extrair');
    api.readNotes.mockResolvedValue({ data: null, error: new Error('offline') });
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['patient-clinical-notes', 'A'] }); });
    await screen.findByRole('alert');
    expect(screen.queryByText('Anotação sintética salva')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Rascunho sintético para extrair');
    api.readNotes.mockResolvedValue({ data: { clinical_notes: 'Anotação sintética atualizada' }, error: null });
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Anotação sintética atualizada')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Rascunho sintético para extrair');
  });

  it('keeps each draft attached to its originating patient', async () => {
    const user = userEvent.setup();
    const { rerender, view } = setup();
    const input = () => screen.getByRole('textbox');
    await user.type(input(), 'Notes for A');
    rerender(view('B'));
    expect(input()).toHaveValue('');
    rerender(view('A'));
    expect(input()).toHaveValue('Notes for A');
  });

  it('does not let a late success for A erase B’s draft', async () => {
    let complete: (result: { data: { message: string }; error: null }) => void;
    api.invoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const user = userEvent.setup();
    const { rerender, view } = setup();
    await user.type(screen.getByRole('textbox'), 'Notes for A');
    await user.click(screen.getByRole('button', { name: 'Processar com IA' }));
    rerender(view('B'));
    await user.type(screen.getByRole('textbox'), 'Notes for B');
    complete!({ data: { message: 'Saved A' }, error: null });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Notes for B'));
  });
  it('opens an editor for allergies, diagnoses and medications without the AI', async () => {
    const user = userEvent.setup();
    setup();
    for (const [button, title] of [
      ['Editar alergias', 'Editar alergias'],
      ['Editar diagnósticos', 'Editar diagnósticos'],
      ['Editar medicações', 'Editar medicações'],
    ]) {
      await user.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByRole('dialog', { name: title })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
  });
  it('shows when a diagnosis and a medication were recorded, under each of them', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PatientSnapshot
          patient={{
            ...patient('A'),
            diagnoses: [{ code: '', description: 'Osteopenia', note: 'desde 05/2021 · último registro em 19/06/2026' }],
            medications: [{ name: 'Estradiol gel', dosage: '', instructions: '1 pressão ao dia', note: 'último registro em 19/06/2026' }],
          }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Osteopenia')).toBeInTheDocument();
    expect(screen.getByText('desde 05/2021 · último registro em 19/06/2026')).toBeInTheDocument();
    // No dose: the line starts with the instructions, not with a loose separator.
    expect(screen.getByText('1 pressão ao dia')).toBeInTheDocument();
    expect(screen.getByText('último registro em 19/06/2026')).toBeInTheDocument();
  });
  it('names an intolerance as an intolerance and everything else as an allergy', () => {
    expect(allergyLabel('Dipirona')).toBe('Alergia a Dipirona');
    expect(allergyLabel('Nitrofurantoína (falta de ar)')).toBe('Alergia a Nitrofurantoína (falta de ar)');
    expect(allergyLabel('Lactose (intolerância)')).toBe('Intolerância a Lactose');
    expect(allergyLabel('Medicamento sintético (intolerância: obstipação)')).toBe('Intolerância a Medicamento sintético (obstipação)');
  });
  it('keeps AI insights as a suggestion to review after the note is saved', async () => {
    api.invoke.mockResolvedValueOnce({ data: { saved: true, insights: { summary: 'Resumo sintético' }, message: 'Anotação salva.' }, error: null });
    const user = userEvent.setup();
    const { queryClient } = setup();
    await user.type(screen.getByRole('textbox'), 'Nota sintética');
    await user.click(screen.getByRole('button', { name: 'Processar com IA' }));
    expect(await screen.findByRole('button', { name: 'Revisar sugestões' })).toBeInTheDocument();
    expect(screen.getByText(/Nada foi gravado no perfil/)).toBeInTheDocument();
    expect(queryClient.getQueryData(['ai-insights-proposal', 'A', 'doctor'])).toMatchObject({ insights: { summary: 'Resumo sintético' } });
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('saves the note without a suggestion when the AI returns none', async () => {
    api.invoke.mockResolvedValueOnce({ data: { saved: true, insights: null, message: 'Anotação salva. A IA está indisponível.' }, error: null });
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox'), 'Nota sintética');
    await user.click(screen.getByRole('button', { name: 'Processar com IA' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(screen.queryByRole('button', { name: 'Revisar sugestões' })).not.toBeInTheDocument();
  });
});
