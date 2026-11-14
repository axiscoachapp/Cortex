#!/usr/bin/env node
// Looks for PATTERNS across the organised profiles of a sample: what the model
// tends to put in the wrong list, what comes without a date, what repeats, what
// the rules send away. One chart shows a defect; thirty show whether it is a
// habit worth a rule.
//
// By default prints counts only. `--show <pattern>` lists the items of one
// pattern (anonymised text, "Paciente N" labels) for whoever is reviewing on
// this computer; nothing is written to disk.
//
// Usage: node scripts/personalmed/sample-review.mjs [--dir <folder>] [--show <pattern>] [--export-date 2026-08-24]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrCreateKey } from './local-key.mjs';
import { dateKey, quoteDay, recordSpan, renderProfile, squash } from './organize.mjs';
import { readAll, sampleDir } from './sample.mjs';
import { decryptBuffer } from './secure-staging.mjs';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const DIR = sampleDir(opt('--dir'));
const SHOW = opt('--show');
const EXPORT_DATE = opt('--export-date') ?? '2026-08-24';
const key = loadOrCreateKey(DIR);
const read = (file) => JSON.parse(decryptBuffer(readFileSync(file), key).toString('utf8'));

const organized = readdirSync(join(DIR, 'organized')).filter((f) => /^patient-\d+\.enc$/.test(f)).map((f) => read(join(DIR, 'organized', f))).sort((a, b) => a.sample - b.sample);
const staging = existsSync(join(DIR, 'anonymous')) ? readAll(join(DIR, 'anonymous'), key) : [];

const patterns = new Map(); // pattern -> [{ patient, text }]
const hit = (pattern, patient, text) => patterns.set(pattern, [...(patterns.get(pattern) ?? []), { patient, text: String(text).replace(/\s+/g, ' ').slice(0, 200) }]);
const tally = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);
const dist = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? { min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s.at(-1), total: s.reduce((a, b) => a + b, 0) } : null;
};
const months = (from, to) => (/^\d{4}-\d{2}/.test(from ?? '') && /^\d{4}-\d{2}/.test(to ?? '') ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) : null);
// The first two words that say something, without the plural: "Cistos ovarianos" and "Cisto ovariano"
// are one, "Cistos mamários" and "Cistos de Naboth" are not.
const stem = (name) => String(name ?? '').split(/[\s(,;:]+/).map((w) => squash(w).replace(/(?:es|s)$/, '')).filter((w) => w.length >= 4).slice(0, 2).map((w) => w.slice(0, 6)).join(' ');

// What a name in the problem list should not be.
const NOT_A_PROBLEM = /^(uso\b|usu[aá]ri|em uso|reposi|suplement|tratamento|terapia|controle|acompanhamento|seguimento|rotina|pr[eé][- ]?natal|gesta[cç]|gravidez|puerp|p[oó]s[- ]?parto|parto|ces[aá]r|exame|rastreamento|preventivo|vacina|cirurgia|p[oó]s[- ]?operat|retorno|consulta|normal|sem\s|aus[eê]ncia|hist[oó]ria|antecedente|desejo|planejamento|orienta|inser[cç]|retirada|troca\b|laser|check[- ]?up)/i;
const MEASURE = /\d\s*(mm|cm|ml|kg|g\b|%)|\b(direit[oa]|esquerd[oa]|bilateral|\bdir\b|\besq\b)/i;
const NOT_A_SURGERY = /^(inser[cç][aã]o|retirada de (diu|implante|pontos)|troca de (diu|implante)|coleta|laser|infiltra|curativo|aplica[cç]|cauteriza|bi[oó]psia|pun[cç][aã]o|colposcopia|histeroscopia diagn|exame)/i;
const NON_HORMONAL = /(cobre|\bcu\b|multiload|preservativo|condom|laqueadura|vasectomia|tabel|coito|diafragma)/i;
const HORMONAL = /(mirena|kyleena|implan|p[ií]lula|anticoncepcional oral|inje[cç]|anel|adesivo|nuvaring|cerazette|yaz|yasmin|diane|selene|allurene|depo)/i;

const perPatient = [];
const kinds = new Map();
const outcomes = new Map();
const examKinds = new Map();
const allergyKinds = new Map();
const methodStates = new Map();
let dropped = 0;
let kept = 0;
const droppedBy = new Map();

for (const org of organized) {
  const who = `Paciente ${org.sample}`;
  const p = org.profile;
  const raw = org.profileRaw ?? {};
  const get = (k) => p[k] ?? [];
  const lastRecord = org.lastRecord ?? null;
  const chart = staging.find((e) => e.sample === org.sample && e.sourceEntity === 'chart')?.payload ?? {};
  const rendered = renderProfile(p, { organizedOn: org.organizedOn, civilStatus: chart.civil_status ?? null, bloodType: chart.blood_type ?? null, lastRecord, exportDate: org.exportDate ?? EXPORT_DATE, sex: chart.sex ?? null });

  for (const [list, items] of Object.entries(p)) {
    if (!Array.isArray(items)) continue;
    kept += items.length;
    const lost = Math.max(0, (raw[list]?.length ?? items.length) - items.length);
    // cleanProfile also removes entries: what is counted here is everything the model wrote and the chart did not keep.
    if (lost) { dropped += lost; droppedBy.set(list, (droppedBy.get(list) ?? 0) + lost); }
    for (const e of items) if (!(e.origem ?? []).length) hit('item sem origem depois da conferência', who, `${list}: ${JSON.stringify(e).slice(0, 120)}`);
  }

  // Problems.
  const active = get('problemas').filter((x) => x.situacao === 'ativo');
  const shown = new Set(rendered.diagnoses.map((d) => d.description));
  for (const x of get('problemas')) {
    tally(kinds, `${x.tipo} · ${x.situacao}`);
    if (NOT_A_PROBLEM.test(x.nome.trim())) hit('problema que parece outra coisa (tratamento, gestação, exame, procedimento)', who, `${x.nome} [${x.tipo}, ${x.situacao}]`);
    if (MEASURE.test(x.nome)) hit('problema com medida ou lado no nome', who, x.nome);
    if (x.nome.length > 60) hit('problema com nome longo (mais de 60 caracteres)', who, x.nome);
    if (!recordSpan(x)) hit('problema sem nenhuma data (página sem data, linha sem data)', who, `${x.nome} [${x.tipo}, ${x.situacao}]`);
  }
  for (const x of active) if (!shown.has(x.nome.replace(/\s+/g, ' ').trim())) hit('ativo para a IA, fora dos diagnósticos pela regra de prazo', who, `${x.nome} [${x.tipo}] ${JSON.stringify(recordSpan(x))} · último registro da paciente ${lastRecord}`);
  const stems = new Map();
  for (const x of get('problemas')) stems.set(stem(x.nome), [...(stems.get(stem(x.nome)) ?? []), x.nome]);
  for (const names of stems.values()) if (names.length > 1) hit('problemas com o mesmo radical no mesmo paciente (possível repetição)', who, names.join(' | '));
  for (const d of rendered.diagnoses) if (!d.note) hit('diagnóstico sem observação de data', who, d.description);

  // Contraception.
  const inUse = get('contracepcao').filter((c) => c.situacao === 'em uso');
  for (const c of get('contracepcao')) {
    tally(methodStates, c.situacao);
    if (c.hormonal && NON_HORMONAL.test(c.metodo) && !HORMONAL.test(c.metodo)) hit('método sem hormônio marcado como hormonal', who, c.metodo);
    if (!c.hormonal && HORMONAL.test(c.metodo) && !NON_HORMONAL.test(c.metodo)) hit('método hormonal marcado como não hormonal', who, c.metodo);
  }
  if (inUse.length > 1) hit('mais de um método "em uso"', who, inUse.map((c) => `${c.metodo} ${JSON.stringify(recordSpan(c))}`).join(' | '));
  for (const c of inUse) {
    // A sterilisation stays "in use" for good; anything else not recorded for five years is doubtful.
    if (/laqueadura|vasectomia|ligadura/i.test(c.metodo)) continue;
    const idle = months(recordSpan(c)?.last, lastRecord);
    if (idle !== null && idle > 60) hit('método "em uso" com último registro há mais de 5 anos do último atendimento', who, `${c.metodo}: ${recordSpan(c).last} · último registro da paciente ${lastRecord}`);
  }
  const age = chart.date_of_birth ? Number(EXPORT_DATE.slice(0, 4)) - Number(chart.date_of_birth.slice(0, 4)) : null;
  if (age !== null && age >= 56 && inUse.some((c) => !/laqueadura|vasectomia/i.test(c.metodo))) hit('contracepção "em uso" em paciente de 56 anos ou mais', who, `${age} anos: ${inUse.map((c) => c.metodo).join(' | ')}`);
  if (chart.sex === 'masculino' && (get('contracepcao').length || get('gestacoes').length || get('marcos_ginecologicos').length)) hit('homem com contracepção, gestação ou marco ginecológico', who, JSON.stringify({ contracepcao: get('contracepcao').length, gestacoes: get('gestacoes').length, marcos: get('marcos_ginecologicos').length }));

  // Medicines.
  const allergyNames = get('alergias').map((a) => squash(a.substancia)).filter((n) => n.length >= 4);
  for (const m of get('medicacoes_em_uso')) {
    if (!String(m.dose ?? '').trim() && !String(m.uso ?? '').trim()) hit('medicação em uso sem dose nem modo de uso', who, m.nome);
    if (allergyNames.some((n) => squash(m.nome).includes(n) || n.includes(squash(m.nome)))) hit('medicação em uso que também está nas alergias ou intolerâncias', who, m.nome);
    if (HORMONAL.test(m.nome) && /diu|mirena|kyleena|implan/i.test(m.nome)) hit('dispositivo contraceptivo na lista de medicações', who, m.nome);
    const idle = months(recordSpan(m)?.last, lastRecord);
    if (idle !== null && idle > 12) hit('medicação "em uso" com último registro há mais de 12 meses do último atendimento', who, `${m.nome}: ${recordSpan(m).last} · ${lastRecord}`);
    if (m.duracao === 'prazo definido' && idle !== null && idle > 3) hit('tratamento com prazo prescrito há mais de 3 meses do último atendimento', who, `${m.nome}: ${recordSpan(m).last}`);
  }
  const medNames = get('medicacoes_em_uso').map((m) => squash(m.nome));
  if (new Set(medNames).size < medNames.length) hit('medicação em uso repetida', who, get('medicacoes_em_uso').map((m) => m.nome).join(' | '));

  // Allergies.
  for (const a of get('alergias')) {
    tally(allergyKinds, a.tipo);
    if (/^(alergia|intoler|rea[cç][aã]o)/i.test(a.substancia.trim())) hit('alergia cujo nome não é uma substância', who, a.substancia);
  }
  if (p.alergias_negadas && get('alergias').length) hit('"nega alergias" e alergia escrita ao mesmo tempo', who, get('alergias').map((a) => a.substancia).join(' | '));

  // Pregnancies.
  const orders = get('gestacoes').map((g) => Number(g.ordem)).filter(Number.isFinite);
  for (const g of get('gestacoes')) {
    tally(outcomes, g.desfecho);
    if (!g.data && !recordSpan(g)) hit('gestação sem data escrita e sem data de registro', who, `${g.ordem}: ${g.desfecho}`);
    if (g.desfecho === 'em curso') {
      const idle = months(recordSpan(g)?.last ?? lastRecord, EXPORT_DATE);
      if (idle !== null && idle > 10) hit('gestação "em curso" com último registro há mais de 10 meses da exportação', who, `${recordSpan(g)?.last ?? lastRecord}`);
    }
    if (/\b(dum|dpp)\b/i.test(g.detalhes ?? '')) hit('DUM ou DPP nos detalhes da gestação', who, g.detalhes);
  }
  if (orders.length && orders.some((o, i) => o !== i + 1)) hit('ordem das gestações com salto ou repetição', who, orders.join(', '));
  if (get('cirurgias').some((c) => /^ces[aá]r/i.test(c.nome.trim())) && get('gestacoes').some((g) => g.desfecho === 'cesarea')) hit('cesárea repetida em cirurgias', who, get('cirurgias').filter((c) => /^ces[aá]r/i.test(c.nome.trim())).map((c) => c.nome).join(' | '));

  // Surgeries and procedures.
  for (const c of get('cirurgias')) {
    if (NOT_A_SURGERY.test(c.nome.trim())) hit('procedimento de consultório entre as cirurgias', who, c.nome);
    if (c.data && !dateKey(c.data)) hit('cirurgia com data escrita que não situa no tempo', who, `${c.nome}: ${c.data}`);
    if (/(?<![a-zà-ú])(?:diu|implante|implanon|mirena|kyleena)(?![a-zà-ú])/i.test(c.nome)) hit('inserção ou retirada de DIU ou implante entre as cirurgias (é contracepção)', who, c.nome);
  }

  // Exams.
  for (const e of get('exames')) {
    tally(examKinds, e.tipo);
    const day = dateKey(e.data);
    if (e.data && !day) hit('exame com data escrita que não situa no tempo', who, `${e.exame}: ${e.data}`);
    if (day && day > EXPORT_DATE) hit('exame com data depois da exportação', who, `${e.exame}: ${e.data}`);
    const record = (e.origem ?? []).map((o) => o.data).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')).sort().at(-1);
    if (day && record && months(record, day) !== null && months(record, day) > 1) hit('exame com data posterior ao registro que o cita', who, `${e.exame}: exame ${e.data} · registro ${record}`);
    if (!String(e.resultado ?? '').trim()) hit('exame sem resultado', who, e.exame);
  }

  // Pending items.
  for (const t of get('pendencias')) {
    const idle = months(recordSpan(t)?.last, lastRecord);
    if (idle !== null && idle > 12) hit('pendência de mais de 12 meses antes do último atendimento', who, `${t.texto} · ${recordSpan(t).last}`);
  }
  if (lastRecord && months(lastRecord, EXPORT_DATE) > 24 && get('pendencias').length) hit('pendências de paciente sem atendimento há mais de 2 anos', who, `${get('pendencias').length} · último registro ${lastRecord}`);

  // Quotes that are dated only by the line of an undated page.
  for (const [list, items] of Object.entries(p)) {
    if (!Array.isArray(items)) continue;
    for (const e of items) if ((e.origem ?? []).length && (e.origem ?? []).every((o) => !/^\d{4}-\d{2}-\d{2}$/.test(o.data ?? '')) && (e.origem ?? []).some((o) => quoteDay(o))) tally(kinds, `(data lida da linha de página sem data) ${list}`);
  }

  perPatient.push({
    sample: org.sample, chars: null, lastRecord, staleMonths: months(lastRecord, EXPORT_DATE),
    diagnoses: rendered.diagnoses.length, medications: rendered.medications.length, allergies: rendered.allergies.length,
    history: rendered.medical_history.length, summary: rendered.summaryNote.length, tasks: rendered.tasks.length,
    problems: get('problemas').length, exams: get('exames').length, resumo: (p.resumo ?? '').length,
  });
}

// The converted record itself (anonymised staging): shapes worth knowing before a full migration.
const structure = {};
if (staging.length) {
  const bySample = new Map();
  for (const e of staging) bySample.set(e.sample, [...(bySample.get(e.sample) ?? []), e]);
  const notes = [];
  const rows = { consultations: [], appointments: [], undated: [], files: [], alerts: [], charts: [] };
  const issues = new Map();
  for (const [, es] of bySample) {
    const cons = es.filter((e) => e.sourceEntity === 'consultation');
    rows.consultations.push(cons.length);
    rows.appointments.push(es.filter((e) => e.sourceEntity === 'appointment').length);
    rows.undated.push(es.filter((e) => e.sourceEntity === 'medical_history').length + cons.filter((e) => (e.issues ?? []).some((i) => /no_dates|no_first_visit/.test(i))).length);
    rows.files.push(es.filter((e) => e.sourceEntity === 'file').length);
    rows.alerts.push(es.filter((e) => e.sourceEntity === 'legacy_alert').length);
    rows.charts.push(es.filter((e) => e.sourceEntity === 'chart').length);
    for (const e of cons) notes.push((e.payload.soap_note ?? '').length);
    for (const e of es) for (const i of e.issues ?? []) tally(issues, `${e.sourceEntity}.${i}`);
  }
  Object.assign(structure, {
    people: bySample.size,
    perPerson: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, dist(v)])),
    noteChars: dist(notes),
    notesOver20kChars: notes.filter((n) => n > 20_000).length,
    notesUnder40Chars: notes.filter((n) => n < 40).length,
    issues: Object.fromEntries([...issues].sort((a, b) => b[1] - a[1])),
  });
}

if (SHOW) {
  const found = [...patterns.keys()].filter((k) => k.toLowerCase().includes(SHOW.toLowerCase()));
  for (const k of found) {
    console.log(`\n## ${k} (${patterns.get(k).length})`);
    for (const item of patterns.get(k)) console.log(`- ${item.patient}: ${item.text}`);
  }
  if (!found.length) console.log(`no pattern contains "${SHOW}". Patterns: ${[...patterns.keys()].join(' ; ')}`);
} else {
  const patientsOf = (items) => new Set(items.map((i) => i.patient)).size;
  console.log(JSON.stringify({
    profiles: organized.length,
    items: { kept, removedByChecksAndCleaning: dropped, byList: Object.fromEntries(droppedBy) },
    patterns: Object.fromEntries([...patterns].sort((a, b) => patientsOf(b[1]) - patientsOf(a[1]) || b[1].length - a[1].length).map(([k, v]) => [k, `${v.length} em ${patientsOf(v)} pacientes`])),
    problems: Object.fromEntries([...kinds].sort()),
    contraception: Object.fromEntries(methodStates),
    pregnancies: Object.fromEntries(outcomes),
    allergies: Object.fromEntries(allergyKinds),
    exams: Object.fromEntries([...examKinds].sort((a, b) => b[1] - a[1])),
    rendered: Object.fromEntries(['diagnoses', 'medications', 'allergies', 'tasks', 'history', 'summary', 'problems', 'exams', 'resumo'].map((k) => [k, dist(perPatient.map((x) => x[k]))])),
    patientsWithoutDiagnoses: perPatient.filter((x) => !x.diagnoses).length,
    patientsLastSeenOver18MonthsBeforeExport: perPatient.filter((x) => (x.staleMonths ?? 0) > 18).length,
    structure,
  }, null, 1));
}
