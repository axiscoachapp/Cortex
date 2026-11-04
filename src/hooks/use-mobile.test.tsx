// Breakpoint at a fractional width: 768 x 1.35 = 1036.8px (Codex review of
// 4402143, 04/11 11:48). A browser fires `change` only when a query flips, and
// innerWidth is a whole number, so a second rounded threshold can disagree with
// the query and leave the app stuck in phone mode.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT } from '@/lib/interfaceScale';
import { isBelowMobileBreakpoint, useIsMobile } from './use-mobile';

type Listener = (event: MediaQueryListEvent) => void;
const original = { matchMedia: window.matchMedia, innerWidth: Object.getOwnPropertyDescriptor(window, 'innerWidth') };

/** Viewport whose media queries behave like a browser's: fractional widths,
 *  `change` only when a query's result flips, integer innerWidth. */
function fakeViewport(start: number) {
  let width = start;
  const lists: Array<{ query: string; matches: boolean; listeners: Set<Listener> }> = [];
  const evaluate = (query: string) => {
    const min = /^\(min-width:\s*([\d.]+)px\)$/.exec(query);
    const max = /^\(max-width:\s*([\d.]+)px\)$/.exec(query);
    if (min) return width >= Number(min[1]);
    if (max) return width <= Number(max[1]);
    throw new Error(`query not supported by the fake: ${query}`);
  };
  window.matchMedia = ((query: string) => {
    const entry = { query, matches: evaluate(query), listeners: new Set<Listener>() };
    lists.push(entry);
    return {
      media: query,
      get matches() { return evaluate(query); },
      addEventListener: (_: string, fn: Listener) => entry.listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => entry.listeners.delete(fn),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => Math.floor(width) });
  return {
    resize(next: number) {
      width = next;
      for (const entry of lists) {
        const matches = evaluate(entry.query);
        if (matches === entry.matches) continue;
        entry.matches = matches;
        entry.listeners.forEach((fn) => fn({ matches, media: entry.query } as MediaQueryListEvent));
      }
    },
  };
}

afterEach(() => {
  window.matchMedia = original.matchMedia;
  if (original.innerWidth) Object.defineProperty(window, 'innerWidth', original.innerWidth);
});

describe('phone breakpoint at a fractional width', () => {
  it('is fractional at the 135% scale, so the rule must not round it', () => {
    expect(MOBILE_BREAKPOINT).toBeCloseTo(1036.8);
  });

  it('does not get stuck in phone mode after 1035 -> 1036 -> 1280', () => {
    const viewport = fakeViewport(1035);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    act(() => viewport.resize(1036));
    expect(result.current).toBe(true); // 1036 < 1036.8: Tailwind md does not apply yet
    act(() => viewport.resize(1280));
    expect(result.current).toBe(false);
  });

  it('agrees with the CSS rule on both sides of the breakpoint, also for zoomed fractional widths', () => {
    // MOBILE_BREAKPOINT is 1036.8000000000002 in floating point; Tailwind's md
    // screen is built from the same expression, so both use that exact value.
    for (const [width, phone] of [[1035, true], [1036, true], [1036.5, true], [MOBILE_BREAKPOINT, false], [1037, false], [1280, false]] as const) {
      fakeViewport(width);
      expect(isBelowMobileBreakpoint(), String(width)).toBe(phone);
      const { result, unmount } = renderHook(() => useIsMobile());
      expect(result.current, String(width)).toBe(phone);
      unmount();
    }
  });

  it('follows widening and narrowing in both directions', () => {
    const viewport = fakeViewport(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => viewport.resize(1036));
    expect(result.current).toBe(true);
    act(() => viewport.resize(1037));
    expect(result.current).toBe(false);
    act(() => viewport.resize(390));
    expect(result.current).toBe(true);
  });
});
