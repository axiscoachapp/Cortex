#!/usr/bin/env node
// PersonalMed 2005 -> Cortex: confirm what the agenda codes mean (D9).
// For each appointment state (Age04.Estado) and each slot type (age03.Tipo)
// this prints what actually happened: arrival time recorded, start of care
// recorded, a consultation record the same day for the same patient and
// doctor, past or future, typical duration and time of day.
//
// PRIVACY: counts and percentages only. No patient field is printed.
//
// Usage: node --max-old-space-size=6144 scripts/personalmed/agenda-states.mjs <exportDir> [--export-date 2026-08-24]

import { readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ParadoxTable, toCalendarDate } from './paradox-reader.mjs';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error('usage: agenda-states.mjs <exportDir> [--export-date D]');
const exportDate = args[args.indexOf('--export-date') + 1] && args.includes('--export-date') ? args[args.indexOf('--export-date') + 1] : '2026-08-24';
const px = (name) => new ParadoxTable(join(dir, readdirSync(dir).find((x) => extname(x).toLowerCase() === '.db' && basename(x, extname(x)).toLowerCase() === name.toLowerCase())));
function* rows(table, fields) {
  const idx = fields.map((n) => table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase()).index);
  for (const r of table.records({ fields, blobs: 'none' })) {
    const o = {};
    fields.forEach((n, i) => {
      o[n] = r[idx[i]];
    });
    yield o;
  }
}
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const iso = (v) => toCalendarDate(v)?.iso ?? null;
const minutes = (t) => (t && typeof t.timeMs === 'number' ? Math.round(t.timeMs / 60000) : null);
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);

// Days with a clinical record for (patient, doctor): consultation evidence.
const seen = new Set();
for (const r of rows(px('Co28'), ['PCod', 'UserNumber', 'DataInsert'])) {
  const d = iso(r.DataInsert);
  if (d && r.PCod != null) seen.add(`${r.PCod}|${r.UserNumber}|${d}`);
}
for (const r of rows(px('Co12_2'), ['PCod', 'UserNumber', 'DateInsert'])) {
  const d = iso(r.DateInsert);
  if (d && r.PCod != null) seen.add(`${r.PCod}|${r.UserNumber}|${d}`);
}

// Slots: type per (doctor, day, start).
const slotType = new Map();
const slots = new Map(); // type -> stats
for (const r of rows(px('age03'), ['UserNumber', 'Data', 'Inicio', 'Duracao', 'Tipo'])) {
  const d = iso(r.Data);
  const start = minutes(r.Inicio);
  const type = str(r.Tipo) || '(vazio)';
  if (d && start != null) slotType.set(`${r.UserNumber}|${d}|${start}`, type);
  const s = slots.get(type) ?? { total: 0, future: 0, withAppointment: 0, durations: [], hours: new Map(), weekdays: new Map() };
  s.total += 1;
  if (d && d > exportDate) s.future += 1;
  if (typeof r.Duracao === 'number') s.durations.push(r.Duracao);
  if (start != null) s.hours.set(Math.floor(start / 60), (s.hours.get(Math.floor(start / 60)) ?? 0) + 1);
  if (d) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    s.weekdays.set(wd, (s.weekdays.get(wd) ?? 0) + 1);
  }
  slots.set(type, s);
}

const states = new Map();
for (const r of rows(px('Age04'), ['UserNumber', 'Data', 'Inicio', 'PCod', 'Estado', 'Chegada', 'InicioAtendimento'])) {
  const d = iso(r.Data);
  const st = str(r.Estado) || '-';
  const when = !d ? 'sem data' : d > exportDate ? 'futuro' : 'passado';
  const key = `${st}|${when}`;
  const s = states.get(key) ?? { total: 0, arrival: 0, careStart: 0, clinicalSameDay: 0, withPatient: 0 };
  s.total += 1;
  if (minutes(r.Chegada)) s.arrival += 1;
  if (minutes(r.InicioAtendimento)) s.careStart += 1;
  if (r.PCod != null) s.withPatient += 1;
  if (d && r.PCod != null && seen.has(`${r.PCod}|${r.UserNumber}|${d}`)) s.clinicalSameDay += 1;
  states.set(key, s);
  const start = minutes(r.Inicio);
  const type = d && start != null ? slotType.get(`${r.UserNumber}|${d}|${start}`) : null;
  if (type && slots.has(type)) slots.get(type).withAppointment += 1;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const DAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const out = {
  exportDate,
  estados: Object.fromEntries(
    [...states.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([k, s]) => [k, { total: s.total, comPaciente: `${pct(s.withPatient, s.total)}%`, chegadaRegistrada: `${pct(s.arrival, s.total)}%`, inicioDoAtendimento: `${pct(s.careStart, s.total)}%`, registroClinicoNoDia: `${pct(s.clinicalSameDay, s.total)}%` }]),
  ),
  tiposDeHorario: Object.fromEntries(
    [...slots.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([k, s]) => [
        k,
        {
          total: s.total,
          futuros: s.future,
          comAgendamento: `${pct(s.withAppointment, s.total)}%`,
          duracaoMediana: median(s.durations),
          horasMaisComuns: [...s.hours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => `${h}h: ${n}`),
          diasMaisComuns: [...s.weekdays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${DAY[d]}: ${n}`),
        },
      ]),
  ),
};
console.log(JSON.stringify(out, null, 2));
