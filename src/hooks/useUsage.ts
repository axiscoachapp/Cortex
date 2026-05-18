import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const DEFAULT_LIMIT = 1500;

export interface UsageSummary {
  used: number;
  limit: number;
  calls: number;
  percent: number;          // 0–100
  remaining: number;        // limit - used (never negative)
  resetsInHours: number;    // hours until UTC midnight
  level: 'safe' | 'warn' | 'critical' | 'over';
}

function hoursToUtcMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  ));
  return Math.max(0, Math.round((tomorrow.getTime() - now.getTime()) / 3_600_000));
}

function classify(percent: number): UsageSummary['level'] {
  if (percent >= 100) return 'over';
  if (percent >= 90)  return 'critical';
  if (percent >= 70)  return 'warn';
  return 'safe';
}

export function useUsage(userId: string | undefined) {
  return useQuery<UsageSummary>({
    queryKey: ['usage-daily', userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);

      // Both reads are RLS-scoped to auth.uid() — safe.
      const [{ data: usage }, { data: settings }] = await Promise.all([
        supabase
          .from('usage_daily')
          .select('credits_used, calls')
          .eq('user_id', userId!)
          .eq('day', today)
          .maybeSingle(),
        supabase
          .from('user_settings')
          .select('daily_credit_limit')
          .eq('user_id', userId!)
          .maybeSingle(),
      ]);

      const used = Number(usage?.credits_used ?? 0);
      const calls = Number(usage?.calls ?? 0);
      const limit = Number(settings?.daily_credit_limit ?? DEFAULT_LIMIT);
      const percent = limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : 0;

      return {
        used,
        limit,
        calls,
        percent,
        remaining: Math.max(0, limit - used),
        resetsInHours: hoursToUtcMidnight(),
        level: classify(percent),
      };
    },
  });
}
