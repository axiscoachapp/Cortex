#!/usr/bin/env node
// Second look at an ANONYMISED sample: which words that are first names or
// surnames in the clinic's own registration are still in the free text.
//
// The leak check of sample.mjs looks for the identifiers of each patient. This
// one looks for OTHER people: a referring doctor typed in lower case, a
// technician, whoever signed the note. Most of what it lists is not a person
// ("natal", "dores", "unimed"): it is a list to read, not a verdict.
//
// By default prints counts only. `--words` lists the words and how often each
// appears; `--context word,word` shows a few characters around each occurrence.
// Both are for whoever is reviewing on this computer.
//
// Usage: node scripts/personalmed/sample-residual-names.mjs <exportDir> [--dir <folder>] [--words] [--context a,b]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { buildNameDictionary, foldSameLength } from './anonymize.mjs';
import { loadOrCreateKey } from './local-key.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { readAll, sampleDir } from './sample.mjs';

const args = process.argv.slice(2);
const exportDir = args[0];
if (!exportDir) throw new Error('usage: sample-residual-names.mjs <exportDir> [--dir <folder>] [--words] [--context a,b]');
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const DIR = sampleDir(opt('--dir'));
const WORDS = args.includes('--words');
const CONTEXT = new Set((opt('--context') ?? '').split(',').map((w) => foldSameLength(w.trim())).filter(Boolean));
const key = loadOrCreateKey(DIR);

const mdf = new Mdf(readdirSync(exportDir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(exportDir, f))[0]);
const table = mdf.table('Clini_01');
const columns = ['Name', 'Mother', 'Father'].map((n) => table.fields.find((x) => x.name === n).index);
const names = [];
for (const r of table.records({ fields: ['Name', 'Mother', 'Father'] })) for (const i of columns) if (r[i]) names.push(r[i]);
const dictionary = buildNameDictionary(names);
const drugFile = join(DIR, 'drug-tokens.json');
const clinical = new Set(existsSync(drugFile) ? JSON.parse(readFileSync(drugFile, 'utf8')) : []);

const first = new Map();
const surname = new Map();
const contexts = [];
let texts = 0;
for (const e of readAll(join(DIR, 'anonymous'), key)) {
  for (const field of ['soap_note', 'text', 'notes', 'registrationNote', 'description']) {
    const text = e.payload?.[field];
    if (typeof text !== 'string' || !text) continue;
    texts += 1;
    for (const m of text.matchAll(/[A-Za-zÀ-ÿ]{4,}/g)) {
      const w = foldSameLength(m[0]);
      if (clinical.has(w)) continue;
      const map = dictionary.first.has(w) ? first : dictionary.surname.has(w) ? surname : null;
      if (!map) continue;
      map.set(w, (map.get(w) ?? 0) + 1);
      if (CONTEXT.has(w)) contexts.push(`[${w}] Paciente ${e.sample} ${e.sourceEntity}: …${text.slice(Math.max(0, m.index - 35), m.index + m[0].length + 35).replace(/\s+/g, ' ')}…`);
    }
  }
}
const total = (map) => [...map.values()].reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ texts, firstNameWords: { distinct: first.size, occurrences: total(first) }, surnameOnlyWords: { distinct: surname.size, occurrences: total(surname) } }));
if (WORDS) {
  const list = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w}:${c}`).join(' ');
  console.log(`first names\n${list(first)}\nsurnames only\n${list(surname)}`);
}
for (const line of contexts) console.log(line);
