#!/usr/bin/env node
// PersonalMed 2005 -> Cortex: who is behind each legacy doctor code (D2).
// Prints, per UserNumber, what the clinic can recognise: the name and login
// registered in the old system, specialty, CRM, and how much work each code
// has (charts, consultations, appointments, active years, top CID chapters).
//
// PRIVACY: reads only the staff tables and aggregate counts. Never reads or
// prints the password column (Us01.Pass) nor any patient field.
//
// Usage: node scripts/personalmed/doctors.mjs <exportDir>

import { readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ParadoxTable, toCalendarDate } from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';

const dir = process.argv[2];
if (!dir) throw new Error('usage: doctors.mjs <exportDir>');
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
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const year = (v) => toCalendarDate(v)?.iso?.slice(0, 4) ?? null;

const doctors = new Map();
const get = (u) => {
  if (!doctors.has(u)) doctors.set(u, { code: u, charts: 0, consultations: 0, appointments: 0, years: new Map(), cid: new Map() });
  return doctors.get(u);
};

// Staff tables: never the Pass column.
for (const r of rows(px('Us01'), ['UserNumber', 'UserCode', 'Name', 'UserType', 'Speciality', 'Level'])) {
  Object.assign(get(r.UserNumber), { login: str(r.UserCode), name: str(r.Name), userType: str(r.UserType), specialty: str(r.Speciality), level: r.Level });
}
for (const r of rows(px('Us02'), ['UserNumber', 'Speciality', 'CRM'])) {
  const d = get(r.UserNumber);
  d.crm = str(r.CRM) || d.crm;
  d.specialty ||= str(r.Speciality);
}

// Work per code: counts only.
for (const r of rows(mdf.table('Clini_02'), ['UserNumber'])) get(r.UserNumber).charts += 1;
for (const r of rows(px('Co28'), ['UserNumber', 'DataInsert'])) {
  const d = get(r.UserNumber);
  d.consultations += 1;
  const y = year(r.DataInsert);
  if (y) d.years.set(y, (d.years.get(y) ?? 0) + 1);
}
for (const r of rows(px('age03'), ['UserNumber'])) get(r.UserNumber).appointments += 1;
for (const r of rows(px('Co12_2'), ['UserNumber', 'CidCod'])) {
  const chapter = str(r.CidCod).slice(0, 1).toUpperCase();
  if (chapter) get(r.UserNumber).cid.set(chapter, (get(r.UserNumber).cid.get(chapter) ?? 0) + 1);
}

const CHAPTER = { N: 'aparelho geniturinário', O: 'gravidez e parto', Z: 'consultas de rotina', C: 'neoplasias', D: 'neoplasias benignas e sangue', E: 'endócrinas', R: 'sintomas', B: 'infecções', I: 'circulatório', M: 'osteomuscular', F: 'saúde mental' };
const out = [...doctors.values()]
  .filter((d) => d.charts || d.consultations || d.appointments)
  .sort((a, b) => a.code - b.code)
  .map((d) => {
    const years = [...d.years.keys()].sort();
    return {
      codigo: d.code,
      nomeNoSistemaAntigo: d.name ?? '(sem cadastro em Us01)',
      login: d.login ?? null,
      especialidade: d.specialty || null,
      crm: d.crm || null,
      prontuarios: d.charts,
      consultas: d.consultations,
      horariosNaAgenda: d.appointments,
      periodoComConsultas: years.length ? `${years[0]}–${years.at(-1)}` : null,
      capitulosCidMaisUsados: [...d.cid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} (${CHAPTER[c] ?? 'outro'}): ${n}`),
    };
  });
console.log(JSON.stringify(out, null, 2));
