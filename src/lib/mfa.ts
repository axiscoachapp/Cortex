/** pt-BR message for a Supabase Auth MFA error (AuthApiError carries a `code`). */
export function mfaErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  switch (code) {
    case 'mfa_verification_failed':
    case 'mfa_challenge_expired':
      return 'Código incorreto ou expirado. Confira se o horário do celular está automático e tente o código atual.';
    case 'mfa_factor_name_conflict':
      return 'Já existe um autenticador com este nome. Tente novamente.';
    case 'too_many_enrolled_mfa_factors':
      return 'Limite de autenticadores atingido. Remova um autenticador antigo antes de adicionar outro.';
    case 'mfa_verification_rejected':
    case 'over_request_rate_limit':
      return 'Muitas tentativas seguidas. Aguarde um pouco antes de tentar novamente.';
    default:
      return 'Não foi possível concluir. Confira o código e a conexão e tente novamente.';
  }
}

/** Unique, human-readable authenticator name (Supabase rejects duplicates). */
export function newFactorName(existingCount: number): string {
  const stamp = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  return `Autenticador ${existingCount + 1} · ${stamp} · ${Math.random().toString(36).slice(2, 6)}`;
}
