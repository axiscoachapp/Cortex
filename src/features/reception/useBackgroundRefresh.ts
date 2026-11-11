import { useCallback, useEffect, useRef, useState } from 'react';

export const WHATSAPP_POLL_MS = 15_000;

type Polled = {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt: number;
  refetch: (options?: { cancelRefetch?: boolean }) => Promise<unknown>;
};

/**
 * Background refresh for a read that otherwise hides its data while it refetches.
 *
 * A read started here is "background": the caller keeps showing the last good data while it runs
 * and, if it fails, marks that data as possibly outdated instead of wiping it. Any other refetch
 * (the user's refresh, a command's reconciliation, an invalidation) stays "explicit" and keeps the
 * strict behaviour. Ticks run only while `enabled`, the tab is visible and the read is idle.
 */
export function useBackgroundRefresh(query: Polled, enabled: boolean, interval = WHATSAPP_POLL_MS) {
  // Start time of the background read whose result is on screen, or null when the last read was explicit.
  const [since, setSince] = useState<number | null>(null);
  const latest = useRef(query);
  latest.current = query;
  const tick = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (latest.current.fetchStatus !== 'idle' || latest.current.status === 'pending') return;
    setSince(Date.now());
    void latest.current.refetch({ cancelRefetch: false });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(tick, interval);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, interval, tick]);
  // A successful background read is as good as an explicit one; later refetches start explicit again.
  useEffect(() => {
    if (since !== null && query.status === 'success' && query.fetchStatus === 'idle' && query.dataUpdatedAt >= since) setSince(null);
  }, [since, query.status, query.fetchStatus, query.dataUpdatedAt]);
  const background = since !== null;
  return {
    /** A background read is running or has just failed: keep showing the last good data. */
    background,
    /** The last background read failed (or is waiting for the network): the data on screen may be outdated. */
    outdated: background && (query.status === 'error' || query.fetchStatus === 'paused'),
    /** Call before an explicit refetch so its pending/failed state is shown strictly. */
    explicit: useCallback(() => setSince(null), []),
    tick,
  };
}
