#!/usr/bin/env node
// "Nothing left behind" check for the sample: every line of clinical text the
// legacy base holds for the chosen people must be present in what the
// converter produced for them (the IDENTIFIED staging, before anonymisation),
// and every legacy row must be accounted for. Prints counts only.
//
// Usage: node scripts/personalmed/sample-coverage.mjs <exportDir> [--dir <folder>]

import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { loadOrCreateKey } from './local-key.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { squash } from './organize.mjs';
import { ParadoxTable, listTables } from './paradox-reader.mjs';
import { rtfToText } from './rtf-to-text.mjs';
import { readAll, readSecret, sampleDir } from './sample.mjs';

const args = process.argv.slice(2);
const exportDir = args[0];
if (!exportDir) throw new Error('usage: sample-coverage.mjs <exportDir> [--dir <folder>]');
const DIR = sampleDir(args.includes('--dir') ? args[args.indexOf('--dir') + 1] : undefined);
const key = loadOrCreateKey(DIR);
const { pcods } = readSecret(join(DIR, 'sample.enc'), key);
const wanted = new Set(pcods);

// What the converter produced, per person: every text of every envelope, squashed.
const produced = new Map(pcods.map((p) => [p, '']));
const entities = new Map(pcods.map((p) => [p, {}]));
const chartOwner = new Map();
const envelopes = readAll(join(DIR, 'identified'), key);
const personOf = (e) => Number(/pcod:(\d+)/.exec(e.sourceRecordId)?.[1] ?? /pcod:(\d+)/.exec(e.payload?.personRef ?? '')?.[1] ?? NaN);
for (const e of envelopes) if (e.sourceEntity === 'chart') chartOwner.set(e.targetId, personOf(e));
for (const e of envelopes) {
  const pcod = Number.isFinite(personOf(e)) ? personOf(e) : chartOwner.get(e.payload?.patientTargetId);
  if (!wanted.has(pcod)) continue;
  const texts = [];
  JSON.stringify(e.payload, (k, v) => { if (typeof v === 'string' && k !== 'contentBase64') texts.push(v); return v; });
  produced.set(pcod, produced.get(pcod) + squash(texts.join('\n')));
  entities.get(pcod)[e.sourceEntity] = (entities.get(pcod)[e.sourceEntity] ?? 0) + 1;
}

const plain = (v) => (typeof v === 'string' && v.trim() ? (v.trimStart().startsWith('{\\rtf') ? rtfToText(v).text : v) : '');
const report = {}; // table -> { rows, textUnits, lines, missing }
const check = (table, pcod, text) => {
  const r = (report[table] ??= { rows: 0, textUnits: 0, lines: 0, missing: 0 });
  const body = plain(text);
  if (!body.trim()) return;
  r.textUnits += 1;
  const have = produced.get(pcod) ?? '';
  for (const line of body.split(/\r?\n/)) {
    const q = squash(line);
    if (q.length < 4) continue; // a dash, a lone number: nothing to look for
    r.lines += 1;
    if (!have.includes(q)) r.missing += 1;
  }
};
const scan = (table, name) => {
  const pcodField = table.fields.find((x) => /^pcod$/i.test(x.name));
  if (!pcodField) return;
  const texts = table.fields.filter((x) => ['memo', 'fmtmemo', 'alpha'].includes(x.typeName) || x.sqlType === 'ntext' || x.sqlType === 'text');
  const memo = texts.filter((x) => x.typeName !== 'alpha');
  for (const r of table.records({ fields: [pcodField.name, ...memo.map((x) => x.name)], blobs: 'text' })) {
    const pcod = r[pcodField.index];
    if (!wanted.has(pcod)) continue;
    (report[name] ??= { rows: 0, textUnits: 0, lines: 0, missing: 0 }).rows += 1;
    for (const f of memo) check(name, pcod, r[f.index]);
  }
};
const mdf = new Mdf(readdirSync(exportDir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(exportDir, f))[0]);
for (const t of mdf.userTables()) scan(mdf.table(t.name), `${t.name} (sql)`);
for (const path of listTables(exportDir)) {
  let table;
  try { table = new ParadoxTable(path); } catch { continue; }
  if (table.header.numRecords) scan(table, basename(path, extname(path)));
}
const lines = Object.entries(report).filter(([, r]) => r.rows).map(([t, r]) => `${t.padEnd(18)} rows ${String(r.rows).padStart(4)} · text fields ${String(r.textUnits).padStart(4)} · lines ${String(r.lines).padStart(5)} · missing ${r.missing}`);
console.log(lines.join('\n'));
const total = Object.values(report).reduce((a, r) => ({ lines: a.lines + r.lines, missing: a.missing + r.missing }), { lines: 0, missing: 0 });
console.log(`total: ${total.lines} lines of legacy text, ${total.missing} not found in the converted record`);
console.log('converted per person:', JSON.stringify(Object.fromEntries(pcods.map((p, i) => [`Paciente ${i + 1}`, entities.get(p)]))));
