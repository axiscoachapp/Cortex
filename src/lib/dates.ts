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

export function daysSinceDateOnly(value: string | null, now = new Date()): number {
  if (!value) return 0;
  if (formatDateOnly(value) === 'Data inválida') return 0;
  return Math.round((Date.parse(`${clinicDate(now)}T12:00:00Z`) - Date.parse(`${value}T12:00:00Z`)) / 86_400_000);
}

export function ageAtDate(birthDate: string, onDate = clinicDate()): number | null {
  if (formatDateOnly(birthDate)==='Data inválida'||formatDateOnly(onDate)==='Data inválida'||birthDate>onDate) return null;
  const years=Number(onDate.slice(0,4))-Number(birthDate.slice(0,4))-(onDate.slice(5)<birthDate.slice(5)?1:0);
  return years>=0&&years<=150?years:null;
}
