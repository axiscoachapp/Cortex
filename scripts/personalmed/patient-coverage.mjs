#!/usr/bin/env node
// Which legacy tables hold rows of given people (by PCod), and how many.
// It is the "nothing left behind" check for a sample: every table listed here
// must be mapped by the conversion or named as deliberately not migrated.
// Prints table names, field names and counts; never a value.
//
// Usage: node scripts/personalmed/patient-coverage.mjs <exportDir> --pcods 1,2,3 [--fields]

import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ParadoxTable, listTables } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';

const args = process.argv.slice(2);
const dir = args[0];
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const pcods = (opt('--pcods') ?? '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
if (!dir || !pcods.length) throw new Error('usage: patient-coverage.mjs <exportDir> --pcods 1,2,3 [--fields]');
const wanted = new Set(pcods);
const showFields = args.includes('--fields');

/** Rows of the wanted people in one table, when it has a PCod column. */
export function coverageOf(table, wantedPcods) {
  const key = table.fields.find((f) => /^pcod$/i.test(f.name));
  if (!key) return null;
  const counts = new Map();
  let total = 0;
  for (const r of table.records({ fields: [key.name], blobs: 'none' })) {
    total += 1;
    const v = r[key.index];
    if (wantedPcods.has(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return { key: key.name, total, counts };
}

const out = [];
const withoutKey = [];
const mdf = new Mdf(readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0]);
for (const t of mdf.userTables()) {
  const table = mdf.table(t.name);
  const c = coverageOf(table, wanted);
  if (c) out.push({ table: `${t.name} (sql)`, fields: table.fields.map((f) => f.name), ...c });
}
for (const path of listTables(dir)) {
  let table;
  try { table = new ParadoxTable(path); } catch { continue; }
  if (!table.header.numRecords) continue;
  const c = coverageOf(table, wanted);
  if (c) out.push({ table: table.name, fields: table.fields.map((f) => `${f.name}:${f.typeName}`), ...c });
  else withoutKey.push(`${table.name}(${table.header.numRecords})`);
}
console.log(`people: ${pcods.join(', ')}`);
for (const t of out) {
  const hits = pcods.map((p) => t.counts.get(p) ?? 0);
  if (!hits.some(Boolean)) continue;
  console.log(`${t.table.padEnd(18)} ${hits.map((n) => String(n).padStart(5)).join(' ')}   (of ${t.total})${showFields ? `\n    ${t.fields.join(', ')}` : ''}`);
}
console.log(`tables with a PCod column and no row for these people: ${out.filter((t) => !pcods.some((p) => t.counts.get(p))).map((t) => t.table).join(', ')}`);
console.log(`tables with data and no PCod column (reference, settings, agenda slots): ${withoutKey.length}`);
