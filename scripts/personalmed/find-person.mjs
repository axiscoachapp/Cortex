#!/usr/bin/env node
// Locate people in the PersonalMed registration (Clini_01) by name, for a
// hand-picked sample. The names come from a file OUTSIDE the repository (one
// per line) and are never printed: the output is the legacy key (PCod), how
// the name matched, and a few non-identifying facts to tell homonyms apart
// (birth year, charts per doctor, last visit month).
//
// Usage: node scripts/personalmed/find-person.mjs <exportDir> <names.txt>

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Mdf } from './mssql2000-reader.mjs';
import { toCalendarDate } from './paradox-reader.mjs';
import { fold } from './transforms.mjs';

const [dir, namesFile] = process.argv.slice(2);
if (!dir || !namesFile) throw new Error('usage: find-person.mjs <exportDir> <names.txt>');
const queries = readFileSync(namesFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const mdf = new Mdf(readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0]);

function* rows(table, fields) {
  const idx = fields.map((n) => table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase()).index);
  for (const r of table.records({ fields, blobs: 'none' })) yield Object.fromEntries(fields.map((n, i) => [n, r[idx[i]]]));
}
const tokens = (s) => fold(String(s ?? '')).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
/** Edit distance with an early exit, enough for typos in a surname. */
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** exact: same tokens in order; all: every query token present; fuzzy: every query token within 2 edits of some name token. */
function match(queryTokens, nameTokens) {
  if (queryTokens.join(' ') === nameTokens.join(' ')) return 'exact';
  if (queryTokens.every((q) => nameTokens.includes(q))) return 'all_tokens';
  if (queryTokens.every((q) => nameTokens.some((n) => distance(q, n) <= (q.length >= 6 ? 2 : 1)))) return 'fuzzy';
  return null;
}

const wanted = queries.map((q) => ({ tokens: tokens(q), hits: [] }));
for (const p of rows(mdf.table('Clini_01'), ['PCod', 'Name', 'BirthDate'])) {
  const nameTokens = tokens(p.Name);
  for (const w of wanted) {
    const how = match(w.tokens, nameTokens);
    if (how) w.hits.push({ pcod: p.PCod, how, birthYear: toCalendarDate(p.BirthDate)?.iso?.slice(0, 4) ?? null, nameTokens: nameTokens.length });
  }
}
const charts = new Map();
for (const c of rows(mdf.table('Clini_02'), ['PCod', 'UserNumber', 'FirstMedAdvice', 'LastMedAdvice'])) {
  if (!charts.has(c.PCod)) charts.set(c.PCod, []);
  charts.get(c.PCod).push({ doctor: c.UserNumber, first: toCalendarDate(c.FirstMedAdvice)?.iso?.slice(0, 7) ?? null, last: toCalendarDate(c.LastMedAdvice)?.iso?.slice(0, 7) ?? null });
}
const order = { exact: 0, all_tokens: 1, fuzzy: 2 };
wanted.forEach((w, i) => {
  w.hits.sort((a, b) => order[a.how] - order[b.how]);
  console.log(`query ${i + 1} (${w.tokens.length} name tokens): ${w.hits.length} candidate(s)`);
  for (const h of w.hits.slice(0, 8)) console.log(`  pcod ${h.pcod} · ${h.how} · name tokens ${h.nameTokens} · born ${h.birthYear ?? '?'} · charts ${JSON.stringify(charts.get(h.pcod) ?? [])}`);
});
