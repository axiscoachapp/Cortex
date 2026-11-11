/**
 * Temporary-password handlers (review 2026-11-10, security finding 1).
 *
 * change-initial-password: the owner of a provisioned account replaces the temporary password.
 *   It is the only handler that accepts a pending account (auth.ts requirePendingPasswordCaller).
 *   Order matters: the other sessions are revoked while the flag is still set (so a session opened
 *   with the temporary password can never refresh into a full one), then password, flag and expiry
 *   change in one Admin API update, then the other sessions are revoked again to close the gap.
 *   The client must refresh its own session: its current token still carries the old claim.
 * reissue-temporary-password: a clinic admin issues a new temporary password, only for an account
 *   of the clinic that never set its own password (otherwise the admin could take it over).
 *
 * Dependencies are injected (production wiring: passwordChangeDeps.ts) so the logic is unit-tested.
 */
import { readJsonObject, RequestError } from './http.ts';
import {
  passwordChangePending,
  passwordProblem,
  temporaryPasswordAppMetadata,
  temporaryPasswordExpired,
} from './passwordPolicy.ts';

type Json = Record<string, unknown>;

/** The verified caller of change-initial-password (auth.ts requirePendingPasswordCaller). */
export type PendingPasswordCaller = Readonly<{
  userId: string;
  email: string;
  createdAt: string | null;
  appMetadata: Json;
  userMetadata: Json;
  accessToken: string;
}>;
export type AdminUserUpdate = { password: string; app_metadata: Json; user_metadata?: Json };

export type ChangeInitialPasswordDeps = {
  corsHeaders: Record<string, string>;
  authenticate(req: Request): Promise<PendingPasswordCaller>;
  /** Response for an authentication failure, or null when the error is not one. */
  authFailure(error: unknown): Response | null;
  now(): Date;
  /** True when `password` already signs in to the account (i.e. equals the temporary password). */
  passwordIsCurrent(email: string, password: string): Promise<boolean>;
  /** Ends every session of the caller except the one presenting `accessToken`. */
  revokeOtherSessions(accessToken: string): Promise<void>;
  updateUser(userId: string, update: AdminUserUpdate): Promise<void>;
  log(event: string, detail: Json): void;
};

export type ReissueTarget = { kind: 'doctor' | 'reception' };
export type ManagedAccount = { email: string; appMetadata: Json; userMetadata: Json };

export type ReissueTemporaryPasswordDeps = {
  corsHeaders: Record<string, string>;
  authenticate(req: Request): Promise<{ userId: string }>;
  authFailure(error: unknown): Response | null;
  now(): Date;
  /** Clinic where the caller is an active admin, or null. */
  adminClinic(userId: string): Promise<string | null>;
  /** The target when it is an active doctor or receptionist of that clinic, otherwise null. */
  clinicAccount(clinicId: string, targetId: string): Promise<ReissueTarget | null>;
  getAccount(userId: string): Promise<ManagedAccount | null>;
  updateUser(userId: string, update: AdminUserUpdate): Promise<void>;
  generatePassword(): string;
  audit(clinicId: string, actorId: string, targetId: string, kind: ReissueTarget['kind']): Promise<void>;
  log(event: string, detail: Json): void;
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function json(body: Json, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function preflight(req: Request, cors: Record<string, string>): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors });
  return null;
}

export const EXPIRED_MESSAGE = 'Senha temporária vencida. Peça uma nova ao administrador da clínica.';

export async function changeInitialPasswordHandler(req: Request, deps: ChangeInitialPasswordDeps): Promise<Response> {
  const cors = deps.corsHeaders;
  const early = preflight(req, cors);
  if (early) return early;
  let caller: PendingPasswordCaller;
  try {
    caller = await deps.authenticate(req);
  } catch (error) {
    const failure = deps.authFailure(error);
    if (failure) return failure;
    return json({ error: 'Não foi possível verificar sua sessão. Tente novamente.' }, 503, cors);
  }
  try {
    const body = await readJsonObject(req, 4096);
    const account = { app_metadata: caller.appMetadata, user_metadata: caller.userMetadata, created_at: caller.createdAt };
    if (!passwordChangePending(account))
      return json({ error: 'Esta conta já tem uma senha pessoal.', code: 'password_change_not_required' }, 409, cors);
    if (temporaryPasswordExpired(account, deps.now()))
      return json({ error: EXPIRED_MESSAGE, code: 'temporary_password_expired' }, 403, cors);
    const problem = passwordProblem(body.password, caller.email);
    if (problem) return json({ error: problem, code: 'weak_password' }, 422, cors);
    const password = body.password as string;
    if (await deps.passwordIsCurrent(caller.email, password))
      return json({ error: 'Escolha uma senha diferente da senha temporária.', code: 'same_as_temporary' }, 422, cors);

    // While the flag is still set, no other session can do anything; ending them now means none
    // of them (e.g. one opened by whoever else knew the temporary password) survives the change.
    await deps.revokeOtherSessions(caller.accessToken);
    const changedAt = deps.now().toISOString();
    await deps.updateUser(caller.userId, {
      password,
      // null removes the key in Auth's metadata merge.
      app_metadata: { must_change_password: null, temporary_password_expires_at: null, password_set_by_owner_at: changedAt },
      user_metadata: { must_change_password: null },
    });
    try {
      await deps.revokeOtherSessions(caller.accessToken);
    } catch {
      deps.log('password_change_second_revoke_failed', { userId: caller.userId });
    }
    deps.log('initial_password_changed', { userId: caller.userId });
    return json({ success: true, refreshSession: true }, 200, cors);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status, cors);
    deps.log('initial_password_change_failed', { userId: caller.userId, error: error instanceof Error ? error.name : 'unknown' });
    return json({ error: 'Não foi possível salvar a nova senha. Tente novamente.' }, 503, cors);
  }
}

// ---------------------------------------------------------------- change-password (round two, C24)

/**
 * A signed-in owner changes their own password, proving the current one. Same rule as every
 * owner-chosen password (passwordPolicy.ts). A pending temporary password goes through
 * change-initial-password instead. Other sessions are ended after the change (a password is
 * usually changed because it may be known to someone else); the caller's session stays.
 */
export type ChangeOwnPasswordDeps = Omit<ChangeInitialPasswordDeps, 'passwordIsCurrent'> & {
  /** 'ok' when the password signs in to the account, 'wrong' when it does not. */
  checkPassword(email: string, password: string): Promise<'ok' | 'wrong'>;
};

export async function changeOwnPasswordHandler(req: Request, deps: ChangeOwnPasswordDeps): Promise<Response> {
  const cors = deps.corsHeaders;
  const early = preflight(req, cors);
  if (early) return early;
  let caller: PendingPasswordCaller;
  try {
    caller = await deps.authenticate(req);
  } catch (error) {
    const failure = deps.authFailure(error);
    if (failure) return failure;
    return json({ error: 'Não foi possível verificar sua sessão. Tente novamente.' }, 503, cors);
  }
  try {
    const body = await readJsonObject(req, 4096);
    const account = { app_metadata: caller.appMetadata, user_metadata: caller.userMetadata, created_at: caller.createdAt };
    if (passwordChangePending(account))
      return json({ error: 'Troque primeiro a senha temporária.', code: 'password_change_required' }, 409, cors);
    if (typeof body.currentPassword !== 'string' || !body.currentPassword)
      return json({ error: 'Informe a senha atual.', code: 'current_required' }, 422, cors);
    const problem = passwordProblem(body.password, caller.email);
    if (problem) return json({ error: problem, code: 'weak_password' }, 422, cors);
    const password = body.password as string;
    if (password === body.currentPassword)
      return json({ error: 'Escolha uma senha diferente da atual.', code: 'same_as_current' }, 422, cors);
    if (await deps.checkPassword(caller.email, body.currentPassword) !== 'ok')
      return json({ error: 'A senha atual não confere.', code: 'wrong_password' }, 403, cors);
    await deps.updateUser(caller.userId, { password, app_metadata: { password_set_by_owner_at: deps.now().toISOString() } });
    try {
      await deps.revokeOtherSessions(caller.accessToken);
    } catch {
      deps.log('password_change_revoke_failed', { userId: caller.userId });
    }
    deps.log('password_changed', { userId: caller.userId });
    return json({ success: true }, 200, cors);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status, cors);
    deps.log('password_change_failed', { userId: caller.userId, error: error instanceof Error ? error.name : 'unknown' });
    return json({ error: 'Não foi possível trocar a senha agora. Tente novamente.' }, 503, cors);
  }
}

/** Pending accounts only: never one whose owner already chose a password. */
function reissuable(account: ManagedAccount): boolean {
  if (account.appMetadata.must_change_password === true) return true;
  return account.userMetadata.must_change_password === true && !('password_set_by_owner_at' in account.appMetadata);
}

export async function reissueTemporaryPasswordHandler(req: Request, deps: ReissueTemporaryPasswordDeps): Promise<Response> {
  const cors = deps.corsHeaders;
  const early = preflight(req, cors);
  if (early) return early;
  let actorId: string;
  try {
    actorId = (await deps.authenticate(req)).userId;
  } catch (error) {
    const failure = deps.authFailure(error);
    if (failure) return failure;
    return json({ error: 'Não foi possível verificar sua sessão. Tente novamente.' }, 503, cors);
  }
  try {
    const body = await readJsonObject(req, 1024);
    const targetId = typeof body.userId === 'string' ? body.userId : '';
    if (!UUID.test(targetId)) throw new RequestError('Conta inválida.');
    if (targetId === actorId) throw new RequestError('Use a sua própria tela de segurança para trocar a sua senha.', 403);
    const clinicId = await deps.adminClinic(actorId);
    if (!clinicId) throw new RequestError('Somente o administrador da clínica pode gerar senhas temporárias.', 403);
    const target = await deps.clinicAccount(clinicId, targetId);
    if (!target) throw new RequestError('Esta conta não está ativa na sua clínica.', 403);
    const account = await deps.getAccount(targetId);
    if (!account) throw new RequestError('Esta conta não está ativa na sua clínica.', 403);
    if (!reissuable(account))
      return json({
        error: 'Esta pessoa já definiu a própria senha. Por segurança, o administrador não pode trocá-la.',
        code: 'password_owned',
      }, 409, cors);
    const temporaryPassword = deps.generatePassword();
    await deps.updateUser(targetId, {
      password: temporaryPassword,
      app_metadata: temporaryPasswordAppMetadata(deps.now()),
    });
    try {
      await deps.audit(clinicId, actorId, targetId, target.kind);
    } catch {
      deps.log('temporary_password_reissue_audit_failed', { clinicId, targetId });
    }
    deps.log('temporary_password_reissued', { clinicId, actorId, targetId, kind: target.kind });
    return json({ success: true, email: account.email, temporaryPassword }, 200, cors);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status, cors);
    deps.log('temporary_password_reissue_failed', { error: error instanceof Error ? error.name : 'unknown' });
    return json({ error: 'Não foi possível gerar a nova senha temporária. Tente novamente.' }, 503, cors);
  }
}
