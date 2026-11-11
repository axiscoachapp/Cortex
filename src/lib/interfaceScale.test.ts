// The desktop frame (sidebar, no bottom tab bar, patient column) is decided in
// real pixels, while content screens scale with the 135% type. Three places
// must agree: interfaceScale.ts (JS), tailwind.config.ts (`shell` screen) and
// the plain media queries in index.css. Reviews of 10/11/2026 found laptops
// (1280-1536px) getting the phone layout when the frame followed scaled xl.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';
import { INTERFACE_SCALE, MOBILE_BREAKPOINT, SHELL_BREAKPOINT, WIDE_BREAKPOINT } from './interfaceScale';

const screens = tailwindConfig.theme?.screens as Record<string, string>;
const px = (value: string) => Number(value.replace(/px$/, ''));

describe('interface scale breakpoints', () => {
  it('keeps the desktop frame in real pixels, between phone and wide', () => {
    expect(SHELL_BREAKPOINT).toBe(1200);
    expect(MOBILE_BREAKPOINT).toBeLessThan(SHELL_BREAKPOINT);
    expect(SHELL_BREAKPOINT).toBeLessThan(WIDE_BREAKPOINT);
    // 1280x800, 1366x768 and 1536x864 laptops get the desktop frame.
    for (const width of [1280, 1366, 1536]) expect(width).toBeGreaterThanOrEqual(SHELL_BREAKPOINT);
  });

  it('exposes the same values as Tailwind screens, in ascending order', () => {
    expect(px(screens.shell)).toBe(SHELL_BREAKPOINT);
    expect(px(screens.md)).toBeCloseTo(MOBILE_BREAKPOINT);
    expect(px(screens.xl)).toBeCloseTo(WIDE_BREAKPOINT);
    expect(px(screens.sm)).toBeCloseTo(640 * INTERFACE_SCALE);
    const values = Object.values(screens).map(px);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('uses the desktop-frame breakpoint in the plain CSS media queries', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    expect(css).toContain('font-size: 135%');
    expect(css).not.toMatch(/min-width:\s*1728px/);
    expect(css.match(new RegExp(`not all and \\(min-width: ${SHELL_BREAKPOINT}px\\)`, 'g'))).toHaveLength(2);
  });
});
