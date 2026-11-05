#!/usr/bin/env node
// PersonalMed 2005 -> Cortex: deeper analysis for decisions D6 (QP/HDA page:
// consultation or history) and D7 ("Atenção" alerts), asked by the user.
//
// PRIVACY: prints counts, rates and percentiles only. Never prints names,
// identifiers, dates of individuals or any text of the record.
//
// Usage:
//   node scripts/personalmed/d6-d7-analysis.mjs <exportDir> [--export-date 2026-08-24] [--json <out, outside the repo>]

import { readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ParadoxTable, toCalendarDate } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { rtfToText } from './rtf-to-text.mjs';
import { alertCategories, alertSuggestedAction, splitHistory } from './transforms.mjs';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error('usage: d6-d7-analysis.mjs <exportDir> [--export-date D] [--json out]');
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const EXPORT = opt('--export-date') ?? '2026-08-24';
const mdf = new Mdf(readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0]);
const px = (name) => new ParadoxTable(join(dir, readdirSync(dir).find((x) => extname(x).toLowerCase() === '.db' && basename(x, extname(x)).toLowerCase() === name.toLowerCase())));
function* rows(table, fields, blobs = 'none') {
  const idx = fields.map((n) => table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase()).index);
  for (const r of table.records({ fields, blobs })) {
    const o = {};
    fields.forEach((n, i) => { o[n] = r[idx[i]]; });
    yield o;
  }
}
const iso = (v) => toCalendarDate(v)?.iso ?? null;
const valid = (d) => (d && d > '1900-01-01' && d <= EXPORT ? d : null);
const plain = (v) => (typeof v === 'string' && v.trim() ? (v.trimStart().startsWith('{\\rtf') ? rtfToText(v).text : v) : '');
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const yearBucket = (d) => (!d ? 'sem_data' : d >= '2025-01-01' ? '2025_2026' : d >= '2020-01-01' ? '2020_2024' : d >= '2015-01-01' ? '2015_2019' : 'antes_2015');
const t0 = Date.now();
const lap = (label) => process.stderr.write(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// ---------------------------------------------------------------------------
// Visit days per chart: attended appointments (T, A, E) and structured rows.

const visitDays = new Map(); // `${pcod}|${user}` -> Set(day)
const addDay = (pcod, user, d) => {
  if (pcod == null || !d) return;
  const k = `${pcod}|${user}`;
  if (!visitDays.has(k)) visitDays.set(k, new Set());
  visitDays.get(k).add(d);
};
for (const r of rows(px('Age04'), ['UserNumber', 'Data', 'PCod', 'Estado'])) {
  if (['T', 'A', 'E'].includes(str(r.Estado))) addDay(r.PCod, r.UserNumber, valid(iso(r.Data)));
}
const recordDays = new Map(); // structured clinical rows (Co28 evolution) per chart
for (const r of rows(px('Co28'), ['PCod', 'UserNumber', 'DataInsert'])) {
  const d = valid(iso(r.DataInsert));
  if (r.PCod == null || !d) continue;
  const k = `${r.PCod}|${r.UserNumber}`;
  if (!recordDays.has(k)) recordDays.set(k, new Set());
  recordDays.get(k).add(d);
}
lap('visits');

const header = new Map(); // `${pcod}|${user}` -> { first, last }
const personLast = new Map(); // pcod -> latest visit across doctors
for (const r of rows(mdf.table('Clini_02'), ['PCod', 'UserNumber', 'FirstMedAdvice', 'LastMedAdvice'])) {
  const first = valid(iso(r.FirstMedAdvice));
  const last = valid(iso(r.LastMedAdvice));
  header.set(`${r.PCod}|${r.UserNumber}`, { first, last });
  if (last && (!personLast.has(r.PCod) || last > personLast.get(r.PCod))) personLast.set(r.PCod, last);
}
for (const [k, days] of visitDays) {
  const pcod = Number(k.split('|')[0]);
  for (const d of days) if (!personLast.has(pcod) || d > personLast.get(pcod)) personLast.set(pcod, d);
}
lap('headers');

// Running history (Co12_1) as word shingles, to measure repetition.
const SHINGLE = 8;
const shingles = (text) => {
  const words = fold(text).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + SHINGLE <= words.length; i++) out.add(words.slice(i, i + SHINGLE).join(' '));
  return out;
};
// The exact number of consultations each rule creates comes from extract.mjs
// (consultationKinds), which builds the real staging; an estimate here missed
// sources and was withdrawn (05/11).
const historyShingles = new Map();
for (const r of rows(px('Co12_1'), ['PCod', 'UserNumber', 'Contents'], 'text')) {
  const t = plain(r.Contents);
  if (r.PCod == null || !t.trim()) continue;
  historyShingles.set(`${r.PCod}|${r.UserNumber}`, shingles(t));
}
lap('history');

// ---------------------------------------------------------------------------
// D6: QP/HDA pages (Me.CompNumber 201)

const d6 = {
  pages: 0, empty: 0, byDoctor: {}, lengths: null,
  datesInside: { fewerThanTwo: 0, twoOrMore: 0 },
  datedEntries: { total: 0, onVisitDay: 0 },
  firstVisit: { missing: 0, withAttendedVisit: 0, withRecordRow: 0, withEither: 0, withNeither: 0 },
  overlapWithHistory: { noHistory: 0, none: 0, under20: 0, from20to80: 0, atLeast80: 0 },
  recency: {},
  labelled: { qpOrHda: 0 },
};
const lengths = [];
for (const r of rows(mdf.table('Me'), ['PCod', 'UserNumber', 'CompNumber', 'Contents1'], 'text')) {
  if (r.CompNumber !== 201) continue;
  const t = plain(r.Contents1).trim();
  d6.pages += 1;
  if (!t) { d6.empty += 1; continue; }
  const k = `${r.PCod}|${r.UserNumber}`;
  inc(d6.byDoctor, String(r.UserNumber));
  lengths.push(t.length);
  if (/\b(qp|hda|queixa)\b/i.test(fold(t.slice(0, 200)))) d6.labelled.qpOrHda += 1;

  const split = splitHistory(t, { exportDate: EXPORT });
  const dated = (split?.entries ?? []).filter((e) => e.date);
  // splitHistory splits only with 2 or more valid date stamps.
  if (dated.length < 2) d6.datesInside.fewerThanTwo += 1;
  else d6.datesInside.twoOrMore += 1;
  const days = visitDays.get(k) ?? new Set();
  for (const e of dated) {
    d6.datedEntries.total += 1;
    if (days.has(e.date)) d6.datedEntries.onVisitDay += 1;
  }

  const h = header.get(k);
  if (!h?.first) d6.firstVisit.missing += 1;
  else {
    const visit = days.has(h.first);
    const record = recordDays.get(k)?.has(h.first) ?? false;
    if (visit) d6.firstVisit.withAttendedVisit += 1;
    if (record) d6.firstVisit.withRecordRow += 1;
    if (visit || record) d6.firstVisit.withEither += 1;
    else d6.firstVisit.withNeither += 1;
  }

  const hs = historyShingles.get(k);
  if (!hs) d6.overlapWithHistory.noHistory += 1;
  else {
    const own = shingles(t);
    if (!own.size) d6.overlapWithHistory.none += 1;
    else {
      let shared = 0;
      for (const s of own) if (hs.has(s)) shared += 1;
      const ratio = shared / own.size;
      if (ratio === 0) d6.overlapWithHistory.none += 1;
      else if (ratio < 0.2) d6.overlapWithHistory.under20 += 1;
      else if (ratio < 0.8) d6.overlapWithHistory.from20to80 += 1;
      else d6.overlapWithHistory.atLeast80 += 1;
    }
  }
  inc(d6.recency, yearBucket(h?.last ?? null));
}
lengths.sort((a, b) => a - b);
d6.lengths = { median: pct(lengths, 50), p90: pct(lengths, 90), max: lengths.at(-1) ?? null };
lap('qp/hda');

// ---------------------------------------------------------------------------
// D7: "Atenção" alerts (Clini_01.Attention)

// Finer hints for the texts the base categories do not reach (counts only).
const EXTRA = {
  retorno_consulta: /\b(retorno|reconsulta|revisao|consulta)\b/,
  exames: /\b(exame|resultado|usg|ultrass|mamogra|preventivo|papanicolau|colpo|laborat|densito|biopsia)/,
  procedimento: /\b(cirurg|laquead|histerect|cesar|parto|curetag|cauteriz|conizac|vasectom|postect)/,
  contracepcao: /\b(diu|mirena|implanon|anticoncep|pilula|injetavel)\b/,
  vinculo_familiar: /\b(mae d|filha d|filho d|esposa|marido|irma|irmao|sogra|nora|neta|neto|amiga|indicad)/,
  identificacao_cadastro: /\b(cpf|rg|nome|endereco|mudou|cadastro|nasc)/,
  nao_atender: /\b(nao (atender|marcar|agendar)|bloque)/,
  particular: /\b(particular|cortesia|isenta|gratuit)/,
};
const d7 = {
  alerts: 0, lengths: null, base: {}, routing: {}, recency: {}, uncategorized: { total: 0, reachedByExtra: 0, extra: {}, recency: {} },
};
const alertLengths = [];
for (const r of rows(mdf.table('Clini_01'), ['PCod', 'Attention'], 'text')) {
  const t = plain(r.Attention).trim();
  if (!t || r.PCod == null) continue;
  d7.alerts += 1;
  alertLengths.push(t.length);
  const hints = alertCategories(t);
  const { categories } = hints;
  for (const c of categories) inc(d7.base, c);
  const action = alertSuggestedAction(hints);
  const route = action !== 'doctor_review' ? action : categories.length ? 'doctor_review_mixed' : 'doctor_review_uncategorized';
  inc(d7.routing, route);
  const bucket = yearBucket(personLast.get(r.PCod) ?? null);
  inc(d7.recency, `${route}.${bucket}`);
  if (!categories.length) {
    d7.uncategorized.total += 1;
    inc(d7.uncategorized.recency, bucket);
    const f = fold(t);
    const hits = Object.entries(EXTRA).filter(([, re]) => re.test(f)).map(([k]) => k);
    if (hits.length) d7.uncategorized.reachedByExtra += 1;
    for (const h of hits) inc(d7.uncategorized.extra, h);
  }
}
alertLengths.sort((a, b) => a - b);
d7.lengths = { median: pct(alertLengths, 50), p90: pct(alertLengths, 90), max: alertLengths.at(-1) ?? null };
lap('alerts');

const out = { exportDate: EXPORT, d6, d7, seconds: Math.round((Date.now() - t0) / 1000) };
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(out, null, 2));
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
