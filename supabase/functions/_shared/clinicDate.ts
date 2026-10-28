const CLINIC_ZONE = 'America/Sao_Paulo';
export function clinicDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(p => p.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Convert the clinic's calendar day to an explicit [start,end) UTC interval. */
export function clinicDayBounds(now = new Date()): { start: string; end: string } {
  const [year, month, day] = clinicDate(now).split('-').map(Number);
  const midnight = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: CLINIC_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const n = (type: string) => Number(parts.find(p => p.type === type)!.value);
    const offset = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - date.getTime();
    return new Date(date.getTime() - offset).toISOString();
  };
  return { start: midnight(new Date(Date.UTC(year, month - 1, day))), end: midnight(new Date(Date.UTC(year, month - 1, day + 1))) };
}
