import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import type { WorkEntry } from '@/lib/clinicalWorkspace';
import { PatientWorkspaceDialog } from './PatientWorkspaceDialog';

const fixture = vi.hoisted(() => ({ actor: 'doctor-A', denied: false, allowExit: true, requests: [] as Array<{table: string; filters: Record<string,string>; signal?: AbortSignal}> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: fixture.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const request: typeof fixture.requests[number] = { table, filters: {} };
  const q = {
    select: () => q, eq: (key: string, value: string) => { request.filters[key] = value; return q; },
    is: () => q, in: () => q, order: () => q, limit: () => q,
    abortSignal: (signal: AbortSignal) => { request.signal = signal; return q; }, single: () => q,
    then: (done: (value: unknown) => void) => {
      fixture.requests.push(request);
      const patient = request.filters.patient_id ?? request.filters.id;
      const data = table === 'patients' ? { id: patient, name: `Patient ${patient}` } : table === 'clinical_work_items'
        ? [{ id: 'item-' + patient, user_id: fixture.actor, patient_id: patient, kind: 'task', status: 'open', title: `Task ${patient}`, content: '', revision: 1, updated_at: '2026-11-06T12:00:00Z', details: {} }] : [];
      return Promise.resolve({ data: fixture.denied ? null : data, error: fixture.denied ? new Error('denied') : null }).then(done);
    },
  }; return q;
} } }));
vi.mock('@/components/ClinicalWorkEditor', () => ({ ClinicalWorkEditor: ({ patientId, userId, appointmentId, initialTitle, entry, onExitGuardChange }) => {
  useEffect(() => { onExitGuardChange?.(() => fixture.allowExit); }, [onExitGuardChange]);
  return <div data-testid="work-editor">{userId}/{patientId}/{appointmentId}/{initialTitle}/{entry}</div>;
} }));

beforeEach(() => { fixture.actor = 'doctor-A'; fixture.denied = false; fixture.allowExit = true; fixture.requests = []; });
function setup(patientId = 'A', manual = false, entry?: WorkEntry) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const view = (id: string) => <QueryClientProvider client={client}><MemoryRouter><PatientWorkspaceDialog patientId={id} manual={manual} entry={entry} appointmentId="appointment-A" initialTitle="Synthetic complaint" onClose={onClose} /></MemoryRouter></QueryClientProvider>;
  return { ...render(view(patientId)), view, client, onClose };
}
describe('patient workspace in the patient page', () => {
  it.each(['instruction','followup'] as const)('opens %s only after checking the private patient',async entry=>{
    setup('A',false,entry);expect(await screen.findByTestId('work-editor')).toHaveTextContent('/'+entry);
    expect(fixture.requests[0].filters).toEqual({id:'A',user_id:'doctor-A'});
  });
  it('does not mount a direct-entry editor when current ownership is denied',async()=>{
    fixture.denied=true;setup('A',false,'instruction');await screen.findByText(/Paciente indisponível ou sem acesso/);expect(screen.queryByTestId('work-editor')).not.toBeInTheDocument();
  });
  it('reads only the selected private patient and reuses the manual encounter context', async () => {
    setup('A', true);
    expect(await screen.findByTestId('work-editor')).toHaveTextContent('doctor-A/A/appointment-A/Synthetic complaint');
    expect(await screen.findByText('Task A')).toBeVisible();
    expect(fixture.requests.map(r => r.table)).toEqual(['patients', 'clinical_work_items']);
    expect(fixture.requests[0].filters).toEqual({ id: 'A', user_id: 'doctor-A' });
    expect(fixture.requests[1].filters).toMatchObject({ patient_id: 'A', user_id: 'doctor-A' });
    expect(fixture.requests.every(r => r.signal instanceof AbortSignal)).toBe(true);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Consulta e documentos' })).not.toBeInTheDocument();
  });
  it('keeps the panel open when the editor refuses an exit', async () => {
    const { onClose } = setup('A', true);
    await screen.findByTestId('work-editor'); fixture.allowExit = false;
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).not.toHaveBeenCalled();
    fixture.allowExit = true;
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('remounts the editor on patient and actor changes', async () => {
    const { rerender, view } = setup('A', true);
    await screen.findByTestId('work-editor');
    rerender(view('B'));
    await waitFor(() => expect(screen.getByTestId('work-editor')).toHaveTextContent('doctor-A/B/'));
    expect(screen.queryByText('Task A')).not.toBeInTheDocument();
    fixture.actor = 'doctor-B'; rerender(view('B'));
    await waitFor(() => expect(screen.getByTestId('work-editor')).toHaveTextContent('doctor-B/B/'));
    expect(fixture.requests.at(-1)?.filters.user_id).toBe('doctor-B');
  });
  it('freshly checks ownership on reopening and hides cached records on denial', async () => {
    const { rerender, view } = setup(); await screen.findByText('Task A');
    rerender(<div />); fixture.denied = true; rerender(view('A'));
    expect(screen.queryByText('Task A')).not.toBeInTheDocument();
    expect(await screen.findByText(/Paciente indisponível ou sem acesso/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Novo registro' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('work-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Patient A' })).not.toBeInTheDocument();
  });
  it('scopes consultation history and revision requests to the actor and patient', async () => {
    setup(); await screen.findByText('Task A');
    fireEvent.click(screen.getByRole('button', { name: 'Linha do tempo' }));
    await screen.findByText('Sem consultas registradas.');
    expect(fixture.requests.find(r => r.table === 'consultations')?.filters).toEqual({ patient_id: 'A', user_id: 'doctor-A' });
    fireEvent.click(screen.getByRole('button', { name: 'Registros e acompanhamento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver versões' }));
    await waitFor(() => expect(fixture.requests.some(r => r.table === 'clinical_work_revisions')).toBe(true));
    expect(fixture.requests.find(r => r.table === 'clinical_work_revisions')?.filters).toEqual({ user_id: 'doctor-A', item_id: 'item-A' });
  });
});
