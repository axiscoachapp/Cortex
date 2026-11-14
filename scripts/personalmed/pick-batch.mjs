#!/usr/bin/env node
// Choose a larger, varied batch of people for a conversion and organisation
// test, and write the choice ENCRYPTED into a sample folder (sample.enc), ready
// for `sample.mjs extract <exportDir> --dir <folder>`.
//
// The batch is random but repeatable (--seed) and stratified, so that it holds
// what a handful of hand-picked charts cannot: every doctor, men and women,
// every age band, charts of one visit and charts of twenty years, people last
// seen this year and people last seen long ago, pregnancies, specialty sheets.
//
// Prints the strata of the batch (counts only): never a name, a legacy key or
// a clinical value.
//
// Usage: node scripts/personalmed/pick-batch.mjs <exportDir> --dir <folder> [--count 30] [--seed 1]
//          [--exclude-dir <another sample folder>] [--export-date 2026-08-24]

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadOrCreateKey } from './local-key.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { ParadoxTable, listTables, toCalendarDate } from './paradox-reader.mjs';
import { decryptBuffer, encryptBuffer } from './secure-staging.mjs';

const args = process.argv.slice(2);
const exportDir = args[0];
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const DIR = opt('--dir');
if (!exportDir || !DIR) throw new Error('usage: pick-batch.mjs <exportDir> --dir <folder> [--count 30] [--seed 1] [--exclude-dir <folder>]');
const COUNT = Number(opt('--count') ?? 30);
const EXPORT_DATE = opt('--export-date') ?? '2026-08-24';
const UROLOGIST = 9;
const SHEETS = /^(clini_04|clini_08|co31|co31_\d|co43|co52|co53|co53_\d|co54|co54_\d|co55|co55_\d|co50|co51|co51_1)$/i;
const IMAGES = /^(clini_04|co31_1|co52)$/i;

/** A small seeded generator: the same seed picks the same people. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = seeded(Number(opt('--seed') ?? 1));

// Rows per person in every table that has the person's key.
const counts = new Map(); // table -> Map(pcod -> rows)
const bump = (table, pcod) => {
  if (pcod == null) return;
  if (!counts.has(table)) counts.set(table, new Map());
  counts.get(table).set(pcod, (counts.get(table).get(pcod) ?? 0) + 1);
};
for (const path of listTables(exportDir)) {
  let table;
  try { table = new ParadoxTable(path); } catch { continue; }
  if (!table.header.numRecords) continue;
  const key = table.fields.find((f) => /^pcod$/i.test(f.name));
  if (!key) continue;
  for (const r of table.records({ fields: [key.name], blobs: 'none' })) bump(table.name.toLowerCase(), r[key.index]);
}
const mdf = new Mdf(readdirSync(exportDir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(exportDir, f))[0]);
const index = (table, name) => table.fields.find((x) => x.name.toLowerCase() === name.toLowerCase()).index;
const doctors = new Map(); // pcod -> Set(user)
const lastVisit = new Map();
{
  const t = mdf.table('Clini_02');
  const [p, u, l] = ['PCod', 'UserNumber', 'LastMedAdvice'].map((n) => index(t, n));
  for (const r of t.records({ fields: ['PCod', 'UserNumber', 'LastMedAdvice'] })) {
    if (!doctors.has(r[p])) doctors.set(r[p], new Set());
    doctors.get(r[p]).add(r[u]);
    const d = toCalendarDate(r[l])?.iso ?? '';
    if (d > (lastVisit.get(r[p]) ?? '')) lastVisit.set(r[p], d);
  }
}
{
  const t = mdf.table('Me');
  const p = index(t, 'PCod');
  for (const r of t.records({ fields: ['PCod'] })) bump('me', r[p]);
}
const sex = new Map();
const birthYear = new Map();
{
  const t = mdf.table('Clini_01');
  const [p, s, b] = ['PCod', 'Sex', 'BirthDate'].map((n) => index(t, n));
  for (const r of t.records({ fields: ['PCod', 'Sex', 'BirthDate'] })) {
    sex.set(r[p], String(r[s] ?? '').trim().toUpperCase().slice(0, 1));
    const year = Number((toCalendarDate(r[b])?.iso ?? '').slice(0, 4));
    if (year > 1900) birthYear.set(r[p], year);
  }
}

const n = (table, pcod) => counts.get(table)?.get(pcod) ?? 0;
const tablesOf = (pcod, pattern) => [...counts.keys()].filter((t) => pattern.test(t) && n(t, pcod));
const records = (p) => n('co28', p) + n('clini_06', p) + n('co12_2', p) + n('me', p);
const age = (p) => (birthYear.has(p) ? Number(EXPORT_DATE.slice(0, 4)) - birthYear.get(p) : null);

// People already in another sample stay out of this one.
const excluded = new Set();
const excludeDir = opt('--exclude-dir');
if (excludeDir && existsSync(join(excludeDir, 'sample.enc'))) {
  const other = JSON.parse(decryptBuffer(readFileSync(join(excludeDir, 'sample.enc')), loadOrCreateKey(excludeDir)).toString('utf8'));
  for (const p of other.pcods) excluded.add(p);
}

const people = [...doctors.keys()].filter((p) => !excluded.has(p) && records(p) > 0).sort((a, b) => a - b);
const sizes = people.map(records).sort((a, b) => a - b);
const huge = sizes[Math.floor(sizes.length * 0.99)] ?? Infinity;
const large = sizes[Math.floor(sizes.length * 0.9)] ?? Infinity;

/** Each stratum: how many of the batch must be in it. Filled in this order, rarest first. */
const strata = [
  ['prontuário entre o 1% mais longo', 2, (p) => records(p) >= huge],
  ['prontuário entre os 10% mais longos', 3, (p) => records(p) >= large && records(p) < huge],
  ['homem', 3, (p) => sex.get(p) === 'M'],
  ['médico urologista', 3, (p) => doctors.get(p).has(UROLOGIST)],
  ['com imagem embutida', 2, (p) => tablesOf(p, IMAGES).length > 0],
  ['com três ou mais tipos de ficha de especialidade', 2, (p) => tablesOf(p, SHEETS).length >= 3],
  ['pré-natal com seis ou mais consultas', 3, (p) => n('co49_2', p) >= 6],
  ['mais de um médico', 3, (p) => doctors.get(p).size > 1],
  ...[...new Set([...doctors.values()].flatMap((s) => [...s]))].sort((a, b) => a - b).map((user) => [`médico ${user}`, 2, (p) => doctors.get(p).has(user)]),
  ['menos de 25 anos', 2, (p) => age(p) !== null && age(p) < 25],
  ['25 a 39 anos', 3, (p) => age(p) !== null && age(p) >= 25 && age(p) < 40],
  ['40 a 54 anos', 3, (p) => age(p) !== null && age(p) >= 40 && age(p) < 55],
  ['55 a 69 anos', 3, (p) => age(p) !== null && age(p) >= 55 && age(p) < 70],
  ['70 anos ou mais', 2, (p) => age(p) !== null && age(p) >= 70],
  ['um a três registros', 3, (p) => records(p) <= 3],
  ['última visita em 2026', 4, (p) => (lastVisit.get(p) ?? '') >= '2026-01-01'],
  ['última visita em 2024 ou 2025', 3, (p) => (lastVisit.get(p) ?? '') >= '2024-01-01' && (lastVisit.get(p) ?? '') < '2026-01-01'],
  ['última visita de 2018 a 2023', 3, (p) => (lastVisit.get(p) ?? '') >= '2018-01-01' && (lastVisit.get(p) ?? '') < '2024-01-01'],
  ['última visita antes de 2018', 2, (p) => (lastVisit.get(p) ?? '') !== '' && (lastVisit.get(p) ?? '') < '2018-01-01'],
];

const picked = [];
const taken = new Set();
const draw = (pool) => pool[Math.floor(random() * pool.length)];
for (const [, quota, belongs] of strata) {
  while (picked.length < COUNT && picked.filter(belongs).length < quota) {
    const pool = people.filter((p) => !taken.has(p) && belongs(p));
    if (!pool.length) break;
    const p = draw(pool);
    taken.add(p);
    picked.push(p);
  }
}
// The rest of the batch: anyone, as the base is.
while (picked.length < COUNT) {
  const pool = people.filter((p) => !taken.has(p));
  if (!pool.length) break;
  const p = draw(pool);
  taken.add(p);
  picked.push(p);
}

// The order is shuffled so that "Paciente 7" says nothing about why the person was chosen.
for (let i = picked.length - 1; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1));
  [picked[i], picked[j]] = [picked[j], picked[i]];
}
const key = loadOrCreateKey(DIR);
writeFileSync(join(DIR, 'sample.enc'), encryptBuffer(Buffer.from(JSON.stringify({ pcods: picked, salt: randomBytes(16).toString('hex') })), key));

const sized = picked.map(records).sort((a, b) => a - b);
console.log(JSON.stringify({
  eligible: people.length,
  excluded: excluded.size,
  picked: picked.length,
  records: { smallest: sized[0], median: sized[Math.floor(sized.length / 2)], largest: sized.at(-1), longest1PercentFrom: huge, longest10PercentFrom: large },
  strata: Object.fromEntries(strata.map(([label, quota, belongs]) => [label, `${picked.filter(belongs).length} (mínimo ${quota})`])),
  written: join(DIR, 'sample.enc'),
}, null, 1));
