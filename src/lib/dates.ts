/** Calendar dates are not instants. Never parse a SQL DATE in the browser timezone. */
export function formatDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Data inválida';
  const [, year, month, day] = match;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'Data inválida';
  return `${day}/${month}/${year}`;
}

export function clinicDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

export function daysSinceDateOnly(value: string, now = new Date()): number {
  if (formatDateOnly(value) === 'Data inválida') return 0;
  return Math.round((Date.parse(`${clinicDate(now)}T12:00:00Z`) - Date.parse(`${value}T12:00:00Z`)) / 86_400_000);
}
