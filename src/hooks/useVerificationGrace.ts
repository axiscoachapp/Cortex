import { useEffect, useRef, useState } from 'react';

// A transient transport failure of a background re-verification keeps the
// last verified state for this long. After it, the guard blocks as before.
export const VERIFICATION_GRACE_MS = 45_000;
// Quick retries of a transport failure before it surfaces as a failure.
export const VERIFICATION_RETRIES = 2;
export const VERIFICATION_RETRY_DELAY_MS = 300;

/**
 * Returns true once `failing` has stayed true for VERIFICATION_GRACE_MS.
 * The window restarts after any non-failing render (a verified read) or when
 * `scope` (the verified identity) changes.
 */
export function useGraceExpired(failing: boolean, scope: string | null) {
  const since = useRef<{ scope: string | null; at: number } | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  useEffect(() => {
    if (!failing) {
      since.current = null;
      setExpired(null);
      return;
    }
    if (!since.current || since.current.scope !== scope) since.current = { scope, at: Date.now() };
    const left = since.current.at + VERIFICATION_GRACE_MS - Date.now();
    const mark = () => setExpired(scope ?? '');
    if (left <= 0) {
      mark();
      return;
    }
    const timer = setTimeout(mark, left);
    return () => clearTimeout(timer);
  }, [failing, scope]);
  return failing && expired === (scope ?? '');
}
