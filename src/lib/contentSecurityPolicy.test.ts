// @vitest-environment node
// The CSP served by Vercel (security review finding 14). Each directive is the narrowest the app allows:
// fonts are self-hosted, the browser talks only to this origin and the Supabase project, nothing is framed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};
const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')!.value;
const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([name, ...v]) => [name, v]));

describe('Content-Security-Policy', () => {
  it('keeps scripts, frames and objects locked down', () => {
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['frame-src']).toEqual(["'none'"]);
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['base-uri']).toEqual(["'self'"]);
    expect(directives['form-action']).toEqual(["'self'"]);
  });
  it('allows network access only to this origin and Supabase over https', () => {
    expect(directives['connect-src']).toEqual(["'self'", 'https://*.supabase.co']);
  });
  it('loads no third-party images, fonts or styles', () => {
    expect(directives['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(directives['font-src']).toEqual(["'self'", 'data:']);
    expect(directives['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp).not.toMatch(/googleapis|gstatic|https:(?!\/\/\*\.supabase\.co)/);
  });
  it('uses self-hosted fonts only', () => {
    const fonts = readFileSync(new URL('../../public/brand/fonts.css', import.meta.url), 'utf8');
    expect(fonts).not.toMatch(/https?:\/\//);
  });
});
