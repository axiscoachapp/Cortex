import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Colors come from the brand tokens (synced from ../brand/tokens.css), so the
// palette has a single source of truth and Tailwind opacity modifiers still work.
const tokensCss = readFileSync(fileURLToPath(new URL('./src/styles/tokens.css', import.meta.url)), 'utf8');
const tokens = Object.fromEntries(
  [...tokensCss.matchAll(/--cx-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(([, name, hex]) => [name, hex]),
);
const t = (name) => {
  if (!tokens[name]) throw new Error(`Token --cx-${name} não encontrado em src/styles/tokens.css`);
  return tokens[name];
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
    extend: {
      colors: {
        ink: t('ink'),
        teal: {
          50: t('teal-50'),
          100: t('teal-100'),
          300: t('teal-300'),
          600: t('teal-600'),
          700: t('teal-700'),
          800: t('teal-800'),
        },
        signal: { DEFAULT: t('signal'), 50: t('signal-50'), 700: t('signal-700') },
        bg: t('bg'),
        surface: t('surface'),
        line: t('border'),
        muted: t('muted'),
        'muted-ink': t('muted-on-ink'),
        success: t('success'),
        warning: t('warning'),
        danger: t('danger'),
        info: t('info'),
      },
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      fontSize: {
        // Site scale from the brand guide: 14 / 16 / 18 / 20 / 24 / 32 / 44 / 56
        sm: ['0.875rem', { lineHeight: '1.35rem' }],
        base: ['1rem', { lineHeight: '1.65rem' }],
        lg: ['1.125rem', { lineHeight: '1.8rem' }],
        xl: ['1.25rem', { lineHeight: '1.85rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em' }],
        '3xl': ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.015em' }],
        '4xl': ['2.75rem', { lineHeight: '3.15rem', letterSpacing: '-0.02em' }],
        '5xl': ['3.5rem', { lineHeight: '3.85rem', letterSpacing: '-0.02em' }],
      },
      borderRadius: { card: '12px', panel: '20px' },
      boxShadow: {
        card: '0 1px 2px rgb(14 42 51 / 0.06), 0 8px 24px rgb(14 42 51 / 0.08)',
        mock: '0 2px 4px rgb(14 42 51 / 0.08), 0 24px 60px -12px rgb(14 42 51 / 0.28)',
      },
      maxWidth: { site: '1200px', prose: '68ch' },
      transitionDuration: { DEFAULT: '180ms' },
    },
  },
  plugins: [],
};
