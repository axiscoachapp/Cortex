import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolShareControls, SharedProtocolsPanel } from './ProtocolSharing';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/sharing', () => ({ sharingRpc: mocks.rpc }));
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
const source = { id: 'protocol-1', title: 'Reviewed shared protocol', source_version: '2026', source_author: 'Source physician', reviewed_at: '2026-10-28T12:00:00Z', authorization_revision: 1, source_review_revision: 1, source_text: 'Original protocol content, shared as one exact version.', source_reference: 'Synthetic professional society' };
const overview = { members: [{ user_id: 'recipient', name: 'Receiving physician' }], received: [source], received_count: 1, granted: [] };
const ownerSource = { id: source.id, title: source.title, review_status: 'approved', status: 'ready' };
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockImplementation(async name => name === 'protocol_sharing_overview' ? overview : name === 'get_shared_protocol' ? source : name === 'check_shared_protocol_access' ? { authorization_revision: 1, source_review_revision: 1 } : true); });
afterEach(() => vi.restoreAllMocks());
describe('exact-version read-only protocol sharing', () => {
  it('shows attributed original source text without edit, reindex or export actions', async () => {
    render(<SharedProtocolsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ler versão' }));
    await screen.findByText(source.source_text);
    expect(screen.getByText('Fonte: Synthetic professional society')).toBeInTheDocument();
    expect(screen.getByText(/Revisado \/ compartilhado por: Source physician · versão 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reindexar|Exportar|Aprovar|Salvar/ })).not.toBeInTheDocument();
  });
  it('grants only the selected source version to one active doctor', async () => {
    render(<ProtocolShareControls source={ownerSource} />);
    fireEvent.change(await screen.findByLabelText('Médico destinatário'), { target: { value: 'recipient' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conceder leitura' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('grant_protocol_share', { p_document_id: 'protocol-1', p_recipient_user_id: 'recipient' }));
    expect(mocks.rpc).not.toHaveBeenCalledWith('grant_patient_share', expect.anything());
  });
  it('does not offer grants for an unapproved or retired source', async () => {
    render(<ProtocolShareControls source={{ ...ownerSource, review_status: 'retired' }} />);
    await screen.findByText('A fonte precisa estar aprovada e com indexação concluída para receber novos compartilhamentos.');
    expect(screen.queryByRole('button', { name: 'Conceder leitura' })).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalledWith('grant_protocol_share', expect.anything());
  });
  it('purges revoked names and source text during periodic authorization checks', async () => {
    const polls: (() => void)[] = []; const originalInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation((callback, timeout, ...args) => {
      if (timeout !== 5000) return originalInterval(callback, timeout, ...args);
      polls.push(callback as () => void); return originalInterval(() => {}, 1_000_000);
    });
    render(<SharedProtocolsPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Ler versão' })); await screen.findByText(source.source_text);
    mocks.rpc.mockImplementation(async name => { if (name === 'check_shared_protocol_access') throw new Error('Acesso revogado'); return { ...overview, received: [], received_count: 0 }; });
    await act(async () => { polls.forEach(poll => poll()); });
    await waitFor(() => expect(screen.queryByText(source.source_text)).not.toBeInTheDocument());
    expect(screen.queryByText(source.title)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ler versão' })).not.toBeInTheDocument();
  });
  it('ignores a delayed source result after another protocol is selected', async () => {
    let resolveFirst!: (value: typeof source) => void;
    const second = { ...source, id: 'protocol-2', title: 'Second protocol', source_text: 'Second source text' };
    mocks.rpc.mockImplementation(async (name, args) => name === 'protocol_sharing_overview' ? { ...overview, received: [source, second], received_count: 2 } : args.p_document_id === source.id ? new Promise(resolve => { resolveFirst = resolve; }) : second);
    render(<SharedProtocolsPanel />); await screen.findByText('Second protocol');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ler versão' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ler versão' })[1]);
    await screen.findByText('Second source text');
    await act(async () => resolveFirst(source));
    expect(screen.queryByText(source.source_text)).not.toBeInTheDocument();
    expect(screen.getByText('Second source text')).toBeInTheDocument();
  });
  it('can reopen the selected source without leaving an empty panel', async () => {
    render(<SharedProtocolsPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Ler versão' })); await screen.findByText(source.source_text);
    fireEvent.click(screen.getByRole('button', { name: 'Ler versão' }));
    await screen.findByText(source.source_text);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'get_shared_protocol')).toHaveLength(2);
  });
});
