// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { changeOwnPasswordHandler, type ChangeOwnPasswordDeps } from '../../supabase/functions/_shared/passwordChange';

const NOW = new Date('2026-11-11T12:00:00Z');
const userId = 'c7100000-0000-4000-8000-000000000002';
const CURRENT = 'senha-atual-sintetica-1';
const GOOD = 'cavalo-azul-lagoa-17';

function deps(overrides: Partial<ChangeOwnPasswordDeps> = {}, caller: Record<string, unknown> = {}) {
  const d: ChangeOwnPasswordDeps = {
    corsHeaders: {},
    authenticate: vi.fn(async () => ({ userId, email: 'medica@example.invalid', createdAt: null, appMetadata: {}, userMetadata: {}, accessToken: 'synthetic-token', ...caller })),
    authFailure: () => null,
    now: () => NOW,
    checkPassword: vi.fn(async (_e: string, p: string) => (p === CURRENT ? 'ok' as const : 'wrong' as const)),
    revokeOtherSessions: vi.fn(async () => {}),
    updateUser: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  };
  return d;
}
const post = (body: unknown) => new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify(body) });

describe('change-password (signed-in owner)', () => {
  it('changes the password after proving the current one and ends the other sessions', async () => {
    const d = deps();
    const r = await changeOwnPasswordHandler(post({ currentPassword: CURRENT, password: GOOD }), d);
    expect(r.status).toBe(200);
    expect(d.checkPassword).toHaveBeenCalledWith('medica@example.invalid', CURRENT);
    expect(d.updateUser).toHaveBeenCalledWith(userId, { password: GOOD, app_metadata: { password_set_by_owner_at: NOW.toISOString() } });
    expect(d.revokeOtherSessions).toHaveBeenCalledWith('synthetic-token');
  });

  it.each([
    ['a wrong current password', { currentPassword: 'outra-senha-qualquer', password: GOOD }, 403, 'wrong_password'],
    ['no current password', { password: GOOD }, 422, 'current_required'],
    ['a short password', { currentPassword: CURRENT, password: 'curta' }, 422, 'weak_password'],
    ['a guessable password', { currentPassword: CURRENT, password: '1234567890' }, 422, 'weak_password'],
    ['the same password', { currentPassword: GOOD, password: GOOD }, 422, 'same_as_current'],
  ])('refuses %s and changes nothing', async (_label, body, status, code) => {
    const d = deps();
    const r = await changeOwnPasswordHandler(post(body), d);
    expect([r.status, (await r.json()).code]).toEqual([status, code]);
    expect(d.updateUser).not.toHaveBeenCalled();
  });

  it('sends a pending temporary password to its own flow', async () => {
    const d = deps({}, { appMetadata: { must_change_password: true } });
    const r = await changeOwnPasswordHandler(post({ currentPassword: CURRENT, password: GOOD }), d);
    expect([r.status, (await r.json()).code]).toEqual([409, 'password_change_required']);
    expect(d.checkPassword).not.toHaveBeenCalled();
  });
});
