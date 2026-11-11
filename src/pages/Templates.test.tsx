import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplatesPage from './Templates';

const settings = vi.hoisted(() => ({
  activeTemplateId: null as string | null,
  setActiveTemplateId: vi.fn(),
}));
vi.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ ...settings, isSaving: false, isLoading: false }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const rows = [
  { id: 'mine', user_id: 'doctor', name: 'Retorno ginecológico', description: 'Meu modelo', content: '## S', created_at: '2026-11-01' },
  { id: 'builtin', user_id: null, name: 'Consulta geral', description: 'Padrão', content: '## S', created_at: '2026-10-01' },
];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        range: async (from: number) => ({ data: from === 0 ? rows : [], error: null }),
      };
      return query;
    },
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TemplatesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  settings.activeTemplateId = null;
  settings.setActiveTemplateId.mockReset();
});

describe('Templates page', () => {
  it('says the default structure is in use and activates a template for new evolutions', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('estrutura SOAP padrão')).toBeInTheDocument();
    expect(screen.queryByText('Em uso')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usar Retorno ginecológico nas evoluções' }));
    expect(settings.setActiveTemplateId).toHaveBeenCalledWith('mine');
    expect(screen.queryByText(/ao iniciar uma gravação/)).not.toBeInTheDocument();
  });

  it('marks the active template and lets the doctor go back to the default', async () => {
    settings.activeTemplateId = 'builtin';
    const user = userEvent.setup();
    renderPage();
    const status = await screen.findByRole('status');
    expect(within(status).getByText('Consulta geral')).toBeInTheDocument();
    expect(screen.getByText('Em uso')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar Consulta geral nas evoluções' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar Retorno ginecológico nas evoluções' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usar a estrutura padrão' }));
    expect(settings.setActiveTemplateId).toHaveBeenCalledWith(null);
  });
});
