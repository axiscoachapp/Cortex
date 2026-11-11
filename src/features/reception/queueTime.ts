import { useEffect, useState } from 'react';
import { clinicDateLabel, clinicDay, clinicTime } from './dates';

/** Time only for today's messages (clinic day); the date as well for older ones. */
export function messageTimeLabel(at: string, now = Date.now()) {
  return clinicDay(at) === clinicDay(new Date(now).toISOString()) ? clinicTime(at) : `${clinicDateLabel(at)} · ${clinicTime(at)}`;
}

/** "agora", "há 12 min", "há 2 h 5 min", "há 3 dias": how long a case has been waiting. */
export function waitingLabel(createdAt: string, now: number): string {
  const started = Date.parse(createdAt);
  if (!Number.isFinite(started)) return '';
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `há ${hours} h ${minutes % 60} min` : `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

/** The current time, refreshed every minute, so waiting times move on their own. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Brazilian numbers stored in international form read as "(41) 99999-0001"; anything else is shown as typed. */
export function displayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim();

/** Name (accents and case ignored) or phone digits (3 or more). An empty search matches everything. */
export function matchesContactSearch(item: { contactName: string; phone: string; subject?: string }, search: string): boolean {
  const query = fold(search);
  if (!query) return true;
  const digits = query.replace(/\D/g, '');
  if (digits.length >= 3 && /^[\d\s()+-]+$/.test(query)) return item.phone.replace(/\D/g, '').includes(digits);
  return fold(item.contactName).includes(query) || (item.subject !== undefined && fold(item.subject).includes(query));
}
