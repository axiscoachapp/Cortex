import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PatientSnapshot } from './PatientSnapshot';
import type { Patient } from '@/types/patient';

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: api.invoke },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { clinical_notes: '' }, error: null }) }) }) }),
} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('./PatientProfileDrawer', () => ({ PatientProfileDrawer: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const patient = (id: string): Patient => ({ id, name: id, age: 30, profession: '', lastVisit: '2026-10-27', status: 'retorno', diagnoses: [], medications: [], allergies: [] });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: string) => <QueryClientProvider client={queryClient}><PatientSnapshot patient={patient(id)} /></QueryClientProvider>;
  return { ...render(view('A')), view };
}

describe('patient note ownership', () => {
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
});
