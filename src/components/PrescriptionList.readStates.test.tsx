import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetOperation, pendingOperation } from '@/lib/signatureClient';
import { PrescriptionList } from './PrescriptionList';

const mocks = vi.hoisted(() => ({
  read: vi.fn(), invoke: vi.fn(), sign: vi.fn(), rpc: vi.fn(), sessionRevoke: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'synthetic-owner' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      range: (from: number) => from ? Promise.resolve({ data: [], error: null }) : mocks.read(),
    };
    return query;
  },
  functions: { invoke: mocks.invoke },
  rpc: mocks.rpc,
} }));

const row = {
  id: 'synthetic-document', doc_type: 'receita_simples', status: 'generated', secret_code: 'SYNTHETIC-CODE',
  created_at: '2026-11-10', expires_at: '2099-01-01', issuance_verified_at: '2026-11-10',
  issuance_snapshot: { pdf_sha256: 'b'.repeat(64) },
};
const page = { data: [row], error: null };
const key = ['patient-prescriptions', 'synthetic-patient', 'synthetic-owner'];
type Reply = { data: unknown; error: unknown };
type Mode = 'fetching' | 'paused' | 'error';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(
    <MemoryRouter><QueryClientProvider client={client}>
      <PrescriptionList patientId="synthetic-patient" />
    </QueryClientProvider></MemoryRouter>,
  ), client };
}
const signCalls = () => mocks.invoke.mock.calls.filter(([name]) => name === 'sign-document');
const sessionRevokeCalls = () => mocks.invoke.mock.calls.filter(([name]) => name === 'signature-session/revoke');
const emptyMessage = 'Nenhum documento emitido por você para este paciente.';
async function loaded() { return screen.findByRole('button', { name: 'Assinar digitalmente' }); }
async function recovered(client: QueryClient) {
  await waitFor(() => expect(client.getQueryState(key)).toMatchObject({ status: 'success', fetchStatus: 'idle' }));
  await waitFor(() => expect(screen.getByText('Receita simples')).toBeVisible());
}

async function interruptRead(client: QueryClient, mode: Mode) {
  if (mode === 'error') {
    mocks.read.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_FAILURE'));
    await act(async () => { await client.invalidateQueries({ queryKey: key }); });
    await screen.findByRole('alert');
    let recovery: Promise<void> | undefined;
    return { recover: () => recovery ??= (async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      await recovered(client);
    })() };
  }
  const pending = deferred<typeof page>();
  mocks.read.mockReturnValueOnce(pending.promise);
  if (mode === 'paused') onlineManager.setOnline(false);
  let refresh!: Promise<void>;
  act(() => { refresh = client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe(mode));
  let recovery: Promise<void> | undefined;
  return { recover: () => recovery ??= (async () => {
    await act(async () => { pending.resolve(page); onlineManager.setOnline(true); await refresh; });
    await recovered(client);
  })() };
}

beforeEach(() => {
  vi.resetAllMocks();
  onlineManager.setOnline(true);
  localStorage.clear(); sessionStorage.clear();
  forgetOperation('synthetic-owner', row.id);
  mocks.read.mockResolvedValue(page);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.sign.mockResolvedValue({ data: { status: 'in_progress' }, error: null });
  mocks.sessionRevoke.mockResolvedValue({ data: { revoked: true }, error: null });
  mocks.invoke.mockImplementation(async (name: string) => {
    if (name === 'signature-session/state') return { data: { active: true, configured: true, expiresAt: '2099-01-01T12:00:00Z' }, error: null };
    if (name === 'sign-document') return mocks.sign();
    if (name === 'signature-session/revoke') return mocks.sessionRevoke();
    throw new Error(`Unexpected synthetic function: ${name}`);
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => { onlineManager.setOnline(true); vi.restoreAllMocks(); });

describe('document read states', () => {
  it('waits for a first offline read without claiming the doctor has no documents', async () => {
    onlineManager.setOnline(false);
    const { client } = mount();
    try {
      await waitFor(() => expect(client.getQueryState(key)).toMatchObject({ status: 'pending', fetchStatus: 'paused' }));
      expect(screen.getByRole('status')).toHaveTextContent('Aguardando conexão para carregar os documentos emitidos.');
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      await act(async () => { onlineManager.setOnline(true); });
      await loaded();
    }
  });

  it('shows absence only after the first pending read finishes successfully', async () => {
    const pending = deferred<{ data: typeof row[]; error: null }>();
    mocks.read.mockReturnValueOnce(pending.promise);
    const { client } = mount();
    try {
      await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('fetching'));
      expect(screen.getByRole('status')).toHaveTextContent('Carregando documentos emitidos…');
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    } finally { await act(async () => pending.resolve({ data: [], error: null })); }
    expect(await screen.findByText(emptyMessage)).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('withdraws the empty claim while a cached empty list waits for connection', async () => {
    mocks.read.mockResolvedValue({ data: [], error: null });
    const { client } = mount();
    await screen.findByText(emptyMessage);
    onlineManager.setOnline(false);
    let refresh!: Promise<void>;
    try {
      act(() => { refresh = client.invalidateQueries({ queryKey: key }); });
      await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('paused'));
      await waitFor(() => expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument(), { timeout: 1500 });
      expect(screen.getByRole('status')).toHaveTextContent(/aguardando conexão/i);
      expect(screen.getByRole('status')).toHaveTextContent(/última leitura/i);
    } finally { await act(async () => { onlineManager.setOnline(true); await refresh; }); }
    expect(await screen.findByText(emptyMessage)).toBeVisible();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each(['fetching', 'paused'] as const)('qualifies cached rows and disables new document commands during %s', async mode => {
    const { client } = mount();
    const sign = await loaded();
    const revoke = screen.getByRole('button', { name: 'Revogar documento' });
    const open = screen.getByRole('button', { name: 'Abrir documento' });
    const copy = screen.getByRole('button', { name: 'Copiar código de acesso' });
    const session = screen.getByRole('button', { name: 'Encerrar' });
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText');
    const interruption = await interruptRead(client, mode);
    try {
      await waitFor(() => expect(sign).toBeDisabled(), { timeout: 1500 });
      expect(screen.getByRole('status')).toHaveTextContent(/última leitura/i);
      expect(screen.getByText('Receita simples')).toBeVisible();
      for (const button of [sign, revoke, open, copy]) {
        expect(button.isConnected).toBe(true);
        expect(button).toBeDisabled();
        await user.click(button);
      }
      expect(screen.getByRole('button', { name: 'Assinar digitalmente' })).toBe(sign);
      expect(screen.getByRole('button', { name: 'Encerrar' })).toBe(session);
      expect(session).toBeEnabled();
      expect(signCalls()).toHaveLength(0);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
      expect(window.confirm).not.toHaveBeenCalled();
    } finally { await interruption.recover(); }
    expect(screen.getByRole('button', { name: 'Assinar digitalmente' })).toBe(sign);
    expect(sign).toBeEnabled();
    expect(signCalls()).toHaveLength(0);
  });

  it('hides the retained document subtree on read error and restores it only after a successful retry', async () => {
    const { client } = mount();
    const sign = await loaded();
    const interruption = await interruptRead(client, 'error');
    try {
      expect(screen.getByRole('alert')).not.toHaveTextContent('SYNTHETIC_PRIVATE_FAILURE');
      expect(sign.isConnected).toBe(true);
      expect(sign).not.toBeVisible();
      expect(sign).toBeDisabled();
      expect(screen.getByText('Receita simples')).not.toBeVisible();
      expect(screen.queryByRole('button', { name: 'Abrir documento' })).not.toBeInTheDocument();
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
    } finally { await interruption.recover(); }
    expect(screen.getByRole('button', { name: 'Assinar digitalmente' })).toBe(sign);
    expect(sign).toBeEnabled();
    expect(signCalls()).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('accepted document commands during read interruption', () => {
  it.each(['fetching', 'paused', 'error'] as const)('preserves the signing controller and operation through %s and recovery', async mode => {
    const command = deferred<Reply>();
    mocks.sign.mockReturnValueOnce(command.promise);
    const { client } = mount();
    const sign = await loaded();
    fireEvent.click(sign);
    await waitFor(() => expect(signCalls()).toHaveLength(1));
    const operationId = pendingOperation('synthetic-owner', row.id)?.operationId;
    expect(operationId).toMatch(/^[0-9a-f-]{36}$/);
    const interruption = await interruptRead(client, mode);
    try {
      expect(sign.isConnected).toBe(true);
      if (mode === 'error') expect(sign).not.toBeVisible();
      await interruption.recover();
      expect(screen.getByRole('button', { name: 'Assinar digitalmente' })).toBe(sign);
      expect(sign).toBeDisabled(); // The read recovered, but the accepted signature is still pending.
      expect(pendingOperation('synthetic-owner', row.id)?.operationId).toBe(operationId);
      expect(signCalls()).toHaveLength(1);
    } finally {
      await interruption.recover();
      await act(async () => command.resolve({ data: { status: 'in_progress' }, error: null }));
    }
    expect(await screen.findByRole('button', { name: 'Verificar assinatura' })).toBe(sign);
    expect(pendingOperation('synthetic-owner', row.id)).toMatchObject({ operationId, awaiting: 'in_progress' });
    expect(signCalls()).toHaveLength(1);
  });

  it.each(['paused', 'error'] as const)('preserves an accepted revocation and its busy state through %s', async mode => {
    const command = deferred<Reply>();
    mocks.rpc.mockReturnValueOnce(command.promise);
    const { client } = mount();
    await loaded();
    const revoke = screen.getByRole('button', { name: 'Revogar documento' });
    fireEvent.click(revoke);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('revoke_prescription', { p_id: row.id }));
    const interruption = await interruptRead(client, mode);
    try {
      expect(revoke.isConnected).toBe(true);
      await interruption.recover();
      expect(screen.getByRole('button', { name: 'Revogar documento' })).toBe(revoke);
      expect(revoke).toBeDisabled();
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    } finally {
      await interruption.recover();
      await act(async () => command.resolve({ data: null, error: null }));
    }
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Documento revogado' })));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['paused', 'error'] as const)('preserves the session controller while its revocation is pending through %s', async mode => {
    const command = deferred<Reply>();
    mocks.sessionRevoke.mockReturnValueOnce(command.promise);
    const { client } = mount();
    await loaded();
    const session = screen.getByRole('button', { name: 'Encerrar' });
    fireEvent.click(session);
    await waitFor(() => expect(sessionRevokeCalls()).toHaveLength(1));
    const interruption = await interruptRead(client, mode);
    try {
      expect(screen.getByRole('button', { name: 'Encerrar' })).toBe(session);
      expect(session).toBeDisabled();
      await interruption.recover();
      expect(screen.getByRole('button', { name: 'Encerrar' })).toBe(session);
      expect(session).toBeDisabled();
      expect(sessionRevokeCalls()).toHaveLength(1);
    } finally {
      await interruption.recover();
      await act(async () => command.resolve({ data: { revoked: true }, error: null }));
    }
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sessão de assinatura encerrada' })));
    expect(sessionRevokeCalls()).toHaveLength(1);
  });
});
