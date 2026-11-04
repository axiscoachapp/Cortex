import * as React from "react";
import { MOBILE_BREAKPOINT } from '@/lib/interfaceScale';

/**
 * Phone layout = the complement of Tailwind's `md` screen (min-width:
 * MOBILE_BREAKPOINT). At 135% the breakpoint is fractional (1036.8px), so the
 * state comes only from this query and its `change` events, never from a
 * second rounded threshold such as innerWidth or `max-width: N - 1`.
 */
export const DESKTOP_LAYOUT_QUERY = `(min-width: ${MOBILE_BREAKPOINT}px)`;

/** Whether the phone layout applies right now (same rule as the CSS). */
export function isBelowMobileBreakpoint(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return window.innerWidth < MOBILE_BREAKPOINT;
  return !window.matchMedia(DESKTOP_LAYOUT_QUERY).matches;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(isBelowMobileBreakpoint);

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_LAYOUT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(!event.matches);
    mql.addEventListener("change", onChange);
    setIsMobile(!mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
