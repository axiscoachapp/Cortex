export class ClinicAccessTransportError extends Error {
  readonly code = 'CLINIC_ACCESS_TRANSPORT';
  constructor() {
    super('Não foi possível atualizar o acesso à clínica.');
    this.name = 'ClinicAccessTransportError';
  }
}

// Do not mistake an authorization/contract error for availability. Status zero
// is PostgREST's fetch-failure envelope; malformed JSON is not a network grant.
export function isClinicAccessTransportFailure(status: number, error: { code?: string; message?: string }) {
  const code = error.code ?? '';
  if (status === 0) return !code && /^(TypeError|FetchError|AbortError|TimeoutError):/.test(error.message ?? '');
  if (status === 502) return !code;
  if (status === 503) return ['', 'PGRST000', 'PGRST001', 'PGRST002'].includes(code);
  if (status === 504) return ['', 'PGRST003'].includes(code);
  return false;
}
