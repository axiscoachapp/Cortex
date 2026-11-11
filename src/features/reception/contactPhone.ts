// Mirrors public.normalize_reception_phone, so the receptionist sees the server's
// rule under the field instead of a refusal after submitting.
const allowed = /^[+0-9 ().-]+$/;
const digitsOf = (raw: string) => raw.replace(/\D/g, '');

export const phoneHint = 'Celular ou fixo com DDD, por exemplo (41) 99999-0000. De outro país: + e o código.';

/** The problem with a typed phone, or null when it is empty or valid. */
export function phoneProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const digits = digitsOf(value);
  if (value.length > 40 || !allowed.test(value)) return 'Use só números, espaços, parênteses, traço e +.';
  if (digits.length < 10) return 'Faltam números: informe o DDD e o número completo.';
  if (digits.length > 15) return 'Número longo demais. Confira o telefone.';
  return null;
}

/** Same normalization as the server: Brazilian numbers gain the 55 country code. */
export function normalizePhone(raw: string): string | null {
  const value = raw.trim();
  if (!value || phoneProblem(value)) return null;
  const digits = digitsOf(value);
  return !value.startsWith('+') && (digits.length === 10 || digits.length === 11) ? '55' + digits : digits;
}
