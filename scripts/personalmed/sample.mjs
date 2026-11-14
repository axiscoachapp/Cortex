#!/usr/bin/env node
// End-to-end conversion test on a handful of people:
//
//   extract    the whole legacy record of the chosen people -> encrypted staging
//              (same converter as the real migration: extract.mjs --pcods)
//   anonymize  encrypted staging -> encrypted, de-identified staging
//              ("Paciente 1..N"), with a leak check that prints counts only
//
// Everything lives in a folder outside the repository; the key is wrapped with
// Windows DPAPI (local-key.mjs). Nothing here prints a name or a clinical value.
//
// Usage:
//   node scripts/personalmed/sample.mjs extract   <exportDir> --pcods 1,2,3 [--dir <folder>]
//   node scripts/personalmed/sample.mjs anonymize <exportDir> [--dir <folder>]

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNameDictionary, coarseBirthDate, createScrubber, nameTokens } from './anonymize.mjs';
import { loadOrCreateKey } from './local-key.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { ParadoxTable } from './paradox-reader.mjs';
import { textPdf } from './placeholder-pdf.mjs';
import { SecureBatchWriter, decryptBuffer, encryptBuffer, readEncryptedNdjson } from './secure-staging.mjs';
import { legacyFileName } from './staging.mjs';
import { uuidv5 } from './transforms.mjs';

// The commands run only when this file is the entry point; other scripts import its helpers.
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
const [command, exportDir, ...rest] = isMain ? process.argv.slice(2) : [];
const opt = (n) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined);
export const sampleDir = (dir) => dir ?? join(process.env.LOCALAPPDATA ?? '.', 'CortexBackups', 'pm-sample');
const DIR = sampleDir(opt('--dir'));
const HERE = dirname(fileURLToPath(import.meta.url));

/** Labels for the legacy accounts. Doctors keep a stable letter; other staff is "Equipe". */
/** The legacy accounts of this clinic's urologists (the only doctors who see men). */
export const UROLOGY_USERS = [9];
export const DOCTOR_LABEL = { 2: 'Médica A', 3: 'Médica B', 4: 'Médico C', 5: 'Médica D', 9: 'Médico E (urologia)', 11: 'Login compartilhado', 13: 'Médico F' };

function* rows(table, fields, blobs = 'none') {
  const idx = fields.map((n) => table.fields.find((x) => x.name.toLowerCase() === n.toLowerCase()).index);
  for (const r of table.records({ fields, blobs })) yield Object.fromEntries(fields.map((n, i) => [n, r[idx[i]]]));
}
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The page that stands where a legacy image would be in the anonymised sample.
 * It carries no text of the chart: only what the image was and why it is not here.
 */
export function placeholderNotice({ source, date, mime, bytes }) {
  const what = legacyFileName(source, null, 'x').replace(/ \(PersonalMed\)\.x$/, '').toLowerCase();
  const when = date ? `, com data de ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} no PersonalMed` : '';
  const format = { 'image/jpeg': 'JPEG', 'image/png': 'PNG' }[mime] ?? 'imagem';
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return textPdf('Imagem não incluída nesta amostra anonimizada', [
    `Este aviso está no lugar de uma ${what} do prontuário antigo${when}.`,
    `A imagem original (${format}, ${size}) foi convertida e está guardada, mas não foi enviada para este projeto de teste: imagens de exame costumam trazer o nome de quem fez o exame gravado na própria figura, e os prontuários desta amostra estão sem identificação.`,
    'Na migração real, a imagem aparece neste mesmo lugar, na lista de arquivos do prontuário.',
    'O texto que acompanhava a imagem no PersonalMed está no histórico, na nota "Páginas e fichas do prontuário antigo (PersonalMed)".',
  ]);
}

export const readAll = (dir, key) =>
  readdirSync(dir).filter((f) => f.endsWith('.ndjson.enc')).flatMap((f) => readEncryptedNdjson(join(dir, f), key));
export const readSecret = (file, key) => JSON.parse(decryptBuffer(readFileSync(file), key).toString('utf8'));

if (command === 'extract') {
  const key = loadOrCreateKey(DIR);
  const secretFile = join(DIR, 'sample.enc');
  const previous = existsSync(secretFile) ? readSecret(secretFile, key) : null;
  const asked = (opt('--pcods') ?? '').split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n) && n > 0);
  // Without --pcods the same people are extracted again.
  const pcods = asked.length ? asked : previous?.pcods ?? [];
  if (!exportDir || !pcods.length) throw new Error('usage: sample.mjs extract <exportDir> --pcods 1,2,3');
  // The order given here is the order of "Paciente 1..N"; the salt makes the new ids unguessable.
  // The same people in the same order keep their salt, and so their ids: extracting again must
  // not turn what was already loaded into strangers (--new-ids asks for that on purpose).
  const samePeople = Boolean(previous) && previous.pcods.length === pcods.length && previous.pcods.every((p, i) => p === pcods[i]);
  const salt = samePeople && !rest.includes('--new-ids') ? previous.salt : randomBytes(16).toString('hex');
  writeFileSync(secretFile, encryptBuffer(Buffer.from(JSON.stringify({ pcods, salt })), key));
  const out = execFileSync(process.execPath, ['--max-old-space-size=6144', join(HERE, 'extract.mjs'), exportDir, '--pcods', pcods.join(','), '--urology-users', UROLOGY_USERS.join(','), '--out', join(DIR, 'identified')], {
    env: { ...process.env, PM_STAGING_KEY: key.toString('hex') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  const j = JSON.parse(out);
  console.log(JSON.stringify({ people: j.persons, sameIdsAsBefore: salt === previous?.salt, sheets: j.sheets, entities: Object.fromEntries(Object.entries(j.entities).map(([k, v]) => [k, v.total])), staging: join(DIR, 'identified') }));
} else if (command === 'anonymize') {
  if (!exportDir) throw new Error('usage: sample.mjs anonymize <exportDir>');
  const key = loadOrCreateKey(DIR);
  const { pcods, salt } = readSecret(join(DIR, 'sample.enc'), key);
  const envelopes = readAll(join(DIR, 'identified'), key);

  // Registration: every name feeds the dictionary of names; the sample's own rows give the identifiers.
  const mdf = new Mdf(readdirSync(exportDir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(exportDir, f))[0]);
  const px = (name) => new ParadoxTable(join(exportDir, readdirSync(exportDir).find((x) => extname(x).toLowerCase() === '.db' && basename(x, extname(x)).toLowerCase() === name.toLowerCase())));
  const allNames = [];
  const registration = new Map();
  for (const p of rows(mdf.table('Clini_01'), ['PCod', 'Name', 'Mother', 'Father', 'IndicatedBy', 'ID', 'FAX', 'Phone', 'Cellular', 'EMail', 'Address', 'Zip'])) {
    allNames.push(p.Name, p.Mother, p.Father);
    if (pcods.includes(p.PCod)) registration.set(p.PCod, p);
  }
  const dictionary = buildNameDictionary(allNames.filter(Boolean));
  // Kept (encrypted) beside the sample: the loader scrubs the text the AI wrote with the same
  // dictionary, so that a rule added later also reaches summaries made before it.
  writeFileSync(join(DIR, 'name-dictionary.enc'), encryptBuffer(Buffer.from(JSON.stringify({ first: [...dictionary.first], surname: [...dictionary.surname] })), key));
  // Medicine words (public catalogue, exported beside the sample): never taken for a person's name.
  const drugFile = join(DIR, 'drug-tokens.json');
  const clinicalTokens = new Set(existsSync(drugFile) ? JSON.parse(readFileSync(drugFile, 'utf8')) : []);
  const staff = [...rows(px('Us01'), ['UserNumber', 'Name'])].map((r) => ({ code: r.UserNumber, name: str(r.Name) })).filter((r) => r.name);
  const crm = new Map([...rows(px('Us02'), ['UserNumber', 'CRM'])].map((r) => [r.UserNumber, str(r.CRM)]));
  const doctors = staff.map((s) => ({ label: DOCTOR_LABEL[s.code] ?? 'Equipe', names: [s.name] }));
  const protectedTokens = staff.flatMap((s) => nameTokens(s.name));
  const staffDigits = [...crm.values()].filter(Boolean);

  const byPcod = (e) => Number(/(?:^|\|)pcod:(\d+)/.exec(e.sourceRecordId)?.[1] ?? /pcod:(\d+)/.exec(e.payload?.personRef ?? '')?.[1] ?? NaN);
  const cards = new Map();
  for (const e of envelopes) if (e.sourceEntity === 'health_plan_card') cards.set(byPcod(e), [...(cards.get(byPcod(e)) ?? []), e.payload]);
  const personOf = new Map(envelopes.filter((e) => e.sourceEntity === 'person').map((e) => [byPcod(e), e.payload]));

  const scrubbers = new Map();
  pcods.forEach((pcod, i) => {
    const reg = registration.get(pcod) ?? {};
    const person = personOf.get(pcod) ?? {};
    scrubbers.set(pcod, createScrubber({
      label: `Paciente ${i + 1}`,
      name: str(reg.Name) || person.name || '',
      relatives: [reg.Mother, reg.Father, reg.IndicatedBy, ...(cards.get(pcod) ?? []).map((c) => c.holderName)].map(str).filter(Boolean),
      digits: [reg.ID, reg.FAX, person.cpf, reg.Zip, ...(cards.get(pcod) ?? []).map((c) => c.cardNumber), ...staffDigits].filter(Boolean),
      phones: [reg.Phone, reg.Cellular, reg.FAX, ...(person.phones ?? []).flatMap((p) => [p.raw, p.normalized])].filter(Boolean),
      emails: [reg.EMail, person.email].filter(Boolean),
      streets: [reg.Address].filter(Boolean),
      birthDate: person.dateOfBirth ?? null,
      doctors,
      protectedTokens,
      dictionary,
      clinicalTokens,
    }));
  });

  const newId = (id) => (id ? uuidv5(`pm-sample|${salt}|${id}`) : id);
  const index = (pcod) => pcods.indexOf(pcod) + 1;
  const counters = new Map(pcods.map((p) => [p, {}]));
  const fileNames = new Map(pcods.map((p) => [p, new Set()]));
  const writer = new SecureBatchWriter(join(DIR, 'anonymous'), key);
  const leakTotals = new Map(pcods.map((p) => [p, {}]));
  const stats = { entities: {}, unattributed: 0 };

  for (const e of envelopes) {
    const pcod = byPcod(e);
    const s = scrubbers.get(pcod);
    if (!s) { stats.unattributed += 1; continue; }
    const counter = counters.get(pcod);
    const scrub = (v) => s.scrub(v, counter);
    const label = `Paciente ${index(pcod)}`;
    const p = structuredClone(e.payload);
    for (const k of ['patientTargetId', 'contactTargetId']) if (p[k]) p[k] = newId(p[k]);
    if (p.personRef) p.personRef = `sample:${index(pcod)}`;
    if (Array.isArray(p.recipients)) p.recipients = p.recipients.map((r) => ({ ...r, patientTargetId: newId(r.patientTargetId) }));
    switch (e.sourceEntity) {
      case 'person':
        Object.assign(p, { name: label, dateOfBirth: coarseBirthDate(p.dateOfBirth), cpf: null, cpfSource: null, motherName: null, birthplace: null, phones: [], email: null,
          address: { street: null, district: null, city: p.address?.city ?? null, uf: p.address?.uf ?? null, cep: null },
          healthPlan: p.healthPlan ? { ...p.healthPlan, card: null } : null, registrationNote: scrub(p.registrationNote) });
        break;
      case 'contact':
        Object.assign(p, { name: label, phone: '', phone_normalized: null });
        break;
      case 'chart':
        Object.assign(p, { name: label, date_of_birth: coarseBirthDate(p.date_of_birth), cpf: null, phone: null, email: null, profession: null }); // the occupation as typed can point to one person (the owner of a named business)
        break;
      case 'consultation':
        p.soap_note = scrub(p.soap_note);
        break;
      case 'medical_history':
      case 'legacy_alert':
        p.text = scrub(p.text);
        break;
      case 'appointment':
        Object.assign(p, { notes: scrub(p.notes), title: p.title ? label : null });
        break;
      case 'health_plan_card':
        Object.assign(p, { cardNumber: null, holderName: null });
        break;
      case 'file': {
        // The picture itself can carry the name burnt into the pixels (ultrasound, colposcopy):
        // the sample keeps its facts and, in its place, a page that says what is missing and
        // why. Opened in the app it reads as a notice, not as a broken image.
        const source = p.source ?? /^personalmed-(.+?)-\d/.exec(p.file_name)?.[1] ?? '';
        const notice = placeholderNotice({ source, date: p.date, mime: p.mime_type, bytes: p.size_bytes });
        Object.assign(p, { description: scrub(p.description), originalBytes: p.size_bytes, originalMime: p.mime_type, contentBase64: notice.toString('base64'), mime_type: 'application/pdf', size_bytes: notice.length, placeholder: true, file_name: legacyFileName(source, p.date, 'pdf', fileNames.get(pcod)) });
        break;
      }
      default:
        break;
    }
    // The legacy key of a card is its number: the key loses it too.
    const recordId = e.sourceRecordId.replace(/pcod:\d+/, `sample:${index(pcod)}`).replace(/card:[^|]+/, 'card:removido');
    const out = { ...e, sourceRecordId: recordId, targetId: newId(e.targetId), sourceInstance: 'pm-sample', batchId: 'pm-sample', payload: p, sample: index(pcod) };
    // Leak check over everything that is text in the anonymised line.
    // Generated ids and timestamps are skipped: a run of digits inside them is chance, not a document.
    // A leak is reported as "kind in entity.field", never with its value.
    JSON.stringify(out, (k, v) => {
      if (typeof v === 'string' && k !== 'contentBase64' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(v)) {
        for (const [kind, n] of Object.entries(s.leaks(v))) {
          const where = `${kind} in ${e.sourceEntity}.${k}`;
          leakTotals.get(pcod)[where] = (leakTotals.get(pcod)[where] ?? 0) + n;
        }
      }
      return v;
    });
    writer.add(out);
    stats.entities[e.sourceEntity] = (stats.entities[e.sourceEntity] ?? 0) + 1;
  }
  writer.close({ sourceSystem: 'personalmed', sourceInstance: 'pm-sample', batchId: 'pm-sample', anonymised: true });
  const report = {
    people: pcods.length,
    dictionary: { firstNames: dictionary.first.size, surnames: dictionary.surname.size, medicineWords: clinicalTokens.size },
    entities: stats.entities,
    unattributed: stats.unattributed,
    replacements: Object.fromEntries(pcods.map((p) => [`Paciente ${index(p)}`, counters.get(p)])),
    leaksAfter: Object.fromEntries(pcods.map((p) => [`Paciente ${index(p)}`, leakTotals.get(p)])),
  };
  mkdirSync(join(DIR, 'anonymous'), { recursive: true });
  writeFileSync(join(DIR, 'anonymous', 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} else if (command) {
  throw new Error(`unknown command: ${command}`);
}
