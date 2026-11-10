import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUserSettings } from './useUserSettings';
const mocks = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'synthetic-doctor' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: () => mocks.read() }; return q; }, rpc: (...args: unknown[]) => mocks.rpc(...args),
} }));
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderHook(() => useUserSettings(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
describe('clinic user settings with managed setup', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ error: null }); });
  it.each([true, false])('keeps real-time analysis disabled for a stored preference of %s', async enabled => {
    mocks.read.mockResolvedValue({ data: { specialty: 'cardiologia', live_copilot_enabled: enabled }, error: null });
    const { result } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.specialty).toBe('cardiologia');
    expect(result.current.liveCopilotEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not enable the copilot when there is no row or while loading', async () => {
    mocks.read.mockResolvedValue({ data: null, error: null });
    const { result } = mount();
    expect(result.current.liveCopilotEnabled).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.liveCopilotEnabled).toBe(false);
  });
  it('reports read failures without enabling live analysis', async () => {
    mocks.read.mockResolvedValue({ data: null, error: new Error('synthetic offline') });
    const { result } = mount();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.liveCopilotEnabled).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('writes only the chosen template using the existing RPC', async () => {
    mocks.read.mockResolvedValue({ data: { active_template_id: null, live_copilot_enabled: true }, error: null });
    const { result } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setActiveTemplateId('synthetic-template'));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('update_user_settings', { p_patch: { active_template_id: 'synthetic-template' } }));
    expect(result.current.liveCopilotEnabled).toBe(false);
  });
});
