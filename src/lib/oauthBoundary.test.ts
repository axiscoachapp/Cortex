// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertOAuthRedirect, createOAuthSecrets, pkceChallenge } from '../../supabase/functions/_shared/oauth';

describe('OAuth transaction boundary', () => {
  it('matches the RFC7636 S256 test vector', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('generates independent high entropy state and verifier', async () => {
    const a = await createOAuthSecrets(); const b = await createOAuthSecrets();
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(a.state).not.toBe(b.state);
    expect(a.challenge).toBe(await pkceChallenge(a.verifier));
  });
  it('requires an exact configured redirect, including scheme and origin', () => {
    const valid = 'https://cortex.example/google-oauth-callback';
    expect(assertOAuthRedirect(valid,[valid])).toBe(valid);
    for (const bad of ['https://evil.example/google-oauth-callback',valid+'?next=evil',valid+'#code','http://cortex.example/google-oauth-callback','https://user@cortex.example/google-oauth-callback']) {
      expect(() => assertOAuthRedirect(bad,[valid])).toThrow();
    }
    expect(() => assertOAuthRedirect(valid,[])).toThrow();
  });
});
