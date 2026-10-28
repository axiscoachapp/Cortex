export function escapeHtml(value: string): string {
  const escaped: Record<string,string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  return value.replace(/[&<>"']/g, character => escaped[character]);
}
export function whatsappPhone(value: unknown): string {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) throw new Error('Telefone inválido');
  const digits = value.replace(/\D/g,'');
  if (value.trim().startsWith('+')) {
    if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('Telefone inválido');
    return digits;
  }
  if (/^55\d{10,11}$/.test(digits)) return digits;
  if (/^[1-9]\d{9,10}$/.test(digits)) return `55${digits}`;
  throw new Error('Informe DDD e telefone ou código internacional com +');
}

export function canRemindAppointment(status: string, startsAt: string | Date, now = new Date()): boolean {
  const start = startsAt instanceof Date ? startsAt.getTime() : Date.parse(startsAt);
  return ['agendado', 'confirmado'].includes(status) && Number.isFinite(start) && start > now.getTime();
}
