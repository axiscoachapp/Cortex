import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationRecoveryNotice } from './ConsultationRecoveryNotice';

const fixture = vi.hoisted(() => ({ requests: [] as Array<{select?: string; filters: Record<string, unknown>; signal?: AbortSignal; limit?: number}>, rows: [] as unknown[], fail: false, pending: null as Promise<unknown> | null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  if (table !== 'consultation_drafts') throw new Error('Unexpected table');
  const request: typeof fixture.requests[number] = { filters: {} };
  const q = {
    select: (value: string) => { request.select = value; return q; },
    eq: (key: string, value: string) => { request.filters[key] = value; return q; },
    is: (key: string, value: null) => { request.filters[key] = value; return q; },
    in: (key: string, value: string[]) => { request.filters[key] = value; return q; },
    order: () => q,
    limit: (value: number) => { request.limit = value; return q; },
    abortSignal: (value: AbortSignal) => { request.signal = value; return q; },
    then: (done: (value: unknown) => void) => {
      fixture.requests.push(request);
      return (fixture.pending ?? Promise.resolve({data: fixture.rows, error: fixture.fail ? new Error('Unavailable') : null})).then(done);
    },
  }; return q;
} } }));
const row = (id: string, status = 'error') => ({ id: 'draft-' + id, patient_id: id, status, updated_at: '2026-11-06T12:34:56.123456+00:00', patient: {id, name: 'Patient ' + id} });
beforeEach(() => { fixture.requests = []; fixture.rows = [row('A'), row('B', 'review'), row('C', 'processing')]; fixture.fail = false; fixture.pending = null; });
function setup() {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  const resume = vi.fn();
  const view = (userId = 'doctor-A') => <QueryClientProvider client={client}><ConsultationRecoveryNotice userId={userId} onResume={resume} /></QueryClientProvider>;
  return {...render(view()), view, client, resume};
}
describe('consultation recovery on Home', () => {
  it('reads bounded metadata for the actor and opens only the chosen patient without writes', async () => {
    const {resume} = setup();
    fireEvent.click(await screen.findByRole('button', {name:'Retomar consulta de Patient B'}));
    expect(resume).toHaveBeenCalledExactlyOnceWith('B');
    expect(screen.getByText('Aguardando revisão')).toBeVisible();
    expect(screen.getByText('Nova tentativa necessária')).toBeVisible();
    expect(screen.getByText('Processamento pendente')).toBeVisible();
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({filters:{user_id:'doctor-A',discard_requested_at:null,status:['processing','review','error']},limit:51});
    expect(fixture.requests[0].select).not.toMatch(/content|chief_complaint|audio_storage_path/);
    expect(fixture.requests[0].select).toContain('draft_patient_owner_fk');
    expect(fixture.requests[0].signal).toBeInstanceOf(AbortSignal);
  });
  it('hides old rows on refresh failure and permits explicit recovery', async () => {
    setup(); await screen.findByRole('button', {name:'Retomar consulta de Patient A'});
    fixture.fail = true;
    fireEvent.click(screen.getByRole('button', {name:'Atualizar consultas para retomar'}));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', {name:/Retomar consulta de/})).not.toBeInTheDocument();
    fixture.fail = false; fixture.rows = [row('D')];
    // One retry control in the error state.
    expect(screen.getAllByRole('button', {name:'Tentar novamente'})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', {name:'Tentar novamente'}));
    expect(await screen.findByRole('button', {name:'Retomar consulta de Patient D'})).toBeVisible();
    expect(screen.queryByText('Patient A')).not.toBeInTheDocument();
  });
  it('does not expose a previous actor while its old request finishes', async () => {
    let finish: (value: unknown) => void;
    fixture.pending = new Promise(resolve => {finish=resolve;});
    const {rerender,view}=setup();
    await waitFor(() => expect(fixture.requests).toHaveLength(1));
    fixture.pending=null; fixture.rows=[row('B')]; rerender(view('doctor-B'));
    await screen.findByRole('button', {name:'Retomar consulta de Patient B'});
    await act(async () => finish({data:[row('A')],error:null}));
    expect(screen.queryByRole('button',{name:'Retomar consulta de Patient A'})).not.toBeInTheDocument();
    expect(fixture.requests[0].signal.aborted).toBe(true);
    expect(fixture.requests[1].filters.user_id).toBe('doctor-B');
  });
  it('checks again on reopening without showing previously cached metadata', async () => {
    const {rerender,view}=setup(); await screen.findByRole('button',{name:'Retomar consulta de Patient A'});
    rerender(<div />); fixture.fail=true; rerender(view());
    expect(screen.queryByRole('button',{name:/Retomar consulta de/})).not.toBeInTheDocument();
    await screen.findByRole('alert');
    expect(fixture.requests).toHaveLength(2);
  });
  it('does not claim the list is empty when metadata or ownership is invalid', async () => {
    fixture.rows=[{...row('A'),patient:{id:'other',name:'Private other name'}}];
    setup(); await screen.findByRole('alert');
    expect(screen.queryByText('Private other name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Retomar consulta de/})).not.toBeInTheDocument();
  });
  it('shows fifty results with an explicit bound instead of claiming completeness', async () => {
    fixture.rows=Array.from({length:51},(_,index)=>row(String(index)));
    setup(); await screen.findAllByRole('button',{name:/Retomar consulta de/});
    expect(screen.getAllByRole('button',{name:/Retomar consulta de/})).toHaveLength(50);
    expect(screen.getByText(/50 consultas mais recentes/)).toBeVisible();
  });
  it('renders nothing during the first check, so Home does not jump on every load', async () => {
    let finish: (value: unknown) => void;
    fixture.pending = new Promise(resolve => {finish=resolve;});
    setup();
    await waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByText('Verificando consultas…')).not.toBeInTheDocument();
    await act(async () => finish({data:[row('A')],error:null}));
    expect(await screen.findByRole('button', {name:'Retomar consulta de Patient A'})).toBeVisible();
  });
  it('keeps Home uncluttered for an empty result and makes no request without an actor', async () => {
    fixture.rows=[]; const {rerender,view}=setup();
    await waitFor(()=>expect(fixture.requests).toHaveLength(1));
    await waitFor(()=>expect(screen.queryByRole('region')).not.toBeInTheDocument());
    rerender(view('')); expect(fixture.requests).toHaveLength(1);
  });
});
