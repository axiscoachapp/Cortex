import { describe, expect, it } from 'vitest';
import { authDestination } from './authRedirect';
describe('login destination', () => {
  it('preserves the OAuth callback code and state', () => {
    expect(authDestination('/google-oauth-callback?code=synthetic&state=nonce')).toBe('/google-oauth-callback?code=synthetic&state=nonce');
  });
  it('rejects external paths and login loops', () => {
    for (const next of ['https://other.invalid', '//other.invalid', '/\\other.invalid', '/auth?next=/auth']) expect(authDestination(next)).toBe('/');
  });
});
