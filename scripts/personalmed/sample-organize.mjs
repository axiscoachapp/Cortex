#!/usr/bin/env node
// AI organisation of the ANONYMISED sample (never the identified staging).
// Sends each person's converted days and whole chart to the product's own
// model adapter (through a temporary, secret-guarded function), checks every
// answer against the source text (organize.mjs) and stores the result
// encrypted beside the sample. Prints counts, sizes and costs only.
//
// Usage: node scripts/personalmed/sample-organize.mjs [--dir <folder>] [--only 2] [--fresh]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrCreateKey } from './local-key.mjs';
import { DAY_SCHEMA, DAY_SYSTEM, ORGANIZE_VERSION, PROFILE_SCHEMA, checkDay, cleanProfile, dayBatches, dayPrompt, originalBody, profilePrompt, profileSystem, squash, verifyProfile } from './organize.mjs';
import { DOCTOR_LABEL, readAll, sampleDir } from './sample.mjs';
import { decryptBuffer, encryptBuffer } from './secure-staging.mjs';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const DIR = sampleDir(opt('--dir'));
const ONLY = opt('--only') ? Number(opt('--only')) : null;
const FRESH = args.includes('--fresh');
const EXPORT_DATE = opt('--export-date') ?? '2026-08-24';
const ENDPOINT = 'https://conhcwuwtrkerpbblzgu.supabase.co/functions/v1/pm-organize-tmp';
const key = loadOrCreateKey(DIR);
const nonce = decryptBuffer(readFileSync(join(DIR, 'organize-nonce.enc')), key).toString('utf8');
const OUT = join(DIR, 'organized');
mkdirSync(join(OUT, 'cache'), { recursive: true });

const usage = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0, seconds: 0, failures: 0 };
/** One model call, cached by its exact request so a re-run only pays for what changed. */
async function ask(system, prompt, schema, maxOutputTokens) {
  const id = createHash('sha256').update(JSON.stringify([ORGANIZE_VERSION, system, prompt, schema, maxOutputTokens])).digest('hex');
  const file = join(OUT, 'cache', `${id}.enc`);
  if (!FRESH && existsSync(file)) {
    usage.cached += 1;
    return JSON.parse(decryptBuffer(readFileSync(file), key).toString('utf8'));
  }
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pm-nonce': nonce }, body: JSON.stringify({ system, prompt, schema, maxOutputTokens }), signal: AbortSignal.timeout(175_000) });
      const body = await res.json();
      if (!res.ok || typeof body.text !== 'string') throw new Error(`HTTP ${res.status} ${String(body.error ?? '').slice(0, 120)}`);
      usage.calls += 1;
      usage.seconds += (Date.now() - started) / 1000;
      usage.inputTokens += body.usage?.inputTokens ?? 0;
      usage.outputTokens += body.usage?.outputTokens ?? 0;
      const parsed = JSON.parse(body.text);
      writeFileSync(file, encryptBuffer(Buffer.from(JSON.stringify(parsed)), key));
      return parsed;
    } catch (error) {
      usage.failures += 1;
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const all = readAll(join(DIR, 'anonymous'), key);
const people = [...new Set(all.map((e) => e.sample))].sort((a, b) => a - b).filter((n) => !ONLY || n === ONLY);
const report = { version: ORGANIZE_VERSION, people: {} };
const doctorOf = (e) => DOCTOR_LABEL[Number(String(e.sourceDoctorId ?? '').replace('user:', ''))] ?? 'Equipe';
const UNDATED = new Set(['history_no_dates', 'qp_hda_no_first_visit']);

for (const n of people) {
  const es = all.filter((e) => e.sample === n);
  const chart = es.find((e) => e.sourceEntity === 'chart')?.payload ?? {};
  const patient = { label: `Paciente ${n}`, sex: chart.sex ?? null, birthYear: chart.date_of_birth?.slice(0, 4) ?? null, civilStatus: chart.civil_status ?? null, bloodType: chart.blood_type ?? null, profession: chart.profession ?? null };
  const consultations = es.filter((e) => e.sourceEntity === 'consultation').sort((a, b) => (a.payload.created_at < b.payload.created_at ? -1 : a.payload.created_at > b.payload.created_at ? 1 : a.targetId < b.targetId ? -1 : 1));
  const days = [];
  const undated = [];
  consultations.forEach((e, i) => {
    const row = { id: `d${i + 1}`, targetId: e.targetId, date: e.payload.created_at.slice(0, 10), doctor: doctorOf(e), text: originalBody(e.payload.soap_note), kind: e.payload.chief_complaint };
    if (e.issues.some((x) => UNDATED.has(x))) undated.push({ ...row, title: e.payload.chief_complaint });
    else days.push(row);
  });
  for (const e of es.filter((x) => x.sourceEntity === 'medical_history')) undated.push({ doctor: doctorOf(e), title: 'Páginas de histórico e fichas', text: originalBody(e.payload.text) });
  for (const e of es.filter((x) => x.sourceEntity === 'legacy_alert')) undated.push({ doctor: 'Cadastro', title: 'Alerta "Atenção" do cadastro', text: e.payload.text });
  const note = es.find((e) => e.sourceEntity === 'person')?.payload.registrationNote;
  if (note) undated.push({ doctor: 'Cadastro', title: 'Observação do cadastro', text: note });

  // 1. Days, in batches.
  const batches = dayBatches(days);
  const answers = await pool(batches, 3, (batch) => ask(DAY_SYSTEM, dayPrompt(patient, batch), DAY_SCHEMA, 8000));
  const organized = {};
  const dayStats = { days: days.length, organized: 0, missing: 0, newNumbers: 0, lowCoverage: 0, coverage: [] };
  batches.forEach((batch, b) => {
    const byId = new Map((answers[b]?.dias ?? []).map((d) => [d.id, d]));
    for (const d of batch) {
      const note2 = byId.get(d.id);
      if (!note2) { dayStats.missing += 1; continue; }
      const check = checkDay(note2, d.text);
      organized[d.targetId] = { note: note2, check };
      dayStats.organized += 1;
      if (!check.ok) dayStats.newNumbers += 1;
      if (check.coverage < 0.5) dayStats.lowCoverage += 1;
      dayStats.coverage.push(check.coverage);
    }
  });
  const sorted = [...dayStats.coverage].sort((a, b) => a - b);
  dayStats.coverage = { median: sorted[Math.floor(sorted.length / 2)] ?? null, p10: sorted[Math.floor(sorted.length / 10)] ?? null };

  // 2. Profile from the whole chart.
  const raw = await ask(profileSystem(EXPORT_DATE), profilePrompt(patient, days, undated), PROFILE_SCHEMA, 12000);
  const sources = new Map();
  for (const d of days) sources.set(d.date, (sources.get(d.date) ?? '') + squash(d.text));
  sources.set('sem data', undated.map((u) => squash(u.text)).join(''));
  const everything = [...sources.values()].join('');
  const { profile, report: verified } = verifyProfile(cleanProfile(raw), sources, everything);

  writeFileSync(join(OUT, `patient-${n}.enc`), encryptBuffer(Buffer.from(JSON.stringify({ version: ORGANIZE_VERSION, sample: n, organizedOn: new Date().toISOString().slice(0, 10), days: organized, profile, profileRaw: raw })), key));
  report.people[`Paciente ${n}`] = { sourceChars: days.reduce((s, d) => s + d.text.length, 0) + undated.reduce((s, u) => s + u.text.length, 0), undatedPages: undated.length, days: dayStats, profile: verified, lists: Object.fromEntries(Object.entries(profile).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])), resumoChars: profile.resumo?.length ?? 0 };
}
report.usage = { ...usage, seconds: Math.round(usage.seconds) };
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
