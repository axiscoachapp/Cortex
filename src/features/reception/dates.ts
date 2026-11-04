const zone = 'America/Sao_Paulo';
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const stamp = (date: Date) => Object.fromEntries(parts.formatToParts(date).map((p) => [p.type, p.value]));

/** Convert clinic wall time without depending on the secretary's device timezone. */
export function clinicTimestamp(day: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error('Informe data e horário válidos.');
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  if (hour > 23 || minute > 59 || new Date(wall).toISOString().slice(0, 10) !== day)
    throw new Error('Informe data e horário válidos.');
  let actual = wall;
  for (let i = 0; i < 3; i++) {
    const p = stamp(new Date(actual));
    const rendered = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    actual += wall - rendered;
  }
  const p = stamp(new Date(actual));
  if (`${p.year}-${p.month}-${p.day}` !== day || `${p.hour}:${p.minute}` !== time)
    throw new Error('Horário indisponível no fuso da clínica.');
  return new Date(actual).toISOString();
}
export const clinicTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
export const clinicDay = (iso: string) => {
  const p = stamp(new Date(iso));
  return `${p.year}-${p.month}-${p.day}`;
};
export const clinicDateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric' });
export function nextClinicDay(day: string, amount = 1): string {
  const value = new Date(day + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
