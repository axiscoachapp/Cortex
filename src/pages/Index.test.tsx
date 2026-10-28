import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Index from './Index';
import { UnsavedChangesRouteGuard } from '@/hooks/useUnsavedChanges';
import {useEffect} from 'react';

const fixture = vi.hoisted(() => ({
  rows: ['A', 'B'].map(id => ({ id, name: `Patient ${id}`, revision:0, age: 30, profession: '', status: 'retorno', last_visit: '2026-10-27' })),
  invoke: vi.fn(),
  toast: vi.fn(),
  signOut: vi.fn(),
  chatMount:vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' }, loading: false, signOut: fixture.signOut }) }));
vi.mock('@/hooks/useSeedPatients', () => ({ useSeedPatients: () => {} }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: async () => ({data:{patients:fixture.rows,counts:{total:fixture.rows.length,new:0,returns:fixture.rows.length}},error:null}),
  functions: { invoke: fixture.invoke },
  from: () => {
    let requestedId:string|undefined;
    const query = {
      select: () => query, order: () => query, update: () => query,
      eq: (_key:string,id:string) => {requestedId=id;return query;},
      limit:async()=>({data:fixture.rows,error:null}),
      single:async()=>({data:fixture.rows.find(row=>row.id===requestedId),error:null}),
      range: async (from: number, to: number) => ({ data: fixture.rows.slice(from, to + 1), error: null }),
      then: (done: (v: { data: typeof fixture.rows; error: null }) => void) => Promise.resolve({ data: fixture.rows, error: null }).then(done),
    };
    return query;
  },
} }));
vi.mock('@/components/PatientSidebar', () => ({ PatientSidebar: ({ patients, onSelectPatient, onHome, onNavigate }) => <aside>
  {patients.map(p => <button key={p.id} onClick={() => onSelectPatient(p)}>Select {p.id}</button>)}
  <button onClick={onHome}>Home</button>
  <button onClick={()=>onNavigate('/agenda')}>Agenda</button>
</aside> }));
vi.mock('@/components/WelcomeDashboard', () => ({ WelcomeDashboard: () => <h1>Dashboard</h1> }));
vi.mock('@/components/PatientSnapshot', () => ({ PatientSnapshot: () => null }));
vi.mock('@/components/ChatPanel', () => ({ ChatPanel: ({ patient, preBriefing, briefingError, onCaptureStateChange }) => {useEffect(()=>{fixture.chatMount();},[]);return <div><h1>{patient.name}</h1><p>{preBriefing?.returnInfo}</p>{briefingError && <p role="alert">Resumo indisponível</p>}<button onClick={()=>onCaptureStateChange(true)}>Capture fixture</button></div>;} }));
vi.mock('@/components/NewConsultationModal', () => ({ NewConsultationModal: ({ onStartConsultation }) => <button onClick={() => onStartConsultation('B', undefined, 'B complaint')}>Start B</button> }));

beforeEach(() => {
  fixture.invoke.mockReset();
  fixture.chatMount.mockClear();
  fixture.toast.mockClear(); fixture.signOut.mockReset(); fixture.rows.forEach(row=>{row.revision=0;});
  fixture.invoke.mockImplementation(async (_name, { body }) => ({ data: { returnInfo: `Briefing ${body.patientId}`, previousComplaint:'', pending:'', alert:'' }, error: null }));
  window.matchMedia = vi.fn().mockReturnValue({ addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

function setup(entry = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ element:<><UnsavedChangesRouteGuard /><Outlet /></>,children:[{ path: '/', element: <Index /> },{path:'/agenda',element:<h1>Agenda page</h1>}]}], { initialEntries: [entry] });
  return {...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>),client,router};
}

describe('patient activation', () => {
  it('does not remount capture when the current patient is selected again',async()=>{
    setup();const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Select A'}));await screen.findByText('Briefing A');
    await user.click(screen.getByRole('button',{name:'Capture fixture'}));await user.click(screen.getByRole('button',{name:'Select A'}));
    expect(fixture.chatMount).toHaveBeenCalledTimes(1);expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });
  it('keeps the selected patient and URL aligned after a directory refresh', async () => {
    const {client, router} = setup('/?patient=A');
    await screen.findByRole('heading', {name: 'Patient A'});
    await userEvent.click(screen.getByRole('button', {name: 'Select B'}));
    await screen.findByRole('heading', {name: 'Patient B'});
    fixture.rows[0].revision++;
    await act(() => client.invalidateQueries({queryKey: ['patients']}));
    expect(screen.getByRole('heading', {name: 'Patient B'})).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get('patient')).toBe('B');
  });
  it('blocks route exit and logout until captured audio is saved', async()=>{
    setup(); const user=userEvent.setup();
    await user.click(await screen.findByRole('button',{name:'Select A'}));
    await user.click(screen.getByRole('button',{name:'Capture fixture'}));
    await user.click(screen.getByRole('button',{name:'Agenda'}));
    expect(screen.queryByRole('heading',{name:'Agenda page'})).not.toBeInTheDocument();
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Gravação ainda não salva'}));
    await user.click(screen.getAllByRole('button',{name:'Sair'})[0]);
    expect(fixture.signOut).not.toHaveBeenCalled();
  });
  it('refreshes the selected briefing after a clinical revision changes',async()=>{
    const {client}=setup(); const user=userEvent.setup();
    await user.click(await screen.findByRole('button',{name:'Select A'}));
    await screen.findByText('Briefing A');
    fixture.rows[0].revision=1;
    await act(()=>client.invalidateQueries({queryKey:['patients']}));
    await waitFor(()=>expect(fixture.invoke).toHaveBeenCalledTimes(2));
  });
  it('reports logout failure without claiming the session ended',async()=>{
    fixture.signOut.mockRejectedValueOnce(new Error('offline'));
    setup(); await screen.findByRole('heading',{name:'Dashboard'}); await userEvent.click(screen.getAllByRole('button',{name:'Sair'})[0]);
    await waitFor(()=>expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Não foi possível sair da conta'})));
  });
  it('passes an explicit error state when a briefing response fails', async () => {
    fixture.invoke.mockResolvedValueOnce({data:null,error:new Error('offline')});
    setup();
    await userEvent.click(await screen.findByRole('button',{name:'Select A'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resumo indisponível');
  });
  it('loads B’s own briefing when starting a consultation after viewing A', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select A' }));
    await screen.findByText('Briefing A');
    await user.click(screen.getByRole('button', { name: 'Start B' }));
    await screen.findByRole('heading', { name: 'Patient B' });
    await waitFor(() => expect(screen.queryByText('Briefing A')).not.toBeInTheDocument());
    await screen.findByText('Briefing B');
  });

  it('returns to the dashboard using desktop Home', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select A' }));
    await screen.findByRole('heading', { name: 'Patient A' });
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
