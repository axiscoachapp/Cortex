import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUsage } from './useUsage';

const mocks = vi.hoisted(() => ({ filters: [] as Array<[string, string, unknown]>, usage: null as unknown, settings: null as unknown }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { mocks.filters.push([table, key, value]); return q; },
      maybeSingle: async () => ({ data: table === 'usage_daily' ? mocks.usage : mocks.settings, error: null }),
    };
    return q;
  },
} }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useUsage('synthetic-doctor'), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

describe('AI usage on the clinic day', () => {
  afterEach(() => { vi.useRealTimers(); mocks.filters.length = 0; });
  it('reads the São Paulo day, not the UTC day, and counts hours to midnight there', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T01:30:00Z')); // 22:30 on 11/11 in São Paulo
    mocks.usage = { credits_used: 100, credits_reserved: 0, calls: 2 };
    mocks.settings = null;
    const { result } = mount();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocks.filters).toContainEqual(['usage_daily', 'day', '2026-11-11']);
    expect(result.current.data).toMatchObject({ used: 100, limit: 8000, resetsInHours: 2 });
  });
});
