import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Index from './Index';
import { UnsavedChangesRouteGuard } from '@/hooks/useUnsavedChanges';
import { useEffect } from 'react';
import { SHELL_BREAKPOINT } from '@/lib/interfaceScale';

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
afterEach(() => { if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth); });

// matchMedia uses layout width, which can be fractional under browser zoom.
// innerWidth is an integer; query changes fire only across the query boundary.
function desktopViewport(start: number) {
  let width = start;
  const queries: Array<{ query: string; matches: boolean; listeners: Set<(event: MediaQueryListEvent) => void> }> = [];
  const matches = (query: string) => {
    const rule = /^\((min|max)-width:\s*([\d.]+)px\)$/.exec(query);
    if (!rule) throw new Error('Unsupported test query: ' + query);
    return rule[1] === 'min' ? width >= Number(rule[2]) : width <= Number(rule[2]);
  };
  window.matchMedia = (query: string) => {
    const entry = { query, matches: matches(query), listeners: new Set<(event: MediaQueryListEvent) => void>() };
    queries.push(entry);
    return {
      media: query, get matches() { return matches(query); },
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => entry.listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => entry.listeners.delete(listener),
    } as unknown as MediaQueryList;
  };
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => Math.floor(width) });
  return (next: number) => act(() => {
    width = next;
    for (const entry of queries) {
      const current = matches(entry.query);
      if (current === entry.matches) continue;
      entry.matches = current;
      entry.listeners.forEach(listener => listener({ matches: current, media: entry.query } as MediaQueryListEvent));
    }
  });
}

const fixture = vi.hoisted(() => ({
  rows: ['A', 'B'].map((id) => ({
    id,
    name: `Patient ${id}`,
    revision: 0,
    age: 30,
    profession: '',
    status: 'retorno',
    last_visit: '2026-10-27',
  })),
  invoke: vi.fn(),
  toast: vi.fn(),
  signOut: vi.fn(),
  chatMount: vi.fn(),
  update: vi.fn(),
  workspaceExit: true,
  patientFailure: false,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'doctor' }, loading: false, signOut: fixture.signOut }),
}));
vi.mock('@/hooks/useSeedPatients', () => ({ useSeedPatients: () => {} }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: async (name: string) => ({
      data: name === 'list_patient_chat_turns' ? [] : { patients: fixture.rows, counts: { total: fixture.rows.length, new: 0, returns: fixture.rows.length } },
      error: null,
    }),
    functions: { invoke: fixture.invoke },
    from: () => {
      let requestedId: string | undefined;
      const query = {
        select: () => query,
        order: () => query,
        update: (patch: unknown) => { fixture.update(patch); return query; },
        eq: (_key: string, id: string) => {
          requestedId = id;
          return query;
        },
        limit: async () => ({ data: fixture.rows, error: null }),
        single: async () => ({ data: fixture.patientFailure ? null : [...fixture.rows,{...fixture.rows[0],id:'outside',name:'Patient outside'}].find((row) => row.id === requestedId), error: fixture.patientFailure ? new Error('Unavailable') : null }),
        range: async (from: number, to: number) => ({ data: fixture.rows.slice(from, to + 1), error: null }),
        then: (done: (v: { data: typeof fixture.rows; error: null }) => void) =>
          Promise.resolve({ data: fixture.rows, error: null }).then(done),
      };
      return query;
    },
  },
}));
vi.mock('@/components/PatientSidebar', () => ({
  PatientSidebar: ({ patients, onSelectPatient, onHome, onNavigate }) => (
    <aside>
      {patients.map((p) => (
        <button key={p.id} onClick={() => onSelectPatient(p)}>
          Select {p.id}
        </button>
      ))}
      <button onClick={onHome}>Home</button>
      <button onClick={() => onNavigate('/agenda')}>Agenda</button>
      <button onClick={() => onSelectPatient(patients[0], 'appointment-A')}>Appointment A</button>
    </aside>
  ),
}));
vi.mock('@/components/WelcomeDashboard', () => ({ WelcomeDashboard: ({onResumeConsultation,onSignOut,openConsultation}) => <div><h1>Dashboard</h1><button onClick={onSignOut}>Sair da conta</button><button onClick={()=>onResumeConsultation('A')}>Resume A</button><button onClick={()=>onResumeConsultation('outside')}>Resume outside</button>{openConsultation && <button onClick={openConsultation.onReturn}>Voltar à consulta de {openConsultation.name}</button>}</div> }));
vi.mock('@/components/PatientSnapshot', () => ({ PatientSnapshot: ({ profileRequest }) => <p>profile-request:{String(profileRequest ?? 0)}</p> }));
vi.mock('@/components/ChatPanel', () => ({
  ChatPanel: ({ patient, preBriefing, briefingError, onCaptureStateChange, onRetryBriefing, onOpenPatientWork, onOpenPatientPanel }) => {
    useEffect(() => {
      fixture.chatMount();
    }, []);
    return (
      <div>
        <h1>{patient.name}</h1>
        <p>{preBriefing?.returnInfo}</p>
        <button onClick={onRetryBriefing}>Gerar resumo com IA</button>
        {briefingError && <p role="alert">Resumo indisponível</p>}
        <button onClick={() => onCaptureStateChange(true)}>Capture fixture</button>
        <button onClick={() => onOpenPatientWork(true)}>Manual fixture</button>
        <button onClick={() => onOpenPatientWork(false)}>Work fixture</button>
        <button onClick={onOpenPatientPanel}>Safety row fixture</button>
      </div>
    );
  },
}));
vi.mock('@/components/PatientWorkspaceDialog', () => ({
  PatientWorkspaceDialog: ({ patientId, manual, appointmentId, initialTitle, onClose, onExitGuardChange }) => {
    useEffect(() => { onExitGuardChange(() => fixture.workspaceExit); }, [onExitGuardChange]);
    return <div role="dialog"><p>{JSON.stringify({ patientId, manual, appointmentId, initialTitle })}</p><button onClick={onClose}>Close work fixture</button></div>;
  },
}));
vi.mock('@/components/NewConsultationModal', () => ({
  NewConsultationModal: ({ onStartConsultation }) => (
    <button onClick={() => onStartConsultation('B', undefined, 'B complaint')}>Start B</button>
  ),
}));

beforeEach(() => {
  fixture.workspaceExit = true;
  fixture.patientFailure = false;
  fixture.invoke.mockReset();
  fixture.chatMount.mockClear();
  fixture.update.mockClear();
  fixture.toast.mockClear();
  fixture.signOut.mockReset();
  fixture.rows.forEach((row) => {
    row.revision = 0;
  });
  fixture.invoke.mockImplementation(async (_name, { body }) => ({
    data: { returnInfo: `Briefing ${body.patientId}`, previousComplaint: '', pending: '', alert: '' },
    error: null,
  }));
  window.matchMedia = vi.fn().mockReturnValue({ addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

function setup(entry = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <UnsavedChangesRouteGuard />
            <Outlet />
          </>
        ),
        children: [
          { path: '/', element: <Index /> },
          { path: '/agenda', element: <h1>Agenda page</h1> },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  return {
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    client,
    router,
  };
}

describe('patient activation', () => {
  it('retries a notice after the first patient activation fails', async () => {
    setup(); await screen.findByRole('heading',{name:'Dashboard'});
    fixture.patientFailure=true;
    await userEvent.click(screen.getByRole('button',{name:'Resume outside'}));
    await waitFor(()=>expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Paciente indisponível'})));
    await screen.findByRole('heading',{name:'Dashboard'});
    fixture.patientFailure=false;
    await userEvent.click(screen.getByRole('button',{name:'Resume outside'}));
    expect(await screen.findByRole('heading',{name:'Patient outside'})).toBeVisible();
  });
  it('resumes the already-selected patient from Home and preserves its appointment', async () => {
    const {router}=setup('/?patient=A');
    await screen.findByRole('heading',{name:'Patient A'});
    await userEvent.click(screen.getByRole('button',{name:'Appointment A'}));
    await userEvent.click(screen.getByRole('button',{name:'Home'}));
    await screen.findByRole('heading',{name:'Dashboard'});
    await userEvent.click(screen.getByRole('button',{name:'Resume A'}));
    expect(screen.queryByRole('heading',{name:'Dashboard'})).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?patient=A');
    await userEvent.click(screen.getByRole('button',{name:'Manual fixture'}));
    expect(await screen.findByRole('dialog')).toHaveTextContent('"appointmentId":"appointment-A"');
  });
  it('resumes a patient outside the directory with exact identity and clears another patient appointment', async () => {
    const {router}=setup('/?patient=A');
    await screen.findByRole('heading',{name:'Patient A'});
    await userEvent.click(screen.getByRole('button',{name:'Appointment A'}));
    await userEvent.click(screen.getByRole('button',{name:'Home'}));
    await userEvent.click(screen.getByRole('button',{name:'Resume outside'}));
    await screen.findByRole('heading',{name:'Patient outside'});
    expect(router.state.location.search).toBe('?patient=outside');
    await userEvent.click(screen.getByRole('button',{name:'Manual fixture'}));
    expect(await screen.findByRole('dialog')).toHaveTextContent(JSON.stringify({patientId:'outside',manual:true,initialTitle:''}));
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('opens work in the same chart and carries the exact appointment without remounting capture', async () => {
    const { router } = setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Appointment A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Manual fixture' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(JSON.stringify({ patientId: 'A', manual: true, appointmentId: 'appointment-A', initialTitle: '' }));
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('?patient=A');
    expect(fixture.chatMount).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Close work fixture' }));
    await userEvent.click(screen.getByRole('button', { name: 'Work fixture' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('"manual":false');
  });
  it('blocks patient switch and logout while the patient editor refuses exit', async () => {
    const { router } = setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Manual fixture' }));
    await screen.findByRole('dialog'); fixture.workspaceExit = false;
    await userEvent.click(screen.getByRole('button', { name: 'Select B' }));
    expect(router.state.location.search).toBe('?patient=A');
    await userEvent.click(screen.getAllByRole('button', { name: 'Sair' })[0]);
    expect(fixture.signOut).not.toHaveBeenCalled();
    fixture.workspaceExit = true;
    await userEvent.click(screen.getByRole('button', { name: 'Select B' }));
    await screen.findByRole('heading', { name: 'Patient B' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('carries the complaint without placing it in the URL', async () => {
    const { router } = setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Start B' }));
    await screen.findByRole('heading', { name: 'Patient B' });
    await userEvent.click(screen.getByRole('button', { name: 'Manual fixture' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('"initialTitle":"B complaint"');
    expect(router.state.location.search).toBe('?patient=B');
  });
  it('opens a chart without changing status or generating a paid briefing', async () => {
    setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('does not remount capture when the current patient is selected again', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select A' }));
    await user.click(await screen.findByRole('button', { name: 'Gerar resumo com IA' }));
    await screen.findByText('Briefing A');
    await user.click(screen.getByRole('button', { name: 'Capture fixture' }));
    await user.click(screen.getByRole('button', { name: 'Select A' }));
    expect(fixture.chatMount).toHaveBeenCalledTimes(1);
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });
  it('keeps the selected patient and URL aligned after a directory refresh', async () => {
    const { client, router } = setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Select B' }));
    await screen.findByRole('heading', { name: 'Patient B' });
    fixture.rows[0].revision++;
    await act(() => client.invalidateQueries({ queryKey: ['patients'] }));
    expect(screen.getByRole('heading', { name: 'Patient B' })).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get('patient')).toBe('B');
  });
  it('blocks route exit and logout until captured audio is saved', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select A' }));
    await user.click(screen.getByRole('button', { name: 'Capture fixture' }));
    await user.click(screen.getByRole('button', { name: 'Agenda' }));
    expect(screen.queryByRole('heading', { name: 'Agenda page' })).not.toBeInTheDocument();
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Gravação ainda não salva' }));
    await user.click(screen.getAllByRole('button', { name: 'Sair' })[0]);
    expect(fixture.signOut).not.toHaveBeenCalled();
  });
  it('keeps capture mounted and guarded when using the homepage agenda shortcut', async () => {
    const { router } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select A' }));
    await user.click(screen.getByRole('button', { name: 'Capture fixture' }));
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Navegação do consultório' })).getByRole('button', { name: 'Agenda' }));
    expect(router.state.location.pathname).toBe('/');
    expect(fixture.chatMount).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Sair da conta' }));
    expect(fixture.signOut).not.toHaveBeenCalled();
  });
  it('invalidates an outdated briefing without automatically spending again', async () => {
    const { client } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select A' }));
    await user.click(await screen.findByRole('button', { name: 'Gerar resumo com IA' }));
    await screen.findByText('Briefing A');
    fixture.rows[0].revision = 1;
    await act(() => client.invalidateQueries({ queryKey: ['patients'] }));
    await waitFor(() => expect(screen.queryByText('Briefing A')).not.toBeInTheDocument());
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Gerar resumo com IA' }));
    await waitFor(() => expect(fixture.invoke).toHaveBeenCalledTimes(2));
  });
  it('reports logout failure without claiming the session ended', async () => {
    fixture.signOut.mockRejectedValueOnce(new Error('offline'));
    setup();
    await screen.findByRole('heading', { name: 'Dashboard' });
    await userEvent.click(screen.getByRole('button', { name: 'Sair da conta' }));
    await waitFor(() =>
      expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Não foi possível sair da conta' })),
    );
  });
  it('passes an explicit error state when a briefing response fails', async () => {
    fixture.invoke.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Select A' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar resumo com IA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resumo indisponível');
  });
  it('loads B’s own briefing when starting a consultation after viewing A', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select A' }));
    await user.click(await screen.findByRole('button', { name: 'Gerar resumo com IA' }));
    await screen.findByText('Briefing A');
    await user.click(screen.getByRole('button', { name: 'Start B' }));
    await screen.findByRole('heading', { name: 'Patient B' });
    await waitFor(() => expect(screen.queryByText('Briefing A')).not.toBeInTheDocument());
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Gerar resumo com IA' }));
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

// The three-column consultation follows the desktop frame (Tailwind `shell`,
// SHELL_BREAKPOINT real pixels), not the 1.35-scaled xl screen.
describe('desktop layout at the desktop-frame breakpoint, including fractional widths', () => {
  it('widens from the fractional gap without keeping the compact dashboard or remounting capture', async () => {
    const resize = desktopViewport(SHELL_BREAKPOINT - 0.5);
    const { router } = setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Perfil' }));
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    resize(SHELL_BREAKPOINT + 192);
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
    expect(new URLSearchParams(router.state.location.search).get('patient')).toBe('A');
    expect(fixture.chatMount).toHaveBeenCalledTimes(1);
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it('narrows into the fractional gap and crosses the exact breakpoint in both directions', async () => {
    const resize = desktopViewport(SHELL_BREAKPOINT + 192);
    setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Perfil' }));
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    resize(SHELL_BREAKPOINT - 0.5);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    resize(SHELL_BREAKPOINT);
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    resize(SHELL_BREAKPOINT - 1);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(fixture.chatMount).toHaveBeenCalledTimes(1);
  });
});

describe('patient panel and the way back to the consultation (phone and tablet)', () => {
  it('the Perfil tab shows the patient panel only; the full profile opens from "Perfil completo"', async () => {
    setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Perfil' }));
    expect(screen.getByRole('button', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('profile-request:0')).toBeInTheDocument();
  });

  it('the safety row under the name opens the patient panel', async () => {
    setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Safety row fixture' }));
    expect(screen.getByRole('button', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
  });

  it('Início keeps a "Voltar à consulta" while a patient is open', async () => {
    setup('/?patient=A');
    await screen.findByRole('heading', { name: 'Patient A' });
    await userEvent.click(screen.getByRole('button', { name: 'Início' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar à consulta de Patient A' }));
    expect(screen.getByRole('button', { name: 'Consulta' })).toHaveAttribute('aria-current', 'page');
    expect(fixture.chatMount).toHaveBeenCalledTimes(1);
  });
});

