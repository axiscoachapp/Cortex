import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeBasePage from './KnowledgeBase';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  create: vi.fn(),
  review: vi.fn(),
  docs: [] as Record<string, unknown>[],
  listError: false,
}));
vi.mock('@/components/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useUnsavedChanges', () => ({ useUnsavedChanges: () => () => true }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/knowledge', () => ({ createKnowledgeSource: mocks.create, reviewKnowledgeSource: mocks.review }));
vi.mock('@/components/ProtocolSharing', () => ({
  ProtocolShareControls: () => null,
  SharedProtocolsPanel: () => null,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: () => {
      let id: string | null = null;
      const q = {
        select: () => q,
        order: () => q,
        range: async (from: number, to: number) => mocks.listError
          ? { data: null, error: new Error('relation does not exist') }
          : { data: mocks.docs.slice(from, to + 1), error: null },
        eq: (key: string, value: string) => {
          if (key === 'id') id = value;
          return q;
        },
        single: async () => ({ data: mocks.docs.find((doc) => doc.id === id), error: null }),
      };
      return q;
    },
  },
}));
const original = {
  id: 'source-1',
  title: 'Synthetic protocol',
  source_type: 'text',
  char_count: 40,
  status: 'draft',
  created_at: '2026-10-28',
  source_reference: 'Synthetic society',
  source_version: 'v1',
  review_status: 'pending',
  reviewed_at: null,
  reviewer_name: null,
  indexed_at: null,
  source_text: 'Original general protocol without patient data.',
  supersedes_document_id: null,
};
const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KnowledgeBasePage />
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.docs = [{ ...original }];
  mocks.listError = false;
  mocks.create.mockResolvedValue('source-2');
  mocks.review.mockResolvedValue(undefined);
  mocks.invoke.mockResolvedValue({ data: { status: 'ready' }, error: null });
});
describe('reviewed protocol library', () => {
  it('is titled like its menu entry and words its rule without technical terms', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Conhecimento' })).toBeInTheDocument();
    expect(screen.getByText(/O assistente só usa as versões que você revisou e aprovou/)).toBeInTheDocument();
    expect(screen.queryByText(/indexa|caracteres|não preservada/i)).not.toBeInTheDocument();
  });
  it('shows one retry message instead of the empty library when the read fails', async () => {
    mocks.listError = true;
    renderPage();
    expect(await screen.findByText('Não foi possível carregar suas fontes. Verifique a conexão e tente de novo.')).toBeInTheDocument();
    expect(screen.queryByText('Sua biblioteca está vazia')).not.toBeInTheDocument();
    expect(screen.queryByText(/relation does not exist/)).not.toBeInTheDocument();
    mocks.listError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Synthetic protocol')).toBeInTheDocument();
  });
  it('saves the original and source metadata without automatically sending it to AI', async () => {
    mocks.create.mockImplementation(async (input) => {
      mocks.docs.push({
        ...original,
        id: 'source-2',
        title: input.title,
        source_text: input.text,
        source_reference: input.reference,
        source_version: input.version,
      });
      return 'source-2';
    });
    renderPage();
    await screen.findByText('Synthetic protocol');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar fonte' }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'New protocol' } });
    fireEvent.change(screen.getByLabelText('Fonte / referência bibliográfica'), {
      target: { value: 'Synthetic publication' },
    });
    fireEvent.change(screen.getByLabelText('Versão / edição'), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText('Texto original do protocolo'), {
      target: { value: 'Original general protocol without any patient data.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar original para revisão' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        title: 'New protocol',
        text: 'Original general protocol without any patient data.',
        reference: 'Synthetic publication',
        version: '2026',
        supersedesDocumentId: null,
      }),
    );
    await screen.findByRole('button', { name: 'Revisei o original · aprovar' });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it('shows preserved source/version and requires explicit original review before indexing', async () => {
    renderPage();
    await screen.findByText('Synthetic protocol');
    fireEvent.click(screen.getByRole('button', { name: 'Ver fonte' }));
    await screen.findByText('Original general protocol without patient data.');
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revisei o original · aprovar' }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('source-1', true));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('ingest-knowledge', { body: { documentId: 'source-1' } }),
    );
  });
  it('keeps legacy sources unavailable until a new original version is supplied', async () => {
    mocks.docs = [{ ...original, source_text: null, source_version: null, source_reference: null }];
    renderPage();
    await screen.findByText('Synthetic protocol');
    fireEvent.click(screen.getByRole('button', { name: 'Ver fonte' }));
    await screen.findByText(/O texto original desta fonte antiga não foi preservado/);
    expect(screen.queryByRole('button', { name: 'Revisei o original · aprovar' })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Nova versão' }));
    expect(screen.getByLabelText('Título')).toHaveValue('Synthetic protocol');
    expect(screen.getByLabelText('Versão / edição')).toHaveValue('');
  });
  it('retires a reviewed source through the review boundary while preserving its original', async () => {
    mocks.docs = [{ ...original, review_status: 'approved', status: 'ready' }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('Synthetic protocol');
    fireEvent.click(screen.getByRole('button', { name: 'Ver fonte' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retirar das referências' }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('source-1', false));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByText('Original general protocol without patient data.')).toBeInTheDocument();
  });
});
