/** Interface scale of the enlarged design system: 150% at first, reduced on
 * 04/11/2026 to 135% at the user's request (they were using 90% browser zoom,
 * and 90% of 150% is 135%). index.css sets the same value as the root font
 * size. Keep responsive JS thresholds aligned with the Tailwind screens.
 *
 * Two kinds of breakpoint (10/11/2026, reviews of 1366x768 and 1536x864
 * laptops that were getting the phone layout):
 * - Content breakpoints (Tailwind sm/md/lg/xl/2xl) are multiplied by the scale,
 *   because they decide when enlarged text fits side by side: md = 1036.8px,
 *   xl = 1728px.
 * - The application frame is NOT scaled: from SHELL_BREAKPOINT real pixels the
 *   app is a desktop app (persistent sidebar, no bottom tab bar, patient column
 *   beside the consultation). Tailwind screen `shell` and the two
 *   `not all and (min-width: 1200px)` rules in index.css use this value. Between
 *   `shell` and `xl` the frame is compact (13rem sidebar, 18rem patient
 *   column); from `xl` it is the original wide frame. */
export const INTERFACE_SCALE = 1.35;
export const MOBILE_BREAKPOINT = 768 * INTERFACE_SCALE;
/** Desktop frame (sidebar navigation, column layout), in real pixels. */
export const SHELL_BREAKPOINT = 1200;
/** Wide desktop frame (Tailwind xl): roomier sidebar and columns. */
export const WIDE_BREAKPOINT = 1280 * INTERFACE_SCALE;
