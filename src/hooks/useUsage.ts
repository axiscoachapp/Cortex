import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { clinicDate } from '@/lib/dates';

// Same default as reserve_usage (migration 20261111160000).
const DEFAULT_LIMIT = 8000;

export interface UsageSummary {
  used: number;
  limit: number;
  calls: number;
  percent: number;          // 0–100
  remaining: number;        // limit - used (never negative)
  resetsInHours: number;    // hours until midnight of the clinic's day (São Paulo)
  level: 'safe' | 'warn' | 'critical' | 'over';
}

/** The quota day is the clinic's day (America/Sao_Paulo, UTC-3 with no daylight saving since 2019). */
function hoursToClinicMidnight(now = new Date()): number {
  const today = Date.parse(`${clinicDate(now)}T00:00:00-03:00`);
  return Math.max(0, Math.round((today + 86_400_000 - now.getTime()) / 3_600_000));
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
      const today = clinicDate();

      // Both reads are RLS-scoped to auth.uid() — safe.
      const [usageResult, settingsResult] = await Promise.all([
        supabase
          .from('usage_daily')
          .select('credits_used, credits_reserved, calls')
          .eq('user_id', userId!)
          .eq('day', today)
          .maybeSingle(),
        supabase
          .from('user_settings')
          .select('daily_credit_limit')
          .eq('user_id', userId!)
          .maybeSingle(),
      ]);
      if (usageResult.error) throw usageResult.error;
      if (settingsResult.error) throw settingsResult.error;
      const usage = usageResult.data;
      const settings = settingsResult.data;
      const used = Number(usage?.credits_used ?? 0) + Number(usage?.credits_reserved ?? 0);
      const calls = Number(usage?.calls ?? 0);
      const limit = Number(settings?.daily_credit_limit ?? DEFAULT_LIMIT);
      const percent = limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : 0;

      return {
        used,
        limit,
        calls,
        percent,
        remaining: Math.max(0, limit - used),
        resetsInHours: hoursToClinicMidnight(),
        level: classify(percent),
      };
    },
  });
}
