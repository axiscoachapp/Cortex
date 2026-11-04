// PersonalMed 2005 -> Cortex: pure transformation rules for the staging
// contract (docs/migration/personalmed/CODEX_IMPLEMENTATION.md §3–§4).
//
// No I/O and no patient data here: every function takes plain values and
// returns { value, issues }. Rules never invent data; when a rule cannot
// decide, the value is null and an issue code says why.

import { createHash } from 'node:crypto';

export const TRANSFORM_VERSION = 'pm-v1';
/** Fixed namespace for deterministic target ids (UUIDv5). Never change it. */
export const MIGRATION_NAMESPACE = '8f1d2c3b-4a5e-5f60-8172-93a4b5c6d7e8';

// ---------------------------------------------------------------------------
// Identifiers

const uuidBytes = (uuid) => Buffer.from(uuid.replace(/-/g, ''), 'hex');

/** RFC 4122 UUID version 5 (SHA-1, name-based). */
export function uuidv5(name, namespace = MIGRATION_NAMESPACE) {
  const hash = createHash('sha1').update(Buffer.concat([uuidBytes(namespace), Buffer.from(String(name), 'utf8')])).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Stable source key: `pcod:1234|user:3`, parts in the given order. */
export function sourceRecordId(parts) {
  return Object.entries(parts)
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}

export function targetId(sourceInstance, sourceEntity, recordId) {
  return uuidv5(`personalmed|${sourceInstance}|${sourceEntity}|${recordId}`);
}

/** One staging line (envelope of §3). */
export function envelope({ sourceInstance, sourceEntity, key, doctor = null, batchId, targetTable, payload, issues = [], status }) {
  const recordId = sourceRecordId(key);
  return {
    sourceSystem: 'personalmed',
    sourceInstance,
    sourceEntity,
    sourceRecordId: recordId,
    sourceDoctorId: doctor == null ? null : `user:${doctor}`,
    batchId,
    transformVersion: TRANSFORM_VERSION,
    targetTable,
    targetId: targetId(sourceInstance, sourceEntity, recordId),
    payload,
    issues: [...new Set(issues)].sort(),
    mappingStatus: status ?? (issues.some((i) => REVIEW_ISSUES.has(i)) ? 'requires_review' : 'ready'),
  };
}

/** Issues that send a record to human review instead of automatic load. */
// appointment_chart_missing: the doctor has no chart for that patient (D14, clinic decision pending).
export const REVIEW_ISSUES = new Set(['history_date_out_of_order', 'name_invalid', 'appointment_overlap', 'appointment_chart_missing']);

// ---------------------------------------------------------------------------
// Shared reference data

export const DDD = new Set(
  [
    [11, 19], [21, 22], [24, 24], [27, 28], [31, 35], [37, 38], [41, 49], [51, 51], [53, 55], [61, 69], [71, 71],
    [73, 75], [77, 77], [79, 79], [81, 89], [91, 99],
  ].flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)),
);

const CEP_UF = [
  ['SP', 1000, 19999], ['RJ', 20000, 28999], ['ES', 29000, 29999], ['MG', 30000, 39999], ['BA', 40000, 48999],
  ['SE', 49000, 49999], ['PE', 50000, 56999], ['AL', 57000, 57999], ['PB', 58000, 58999], ['RN', 59000, 59999],
  ['CE', 60000, 63999], ['PI', 64000, 64999], ['MA', 65000, 65999], ['PA', 66000, 68899], ['AP', 68900, 68999],
  ['AM', 69000, 69299], ['RR', 69300, 69399], ['AM', 69400, 69899], ['AC', 69900, 69999], ['DF', 70000, 72799],
  ['GO', 72800, 72999], ['DF', 73000, 73699], ['GO', 73700, 76799], ['RO', 76800, 76999], ['TO', 77000, 77999],
  ['MT', 78000, 78899], ['MS', 79000, 79999], ['PR', 80000, 87999], ['SC', 88000, 89999], ['RS', 90000, 99999],
];
const UF_NAMES = {
  AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara', DF: 'distrito federal', ES: 'espirito santo',
  GO: 'goias', MA: 'maranhao', MT: 'mato grosso', MS: 'mato grosso do sul', MG: 'minas gerais', PA: 'para', PB: 'paraiba',
  PR: 'parana', PE: 'pernambuco', PI: 'piaui', RJ: 'rio de janeiro', RN: 'rio grande do norte', RS: 'rio grande do sul',
  RO: 'rondonia', RR: 'roraima', SC: 'santa catarina', SP: 'sao paulo', SE: 'sergipe', TO: 'tocantins',
};
const CURITIBA = /^(curitiba|ctba|cwb|curitba|curitiaba|curitibs)$/;
const AREA_41_CITIES = /^(curitiba|ctba|cwb|curitba|sao jose dos pinhais|colombo|pinhais|araucaria|almirante tamandare|campo largo|fazenda rio grande|piraquara|campina grande do sul|quatro barras)$/;

export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const text = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const digitsOf = (v) => text(v).replace(/\D/g, '');

export function ufOfCep(cep) {
  const d = digitsOf(cep);
  if (d.length !== 8) return null;
  const n = Number(d.slice(0, 5));
  return CEP_UF.find(([, a, b]) => n >= a && n <= b)?.[0] ?? null;
}

/** Curitiba and its metropolitan region use DDD 41 (CEP 80000-83999). */
export function livesInArea41({ cep, city }) {
  const d = digitsOf(cep);
  if (d.length === 8) {
    const n = Number(d.slice(0, 5));
    if (n >= 80000 && n <= 83999) return true;
  }
  return AREA_41_CITIES.test(fold(city));
}

// ---------------------------------------------------------------------------
// CPF

export function cpfValid(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len) => {
    let s = 0;
    for (let i = 0; i < len; i += 1) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

const PHONE_SHAPE = /\(\s*\d{2}\s*\)|\d{4,5}\s*-\s*\d{4}\s*$/;
const looksLikeMobile = (d) => d.length === 11 && DDD.has(Number(d.slice(0, 2))) && d[2] === '9';

/**
 * Find the patient's CPF. Legacy fields in priority order: FAX (where the
 * clinic typed it), RG, e-mail, phone. Only checksum-valid numbers count.
 */
export function findCpf({ fax, rg, email, phone }) {
  const issues = [];
  for (const [source, raw] of [['fax', fax], ['rg', rg], ['email', email], ['phone', phone]]) {
    const s = text(raw);
    if (!s || /[A-Za-zÀ-ÿ@]/.test(s)) continue;
    const d = s.replace(/\D/g, '');
    if (d.length !== 11) continue;
    if (!cpfValid(d)) {
      if (source === 'fax' && !PHONE_SHAPE.test(s) && !looksLikeMobile(d)) issues.push('cpf_checksum_invalid');
      continue;
    }
    if (looksLikeMobile(d) && PHONE_SHAPE.test(s)) continue; // a phone that happens to pass the checksum
    if (looksLikeMobile(d) && !/[.]/.test(s) && !/^\d{3}\s\d{3}\s\d{3}\s\d{2}$/.test(s)) {
      if (source === 'phone') continue;
      issues.push('cpf_ambiguous_mobile');
    }
    return { value: d, source, issues };
  }
  return { value: null, source: null, issues: issues.length ? issues : ['cpf_missing'] };
}

// ---------------------------------------------------------------------------
// Phones

/** Phone-like substrings of a free-form field ("3333-4444 / (41) 99999-8888"). */
export function extractPhones(raw) {
  return [...text(raw).matchAll(/(?:\(?\s*0?\d{2}\s*\)?\s*)?\d{4,5}[-.\s]?\d{4}(?!\d)/g)].map((m) => m[0].trim());
}

/**
 * Normalize to Cortex's `normalize_reception_phone` format: "55" + DDD + number.
 * The DDD is added only when it is known (`ddd`) or the patient lives in the
 * 41 area; otherwise the normalized value is null and the raw value stays.
 */
export function normalizePhone(fragment, { ddd = null, area41 = false } = {}) {
  const raw = text(fragment);
  let d = raw.replace(/\D/g, '');
  const issues = [];
  if (!d) return null;
  if (d.length >= 11 && d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) {
    if (!DDD.has(Number(d.slice(0, 2)))) return { raw, normalized: null, issues: ['phone_invalid'] };
    if (d.length === 10 && /[6-9]/.test(d[2])) {
      d = `${d.slice(0, 2)}9${d.slice(2)}`;
      issues.push('phone_ninth_digit_added');
    }
    return { raw, normalized: `55${d}`, issues };
  }
  if (d.length === 8 && /^[6-9]/.test(d)) {
    d = `9${d}`;
    issues.push('phone_ninth_digit_added');
  } else if (!(d.length === 8 && /^[2-5]/.test(d)) && !(d.length === 9 && d[0] === '9')) {
    return { raw, normalized: null, issues: ['phone_invalid'] };
  }
  const known = ddd != null && DDD.has(Number(ddd)) ? String(Number(ddd)) : null;
  if (known) return { raw, normalized: `55${known}${d}`, issues };
  if (area41) return { raw, normalized: `5541${d}`, issues: [...issues, 'phone_ddd_assumed_41'] };
  return { raw, normalized: null, issues: [...issues, 'phone_no_ddd_outside_41'] };
}

/** All phones of a registration, deduplicated by normalized value (or raw). */
export function registrationPhones({ phone, cellular, dddCellular, fax }, address = {}) {
  const area41 = livesInArea41(address);
  const out = [];
  const seen = new Set();
  const add = (p, kind) => {
    if (!p) return;
    const key = p.normalized ?? `raw:${p.raw.replace(/\D/g, '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...p, kind });
  };
  for (const f of extractPhones(phone)) add(normalizePhone(f, { area41 }), 'principal');
  if (text(cellular)) add(normalizePhone(text(cellular), { ddd: digitsOf(dddCellular) || null, area41 }), 'celular');
  // FAX usually holds the CPF (sometimes mistyped); only phone-shaped values are phones.
  const faxDigits = digitsOf(fax);
  const faxIsPhone = [8, 9, 10].includes(faxDigits.length) || (faxDigits.length === 11 && looksLikeMobile(faxDigits) && !cpfValid(faxDigits));
  if (faxIsPhone) for (const f of extractPhones(fax)) add(normalizePhone(f, { area41 }), 'fax');
  return out;
}

// ---------------------------------------------------------------------------
// E-mail (the legacy field mostly holds the health-plan accommodation)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  const s = text(raw);
  if (!s) return { email: null, accommodation: null, issues: [] };
  if (s.includes('@')) return EMAIL_RE.test(s) ? { email: s.toLowerCase(), accommodation: null, issues: [] } : { email: null, accommodation: null, issues: ['email_invalid'] };
  const f = fold(s);
  const category = /\bapt|\bapart|\bapto/.test(f) ? 'apartamento' : /\benf/.test(f) ? 'enfermaria' : /\bamb/.test(f) ? 'ambulatorial' : 'outro';
  return { email: null, accommodation: { category, original: s.slice(0, 60) }, issues: ['email_field_reused'] };
}

// ---------------------------------------------------------------------------
// Address

export function normalizeCep(raw) {
  const d = digitsOf(raw);
  if (!d) return { cep: null, uf: null, issues: ['cep_missing'] };
  if (d.length === 5) return { cep: null, uf: null, issues: ['cep_old_5_digits'] };
  if (d.length !== 8) return { cep: null, uf: null, issues: ['cep_invalid'] };
  const uf = ufOfCep(d);
  if (!uf) return { cep: null, uf: null, issues: ['cep_out_of_range'] };
  return { cep: d, uf, issues: d.endsWith('000') ? ['cep_generic'] : [] };
}

export function normalizeUf(state, { cepUf = null, city = '' } = {}) {
  const f = fold(state);
  let uf = null;
  if (f) uf = UF_NAMES[f.toUpperCase()] ? f.toUpperCase() : (Object.entries(UF_NAMES).find(([, n]) => n === f)?.[0] ?? null);
  if (f && !uf) return { uf: cepUf, issues: cepUf ? ['uf_invalid', 'uf_inferred_from_cep'] : ['uf_invalid'] };
  if (uf) return { uf, issues: cepUf && cepUf !== uf ? ['cep_uf_mismatch'] : [] };
  if (cepUf) return { uf: cepUf, issues: ['uf_inferred_from_cep'] };
  if (CURITIBA.test(fold(city))) return { uf: 'PR', issues: ['uf_inferred_from_city'] };
  return { uf: null, issues: ['uf_missing'] };
}

export function normalizeCity(raw) {
  const s = text(raw).replace(/\s+/g, ' ');
  if (!s) return { city: null, issues: ['city_missing'] };
  if (CURITIBA.test(fold(s))) return { city: 'Curitiba', issues: fold(s) === 'curitiba' ? [] : ['city_spelling_normalized'] };
  return { city: s, issues: [] };
}

/** Street with a house number (or "s/n"). */
export const hasHouseNumber = (street) => /\d/.test(text(street)) || /\bs\s*\/?\s*n\b/i.test(text(street));

// ---------------------------------------------------------------------------
// Person fields

export function mapSex(raw) {
  const s = text(raw).toUpperCase();
  if (s === 'F') return { sex: 'feminino', issues: [] };
  if (s === 'M') return { sex: 'masculino', issues: [] };
  // Empty is "not collected", never "nao_informado" (which means the patient declined).
  return { sex: null, issues: [s ? 'sex_unknown_value' : 'sex_missing'] };
}

export function cleanName(raw) {
  const name = text(raw).replace(/\s+/g, ' ');
  const letters = name.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (name.length < 2 || name.length > 200 || letters.length < 2 || /^(.)\1{2,}$/i.test(letters)) return { name: null, issues: ['name_invalid'] };
  return { name, issues: /\d/.test(name) ? ['name_has_annotation'] : [] };
}

/** Readers give ISO dates; the Delphi zero date and impossible dates become null. */
export function legacyDate(iso, { min = '1900-01-01', max = '2100-12-31' } = {}) {
  if (!iso) return { date: null, issues: [] };
  if (iso <= '1899-12-31') return { date: null, issues: ['date_sentinel'] };
  if (iso < min || iso > max) return { date: null, issues: ['date_out_of_range'] };
  return { date: iso, issues: [] };
}

// ---------------------------------------------------------------------------
// Running history (Co12_1): split by the dates typed at the start of a line

const STAMP = /^[ \t]*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?!\d)/gm;

function stampDate(dd, mm, yy, exportDate) {
  let y = Number(yy);
  if (yy.length === 2) y += y <= Number(exportDate.slice(2, 4)) ? 2000 : 1900;
  const m = Number(mm);
  const d = Number(dd);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDate() !== d) return null;
  const s = dt.toISOString().slice(0, 10);
  return s >= '1985-01-01' && s <= exportDate ? s : null;
}

/**
 * Returns dated entries. Text before the first date goes at the start of the
 * first entry (never dropped). With fewer than two valid dates the whole text
 * is one undated entry. Entries of the same day are kept in order.
 */
export function splitHistory(fullText, { exportDate }) {
  const t = String(fullText ?? '').replace(/\r\n?/g, '\n');
  if (!t.trim()) return { entries: [], issues: [] };
  const stamps = [...t.matchAll(STAMP)].map((m) => ({ at: m.index, date: stampDate(m[1], m[2], m[3], exportDate) }));
  const valid = stamps.filter((s) => s.date);
  const issues = stamps.length > valid.length ? ['history_invalid_date_stamp'] : [];
  if (valid.length < 2) return { entries: [{ date: null, text: t.trim() }], issues: [...issues, 'history_no_dates'] };
  // An entry is out of order when its date is earlier than one already seen:
  // only that entry needs review, not the whole document.
  let latest = '';
  const entries = valid.map((s, i) => {
    const outOfOrder = s.date < latest;
    if (s.date > latest) latest = s.date;
    return { date: s.date, text: t.slice(i === 0 ? 0 : s.at, valid[i + 1]?.at ?? t.length).trim(), outOfOrder };
  });
  if (entries.some((e) => e.outOfOrder)) issues.push('history_dates_out_of_order');
  return { entries, issues: [...new Set(issues)] };
}

/** Merge entries that fall on the same day: one consultation section per day. */
export function historyByDay(entries) {
  const days = new Map();
  for (const e of entries) {
    const k = e.date ?? 'undated';
    const prev = days.get(k);
    days.set(k, { text: prev ? `${prev.text}\n\n${e.text}` : e.text, outOfOrder: Boolean(prev?.outOfOrder || e.outOfOrder) });
  }
  return [...days.entries()].map(([date, d]) => ({ date: date === 'undated' ? null : date, text: d.text, outOfOrder: d.outOfOrder }));
}

// ---------------------------------------------------------------------------
// Document templates (Us05, Gintxt, Pedtxt)

/** Fields PersonalMed fills at print time and Cortex must support (S3). */
export const SUPPORTED_MERGE_FIELDS = new Set(['@nome', '@data', '@extenso', '@endereco', '@bairro', '@cidade', '@cep', '@telefone', '@idade', '@dtnascimento', '@sexo', '@convenio', '@hora']);
const MERGE_FIELD = /(?<![A-Za-z0-9._%+-])@[a-z_]+/gi;

export function mergeFieldsOf(templateText) {
  const found = [...new Set((String(templateText ?? '').match(MERGE_FIELD) ?? []).map((m) => m.toLowerCase()))].sort();
  return { fields: found, unsupported: found.filter((f) => !SUPPORTED_MERGE_FIELDS.has(f)) };
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "@extenso": date in words, as printed by PersonalMed ("3 de novembro de 2026"). */
export function dateInWords(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

const ITEM = /^\s*[-•*]\s*(.+?)\s*(?:(?:_{2,}|\.{3,}|\t)+\s*(.*?))?\s*$/;
// Route headings such as "Uso int", "USO EXTERNO", "Uso Cont", "Via oral": short lines only.
const ROUTE = /^(uso|via)\s+[a-zà-ÿ.]+(\s+[a-zà-ÿ.]+)?$/i;

/**
 * Prescription template -> structured items. "- NAME ____ quantity" lines are
 * items; the lines after an item, up to the next one, are its instructions.
 * A route heading applies to the items after it. Lines before the first item
 * (patient header) and the closing date line are kept apart. Templates with
 * no item stay as free text.
 */
export function parseTemplateItems(templateText) {
  const lines = String(templateText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const header = [];
  const items = [];
  const footer = [];
  let route = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(ITEM);
    if (m) {
      items.push({ name: m[1].trim(), quantity: (m[2] ?? '').trim(), route, instructions: [] });
      continue;
    }
    if (ROUTE.test(line) && line.length <= 25) {
      route = line;
      continue;
    }
    const isDateLine = /@(extenso|data)\b/i.test(line) && line.replace(MERGE_FIELD, '').replace(/[\s,]/g, '').length <= 20;
    if (isDateLine && items.length) footer.push(line);
    else if (!items.length) header.push(line);
    else items.at(-1).instructions.push(line);
  }
  if (!items.length) return { kind: 'free_text', text: String(templateText ?? '').trim(), items: [] };
  return { kind: 'items', header, items: items.map((i) => ({ ...i, instructions: i.instructions.join('\n') })), footer };
}

// ---------------------------------------------------------------------------
// "Atenção" alerts (Clini_01.Attention)

const ALERT_PATTERNS = {
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
const CLINICAL_ALERT = ['alergia', 'medicamento_citado', 'gestacao', 'doenca_cronica', 'obito'];
const ADMIN_ALERT = ['financeiro', 'comportamento', 'administrativo', 'convenio'];

/** What an "Atenção" text talks about. Keyword hints for the reviewer, not a diagnosis. */
export function alertCategories(alertText) {
  const t = fold(alertText);
  const categories = Object.entries(ALERT_PATTERNS)
    .filter(([, re]) => re.test(t))
    .map(([k]) => k);
  return {
    categories,
    clinical: categories.some((c) => CLINICAL_ALERT.includes(c)),
    administrative: categories.some((c) => ADMIN_ALERT.includes(c)),
  };
}

/** Template kind by PersonalMed ModelType: 1 prescription, 3 exam request, others text. */
export function templateKind(modelType) {
  return modelType === 1 ? 'receita' : modelType === 3 ? 'pedido_exame' : 'texto';
}

/**
 * Fixed text of a template, line by line between merge fields, folded. A
 * document "uses" the template when every chunk appears in it, so one edited
 * dose does not hide the whole template. Too little fixed text (< 40
 * characters) cannot be recognised and returns [].
 */
export function templateChunks(templateText) {
  const chunks = String(templateText ?? '')
    .split(MERGE_FIELD)
    .flatMap((s) => s.split(/\n+/))
    .map(fold)
    .filter((s) => s.length >= 8);
  return chunks.join('').length >= 40 ? chunks : [];
}

/**
 * Who used each template since a date, from issued documents.
 * @param templates [{ key, chunks }]
 * @param issued    [{ user, date: 'YYYY-MM-DD', text }] (text is folded inside)
 * @returns Map key -> { uses, byDoctor: { 'user:N': count }, lastUsed }
 * Counts only: no document text leaves this function.
 */
export function templateUsage(templates, issued, { since }) {
  const usage = new Map();
  const candidates = templates.filter((t) => t.chunks.length);
  for (const doc of issued) {
    if (!doc.date || doc.date < since) continue;
    const textFolded = fold(doc.text);
    for (const t of candidates) {
      if (!t.chunks.every((ch) => textFolded.includes(ch))) continue;
      const u = usage.get(t.key) ?? { uses: 0, byDoctor: {}, lastUsed: null };
      u.uses += 1;
      const doctor = `user:${doc.user}`;
      u.byDoctor[doctor] = (u.byDoctor[doctor] ?? 0) + 1;
      if (!u.lastUsed || doc.date > u.lastUsed) u.lastUsed = doc.date;
      usage.set(t.key, u);
    }
  }
  return usage;
}

// ---------------------------------------------------------------------------
// Agenda

const formatters = new Map();
function tzOffsetMinutes(ts, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
  const parts = Object.fromEntries(
    formatters
      .get(timeZone)
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
  return Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ts) / 60000);
}

/**
 * Legacy times are São Paulo wall-clock times. Brazil had daylight saving
 * until 2019, so the UTC offset depends on the date (IANA tz database).
 */
export function wallClockToUtc(dateIso, minutes, timeZone = 'America/Sao_Paulo') {
  const [y, m, d] = dateIso.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let ts = wall + 3 * 3600e3;
  for (let i = 0; i < 3; i += 1) {
    const next = wall - tzOffsetMinutes(ts, timeZone) * 60e3;
    if (next === ts) break;
    ts = next;
  }
  return new Date(ts).toISOString();
}

/**
 * Legacy status -> Cortex status. Returns null for rows not imported by
 * default (past rows without status, decision D3).
 */
export function mapAppointmentStatus(estado, date, { exportDate }) {
  const s = text(estado) || '-';
  const future = date > exportDate;
  if (s === 'T') return { status: 'realizado', note: null, issues: [] };
  if (s === 'C') return { status: 'cancelado', note: null, issues: [] };
  if (s === 'F') return { status: 'faltou', note: null, issues: ['status_no_show_target_required'] };
  // D9, confirmed on the 24/08/2026 export (scripts/personalmed/agenda-states.mjs):
  // E = care started and never closed (100% arrival and start of care);
  // A = arrived, care never marked (100% arrival, 0.1% start of care);
  // "-" in the past = nothing recorded (0% arrival, like F); in the future = booked.
  if (s === 'E') return future ? { status: 'agendado', note: 'PersonalMed: E', issues: [] } : { status: 'realizado', note: 'PersonalMed: E (em atendimento, não finalizado)', issues: [] };
  if (s === 'A') return future ? { status: 'agendado', note: 'PersonalMed: A', issues: [] } : { status: 'realizado', note: 'PersonalMed: A (chegada registrada, atendimento não marcado)', issues: ['status_arrival_only'] };
  if (s === '-')
    return future
      ? { status: 'agendado', note: null, issues: [] }
      : { status: 'faltou', note: 'PersonalMed: sem registro de comparecimento', issues: ['status_no_attendance_recorded', 'status_no_show_target_required'] };
  return { status: null, note: `PersonalMed: ${s}`, issues: ['status_unknown_code'] };
}

/**
 * Cortex refuses overlapping, non-cancelled appointments of the same doctor.
 * Returns the ids that overlap an earlier one; they go to the rejection list
 * with their original times (never shifted).
 */
export function findOverlaps(appointments) {
  const byDoctor = new Map();
  for (const a of appointments) {
    if (a.status === 'cancelado' || a.status == null) continue;
    if (!byDoctor.has(a.doctor)) byDoctor.set(a.doctor, []);
    byDoctor.get(a.doctor).push(a);
  }
  const overlapping = new Set();
  for (const list of byDoctor.values()) {
    list.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    let maxEnd = '';
    for (const a of list) {
      if (maxEnd && a.start < maxEnd) overlapping.add(a.id);
      if (a.end > maxEnd) maxEnd = a.end;
    }
  }
  return overlapping;
}
