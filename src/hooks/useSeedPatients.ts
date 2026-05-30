import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Seeds demo patients + consultations for new accounts.
 * In production (import.meta.env.DEV === false) this hook is a no-op and
 * the seed data module is never bundled — Vite/Rollup dead-code-eliminates
 * the dynamic import entirely.
 */
export function useSeedPatients(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!import.meta.env.DEV || !userId) return;
    // Dynamic import keeps the ~600-line seed data out of the main bundle.
    import('@/data/seedData').then(({ seedIfEmpty }) => {
      seedIfEmpty(userId).then((seeded) => {
        if (seeded) queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      });
    });
  }, [userId, queryClient]);
}
