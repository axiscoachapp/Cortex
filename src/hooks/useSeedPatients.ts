import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isIsolatedBackend } from '@/integrations/supabase/client';

/**
 * Seeds demo patients + consultations for new accounts.
 * In production (import.meta.env.DEV === false) this hook is a no-op and
 * the seed data module is never bundled — Vite/Rollup dead-code-eliminates
 * the dynamic import entirely.
 */
export function useSeedPatients(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Demo data only on an isolated local/test backend: a dev server pointed at
    // production must never insert fictitious patients into a real account.
    if (!import.meta.env.DEV || !isIsolatedBackend || !userId) return;
    // Dynamic import keeps the ~600-line seed data out of the main bundle.
    import('@/data/seedData').then(({ seedIfEmpty }) => {
      seedIfEmpty(userId).then((seeded) => {
        if (seeded) queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      });
    });
  }, [userId, queryClient]);
}
