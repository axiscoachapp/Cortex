// The doctor's digital signature session (D17) and the function caller the
// signature screens share. See src/lib/signatureClient.ts.
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { sessionState, type Invoke, type SessionState } from '@/lib/signatureClient';

export const signatureInvoke: Invoke = (name, options) =>
  supabase.functions.invoke(name, options) as unknown as ReturnType<Invoke>;

export const SESSION_KEY = 'signature-session';

/** The signature session of the signed-in doctor; unavailable when the functions are not there. */
export function useSignatureSession(enabled: boolean) {
  const { user } = useAuth();
  return useQuery<SessionState>({
    queryKey: [SESSION_KEY, user?.id],
    queryFn: async () => {
      try {
        return await sessionState(signatureInvoke);
      } catch {
        return { available: false };
      }
    },
    enabled: enabled && !!user,
    staleTime: 30_000,
    retry: false,
  });
}
