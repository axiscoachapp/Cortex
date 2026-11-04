#!/usr/bin/env node
// PersonalMed 2005 -> Cortex: agenda, clinical history, documents, alerts,
// images, users and configuration. Complements data-quality.mjs.
//
// PRIVACY: prints counts, rates, medians and configuration labels only
// (appointment-type names, chart-page titles, CID codes with >= 50 uses,
// health-plan names). Never prints names, contacts, dates of individuals or
// free text.
//
// Usage:
//   node scripts/personalmed/domains.mjs <exportDir> [--export-date 2026-08-24]
//        [--catalog medication_catalog.json] [--json <out>]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ParadoxTable, decodeText, toCalendarDate } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { rtfToText } from './rtf-to-text.mjs';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) throw new Error('usage: domains.mjs <exportDir> [--export-date YYYY-MM-DD] [--catalog file] [--json out]');
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const EXPORT = opt('--export-date') ?? '2026-08-24';
const mdf = new Mdf(readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(dir, f))[0]);

function px(name) {
  const f = readdirSync(dir).find((x) => extname(x).toLowerCase() === '.db' && basename(x, extname(x)).toLowerCase() === name.toLowerCase());
  if (!f) throw new Error(`missing table ${name}`);
  return new ParadoxTable(join(dir, f));
}
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
const iso = (v) => {
  const d = toCalendarDate(v)?.iso ?? null;
  return d && d > '1900-01-01' ? d : null;
};
const inc = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const obj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1)));
const byCount = (m, min = 0) => Object.fromEntries([...m.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]));
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const plain = (v) => (typeof v === 'string' && v.trim() ? (v.trimStart().startsWith('{\\rtf') ? rtfToText(v).text : v) : '');
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pctl = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
// Paradox Time = milliseconds since midnight.
const minutes = (t) => (t && typeof t.timeMs === 'number' ? Math.round(t.timeMs / 60000) : null);
const out = { exportDate: EXPORT };

// ---------------------------------------------------------------------------
// Patients: names and phones only to link pre-registered appointments (kept in memory)

const byName = new Map(); // norm(name) -> [PCod]
const phonesOf = new Map(); // PCod -> Set(last 8 digits)
for (const p of rows(mdf.table('Clini_01'), ['PCod', 'Name', 'Phone', 'Cellular'])) {
  const n = norm(p.Name);
  if (n) {
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(p.PCod);
  }
  const s = new Set();
  for (const raw of [str(p.Phone), str(p.Cellular)]) for (const m of raw.replace(/[^\d/,;]/g, ' ').match(/\d{8,}/g) ?? []) s.add(m.slice(-8));
  phonesOf.set(p.PCod, s);
}

// ---------------------------------------------------------------------------
// 1. Agenda

const types = new Map(); // `${user}|${id}` -> label
for (const r of rows(px('age02'), ['UserNumber', 'ID', 'Descricao', 'Duracao'])) types.set(`${r.UserNumber}|${str(r.ID)}`, `${str(r.ID)} — ${str(r.Descricao)}`);
const slotDur = new Map(); // user -> Map(duration -> n)
const slotType = new Map();
for (const r of rows(px('age03'), ['UserNumber', 'Data', 'Duracao', 'Tipo'])) {
  if (!slotDur.has(r.UserNumber)) slotDur.set(r.UserNumber, new Map());
  if ((iso(r.Data) ?? '') >= '2025-01-01') inc(slotDur.get(r.UserNumber), r.Duracao ?? 0);
  inc(slotType, str(r.Tipo) || '(vazio)');
}

const carrierName = new Map();
for (const r of rows(px('Carrier'), ['CarrierCod', 'Name'])) carrierName.set(r.CarrierCod, str(r.Name));

const ag = {
  porAnoEstado: new Map(),
  futuras: { total: 0, porMes: new Map(), porMedico: new Map(), comPaciente: 0, preCadastro: 0 },
  tipos: new Map(),
  convenio2025: new Map(),
  espera: [],
  atrasoChegada: [],
  preCadastro: { linhas: 0, comNome: 0, futuras: 0, nomeUnico: 0, nomeAmbiguo: 0, nomeTelefone: 0, semCorrespondencia: 0 },
  porMedico2025: new Map(),
};
const attended = new Set(); // `${PCod}|${user}|${date}`
for (const r of rows(px('Age04'), ['UserNumber', 'Data', 'Inicio', 'PCod', 'Estado', 'Chegada', 'InicioAtendimento', 'IDTipo', 'CarrierCod', 'PreCadastro'], 'raw')) {
  const d = iso(r.Data);
  if (!d) continue;
  const st = str(r.Estado) || '-';
  const year = d.slice(0, 4);
  inc(ag.porAnoEstado, `${year}|${st}`);
  if (['T', 'A', 'E'].includes(st) && r.PCod != null) attended.add(`${r.PCod}|${r.UserNumber}|${d}`);
  if (d >= '2025-01-01' && d <= EXPORT) {
    inc(ag.tipos, types.get(`${r.UserNumber}|${str(r.IDTipo)}`) ?? `${str(r.IDTipo) || '(sem tipo)'}`);
    inc(ag.porMedico2025, `${r.UserNumber}|${st}`);
    if (st === 'T') {
      inc(ag.convenio2025, carrierName.get(r.CarrierCod) ?? (r.CarrierCod == null ? '(sem convênio)' : `#${r.CarrierCod}`));
      const a = minutes(r.Chegada);
      const b = minutes(r.InicioAtendimento);
      const s = minutes(r.Inicio);
      if (a != null && b != null && b >= a && b - a < 600) ag.espera.push(b - a);
      if (a != null && s != null && Math.abs(a - s) < 600) ag.atrasoChegada.push(a - s);
    }
  }
  const future = d > EXPORT && st !== 'C';
  if (future) {
    ag.futuras.total += 1;
    inc(ag.futuras.porMes, d.slice(0, 7));
    inc(ag.futuras.porMedico, r.UserNumber);
    if (r.PCod != null) ag.futuras.comPaciente += 1;
  }
  if (r.PCod == null && Buffer.isBuffer(r.PreCadastro) && r.PreCadastro.length >= 513) {
    const b = r.PreCadastro;
    const short = (o) => decodeText(b.subarray(o + 1, o + 1 + Math.min(b[o], 255)), 1252);
    const name = norm(short(0));
    ag.preCadastro.linhas += 1;
    if (!name) continue;
    ag.preCadastro.comNome += 1;
    if (future) {
      ag.preCadastro.futuras += 1;
      ag.futuras.preCadastro += 1;
    }
    const cands = byName.get(name) ?? [];
    const tel = [short(256), short(512)].flatMap((t) => t.replace(/\D/g, ' ').match(/\d{8,}/g) ?? []).map((t) => t.slice(-8));
    if (cands.length && tel.length && cands.some((pc) => tel.some((t) => phonesOf.get(pc)?.has(t)))) ag.preCadastro.nomeTelefone += 1;
    else if (cands.length === 1) ag.preCadastro.nomeUnico += 1;
    else if (cands.length > 1) ag.preCadastro.nomeAmbiguo += 1;
    else ag.preCadastro.semCorrespondencia += 1;
  }
}
const yearStatus = new Map();
for (const [k, n] of ag.porAnoEstado) {
  const [y, s] = k.split('|');
  if (!yearStatus.has(y)) yearStatus.set(y, {});
  yearStatus.get(y)[s] = n;
}
const workHours = new Map();
for (const r of rows(px('age06'), ['UserNumber', 'DiaDaSemana', 'Inicio', 'Fim', 'Duracao'])) inc(workHours, r.UserNumber);
const planLimits = { regras: 0, medicos: new Set(), convenios: new Map(), maximo: new Map() };
for (const r of rows(px('age08'), ['UserNumber', 'DiaDaSemana', 'CarrierCod', 'MaxConsultas'])) {
  planLimits.regras += 1;
  inc(planLimits.maximo, r.MaxConsultas ?? 'vazio');
  planLimits.medicos.add(r.UserNumber);
  inc(planLimits.convenios, carrierName.get(r.CarrierCod) ?? `#${r.CarrierCod}`);
}
const notes = { age01: new Map(), age05: new Map(), age05Confidencial: 0 };
for (const r of rows(px('age01'), ['Data'])) inc(notes.age01, (iso(r.Data) ?? '????').slice(0, 4));
for (const r of rows(px('age05'), ['Data', 'Confidencial'])) {
  inc(notes.age05, (iso(r.Data) ?? '????').slice(0, 4));
  if (r.Confidencial) notes.age05Confidencial += 1;
}
out.agenda = {
  porAno: Object.fromEntries([...yearStatus.entries()].sort()),
  tiposDeSlot: byCount(slotType),
  duracaoSlot2025PorMedico: Object.fromEntries([...slotDur.entries()].map(([u, m]) => [u, byCount(m, 20)])),
  tipos2025: byCount(ag.tipos, 20),
  porMedicoEstado2025: obj(ag.porMedico2025),
  convenioAtendidos2025: byCount(ag.convenio2025, 20),
  esperaMinutos2025: { n: ag.espera.length, mediana: median(ag.espera), p90: pctl(ag.espera, 0.9) },
  chegadaMenosHorarioMinutos2025: { n: ag.atrasoChegada.length, mediana: median(ag.atrasoChegada), p10: pctl(ag.atrasoChegada, 0.1), p90: pctl(ag.atrasoChegada, 0.9) },
  futuras: { ...ag.futuras, porMes: obj(ag.futuras.porMes), porMedico: obj(ag.futuras.porMedico) },
  preCadastro: ag.preCadastro,
  configuracao: { horariosDeTrabalhoPorMedico: obj(workHours), limitesPorConvenio: { regras: planLimits.regras, medicos: [...planLimits.medicos].sort((a, b) => a - b), conveniosComRegra: planLimits.convenios.size, maximoPorDia: byCount(planLimits.maximo) } },
  notasDaAgenda: { age01PorAno: obj(notes.age01), age05PorAno: obj(notes.age05), age05Confidencial: notes.age05Confidencial },
};

// ---------------------------------------------------------------------------
// 2. Running history (Co12_1): can it be split by the dates typed at line start?

const STAMP = /^[ \t]*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?!\d)/gm;
const validDate = (dd, mm, yy) => {
  let y = Number(yy);
  if (yy.length === 2) y += y <= Number(EXPORT.slice(2, 4)) ? 2000 : 1900;
  const m = Number(mm);
  const d = Number(dd);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDate() !== d) return null;
  const s = dt.toISOString().slice(0, 10);
  return s >= '1985-01-01' && s <= EXPORT ? s : null;
};
// Dated encounters from the structured tables (same rule as linkage.mjs).
const encounters = new Set();
for (const [t, pc, dt] of [['Co28', 'PCod', 'DataInsert'], ['Clini_06', 'PCod', 'DateInsert'], ['Co12_2', 'PCod', 'DateInsert'], ['Co49_2', 'PCod', 'Date']]) {
  for (const r of rows(px(t), [pc, 'UserNumber', dt])) {
    const d = iso(r[dt]);
    if (d && r[pc] != null) encounters.add(`${r[pc]}|${r.UserNumber}|${d}`);
  }
}
const histDays = new Set(); // distinct (chart, day) among history entries
const hist = { documentos: 0, comTexto: 0, divisiveis: 0, entradas: 0, datasInvalidas: 0, emOrdem: 0, foraDeOrdem: 0, datasComConsulta: 0, entradasComData: 0, preambulo: [], entradasPorDoc: [], tamanhoEntrada: [] };
for (const r of rows(px('Co12_1'), ['PCod', 'UserNumber', 'Contents'], 'text')) {
  hist.documentos += 1;
  const text = plain(r.Contents);
  if (!text.trim()) continue;
  hist.comTexto += 1;
  const stamps = [...text.matchAll(STAMP)].map((m) => ({ at: m.index, date: validDate(m[1], m[2], m[3]) }));
  const valid = stamps.filter((s) => s.date);
  hist.datasInvalidas += stamps.length - valid.length;
  if (valid.length < 2) continue;
  hist.divisiveis += 1;
  hist.entradas += valid.length;
  hist.entradasPorDoc.push(valid.length);
  hist.preambulo.push(valid[0].at);
  let ordered = true;
  for (let i = 1; i < valid.length; i += 1) if (valid[i].date < valid[i - 1].date) ordered = false;
  if (ordered) hist.emOrdem += 1;
  else hist.foraDeOrdem += 1;
  for (let i = 0; i < valid.length; i += 1) {
    hist.entradasComData += 1;
    if (attended.has(`${r.PCod}|${r.UserNumber}|${valid[i].date}`)) hist.datasComConsulta += 1;
    histDays.add(`${r.PCod}|${r.UserNumber}|${valid[i].date}`);
    hist.tamanhoEntrada.push((valid[i + 1]?.at ?? text.length) - valid[i].at);
  }
}
out.historicoCorrido = {
  documentos: hist.documentos,
  comTexto: hist.comTexto,
  divisiveisPorData: hist.divisiveis,
  entradas: hist.entradas,
  entradasPorDocumento: { mediana: median(hist.entradasPorDoc), p90: pctl(hist.entradasPorDoc, 0.9), max: Math.max(0, ...hist.entradasPorDoc) },
  caracteresPorEntrada: { mediana: median(hist.tamanhoEntrada), p90: pctl(hist.tamanhoEntrada, 0.9) },
  caracteresAntesDaPrimeiraData: { mediana: median(hist.preambulo), p90: pctl(hist.preambulo, 0.9) },
  documentosEmOrdemCronologica: hist.emOrdem,
  documentosComDatasForaDeOrdem: hist.foraDeOrdem,
  carimbosComDataInvalida: hist.datasInvalidas,
  entradasNoDiaDeUmaConsultaAtendida: hist.datasComConsulta,
  diasDistintosNasEntradas: histDays.size,
  diasQueJaSaoAtendimentoDatado: [...histDays].filter((k) => encounters.has(k)).length,
  diasNovos: [...histDays].filter((k) => !encounters.has(k)).length,
  atendimentosDatadosEstruturados: encounters.size,
};

// Chart pages (SQL Me): titles come from each doctor's configuration (Us04).
const pageTitle = new Map();
for (const r of rows(px('Us04'), ['UserNumber', 'ComponentNumber', 'Title'])) pageTitle.set(`${r.UserNumber}|${r.ComponentNumber}`, str(r.Title));
const pages = new Map();
for (const r of rows(mdf.table('Me'), ['UserNumber', 'CompNumber'])) inc(pages, pageTitle.get(`${r.UserNumber}|${r.CompNumber}`) || `#${r.CompNumber}`);
out.paginasDoProntuario = byCount(pages);

// ---------------------------------------------------------------------------
// 3. Evolutions with vital signs (Co28)

const vit = { linhas: 0, peso: { ok: 0, fora: 0, vazio: 0 }, altura: { cm: 0, m: 0, fora: 0, vazio: 0 }, fc: { ok: 0, fora: 0, vazio: 0 }, pa: { mmHg: 0, cmHg: 0, fora: 0, vazio: 0 }, temperatura: { ok: 0, vazio: 0 }, textoMediana: [] };
for (const r of rows(px('Co28'), ['Weigth', 'Height', 'FC', 'Pressure', 'Temperature', 'Observation'], 'text')) {
  vit.linhas += 1;
  const w = Number(r.Weigth) || 0;
  if (!w) vit.peso.vazio += 1;
  else if (w >= 25 && w <= 250) vit.peso.ok += 1;
  else vit.peso.fora += 1;
  const h = Number(r.Height) || 0;
  if (!h) vit.altura.vazio += 1;
  else if (h >= 100 && h <= 220) vit.altura.cm += 1;
  else if (h >= 1 && h <= 2.2) vit.altura.m += 1;
  else vit.altura.fora += 1;
  const fc = Number(r.FC) || 0;
  if (!fc) vit.fc.vazio += 1;
  else if (fc >= 30 && fc <= 220) vit.fc.ok += 1;
  else vit.fc.fora += 1;
  const m = str(r.Pressure).match(/^(\d{1,3})\s*[/x]\s*(\d{1,3})$/);
  if (!str(r.Pressure)) vit.pa.vazio += 1;
  else if (m && +m[1] >= 60 && +m[1] <= 260 && +m[2] >= 30 && +m[2] <= 160 && +m[1] > +m[2]) vit.pa.mmHg += 1;
  else if (m && +m[1] >= 6 && +m[1] <= 26 && +m[2] >= 3 && +m[2] <= 16 && +m[1] > +m[2]) vit.pa.cmHg += 1;
  else vit.pa.fora += 1;
  const t = Number(r.Temperature) || 0;
  if (t >= 34 && t <= 42) vit.temperatura.ok += 1;
  else vit.temperatura.vazio += 1;
  const obs = plain(r.Observation);
  if (obs) vit.textoMediana.push(obs.length);
}
vit.textoMediana = median(vit.textoMediana);
out.evolucoes = vit;

// ---------------------------------------------------------------------------
// 4. CID-10 (Co12_2)

const cid10 = new Map();
for (const r of rows(px('Cid10'), ['CodCid', 'Disease'])) cid10.set(norm(r.CodCid).replace(/ /g, ''), str(r.Disease));
const cids = { linhas: 0, validos: 0, invalidos: 0, vazios: 0, porCodigo: new Map(), porProntuario: new Map() };
for (const r of rows(px('Co12_2'), ['PCod', 'UserNumber', 'CidCod'])) {
  cids.linhas += 1;
  const code = norm(r.CidCod).replace(/ /g, '');
  if (!code) {
    cids.vazios += 1;
    continue;
  }
  if (cid10.has(code)) cids.validos += 1;
  else cids.invalidos += 1;
  inc(cids.porCodigo, code);
  inc(cids.porProntuario, `${r.PCod}|${r.UserNumber}`);
  // Chapter Z = reason for the visit (routine exam, prenatal care), not a diagnosis.
  if (code.startsWith('z')) cids.motivo = (cids.motivo ?? 0) + 1;
  else {
    cids.diagnostico = (cids.diagnostico ?? 0) + 1;
    (cids.prontuariosComDiagnostico ??= new Set()).add(`${r.PCod}|${r.UserNumber}`);
  }
}
const perChart = [...cids.porProntuario.values()];
const distinctPerChart = new Map();
out.cid = {
  linhas: cids.linhas,
  codigosValidosNaTabelaCid10: cids.validos,
  codigosNaoEncontrados: cids.invalidos,
  vazios: cids.vazios,
  codigosDistintos: cids.porCodigo.size,
  prontuariosComCid: perChart.length,
  capituloZ_motivoDaConsulta: cids.motivo ?? 0,
  outrosCapitulos_diagnostico: cids.diagnostico ?? 0,
  prontuariosComAlgumDiagnosticoForaDoZ: cids.prontuariosComDiagnostico?.size ?? 0,
  registrosPorProntuario: { mediana: median(perChart), p90: pctl(perChart, 0.9) },
  maisUsados: Object.fromEntries([...cids.porCodigo.entries()].filter(([, n]) => n >= 50).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => [`${c.toUpperCase()} ${cid10.get(c) ?? ''}`.trim(), n])),
};
void distinctPerChart;

// ---------------------------------------------------------------------------
// 5. Obstetrics

const preg = { gestacoes: 0, emCurso: 0, emCursoComDum: 0, emCursoComUsg: 0, comFatorDeRisco: 0, emCursoComFatorDeRisco: 0 };
const activePreg = new Set();
const riskFields = px('Co49_1').fields.filter((f) => /^R[ABC]\d+$/.test(f.name)).map((f) => f.name);
for (const r of rows(px('Co49_1'), ['Pcod', 'UserNumber', 'NumberGestation', 'DUM', 'DPP', 'DataEco', ...riskFields])) {
  preg.gestacoes += 1;
  const dpp = iso(r.DPP);
  const risk = riskFields.some((f) => r[f] === true);
  if (risk) preg.comFatorDeRisco += 1;
  if (dpp && dpp >= EXPORT && dpp <= new Date(Date.parse(EXPORT) + 300 * 864e5).toISOString().slice(0, 10)) {
    preg.emCurso += 1;
    if (iso(r.DUM)) preg.emCursoComDum += 1;
    if (iso(r.DataEco)) preg.emCursoComUsg += 1;
    if (risk) preg.emCursoComFatorDeRisco += 1;
    activePreg.add(`${r.Pcod}|${r.UserNumber}|${r.NumberGestation}`);
  }
}
const visits = { consultas: 0, campos: { Ig: 0, Weight: 0, Pressure: 0, Au: 0, BCF: 0, MF: 0, Edema: 0 }, porGestacaoEmCurso: new Map() };
for (const r of rows(px('Co49_2'), ['PCod', 'UserNumber', 'NumberGestation', 'Ig', 'Weight', 'Pressure', 'Au', 'BCF', 'MF', 'Edema'])) {
  visits.consultas += 1;
  for (const f of Object.keys(visits.campos)) if (r[f] != null && r[f] !== 0 && str(String(r[f])) !== '') visits.campos[f] += 1;
  const k = `${r.PCod}|${r.UserNumber}|${r.NumberGestation}`;
  if (activePreg.has(k)) inc(visits.porGestacaoEmCurso, k);
}
out.obstetricia = {
  ...preg,
  consultasPreNatal: visits.consultas,
  preenchimento: visits.campos,
  consultasPorGestacaoEmCurso: { gestacoesComConsulta: visits.porGestacaoEmCurso.size, mediana: median([...visits.porGestacaoEmCurso.values()]) },
};
let co50 = 0;
let co51 = 0;
for (const _ of rows(px('Co50'), ['PCod'])) co50 += 1;
for (const _ of rows(px('Co51'), ['PCod'])) co51 += 1;
out.obstetricia.contracepcao = co50;
out.obstetricia.climaterio = co51;

// ---------------------------------------------------------------------------
// 6. "Atenção" alerts (Clini_01.Attention): what kind of content they hold

const ALERT = {
  alergia: /\balerg/,
  medicamento_citado: /\b(dipirona|novalgina|penicilina|benzetacil|amoxicilina|cefalexina|sulfa|aas|aspirina|ibuprofeno|diclofenaco|nimesulida|cetoprofeno|anti ?inflamatorio|aine|iodo|contraste|latex|esparadrapo|codeina|tramadol|morfina|buscopan|metronidazol|ciprofloxacino|azitromicina)\b/,
  financeiro: /\b(cheque|deve|devendo|pagament|pagar|pago|debito|divida|cobr|desconto|cortesia|valor|reembolso|nota fiscal|recibo)/,
  comportamento: /\b(cuidado|dificil|reclam|grosseir|agressiv|processo|advogad|briga|nervos|exigente)/,
  administrativo: /\b(ligar|telefon|whats|recado|avisar|marcar|encaixe|horario|agenda|confirmar|email)/,
  obito: /\b(falec|obito|morreu)/,
  gestacao: /\b(gestante|gravida|gestacao|dum|dpp|pre natal)/,
  convenio: /\b(unimed|amil|sulamerica|convenio|plano|carteir|guia|autoriz)/,
  doenca_cronica: /\b(diabet|hipertens|hipotireoid|tireoid|asma|epileps|cardiopat|marcapasso|anticoagul|hiv|hepatite|cancer|neoplasia|lupus|trombofilia|trombose)/,
};
const alerts = { comTexto: 0, tamanho: [], categorias: new Map(), soAlergia: 0, misto: 0 };
for (const p of rows(mdf.table('Clini_01'), ['Attention'], 'text')) {
  const t = norm(plain(p.Attention));
  if (!t) continue;
  alerts.comTexto += 1;
  alerts.tamanho.push(t.length);
  const hits = Object.entries(ALERT).filter(([, re]) => re.test(t)).map(([k]) => k);
  for (const h of hits) inc(alerts.categorias, h);
  if (!hits.length) inc(alerts.categorias, 'nenhuma_das_categorias');
  const clinical = hits.filter((h) => ['alergia', 'medicamento_citado', 'gestacao', 'doenca_cronica', 'obito'].includes(h));
  const admin = hits.filter((h) => ['financeiro', 'comportamento', 'administrativo', 'convenio'].includes(h));
  if (clinical.length && admin.length) alerts.misto += 1;
}
out.alertasAtencao = { comTexto: alerts.comTexto, caracteres: { mediana: median(alerts.tamanho), p90: pctl(alerts.tamanho, 0.9) }, categorias: byCount(alerts.categorias), clinicoEAdministrativoNoMesmoAlerta: alerts.misto };

// ---------------------------------------------------------------------------
// 7. Issued documents (Clini_06): texts and exam requests

const TEXT_KIND = [
  ['atestado', /\batest/],
  ['declaracao', /\bdeclar/],
  ['relatorio', /\brelatorio/],
  ['encaminhamento', /\bencaminh/],
  ['laudo', /\blaudo/],
  ['termo_consentimento', /\b(termo|consentimento|autorizo)/],
  ['orientacoes', /\b(orientac|cuidados|recomendac|dieta)/],
  ['solicitacao', /\b(solicit|pedido|requisic)/],
];
const EXAMS = {
  ultrassom: /\b(ultrass|usg|ecograf|us transvaginal|us obstetric|us de mamas|ultra som)/,
  mamografia: /\bmamograf/,
  citologia_papanicolau: /\b(papanicolau|colpocitolog|citologia|preventivo|cco)\b/,
  colposcopia: /\bcolposcop/,
  hemograma: /\bhemograma/,
  tireoide_tsh_t4: /\b(tsh|t4)\b/,
  glicemia_hba1c: /\b(glicemia|glicose|hemoglobina glicada|hba1c|curva glicemica|tolerancia a glicose)/,
  beta_hcg: /\b(beta ?hcg|bhcg)/,
  urina_urocultura: /\b(eas|urina|urocultura|parcial de urina)\b/,
  vitamina_d: /\bvitamina d|25 oh/,
  ferritina_ferro: /\b(ferritina|ferro serico)/,
  lipidograma: /\b(lipidograma|colesterol|triglicer)/,
  hormonios_reprodutivos: /\b(fsh|lh|estradiol|prolactina|progesterona|testosterona|amh|antimulleriano)\b/,
  sorologias: /\b(hiv|vdrl|sifilis|hepatite|hbsag|anti hcv|toxoplasm|rubeola|citomegalov)/,
  densitometria: /\bdensitometr/,
  ressonancia_tomografia: /\b(ressonanc|tomograf)/,
  psa: /\bpsa\b/,
  espermograma: /\bespermograma/,
  histeroscopia_histerossalpingografia: /\b(histeroscop|histerossalping)/,
};
const docs = { porTipoAno: new Map(), textos: new Map(), exames: new Map(), pedidos2025: 0 };
for (const r of rows(px('Clini_06'), ['DateInsert', 'ModelType', 'Contents'], 'text')) {
  const d = iso(r.DateInsert);
  const y = d ? d.slice(0, 4) : '????';
  inc(docs.porTipoAno, `${y}|${r.ModelType}`);
  if (!d || d < '2025-01-01') continue;
  if (r.ModelType === 2) {
    const head = norm(plain(r.Contents)).slice(0, 400);
    inc(docs.textos, TEXT_KIND.find(([, re]) => re.test(head))?.[0] ?? 'outro');
  } else if (r.ModelType === 3) {
    docs.pedidos2025 += 1;
    const t = norm(plain(r.Contents));
    for (const [k, re] of Object.entries(EXAMS)) if (re.test(t)) inc(docs.exames, k);
  }
}
const typeYear = new Map();
for (const [k, n] of docs.porTipoAno) {
  const [y, t] = k.split('|');
  if (y < '2019') continue;
  if (!typeYear.has(y)) typeYear.set(y, {});
  typeYear.get(y)[{ 1: 'receitas', 2: 'textos', 3: 'pedidos_de_exame' }[t] ?? `tipo${t}`] = n;
}
out.documentos = { porAnoDesde2019: Object.fromEntries([...typeYear.entries()].sort()), textos2025a2026: byCount(docs.textos), pedidosDeExame2025a2026: { total: docs.pedidos2025, examesCitados: byCount(docs.exames) } };

// Text and exam templates by kind (configuration content).
const tplKinds = new Map();
for (const t of ['Us05', 'Gintxt', 'Pedtxt']) {
  for (const r of rows(px(t), ['ModelType', 'ModelName', 'Contents'], 'text')) {
    if (r.ModelType === 1) continue;
    const head = norm(`${str(r.ModelName)} ${plain(r.Contents).slice(0, 300)}`);
    inc(tplKinds, `tipo${r.ModelType}.${(r.ModelType === 3 ? 'pedido_de_exame' : TEXT_KIND.find(([, re]) => re.test(head))?.[0]) ?? 'outro'}`);
  }
}
out.modelosDeTextoEExame = byCount(tplKinds);

// ---------------------------------------------------------------------------
// 8. Template medication lines vs the Cortex catalogue (Anvisa)

if (opt('--catalog')) {
  const cat = JSON.parse(readFileSync(opt('--catalog'), 'utf8'));
  const first = (s) => norm(s).split(' ')[0];
  const products = new Set(cat.map((c) => first(c.p)).filter((w) => w.length >= 4));
  const ingredients = new Set(cat.map((c) => first(c.a)).filter((w) => w.length >= 4));
  const lines = { itens: 0, porNomeComercial: 0, porPrincipioAtivo: 0, manipulado: 0, semCorrespondencia: 0 };
  for (const r of rows(px('Us05'), ['ModelType', 'Contents'], 'text')) {
    if (r.ModelType !== 1) continue;
    for (const m of plain(r.Contents).matchAll(/^\s*[-•*]\s*([^\n_]+?)\s*(?:_{2,}|\.{3,}|\t|$)/gm)) {
      const name = norm(m[1]);
      if (!name) continue;
      lines.itens += 1;
      const w = name.split(' ');
      if (/\b(manipul|formula|farmacia de manipulacao)\b/.test(name)) lines.manipulado += 1;
      else if (products.has(w[0])) lines.porNomeComercial += 1;
      else if (w.some((x) => ingredients.has(x))) lines.porPrincipioAtivo += 1;
      else lines.semCorrespondencia += 1;
    }
  }
  out.itensDosModelosNoCatalogo = lines;
}

// ---------------------------------------------------------------------------
// 9. Images, users, messages, phone book, letterhead

const img = { clini04: { linhas: 0, imagemEmbutida: 0, bytes: 0, arquivoExterno: 0, foto: 0 }, outrosExames: { imagens: 0, bytes: 0 } };
for (const r of rows(px('Clini_04'), ['Image', 'Photo', 'StoragePlace'], 'raw')) {
  img.clini04.linhas += 1;
  if (Buffer.isBuffer(r.Image) && r.Image.length) {
    img.clini04.imagemEmbutida += 1;
    img.clini04.bytes += r.Image.length;
  }
  if (str(r.StoragePlace)) img.clini04.arquivoExterno += 1;
  if (r.Photo) img.clini04.foto += 1;
}
for (const [t, fields] of [['Co31_1', ['Image1', 'Image2', 'Image3', 'Image4']], ['CO52', ['Imagem']]]) {
  for (const r of rows(px(t), fields, 'raw')) for (const f of fields) if (Buffer.isBuffer(r[f]) && r[f].length) {
    img.outrosExames.imagens += 1;
    img.outrosExames.bytes += r[f].length;
  }
}
out.imagens = img;

const users = new Map();
for (const r of rows(px('Us01'), ['UserType', 'Level'])) inc(users, `${str(r.UserType) || '?'}|nivel${r.Level}`);
const msgs = new Map();
for (const r of rows(px('Messages'), ['TimeStamp'])) inc(msgs, (iso(r.TimeStamp) ?? '????').slice(0, 4));
const phoneBook = new Map();
for (const r of rows(px('AgFone'), ['Categoria'])) inc(phoneBook, norm(r.Categoria) || '(sem categoria)');
const head = { cabecalhoTexto: false, cabecalhoImagem: null, rodape: false, cnpj: false, razaoSocial: false };
for (const r of rows(px('Cfg01'), ['AHeader', 'AHeaderImage', 'Footer', 'CNPJ_CPF', 'CorporateName'], 'raw')) {
  head.cabecalhoTexto = Buffer.isBuffer(r.AHeader) && r.AHeader.length > 0;
  head.rodape = Buffer.isBuffer(r.Footer) && r.Footer.length > 0;
  if (Buffer.isBuffer(r.AHeaderImage) && r.AHeaderImage.length) {
    const b = r.AHeaderImage;
    const at = (sig) => b.indexOf(Buffer.from(sig));
    head.cabecalhoImagem = { bytes: b.length, formato: at([0xff, 0xd8, 0xff]) >= 0 && at([0xff, 0xd8, 0xff]) < 64 ? 'jpeg' : at('BM') >= 0 && at('BM') < 64 ? 'bmp' : 'outro' };
  }
  head.cnpj = !!str(r.CNPJ_CPF);
  head.razaoSocial = !!str(r.CorporateName);
}
out.usuariosEConfiguracao = { contasPorTipo: obj(users), mensagensInternasPorAno: obj(msgs), agendaTelefonicaPorCategoria: byCount(phoneBook, 5), timbre: head };

const json = JSON.stringify(out, null, 2);
if (opt('--json')) writeFileSync(opt('--json'), json);
console.log(json);
