// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  changeInitialPasswordHandler,
  reissueTemporaryPasswordHandler,
  type ChangeInitialPasswordDeps,
  type ReissueTemporaryPasswordDeps,
} from '../../supabase/functions/_shared/passwordChange';
import {
  generateTemporaryPassword,
  passwordChangePending,
  passwordProblem,
  temporaryPasswordAppMetadata,
  temporaryPasswordExpired,
} from '../../supabase/functions/_shared/passwordPolicy';

const NOW = new Date('2026-11-11T12:00:00Z');
const userId = 'c7100000-0000-4000-8000-000000000002';
const adminId = 'c7100000-0000-4000-8000-000000000001';
const clinicId = 'c7300000-0000-4000-8000-000000000001';
const GOOD = 'cavalo-azul-lagoa-17';
const pendingApp = () => ({ provisioned_at: '2026-11-10T12:00:00Z', ...temporaryPasswordAppMetadata(new Date('2026-11-10T12:00:00Z')) });

class SyntheticAuthError extends Error {}

function changeDeps(overrides: Partial<ChangeInitialPasswordDeps> = {}, caller: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const deps: ChangeInitialPasswordDeps = {
    corsHeaders: { 'Access-Control-Allow-Origin': 'https://cortex.example' },
    authenticate: vi.fn(async () => ({
      userId,
      email: 'medica@example.invalid',
      createdAt: '2026-11-10T12:00:00Z',
      appMetadata: pendingApp(),
      userMetadata: { full_name: 'Médica' },
      accessToken: 'synthetic-access-token',
      ...caller,
    })),
    authFailure: (error) => (error instanceof SyntheticAuthError ? new Response(null, { status: 401 }) : null),
    now: () => NOW,
    passwordIsCurrent: vi.fn(async () => false),
    revokeOtherSessions: vi.fn(async () => { calls.push('revoke'); }),
    updateUser: vi.fn(async () => { calls.push('update'); }),
    log: vi.fn(),
    ...overrides,
  };
  return { deps, calls };
}
const post = (body: unknown) => new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify(body) });

describe('change-initial-password', () => {
  it('replaces the temporary password, clears flag, expiry and legacy flag in one update, and revokes other sessions around it', async () => {
    const { deps, calls } = changeDeps();
    const response = await changeInitialPasswordHandler(post({ password: GOOD }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, refreshSession: true });
    expect(deps.updateUser).toHaveBeenCalledExactlyOnceWith(userId, {
      password: GOOD,
      app_metadata: { must_change_password: null, temporary_password_expires_at: null, password_set_by_owner_at: NOW.toISOString() },
      user_metadata: { must_change_password: null },
    });
    expect(deps.revokeOtherSessions).toHaveBeenCalledWith('synthetic-access-token');
    expect(calls).toEqual(['revoke', 'update', 'revoke']);
    expect(deps.passwordIsCurrent).toHaveBeenCalledWith('medica@example.invalid', GOOD);
  });

  it('accepts a legacy account flagged only in user_metadata, within 72 hours of creation', async () => {
    const { deps } = changeDeps({}, { appMetadata: {}, userMetadata: { must_change_password: true }, createdAt: '2026-11-10T13:00:00Z' });
    expect((await changeInitialPasswordHandler(post({ password: GOOD }), deps)).status).toBe(200);
    expect(deps.updateUser).toHaveBeenCalledWith(userId, expect.objectContaining({ user_metadata: { must_change_password: null } }));
  });

  it.each([
    ['an expired temporary password', { appMetadata: { must_change_password: true, temporary_password_expires_at: '2026-11-11T11:59:59Z' } }],
    ['a flag without a valid expiry (fails closed)', { appMetadata: { must_change_password: true, temporary_password_expires_at: 'never' } }],
    ['a legacy flag older than 72 hours', { appMetadata: {}, userMetadata: { must_change_password: true }, createdAt: '2026-11-08T11:00:00Z' }],
  ])('refuses %s with the expired code and changes nothing', async (_label, caller) => {
    const { deps } = changeDeps({}, caller);
    const response = await changeInitialPasswordHandler(post({ password: GOOD }), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Senha temporária vencida. Peça uma nova ao administrador da clínica.',
      code: 'temporary_password_expired',
    });
    expect(deps.updateUser).not.toHaveBeenCalled();
    expect(deps.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it('refuses an account that has no pending temporary password (no silent password reset)', async () => {
    const { deps } = changeDeps({}, { appMetadata: { password_set_by_owner_at: '2026-11-10T00:00:00Z' }, userMetadata: { must_change_password: false } });
    const response = await changeInitialPasswordHandler(post({ password: GOOD }), deps);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('password_change_not_required');
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it.each([['short', 'curta123'], ['repeated', 'aaaaaaaaaaaa'], ['sequential', '1234567890'], ['common', 'Senha12345'], ['email', 'medica-segura-2026'], ['missing', undefined]])(
    'refuses a weak password (%s)', async (_label, password) => {
      const { deps } = changeDeps();
      const response = await changeInitialPasswordHandler(post({ password }), deps);
      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe('weak_password');
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

  it('refuses the temporary password itself, so the owner notices a takeover', async () => {
    const { deps } = changeDeps({ passwordIsCurrent: vi.fn(async () => true) });
    const response = await changeInitialPasswordHandler(post({ password: GOOD }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'same_as_temporary', error: 'Escolha uma senha diferente da senha temporária.' });
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('answers the authentication failure untouched (no token, invalid token, MFA pending)', async () => {
    const { deps } = changeDeps({ authenticate: vi.fn(async () => { throw new SyntheticAuthError(); }) });
    expect((await changeInitialPasswordHandler(post({ password: GOOD }), deps)).status).toBe(401);
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('changes nothing when the first session revocation fails, and reports a retryable error', async () => {
    const { deps } = changeDeps({ revokeOtherSessions: vi.fn(async () => { throw new Error('down'); }) });
    const response = await changeInitialPasswordHandler(post({ password: GOOD }), deps);
    expect(response.status).toBe(503);
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('reports a failed Auth update without claiming success', async () => {
    const { deps } = changeDeps({ updateUser: vi.fn(async () => { throw new Error('down'); }) });
    const response = await changeInitialPasswordHandler(post({ password: GOOD }), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Não foi possível salvar a nova senha. Tente novamente.' });
  });

  it('keeps the success when only the closing revocation fails, and logs it', async () => {
    let n = 0;
    const { deps } = changeDeps({ revokeOtherSessions: vi.fn(async () => { if (++n === 2) throw new Error('down'); }) });
    expect((await changeInitialPasswordHandler(post({ password: GOOD }), deps)).status).toBe(200);
    expect(deps.log).toHaveBeenCalledWith('password_change_second_revoke_failed', { userId });
  });

  it('rejects other methods and malformed bodies', async () => {
    const { deps } = changeDeps();
    expect((await changeInitialPasswordHandler(new Request('https://edge.invalid', { method: 'GET' }), deps)).status).toBe(405);
    expect((await changeInitialPasswordHandler(new Request('https://edge.invalid', { method: 'OPTIONS' }), deps)).status).toBe(200);
    expect((await changeInitialPasswordHandler(new Request('https://edge.invalid', { method: 'POST', body: '[]' }), deps)).status).toBe(400);
    expect(deps.updateUser).not.toHaveBeenCalled();
  });
});

function reissueDeps(overrides: Partial<ReissueTemporaryPasswordDeps> = {}, account: Record<string, unknown> = {}) {
  const deps: ReissueTemporaryPasswordDeps = {
    corsHeaders: {},
    authenticate: vi.fn(async () => ({ userId: adminId })),
    authFailure: (error) => (error instanceof SyntheticAuthError ? new Response(null, { status: 403 }) : null),
    now: () => NOW,
    adminClinic: vi.fn(async () => clinicId),
    clinicAccount: vi.fn(async () => ({ kind: 'doctor' as const })),
    getAccount: vi.fn(async () => ({ email: 'medica@example.invalid', appMetadata: pendingApp(), userMetadata: {}, ...account })),
    updateUser: vi.fn(async () => {}),
    generatePassword: () => 'NovaSenhaTemp2X',
    audit: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  };
  return deps;
}

describe('reissue-temporary-password', () => {
  it('issues a new temporary password with a fresh 72-hour expiry for a pending account of the clinic', async () => {
    const deps = reissueDeps();
    const response = await reissueTemporaryPasswordHandler(post({ userId }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, email: 'medica@example.invalid', temporaryPassword: 'NovaSenhaTemp2X' });
    expect(deps.updateUser).toHaveBeenCalledExactlyOnceWith(userId, {
      password: 'NovaSenhaTemp2X',
      app_metadata: { must_change_password: true, temporary_password_expires_at: '2026-11-14T12:00:00.000Z' },
    });
    expect(deps.clinicAccount).toHaveBeenCalledWith(clinicId, userId);
    expect(deps.audit).toHaveBeenCalledWith(clinicId, adminId, userId, 'doctor');
  });

  it('re-issues an expired one (the expiry is reset)', async () => {
    const deps = reissueDeps({}, { appMetadata: { must_change_password: true, temporary_password_expires_at: '2026-11-01T00:00:00Z' } });
    expect((await reissueTemporaryPasswordHandler(post({ userId }), deps)).status).toBe(200);
  });

  it.each([
    ['owner already set a password', { appMetadata: { password_set_by_owner_at: '2026-11-10T00:00:00Z' }, userMetadata: {} }],
    ['self-registered account', { appMetadata: {}, userMetadata: {} }],
    ['legacy flag after the owner marker', { appMetadata: { password_set_by_owner_at: '2026-11-10T00:00:00Z' }, userMetadata: { must_change_password: true } }],
  ])('never resets a password the owner chose (%s)', async (_label, account) => {
    const deps = reissueDeps({}, account);
    const response = await reissueTemporaryPasswordHandler(post({ userId }), deps);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('password_owned');
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('refuses a non-admin, an account outside the clinic, the admin themself and malformed ids', async () => {
    const cases: Array<[ReissueTemporaryPasswordDeps, unknown, number]> = [
      [reissueDeps({ adminClinic: vi.fn(async () => null) }), { userId }, 403],
      [reissueDeps({ clinicAccount: vi.fn(async () => null) }), { userId }, 403],
      [reissueDeps({ getAccount: vi.fn(async () => null) }), { userId }, 403],
      [reissueDeps(), { userId: adminId }, 403],
      [reissueDeps(), { userId: 'not-a-uuid' }, 400],
      [reissueDeps({ authenticate: vi.fn(async () => { throw new SyntheticAuthError(); }) }), { userId }, 403],
    ];
    for (const [deps, body, status] of cases) {
      expect((await reissueTemporaryPasswordHandler(post(body), deps)).status).toBe(status);
      expect(deps.updateUser).not.toHaveBeenCalled();
    }
  });
});

describe('temporary password policy', () => {
  it('flags pending accounts from either metadata and computes the expiry', () => {
    expect(passwordChangePending({ app_metadata: { must_change_password: true } })).toBe(true);
    expect(passwordChangePending({ user_metadata: { must_change_password: true } })).toBe(true);
    expect(passwordChangePending({ app_metadata: { must_change_password: 'true' }, user_metadata: {} })).toBe(false);
    expect(passwordChangePending({})).toBe(false);
    expect(temporaryPasswordAppMetadata(NOW)).toEqual({ must_change_password: true, temporary_password_expires_at: '2026-11-14T12:00:00.000Z' });
    expect(temporaryPasswordExpired({ app_metadata: temporaryPasswordAppMetadata(NOW) }, new Date('2026-11-14T11:59:59Z'))).toBe(false);
    expect(temporaryPasswordExpired({ app_metadata: temporaryPasswordAppMetadata(NOW) }, new Date('2026-11-14T12:00:00Z'))).toBe(true);
  });
  it('accepts a reasonable owner password and explains refusals in Portuguese', () => {
    expect(passwordProblem(GOOD, 'medica@example.invalid')).toBeNull();
    expect(passwordProblem('x'.repeat(73))).toMatch(/72/);
    expect(passwordProblem(' espaco-no-inicio')).toMatch(/espaço/);
    expect(passwordProblem('abcdefghijkl')).toMatch(/fácil/);
  });
  it('generates unambiguous 14-character temporary passwords', () => {
    const value = generateTemporaryPassword();
    expect(value).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/);
    expect(generateTemporaryPassword()).not.toBe(value);
  });
});
