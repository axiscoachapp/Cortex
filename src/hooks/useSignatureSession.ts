// The doctor's digital signature session (D17) and the function caller the
// signature screens share. See src/lib/signatureClient.ts.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { sessionState, type Invoke, type SessionState } from '@/lib/signatureClient';

export const signatureInvoke: Invoke = (name, options) =>
  supabase.functions.invoke(name, options) as unknown as ReturnType<Invoke>;

export const SESSION_KEY = 'signature-session';

/**
 * The signature session of the signed-in doctor; unavailable when the
 * functions are not there. The server answers for the bearer, and the query
 * cache is cleared when the user changes (AuthContext), so the key needs no id.
 */
export function useSignatureSession(enabled: boolean) {
  return useQuery<SessionState>({
    queryKey: [SESSION_KEY],
    queryFn: async () => {
      try {
        return await sessionState(signatureInvoke);
      } catch {
        return { available: false };
      }
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}
