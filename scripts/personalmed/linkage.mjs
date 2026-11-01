#!/usr/bin/env node
// PersonalMed 2005 -> Cortex: linkage, ownership and data-quality aggregates.
//
// PRIVACY: prints counts only (per doctor code, per year, per category).
// Never prints names, documents, phone numbers, dates of individuals or text.
// Doctor codes are PersonalMed UserNumber values, not names.
//
// Usage:
//   node scripts/personalmed/linkage.mjs <exportDir> [--mdf <file.mdf>] [--json <out>]

import { readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ParadoxTable, toCalendarDate } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error('usage: linkage.mjs <exportDir> [--mdf file] [--json out]');
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const mdfPath = opt('--mdf') ?? readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0];
const mdf = new Mdf(mdfPath);
const today = new Date().toISOString().slice(0, 10);

function px(name) {
  const f = readdirSync(dir).find((x) => extname(x).toLowerCase() === '.db' && basename(x, extname(x)).toLowerCase() === name.toLowerCase());
  if (!f) throw new Error(`missing table ${name}`);
  return new ParadoxTable(join(dir, f));
}

/** Iterate rows of a Paradox or MDF table as objects with the requested fields. */
function* rows(table, fields, blobs = 'none') {
  const idx = fields.map((n) => {
    const f = table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!f) throw new Error(`field ${n} not in ${table.name}`);
    return f.index;
  });
  for (const r of table.records({ fields, blobs })) {
    const o = {};
    fields.forEach((n, i) => {
      o[n] = r[idx[i]];
    });
    yield o;
  }
}

const iso = (v) => toCalendarDate(v)?.iso ?? null;
const inc = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const obj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1)));

// ---------------------------------------------------------------------------
// Patients (SQL Server Clini_01)

const patients = new Map(); // PCod -> { birth, lastModified }
const quality = {
  patients: 0,
  birthMissing: 0,
  birthBefore1900: 0,
  birthFuture: 0,
  birthAfterLastModified: 0,
  ageBuckets: new Map(),
  sexMissing: 0,
  noPhone: 0,
  singleWordName: 0,
  nameAllUpper: 0,
  nameHasDigit: 0,
  cpfInFax: { elevenDigits: 0, validChecksum: 0, invalidChecksum: 0, duplicateValidGroups: 0 },
  rgPresent: 0,
  emailPresent: 0,
  addressPresent: 0,
  attentionNonEmpty: 0,
  observationNonEmpty: 0,
};

function cpfValid(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len) => {
    let s = 0;
    for (let i = 0; i < len; i += 1) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

const clini01 = mdf.table('Clini_01');
const cpfCounts = new Map();
for (const p of rows(clini01, ['PCod', 'Name', 'BirthDate', 'Sex', 'Phone', 'Cellular', 'FAX', 'ID', 'EMail', 'Address', 'LastModified', 'Attention', 'Observation'], 'text')) {
  quality.patients += 1;
  const birth = iso(p.BirthDate);
  const lastMod = iso(p.LastModified);
  patients.set(p.PCod, { birth, lastModified: lastMod });
  if (!birth) quality.birthMissing += 1;
  else {
    if (birth < '1900-01-01') quality.birthBefore1900 += 1;
    if (birth > today) quality.birthFuture += 1;
    if (lastMod && birth > lastMod) quality.birthAfterLastModified += 1;
    const age = Math.floor((Date.parse(today) - Date.parse(birth)) / (365.2425 * 86400000));
    const b = age < 18 ? '0-17' : age < 40 ? '18-39' : age < 65 ? '40-64' : age < 90 ? '65-89' : age <= 110 ? '90-110' : '>110';
    inc(quality.ageBuckets, b);
  }
  if (!p.Sex || !p.Sex.trim()) quality.sexMissing += 1;
  if (!(p.Phone && p.Phone.trim()) && !(p.Cellular && p.Cellular.trim())) quality.noPhone += 1;
  const name = (p.Name ?? '').trim();
  if (name && !/\s/.test(name)) quality.singleWordName += 1;
  if (name && name === name.toUpperCase() && /[A-Z]/.test(name)) quality.nameAllUpper += 1;
  if (/\d/.test(name)) quality.nameHasDigit += 1;
  const digits = (p.FAX ?? '').replace(/\D/g, '');
  if (digits.length === 11) {
    quality.cpfInFax.elevenDigits += 1;
    if (cpfValid(digits)) {
      quality.cpfInFax.validChecksum += 1;
      inc(cpfCounts, digits);
    } else quality.cpfInFax.invalidChecksum += 1;
  }
  if (p.ID && p.ID.trim()) quality.rgPresent += 1;
  if (p.EMail && p.EMail.trim()) quality.emailPresent += 1;
  if (p.Address && p.Address.trim()) quality.addressPresent += 1;
  if (typeof p.Attention === 'string' && p.Attention.trim()) quality.attentionNonEmpty += 1;
  if (typeof p.Observation === 'string' && p.Observation.trim()) quality.observationNonEmpty += 1;
}
quality.cpfInFax.duplicateValidGroups = [...cpfCounts.values()].filter((c) => c > 1).length;
quality.cpfInFax.rowsInDuplicateValidGroups = [...cpfCounts.values()].filter((c) => c > 1).reduce((s, c) => s + c, 0);
quality.ageBuckets = obj(quality.ageBuckets);

// ---------------------------------------------------------------------------
// Activity per (patient, doctor)

const activity = new Map(); // PCod -> Map(UserNumber -> { weight, last })
const perDoctor = new Map(); // UserNumber -> counters
const perYear = new Map(); // table -> Map(year -> rows)
const orphans = new Map(); // table -> rows whose PCod is not in Clini_01

function touch(table, pcod, user, date, weight) {
  if (pcod === null || pcod === undefined) return;
  if (!patients.has(pcod)) {
    inc(orphans, table);
    return;
  }
  if (!activity.has(pcod)) activity.set(pcod, new Map());
  const m = activity.get(pcod);
  const a = m.get(user) ?? { weight: 0, last: null, tables: new Set() };
  a.weight += weight;
  a.tables.add(table);
  if (date && date <= today && (!a.last || date > a.last)) a.last = date;
  m.set(user, a);
}
function doctorCount(user, key, by = 1) {
  if (!perDoctor.has(user)) perDoctor.set(user, new Map());
  inc(perDoctor.get(user), key, by);
}
function yearCount(table, date) {
  if (!perYear.has(table)) perYear.set(table, new Map());
  inc(perYear.get(table), date ? date.slice(0, 4) : '(none)');
}

// Chart headers: one per patient x doctor.
for (const r of rows(mdf.table('Clini_02'), ['PCod', 'UserNumber', 'FirstMedAdvice', 'LastMedAdvice'])) {
  const last = iso(r.LastMedAdvice);
  touch('Clini_02', r.PCod, r.UserNumber, last, 1);
  doctorCount(r.UserNumber, 'charts(Clini_02)');
  yearCount('Clini_02.LastMedAdvice', last);
}
// Chart pages (SQL Me), running history (Co12_1), evolutions (Co28), documents (Clini_06), CIDs (Co12_2), prenatal (Co49_*).
for (const r of rows(mdf.table('Me'), ['PCod', 'UserNumber', 'CompNumber'])) {
  touch('Me', r.PCod, r.UserNumber, null, 3);
  doctorCount(r.UserNumber, 'chartPages(Me)');
}
for (const r of rows(px('Co12_1'), ['PCod', 'UserNumber', 'Contents'])) {
  if (!r.Contents) continue;
  touch('Co12_1', r.PCod, r.UserNumber, null, 5);
  doctorCount(r.UserNumber, 'historyText(Co12_1)');
}
for (const r of rows(px('Co28'), ['PCod', 'UserNumber', 'DataInsert'])) {
  const d = iso(r.DataInsert);
  touch('Co28', r.PCod, r.UserNumber, d, 2);
  doctorCount(r.UserNumber, 'evolutions(Co28)');
  yearCount('Co28', d);
}
for (const r of rows(px('Clini_06'), ['PCod', 'UserNumber', 'DateInsert', 'ModelType'])) {
  const d = iso(r.DateInsert);
  touch('Clini_06', r.PCod, r.UserNumber, d, 1);
  doctorCount(r.UserNumber, `documents(Clini_06,type${r.ModelType})`);
  yearCount('Clini_06', d);
}
for (const r of rows(px('Co12_2'), ['PCod', 'UserNumber', 'DateInsert'])) {
  const d = iso(r.DateInsert);
  touch('Co12_2', r.PCod, r.UserNumber, d, 1);
  doctorCount(r.UserNumber, 'cidCodes(Co12_2)');
  yearCount('Co12_2', d);
}
for (const r of rows(px('Co49_1'), ['Pcod', 'UserNumber', 'DUM'])) {
  touch('Co49_1', r.Pcod, r.UserNumber, null, 2);
  doctorCount(r.UserNumber, 'pregnancies(Co49_1)');
}
for (const r of rows(px('Co49_2'), ['PCod', 'UserNumber', 'Date'])) {
  const d = iso(r.Date);
  touch('Co49_2', r.PCod, r.UserNumber, d, 1);
  doctorCount(r.UserNumber, 'prenatalVisits(Co49_2)');
  yearCount('Co49_2', d);
}
// Agenda: attended/arrived appointments count as activity; all count per doctor.
const agendaStatus = new Map();
for (const r of rows(px('Age04'), ['PCod', 'UserNumber', 'Data', 'Estado'])) {
  const d = iso(r.Data);
  const status = (r.Estado ?? '').trim() || '(blank)';
  doctorCount(r.UserNumber, `appointments(Age04,${status})`);
  inc(agendaStatus, `${status}|${r.PCod === null ? 'noPatient' : 'patient'}|${d && d > today ? 'future' : 'past'}`);
  yearCount('Age04', d);
  if (r.PCod !== null && ['T', 'A', 'E'].includes(status)) touch('Age04(attended)', r.PCod, r.UserNumber, d, 1);
  else if (r.PCod !== null && !patients.has(r.PCod)) inc(orphans, 'Age04');
}

// ---------------------------------------------------------------------------
// Encounter synthesis: one candidate Cortex consultation per (patient, doctor, date)
// built from every dated clinical source. Reports how sources combine.

const encounters = new Map(); // `${pcod}|${user}|${date}` -> Set(sources)
function addEncounter(source, pcod, user, date) {
  if (pcod === null || pcod === undefined || !date || !patients.has(pcod)) return;
  const k = `${pcod}|${user}|${date}`;
  if (!encounters.has(k)) encounters.set(k, new Set());
  encounters.get(k).add(source);
}
for (const r of rows(px('Co28'), ['PCod', 'UserNumber', 'DataInsert'])) addEncounter('evolution', r.PCod, r.UserNumber, iso(r.DataInsert));
for (const r of rows(px('Clini_06'), ['PCod', 'UserNumber', 'DateInsert'])) addEncounter('document', r.PCod, r.UserNumber, iso(r.DateInsert));
for (const r of rows(px('Co12_2'), ['PCod', 'UserNumber', 'DateInsert'])) addEncounter('cid', r.PCod, r.UserNumber, iso(r.DateInsert));
for (const r of rows(px('Co49_2'), ['PCod', 'UserNumber', 'Date'])) addEncounter('prenatal', r.PCod, r.UserNumber, iso(r.Date));
const attendedKeys = new Set();
for (const r of rows(px('Age04'), ['PCod', 'UserNumber', 'Data', 'Estado'])) {
  if (r.PCod === null || !['T', 'A', 'E'].includes((r.Estado ?? '').trim())) continue;
  attendedKeys.add(`${r.PCod}|${r.UserNumber}|${iso(r.Data)}`);
}
const encounterMix = new Map();
let encountersWithAppointment = 0;
for (const [k, srcs] of encounters) {
  inc(encounterMix, [...srcs].sort().join('+'));
  if (attendedKeys.has(k)) encountersWithAppointment += 1;
}
const encounterSummary = {
  datedEncounters: encounters.size,
  matchingAttendedAppointmentSameDay: encountersWithAppointment,
  attendedAppointmentDaysWithoutClinicalEntry: [...attendedKeys].filter((k) => !encounters.has(k)).length,
  sourceMix: obj(encounterMix),
};

// Per-doctor chart model: distinct (patient, doctor) pairs by evidence.
const pairs = new Map();
for (const [pcod, m] of activity) for (const [user, a] of m) {
  const t = a.tables;
  const kind = [...t].some((x) => !['Clini_02', 'Age04(attended)'].includes(x)) ? 'withClinicalContent' : t.has('Clini_02') ? 'chartHeaderOnly' : 'attendedAppointmentsOnly';
  inc(pairs, kind);
}

// ---------------------------------------------------------------------------
// Ownership simulation

const doctorsPerPatient = new Map();
const ownerCounts = new Map();
const sharesNeeded = new Map(); // owner->other pairs
let patientsWithActivity = 0;
let multiDoctor = 0;
let ownerTieBrokenByRecency = 0;
const lastActivityYear = new Map();
const coverage = new Map();
for (const [pcod] of patients) {
  const m = activity.get(pcod);
  const tables = new Set();
  if (m) for (const a of m.values()) for (const t of a.tables) tables.add(t);
  const clinical = [...tables].some((t) => !['Clini_02', 'Age04(attended)'].includes(t));
  const attended = tables.has('Age04(attended)');
  inc(coverage, clinical ? 'clinicalContent' : attended ? 'appointmentsOnly' : tables.has('Clini_02') ? 'chartHeaderOnly' : 'registrationOnly');
  if (!m || !m.size) {
    inc(doctorsPerPatient, '0');
    inc(lastActivityYear, '(none)');
    continue;
  }
  patientsWithActivity += 1;
  const docs = [...m.entries()];
  inc(doctorsPerPatient, docs.length >= 4 ? '4+' : String(docs.length));
  if (docs.length > 1) multiDoctor += 1;
  docs.sort((a, b) => b[1].weight - a[1].weight || String(b[1].last).localeCompare(String(a[1].last)));
  if (docs.length > 1 && docs[0][1].weight === docs[1][1].weight) ownerTieBrokenByRecency += 1;
  const owner = docs[0][0];
  inc(ownerCounts, owner);
  for (const [other] of docs.slice(1)) inc(sharesNeeded, `${owner}->${other}`);
  const last = docs.map(([, a]) => a.last).filter(Boolean).sort().pop();
  inc(lastActivityYear, last ? last.slice(0, 4) : '(none)');
}
const cumulative = {};
const years = [...lastActivityYear.entries()].filter(([y]) => /^\d{4}$/.test(y));
for (const since of ['2025', '2021', '2016', '2011']) cumulative[`lastActivity>=${since}`] = years.filter(([y]) => y >= since).reduce((s, [, c]) => s + c, 0);

const result = {
  generatedFor: basename(dir),
  patients: quality.patients,
  orphansNotInClini01: obj(orphans),
  coverage: obj(coverage),
  patientsWithActivity,
  doctorsPerPatient: obj(doctorsPerPatient),
  multiDoctorPatients: multiDoctor,
  ownerByMostActivity: obj(ownerCounts),
  ownerTieBrokenByRecency,
  patientDoctorPairs: obj(pairs),
  encounters: encounterSummary,
  sharesNeededOwnerToOther: obj(sharesNeeded),
  lastActivityYear: obj(lastActivityYear),
  lastActivityCumulative: cumulative,
  perDoctor: Object.fromEntries([...perDoctor.entries()].sort((a, b) => a[0] - b[0]).map(([u, m]) => [u, obj(m)])),
  agendaStatus: obj(agendaStatus),
  rowsPerYear: Object.fromEntries([...perYear.entries()].map(([t, m]) => [t, obj(m)])),
  patientQuality: quality,
};
console.log(JSON.stringify(result, null, 1));
const out = opt('--json');
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
