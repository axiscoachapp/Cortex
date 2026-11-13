#!/usr/bin/env node
// Choose a small, varied sample of people for an end-to-end conversion test.
// Each pick exercises a different part of the legacy record, so that a handful
// of charts touches every table the migration has to read:
//   - "rare": the person present in the most small specialty tables (images,
//     lab results, exam reports, breast, delivery, urogynecology, surgery);
//   - "prenatal": a pregnancy followed here, with many prenatal visits;
//   - "urology": a chart of the urologist (the only non-gynecology doctor).
// Deterministic (ties break on the lowest PCod). Prints legacy keys and counts
// only; never a name or a clinical value.
//
// Usage: node scripts/personalmed/pick-sample.mjs <exportDir> [--exclude 1,2] [--since 2024-01-01]

import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ParadoxTable, listTables, toCalendarDate } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error('usage: pick-sample.mjs <exportDir> [--exclude 1,2] [--since YYYY-MM-DD]');
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const excluded = new Set((opt('--exclude') ?? '').split(',').map(Number).filter(Number.isFinite));
const since = opt('--since') ?? '2024-01-01';
const UROLOGIST = 9;
const RARE = /^(clini_04|clini_08|co31|co31_\d|co43|co52|co53|co53_\d|co54|co54_\d|co55|co55_\d|co50|co51)$/i;

const counts = new Map(); // table -> Map(pcod -> rows)
const bump = (table, pcod) => {
  if (pcod == null) return;
  if (!counts.has(table)) counts.set(table, new Map());
  const m = counts.get(table);
  m.set(pcod, (m.get(pcod) ?? 0) + 1);
};
for (const path of listTables(dir)) {
  let table;
  try { table = new ParadoxTable(path); } catch { continue; }
  if (!table.header.numRecords) continue;
  const key = table.fields.find((f) => /^pcod$/i.test(f.name));
  if (!key) continue;
  for (const r of table.records({ fields: [key.name], blobs: 'none' })) bump(table.name.toLowerCase(), r[key.index]);
}
const mdf = new Mdf(readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0]);
const field = (table, name) => table.fields.find((x) => x.name.toLowerCase() === name.toLowerCase()).index;
const doctors = new Map(); // pcod -> Set(user)
const lastVisit = new Map();
{
  const t = mdf.table('Clini_02');
  const [p, u, l] = ['PCod', 'UserNumber', 'LastMedAdvice'].map((n) => field(t, n));
  for (const r of t.records({ fields: ['PCod', 'UserNumber', 'LastMedAdvice'] })) {
    if (!doctors.has(r[p])) doctors.set(r[p], new Set());
    doctors.get(r[p]).add(r[u]);
    const d = toCalendarDate(r[l])?.iso ?? '';
    if (d > (lastVisit.get(r[p]) ?? '')) lastVisit.set(r[p], d);
  }
}
{
  const t = mdf.table('Me');
  const p = field(t, 'PCod');
  for (const r of t.records({ fields: ['PCod'] })) bump('me', r[p]);
}
const n = (table, pcod) => counts.get(table)?.get(pcod) ?? 0;
const people = [...doctors.keys()].filter((p) => !excluded.has(p) && (lastVisit.get(p) ?? '') >= since).sort((a, b) => a - b);
const volume = (p) => n('co28', p) + n('clini_06', p) + n('co12_2', p) + n('me', p);
const describe = (p) => ({ pcod: p, doctors: [...doctors.get(p)].sort((a, b) => a - b), lastVisit: (lastVisit.get(p) ?? '').slice(0, 7), rows: Object.fromEntries([...counts.keys()].filter((t) => n(t, p)).sort().map((t) => [t, n(t, p)])) });
const best = (score, filter = () => true) => people.filter(filter).map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.p - b.p)[0]?.p ?? null;

const taken = new Set();
const picks = {};
const take = (label, pcod) => { if (pcod != null) { picks[label] = describe(pcod); taken.add(pcod); } };
// Rare tables first: distinct rare tables weigh most, then their rows.
take('rare', best((p) => [...counts.keys()].filter((t) => RARE.test(t) && n(t, p)).length * 1000 + Math.min(volume(p), 999)));
take('prenatal', best((p) => (n('co49_2', p) >= 6 ? n('co49_2', p) * 10 + Math.min(n('co28', p) + n('clini_06', p), 9) : 0), (p) => !taken.has(p)));
take('urology', best((p) => Math.min(volume(p), 400), (p) => !taken.has(p) && doctors.get(p).has(UROLOGIST)));
console.log(JSON.stringify({ since, eligible: people.length, picks }, null, 1));
