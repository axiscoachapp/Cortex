/** Interface scale of the enlarged design system: 150% at first, reduced on
 * 04/11/2026 to 135% at the user's request (they were using 90% browser zoom,
 * and 90% of 150% is 135%). index.css sets the same value as the root font
 * size. Keep responsive JS thresholds aligned with the Tailwind screens. */
export const INTERFACE_SCALE = 1.35;
export const MOBILE_BREAKPOINT = 768 * INTERFACE_SCALE;
export const DESKTOP_BREAKPOINT = 1280 * INTERFACE_SCALE;
