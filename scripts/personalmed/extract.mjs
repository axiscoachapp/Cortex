#!/usr/bin/env node
// PersonalMed 2005 -> Cortex staging, real export. DRY RUN: builds every
// staging envelope in memory and prints only aggregate counts (per entity,
// status, doctor, issue code) next to the expected totals of
// CODEX_IMPLEMENTATION.md §6. Nothing with patient data is written.
//
// Usage:
//   node --max-old-space-size=6144 scripts/personalmed/extract.mjs <exportDir> \
//        [--export-date 2026-08-24] [--import-date YYYY-MM-DD] [--json <aggregates.json>]
//        [--usage-since 2025-01-01]       # window for template usage counts
//        [--out <dir outside the repo>]   # writes the ENCRYPTED staging; needs PM_STAGING_KEY

import { readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ParadoxTable, decodeText, toCalendarDate } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { rtfToText } from './rtf-to-text.mjs';
import { SecureBatchWriter, keyFromEnv } from './secure-staging.mjs';
import { buildAgenda, buildChartClinical, buildHealthPlanCards, buildLegacyAlert, buildPerson, buildTemplate } from './staging.mjs';
import { splitHistory, templateChunks, templateUsage, wallClockToUtc } from './transforms.mjs';
import { antimicrobialsIn, controlledSubstancesIn } from '../../supabase/functions/_shared/regulatedMedications.ts';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error('usage: extract.mjs <exportDir> [--export-date D] [--import-date D] [--json out]');
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const EXPORT = opt('--export-date') ?? '2026-08-24';
const ctx = { sourceInstance: `pm2005-${EXPORT}`, batchId: `pm-dryrun-${EXPORT}`, exportDate: EXPORT, importDate: opt('--import-date') ?? new Date().toISOString().slice(0, 10) };
const mdf = new Mdf(readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0]);
const px = (name) => new ParadoxTable(join(dir, readdirSync(dir).find((x) => extname(x).toLowerCase() === '.db' && basename(x, extname(x)).toLowerCase() === name.toLowerCase())));
function* rows(table, fields, blobs = 'none') {
  const idx = fields.map((n) => table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase()).index);
  for (const r of table.records({ fields, blobs })) {
    const o = {};
    fields.forEach((n, i) => {
      o[n] = r[idx[i]];
    });
    yield o;
  }
}
const iso = (v) => toCalendarDate(v)?.iso ?? null; // sentinels stay visible; legacyDate() flags them
const plain = (v) => (typeof v === 'string' && v.trim() ? (v.trimStart().startsWith('{\\rtf') ? rtfToText(v).text : v) : '');
const minutes = (t) => (t && typeof t.timeMs === 'number' ? Math.round(t.timeMs / 60000) : null);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const t0 = Date.now();
const lap = (label) => process.stderr.write(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// ---------------------------------------------------------------------------
// Aggregates (the only output)

// Optional encrypted output (real patient data): only outside the repo, only with PM_STAGING_KEY.
const writer = opt('--out') ? new SecureBatchWriter(opt('--out'), keyFromEnv()) : null;

const agg = { entities: {}, issues: {}, sections: {}, chars: { historySource: 0, historyInConsultations: 0 } };
function count(e) {
  writer?.add(e);
  const a = (agg.entities[e.sourceEntity] ??= { total: 0, byStatus: {}, byDoctor: {} });
  a.total += 1;
  a.byStatus[e.mappingStatus] = (a.byStatus[e.mappingStatus] ?? 0) + 1;
  if (e.sourceDoctorId) a.byDoctor[e.sourceDoctorId] = (a.byDoctor[e.sourceDoctorId] ?? 0) + 1;
  for (const i of e.issues) agg.issues[`${e.sourceEntity}.${i}`] = (agg.issues[`${e.sourceEntity}.${i}`] ?? 0) + 1;
  if (e.sourceEntity === 'consultation') {
    for (const m of e.payload.soap_note.matchAll(/^### (.+)$/gm)) agg.sections[m[1]] = (agg.sections[m[1]] ?? 0) + 1;
    const h = e.payload.soap_note.split('### Histórico corrido\n\n')[1];
    if (h) agg.chars.historyInConsultations += h.length;
    else if (/^Histórico PersonalMed|^Anotação do histórico/.test(e.payload.chief_complaint)) agg.chars.historyInConsultations += e.payload.soap_note.length;
  }
}

// ---------------------------------------------------------------------------
// Agenda first: attended visits date the consultations; activity feeds the cohort.

const typeLabel = new Map();
for (const r of rows(px('age02'), ['UserNumber', 'ID', 'Descricao'])) typeLabel.set(`${r.UserNumber}|${str(r.ID)}`, str(r.ID));
const slot = new Map(); // `${user}|${date}|${min}` -> { duration, tipo }
const blocks = [];
for (const r of rows(px('age03'), ['UserNumber', 'Data', 'Inicio', 'Duracao', 'Tipo'])) {
  const d = iso(r.Data);
  const m = minutes(r.Inicio);
  if (!d || m == null) continue;
  slot.set(`${r.UserNumber}|${d}|${m}`, { duration: r.Duracao ?? 0, tipo: str(r.Tipo) });
  // B and P are blocks (D9: P is a short block that is never booked).
  if (str(r.Tipo) === 'B' || str(r.Tipo) === 'P') blocks.push({ user: r.UserNumber, date: d, startMinutes: m, duration: r.Duracao ?? 0, slotType: str(r.Tipo) });
}
const agendaRows = [...blocks];
const attendedStart = new Map(); // `${pcod}|${user}|${date}` -> minutes (earliest)
const lastActivity = new Map();
const future = new Set();
const touch = (pcod, d) => {
  if (pcod == null || !d || d > EXPORT) return;
  if (!lastActivity.has(pcod) || d > lastActivity.get(pcod)) lastActivity.set(pcod, d);
};
for (const r of rows(px('Age04'), ['UserNumber', 'Data', 'Inicio', 'PCod', 'Estado', 'IDTipo', 'PreCadastro'], 'raw')) {
  const d = iso(r.Data);
  const m = minutes(r.Inicio);
  if (!d || m == null) continue;
  const st = str(r.Estado);
  let pre = null;
  if (r.PCod == null && Buffer.isBuffer(r.PreCadastro) && r.PreCadastro.length >= 513) {
    const b = r.PreCadastro;
    const short = (o) => decodeText(b.subarray(o + 1, o + 1 + Math.min(b[o], 255)), 1252).trim();
    pre = { name: short(0), phone: short(256) || short(512) };
  }
  const s = slot.get(`${r.UserNumber}|${d}|${m}`);
  agendaRows.push({ user: r.UserNumber, date: d, startMinutes: m, duration: s?.duration ?? 0, slotType: 'C', estado: st, pcod: r.PCod ?? null, preCadastro: pre, typeLabel: typeLabel.get(`${r.UserNumber}|${str(r.IDTipo)}`) ?? null });
  if (['T', 'A', 'E'].includes(st) && r.PCod != null) {
    const k = `${r.PCod}|${r.UserNumber}|${d}`;
    if (!attendedStart.has(k) || m < attendedStart.get(k)) attendedStart.set(k, m);
    touch(r.PCod, d);
  }
  if (d > EXPORT && st !== 'C' && r.PCod != null) future.add(r.PCod);
}
lap('agenda');

// ---------------------------------------------------------------------------
// Clinical rows grouped by chart

const charts = new Map(); // `${pcod}|${user}` -> input for buildChartClinical
const chartOf = (pcod, user) => {
  const k = `${pcod}|${user}`;
  if (!charts.has(k)) charts.set(k, { encounters: new Map(), history: null, pages: [], pregnancies: [] });
  return charts.get(k);
};
const encounter = (pcod, user, day) => {
  const c = chartOf(pcod, user);
  if (!c.encounters.has(day)) {
    const start = attendedStart.get(`${pcod}|${user}|${day}`);
    c.encounters.set(day, { evolutions: [], documents: [], cids: [], prenatal: [], appointmentKey: start != null ? { user, date: day, start } : null, appointmentStart: start != null ? wallClockToUtc(day, start) : null });
  }
  touch(pcod, day);
  return c.encounters.get(day);
};
for (const r of rows(px('Co28'), ['PCod', 'UserNumber', 'DataInsert', 'Observation', 'Weigth', 'Height', 'FC', 'Pressure', 'Temperature'], 'text')) {
  const d = iso(r.DataInsert);
  if (!d || r.PCod == null || d <= '1900-01-01') continue;
  encounter(r.PCod, r.UserNumber, d).evolutions.push({ text: plain(r.Observation), weight: r.Weigth, height: r.Height, fc: r.FC, pressure: r.Pressure, temperature: r.Temperature });
}
for (const r of rows(px('Clini_06'), ['PCod', 'UserNumber', 'DateInsert', 'ModelType', 'Contents'], 'text')) {
  const d = iso(r.DateInsert);
  if (!d || r.PCod == null || d <= '1900-01-01') continue;
  encounter(r.PCod, r.UserNumber, d).documents.push({ type: r.ModelType, text: plain(r.Contents) });
}
for (const r of rows(px('Co12_2'), ['PCod', 'UserNumber', 'DateInsert', 'CidCod', 'Description'])) {
  const d = iso(r.DateInsert);
  if (!d || r.PCod == null || d <= '1900-01-01' || !str(r.CidCod)) continue;
  encounter(r.PCod, r.UserNumber, d).cids.push({ code: str(r.CidCod), description: str(r.Description) });
}
for (const r of rows(px('Co49_2'), ['PCod', 'UserNumber', 'Date', 'Ig', 'Weight', 'Pressure', 'Au', 'BCF', 'MF', 'Edema'])) {
  const d = iso(r.Date);
  if (!d || r.PCod == null || d <= '1900-01-01') continue;
  encounter(r.PCod, r.UserNumber, d).prenatal.push({ ig: r.Ig, weight: r.Weight, pressure: r.Pressure, au: r.Au, bcf: r.BCF, mf: r.MF, edema: r.Edema });
}
lap('encounters');
for (const r of rows(px('Co12_1'), ['PCod', 'UserNumber', 'Contents'], 'text')) {
  const t = plain(r.Contents);
  if (!t.trim() || r.PCod == null) continue;
  agg.chars.historySource += t.trim().length;
  chartOf(r.PCod, r.UserNumber).history = splitHistory(t, { exportDate: EXPORT });
}
const pageTitle = new Map();
for (const r of rows(px('Us04'), ['UserNumber', 'ComponentNumber', 'Title'])) pageTitle.set(`${r.UserNumber}|${r.ComponentNumber}`, str(r.Title));
for (const r of rows(mdf.table('Me'), ['PCod', 'UserNumber', 'CompNumber', 'Contents1'], 'text')) {
  const t = plain(r.Contents1);
  if (!t.trim()) continue;
  const title = pageTitle.get(`${r.UserNumber}|${r.CompNumber}`) || `Página ${r.CompNumber}`;
  chartOf(r.PCod, r.UserNumber).pages.push({ title, kind: r.CompNumber === 201 ? 'qp_hda' : 'history', text: t });
}
for (const r of rows(px('Co49_1'), ['Pcod', 'UserNumber', 'NumberGestation', 'DUM', 'DPP', 'DataEco'])) {
  chartOf(r.Pcod, r.UserNumber).pregnancies.push({ number: r.NumberGestation, dum: iso(r.DUM), dpp: iso(r.DPP), dppSource: iso(r.DataEco) && iso(r.DataEco) > '1900-01-01' ? 'USG' : 'DUM' });
}
lap('history, pages, pregnancies');

// ---------------------------------------------------------------------------
// People, charts and plans

const chartHeaders = new Map(); // pcod -> [{ user, firstVisit, lastVisit }]
for (const r of rows(mdf.table('Clini_02'), ['PCod', 'UserNumber', 'FirstMedAdvice', 'LastMedAdvice'])) {
  if (!chartHeaders.has(r.PCod)) chartHeaders.set(r.PCod, []);
  chartHeaders.get(r.PCod).push({ user: r.UserNumber, firstVisit: iso(r.FirstMedAdvice), lastVisit: iso(r.LastMedAdvice) });
  touch(r.PCod, iso(r.LastMedAdvice));
}
const carrier = new Map();
for (const r of rows(px('Carrier'), ['CarrierCod', 'Name', 'IsPrivate', 'Disabled'])) carrier.set(r.CarrierCod, { name: str(r.Name).split(' - ')[0], isPrivate: Boolean(r.IsPrivate), disabled: Boolean(r.Disabled) });
const plans = new Map();
const planStats = { rows: 0, unknownCarrier: 0 };
for (const r of rows(px('Clini_05'), ['PCod', 'CarrierCod', 'Registration', 'OwnerName', 'ExpirationDate'])) {
  planStats.rows += 1;
  const c = carrier.get(r.CarrierCod);
  if (!c) {
    planStats.unknownCarrier += 1;
    continue;
  }
  if (!plans.has(r.PCod)) plans.set(r.PCod, []);
  plans.get(r.PCod).push({ carrierCod: r.CarrierCod, carrier: c.name, card: str(r.Registration), isPrivate: c.isPrivate, disabled: c.disabled, ownerName: str(r.OwnerName), expiration: iso(r.ExpirationDate) });
}

const chartIds = new Map();
let persons = 0;
for (const p of rows(mdf.table('Clini_01'), ['PCod', 'Name', 'BirthDate', 'Sex', 'Phone', 'Cellular', 'DDDCellular', 'FAX', 'ID', 'EMail', 'Address', 'District', 'City', 'Zip', 'State', 'Mother', 'HomeBorn', 'Occupation'])) {
  persons += 1;
  const row = { ...p, BirthDate: iso(p.BirthDate) };
  const headers = chartHeaders.get(p.PCod) ?? [];
  const list = buildPerson(
    ctx,
    row,
    headers.map((h) => {
      const c = charts.get(`${p.PCod}|${h.user}`);
      return { ...h, hasConsultations: Boolean(c && (c.encounters.size || c.history || c.pages.some((pg) => pg.kind === 'qp_hda'))) };
    }),
    plans.get(p.PCod) ?? [],
    { active: (lastActivity.get(p.PCod) ?? '') >= '2025-01-01' || future.has(p.PCod), futureAppointment: future.has(p.PCod) },
  );
  for (const e of list) {
    if (e.sourceEntity === 'chart') chartIds.set(`${p.PCod}|${e.payload.ownerLegacyDoctor}`, e.targetId);
    count(e);
  }
}
lap('people and charts');

// Clinical envelopes per chart (built and counted one chart at a time).
let chartsWithoutHeader = 0;
for (const [k, c] of charts) {
  const [pcod, user] = k.split('|').map(Number);
  const id = chartIds.get(k);
  if (!id) chartsWithoutHeader += 1;
  const header = (chartHeaders.get(pcod) ?? []).find((h) => h.user === user) ?? {};
  for (const e of buildChartClinical(ctx, { pcod, user, patientTargetId: id ?? null }, { ...c, firstVisit: header.firstVisit, lastVisit: header.lastVisit })) count(e);
  charts.set(k, null); // free memory
}
lap('clinical envelopes');

for (const e of buildAgenda(ctx, agendaRows, chartIds)) count(e);
lap('agenda envelopes');

// Health-plan cards (staging only until S2). Private pay is not a card.
for (const [pcod, list] of plans) for (const e of buildHealthPlanCards(ctx, pcod, list)) count(e);
planStats.privatePay = [...plans.values()].flat().filter((c) => c.isPrivate).length;
lap('health-plan cards');

// "Atenção" alerts (S6): one per person with text, sent to the charts built
// for that person. Counts only leave this script.
const alertStats = { withText: 0, recipients: { none: 0, one: 0, several: 0 } };
for (const r of rows(mdf.table('Clini_01'), ['PCod', 'Attention'], 'text')) {
  const own = (chartHeaders.get(r.PCod) ?? [])
    .map((h) => ({ user: h.user, patientTargetId: chartIds.get(`${r.PCod}|${h.user}`) }))
    .filter((c) => c.patientTargetId);
  const e = buildLegacyAlert(ctx, { pcod: r.PCod, text: plain(r.Attention) }, own);
  if (!e) continue;
  count(e);
  alertStats.withText += 1;
  alertStats.recipients[own.length === 0 ? 'none' : own.length === 1 ? 'one' : 'several'] += 1;
}
lap('alerts');

// Document templates (S3). UserNumber 0 is the clinic-wide library. Usage
// comes from documents issued since USAGE_SINCE with the same ModelType; only
// counts leave templateUsage(), and the document text is dropped right after.
const USAGE_SINCE = opt('--usage-since') ?? '2025-01-01';
ctx.usageSince = USAGE_SINCE;
const templates = [];
for (const table of ['Us05', 'Gintxt', 'Pedtxt']) {
  for (const r of rows(px(table), ['UserNumber', 'ModelNumber', 'ModelName', 'ModelType', 'Contents'], 'text')) {
    const raw = typeof r.Contents === 'string' ? r.Contents : '';
    templates.push({ table, modelNumber: r.ModelNumber, user: r.UserNumber > 0 ? r.UserNumber : null, modelType: r.ModelType, name: str(r.ModelName), text: plain(raw), rtfTable: /\\trowd/.test(raw) });
  }
}
const issuedByType = new Map();
for (const r of rows(px('Clini_06'), ['UserNumber', 'DateInsert', 'ModelType', 'Contents'], 'text')) {
  const date = iso(r.DateInsert);
  if (!date || date < USAGE_SINCE) continue;
  if (!issuedByType.has(r.ModelType)) issuedByType.set(r.ModelType, []);
  issuedByType.get(r.ModelType).push({ user: r.UserNumber, date, text: plain(r.Contents) });
}
const usage = new Map();
for (const [type, docs] of issuedByType) {
  const candidates = templates.filter((t) => t.modelType === type).map((t) => ({ key: `${t.table}:${t.modelNumber}`, chunks: templateChunks(t.text) }));
  for (const [key, u] of templateUsage(candidates, docs, { since: USAGE_SINCE })) usage.set(key, u);
}
issuedByType.clear();
const templateStats = { since: USAGE_SINCE, byKind: {}, used: 0, usedByDoctor: {}, recognisable: 0 };
for (const t of templates) {
  const key = `${t.table}:${t.modelNumber}`;
  const regulated = { antimicrobial: [...new Set(antimicrobialsIn(t.text))], controlled: [...new Set(controlledSubstancesIn(t.text))] };
  const e = buildTemplate(ctx, t, usage.get(key), regulated);
  count(e);
  const k = (templateStats.byKind[e.payload.kind] ??= {});
  k[e.mappingStatus] = (k[e.mappingStatus] ?? 0) + 1;
  if (templateChunks(t.text).length) templateStats.recognisable += 1;
  if (e.payload.usage.uses) templateStats.used += 1;
  // D19 sizing: how many distinct templates of each kind each doctor would receive.
  const perKind = (templateStats.usedByDoctor[e.payload.kind] ??= {});
  for (const doctor of Object.keys(e.payload.usage.by_doctor)) perKind[doctor] = (perKind[doctor] ?? 0) + 1;
}
templates.length = 0;
lap('templates');

// ---------------------------------------------------------------------------

const expected = { person: 32882, chart: 34796, contact_chart_link: 34796, consultation: 169934 + 13010, diagnosis_set: 2353, pregnancy_item: 97, template: 1123, legacy_alert: 5277, health_plan_card: 62204 - 32686 /* Clini_05 rows minus private pay */ };
const reconciliation = Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, { expected: v, staged: agg.entities[k]?.total ?? 0, diff: (agg.entities[k]?.total ?? 0) - v }]));
const out = { exportDate: EXPORT, importDate: ctx.importDate, persons, chartsWithClinicalButNoHeader: chartsWithoutHeader, reconciliation, entities: agg.entities, issues: Object.fromEntries(Object.entries(agg.issues).sort()), consultationSections: agg.sections, historyChars: agg.chars, templates: templateStats, alerts: alertStats, healthPlans: planStats, seconds: Math.round((Date.now() - t0) / 1000) };
if (writer) out.encryptedStaging = { dir: opt('--out'), manifest: 'manifest.json', files: Object.keys(writer.close({ sourceSystem: 'personalmed', sourceInstance: ctx.sourceInstance, batchId: ctx.batchId, exportDate: EXPORT, importDate: ctx.importDate }).files) };
const json = JSON.stringify(out, null, 2);
if (opt('--json')) writeFileSync(opt('--json'), json);
console.log(json);
