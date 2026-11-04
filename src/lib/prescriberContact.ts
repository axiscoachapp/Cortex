// Client-side mirror of the prescriber contact checks in migration
// 20261104100000 (user_settings.professional_phone and rqe). The server is
// still the authority; this only gives a clear message before saving.

/** Error message for the professional phone, or null when it is acceptable. */
export function professionalPhoneError(value: string): string | null {
  const phone = value.trim();
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!/^[+0-9 ().-]+$/.test(phone) || digits.length < 10 || digits.length > 15)
    return 'Informe o telefone profissional com DDD, por exemplo (41) 3000-0000.';
  return null;
}

/** Error message for the RQE, or null when it is acceptable. */
export function rqeError(value: string): string | null {
  const rqe = value.trim();
  // eslint-disable-next-line no-control-regex
  if (rqe.length > 60 || /[\u0000-\u001f\u007f]/.test(rqe)) return 'Revise o RQE: até 60 caracteres.';
  return null;
}
