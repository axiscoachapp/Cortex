import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SharingPage from './Sharing';
import type { SharedChart, SharingOverview } from '@/lib/sharing';
import { SharingError } from '@/lib/sharing';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn(), invoke: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useSearchParams: () => [new URLSearchParams()] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'recipient' } }) }));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: () => () => true }));
vi.mock('@/lib/sharing', async original => ({ ...await original<typeof import('@/lib/sharing')>(), sharingRpc: mocks.rpc }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke }, from: () => {
  const q = { select: () => q, eq: () => q, ilike: () => q, order: () => q, limit: async () => ({ data: [], error: null }) }; return q;
} } }));
const overview: SharingOverview = { memberships: [], members: [], granted: [], received: [
  { patient_id: 'a', name: 'Synthetic A', owner_name: 'Doctor A', permission: 'read', allow_download: false, revision: 1, expires_at: null },
  { patient_id: 'b', name: 'Synthetic B', owner_name: 'Doctor B', permission: 'contribute', allow_download: false, revision: 2, expires_at: null },
] };
const chart = (id: string, permission: SharedChart['permission'] = 'read'): SharedChart => ({
  permission, allow_download: false, authorization_revision: 2,
  patient: { id, name: `Chart ${id}`, age: null, allergies: [], medications: [], diagnoses: [], clinical_notes: `Sensitive ${id}`, medical_history: null, social_anamnesis: null },
  consultations: [], consultation_count: 0, entries: [], entry_count: 0, files: [], file_count: 0, prescriptions: [], structured_history: [], structured_history_count: 0,
});
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockImplementation(async (name, args) => name === 'sharing_overview' ? overview : name === 'get_shared_patient_chart' ? chart(args.p_patient_id, args.p_patient_id === 'b' ? 'contribute' : 'read') : 'entry-id'); });
afterEach(() => vi.restoreAllMocks());
describe('selective sharing workspace', () => {
  it('shows a received read-only chart without clinical editing or downloads', async () => {
    render(<SharingPage />);
    await screen.findByText('Synthetic A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
    await screen.findByText('Sensitive a');
    expect(screen.queryByRole('button', { name: 'Confirmar e registrar com autoria' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Baixar/ })).not.toBeInTheDocument();
    expect(screen.getByText('Não informada')).toBeInTheDocument();
  });
  it('saves exact reviewed text with attribution authorization version and retry identity', async () => {
    render(<SharingPage />);
    await screen.findByText('Synthetic B');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[1]);
    const editor = await screen.findByLabelText('Texto revisado pelo médico');
    fireEvent.change(editor, { target: { value: 'Exact physician text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar com autoria' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('append_shared_chart_entry', expect.objectContaining({ p_patient_id: 'b', p_content: 'Exact physician text', p_expected_authorization_revision: 2, p_request_id: expect.any(String) })));
    await waitFor(() => expect(screen.getByLabelText('Texto revisado pelo médico')).toHaveValue(''));
  });
  it('ignores a delayed chart result after switching to another patient', async () => {
    let resolveA!: (result: SharedChart) => void;
    mocks.rpc.mockImplementation(async (name, args) => name === 'sharing_overview' ? overview : args.p_patient_id === 'a' ? new Promise<SharedChart>(resolve => { resolveA = resolve; }) : chart('b'));
    render(<SharingPage />);
    await screen.findByText('Synthetic A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[1]);
    await screen.findByText('Sensitive b');
    await act(async () => resolveA(chart('a')));
    expect(screen.queryByText('Sensitive a')).not.toBeInTheDocument();
    expect(screen.getByText('Sensitive b')).toBeInTheDocument();
  });
  it('purges chart and pending contribution when a periodic access check reports revocation', async () => {
    let poll!: () => void;
    const originalInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation((callback, timeout, ...args) => {
      if (timeout !== 5000) return originalInterval(callback, timeout, ...args);
      poll = callback as () => void;
      return originalInterval(() => {}, 1_000_000);
    });
    render(<SharingPage />);
    await screen.findByText('Synthetic B');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[1]);
    fireEvent.change(await screen.findByLabelText('Texto revisado pelo médico'), { target: { value: 'Pending sensitive contribution' } });
    mocks.rpc.mockImplementation(async name => {
      if (name === 'check_shared_patient_access') throw new SharingError('Acesso revogado', '42501');
      return overview;
    });
    await act(async () => poll());
    await screen.findByRole('alert');
    expect(screen.queryByText('Sensitive b')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Texto revisado pelo médico')).not.toBeInTheDocument();
    mocks.rpc.mockImplementation(async name => name === 'sharing_overview' ? overview : chart('b', 'contribute'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByLabelText('Texto revisado pelo médico')).toHaveValue('');
  });
  it('removes revoked patient names from the overview even when no chart is open', async () => {
    let poll!: () => void;
    const originalInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation((callback, timeout, ...args) => {
      if (timeout !== 5000) return originalInterval(callback, timeout, ...args);
      poll = callback as () => void; return originalInterval(() => {}, 1_000_000);
    });
    render(<SharingPage />); await screen.findByText('Synthetic A');
    mocks.rpc.mockResolvedValue({ ...overview, received: [] });
    await act(async () => poll());
    await waitFor(() => expect(screen.queryByText('Synthetic A')).not.toBeInTheDocument());
    expect(screen.queryByText('Synthetic B')).not.toBeInTheDocument();
  });
  it('does not overlap slow authorization checks and purges data when the check times out', async () => {
    let poll!: () => void; let rejectCheck!: (reason: Error) => void;
    const originalInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation((callback, timeout, ...args) => {
      if (timeout !== 5000) return originalInterval(callback, timeout, ...args);
      poll = callback as () => void; return originalInterval(() => {}, 1_000_000);
    });
    render(<SharingPage />); await screen.findByText('Synthetic A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[0]); await screen.findByText('Sensitive a');
    mocks.rpc.mockImplementation(async name => name === 'check_shared_patient_access' ? new Promise((_, reject) => { rejectCheck = reject; }) : overview);
    await act(async () => { poll(); poll(); });
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'check_shared_patient_access')).toHaveLength(1);
    await act(async () => rejectCheck(new SharingError('Access could not be renewed', 'ACCESS_UNVERIFIED')));
    await screen.findByRole('alert');
    expect(screen.queryByText('Sensitive a')).not.toBeInTheDocument();
  });
  it('locks the submitted contribution text and type while saving', async () => {
    let resolveSave!: () => void;
    render(<SharingPage />); await screen.findByText('Synthetic B');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[1]);
    const editor = await screen.findByLabelText('Texto revisado pelo médico');
    fireEvent.change(editor, { target: { value: 'Exact pending text' } });
    mocks.rpc.mockImplementation(async name => name === 'append_shared_chart_entry' ? new Promise<void>(resolve => { resolveSave = resolve; }) : name === 'sharing_overview' ? overview : chart('b', 'contribute'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e registrar com autoria' }));
    expect(editor).toBeDisabled();
    expect(screen.getByLabelText('Tipo de registro')).toBeDisabled();
    await act(async () => resolveSave());
    await waitFor(() => expect(screen.getByLabelText('Texto revisado pelo médico')).toHaveValue(''));
  });
  it('shows attributed structured history and offers bounded additional records', async () => {
    const structuredChart = { ...chart('a'), structured_history_count: 51, structured_history: [{ id: 'observation', kind: 'observation', title: 'Approved observation', content: 'Physician-entered value', details: { date: '2026-10-28', value: '120', unit: 'mmHg', source: 'Consultation source' }, status: 'open', created_at: '2026-10-28T12:00:00Z', updated_at: '2026-10-28T12:00:00Z', author_user_id: 'owner', author_name: 'Responsible physician' }] };
    mocks.rpc.mockImplementation(async name => name === 'sharing_overview' ? overview : structuredChart);
    render(<SharingPage />); await screen.findByText('Synthetic A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir' })[0]);
    await screen.findByText('Histórico estruturado · 1 de 51');
    expect(screen.getByText('Responsible physician · 28/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Valor: 120 mmHg')).toBeInTheDocument();
    expect(screen.getByText(/Fonte: Consultation source/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais registros' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('get_shared_patient_chart', { p_patient_id: 'a', p_limit: 100 }));
    expect(screen.queryByRole('button', { name: 'Abrir registro' })).not.toBeInTheDocument();
  });
});
