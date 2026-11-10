import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfessionalSettingsForm } from './ProfessionalSettingsForm';
const mocks = vi.hoisted(() => ({ change: vi.fn(), retry: vi.fn(), error: false, loading: false, templateError: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'synthetic' } }) }));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ activeTemplateId: null, setActiveTemplateId: mocks.change, isLoading: mocks.loading, isError: mocks.error, isSaving: false, retrySettings: mocks.retry }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const q = { select: () => q, order: () => q, range: async (from: number) => ({ data: from === 0 ? [{ id: 'template-synthetic', name: 'Evolução sintética' }] : [], error: mocks.templateError ? new Error('offline') : null }) }; return q;
} } }));
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ProfessionalSettingsForm /></MemoryRouter></QueryClientProvider>); }
describe('personal clinical preferences', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.error = false; mocks.loading = false; mocks.templateError = false; });
  it('allows choosing a template without technical or prescriber editors', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Evolução sintética' }));
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith('template-synthetic');
    expect(screen.queryByLabelText('Especialidade')).toBeNull(); expect(screen.queryAllByRole('textbox')).toHaveLength(0); expect(screen.queryByRole('switch')).toBeNull();
  });
  it('refuses editing when the personal settings read fails', async () => {
    mocks.error = true; mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível consultar');
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); expect(mocks.retry).toHaveBeenCalledOnce(); expect(mocks.change).not.toHaveBeenCalled();
  });
  it('does not offer an incomplete template list as a fresh choice', async () => {
    mocks.templateError = true; mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os modelos');
    expect(screen.getByRole('combobox')).toBeDisabled(); expect(mocks.change).not.toHaveBeenCalled();
  });
});
