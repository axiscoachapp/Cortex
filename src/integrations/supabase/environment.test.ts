import { describe, expect, it } from 'vitest';
import { validateSupabaseEnvironment } from './environment';
const jwt = (claims: object) => `e30.${btoa(JSON.stringify(claims))}.signature`;
describe('explicit backend configuration', () => {
  it('fails on missing configuration instead of selecting a real project', () => {
    expect(() => validateSupabaseEnvironment(undefined, undefined)).toThrow(/explicitamente/);
    expect(() => validateSupabaseEnvironment('https://sample.supabase.co', '')).toThrow(/explicitamente/);
  });
  it('rejects cross-project keys and elevated credentials', () => {
    expect(() => validateSupabaseEnvironment('https://one.supabase.co', jwt({ role: 'anon', ref: 'two' }))).toThrow(/diferentes/);
    expect(() => validateSupabaseEnvironment('https://one.supabase.co', jwt({ role: 'service_role', ref: 'one' }))).toThrow(/anônima/);
    expect(() => validateSupabaseEnvironment('https://one.supabase.co', 'sb_secret_test')).toThrow(/pública/);
  });
  it('accepts a deliberately isolated loopback fixture and matching production settings', () => {
    expect(validateSupabaseEnvironment('http://127.0.0.1:54321', 'fixture')).toMatchObject({ isolated: true });
    expect(validateSupabaseEnvironment('https://one.supabase.co', jwt({ role: 'anon', ref: 'one' }))).toMatchObject({ isolated: false });
  });
  it('rejects plaintext remote backends and URLs containing credentials or paths', () => {
    for (const url of ['http://one.supabase.co', 'https://user@one.supabase.co', 'https://one.supabase.co/rest/v1']) expect(() => validateSupabaseEnvironment(url, 'fixture')).toThrow();
  });
});
