// De-identification of a small sample of legacy charts, done on the operator's
// computer BEFORE anything is sent to an AI provider or loaded into a hosted
// project. The person becomes a label ("Paciente 3"); direct identifiers are
// removed from the structured fields and scrubbed from the free text.
//
// What this does NOT promise: free clinical text can still describe a person
// in ways no pattern catches (a rare event, a workplace, a relative's story).
// The output is pseudonymised health data and must be handled as such.
//
// Pure functions; the tests use invented people only.

/** Lower-case and strip accents, one output character per input character (offsets stay valid). */
export function foldSameLength(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += base.length === ch.length ? base : ch.length === 1 ? (base[0] ?? ' ') : ' '.repeat(ch.length);
  }
  return out;
}

const CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'di', 'del', 'van', 'von']);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const nameTokens = (name) => foldSameLength(name).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
const significant = (tokens) => tokens.filter((t) => !CONNECTORS.has(t));

/** Replace every match of a regex built for the FOLDED text, in the original text. */
function replaceFolded(text, regex, replacement, counter, kind) {
  const folded = foldSameLength(text);
  let out = '';
  let last = 0;
  for (const m of folded.matchAll(regex)) {
    out += text.slice(last, m.index) + (typeof replacement === 'function' ? replacement(m, text.slice(m.index, m.index + m[0].length)) : replacement);
    last = m.index + m[0].length;
    counter[kind] = (counter[kind] ?? 0) + 1;
  }
  return out + text.slice(last);
}

const SEP = '[\\s.,;:/\\\\-]*';
/** A name as typed in running text: the tokens in order, connectors optional, any spacing. */
function sequencePattern(tokens) {
  return tokens.map((t, i) => (i === 0 ? escape(t) : `(?:${SEP}(?:de|da|do|dos|das|e)\\b)?${SEP}${escape(t)}`)).join('');
}
/** Contiguous runs of at least `min` significant tokens, longest first. */
function runs(tokens, min) {
  const out = [];
  for (let size = tokens.length; size >= min; size -= 1) for (let i = 0; i + size <= tokens.length; i += 1) out.push(tokens.slice(i, i + size));
  return out;
}
const word = (pattern) => new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, 'g');
/** Digits of an identifier as they may be typed: with dots, dashes, spaces or parentheses between them. */
const digitsPattern = (digits) => digits.split('').join('[\\s.\\-/()]*');

const KINSHIP = '(?:marido|esposo|esposa|companheiro|companheira|namorado|namorada|noivo|noiva|filho|filha|filhos|filhas|mae|pai|irma|irmao|sogra|sogro|tia|tio|avo|neto|neta|sobrinha|sobrinho|cunhada|cunhado|sr|sra|srta|dr|dra|prof|profa|doutor|doutora|enf|enfa)';

/**
 * @param {{
 *   label: string,
 *   name: string,
 *   relatives?: string[],            // mother, father, health-plan card holder
 *   digits?: string[],               // CPF, RG, card numbers (any punctuation)
 *   phones?: string[],
 *   emails?: string[],
 *   streets?: string[],
 *   birthDate?: string | null,       // ISO
 *   doctors?: { label: string, names: string[] }[],
 *   protectedTokens?: string[],      // folded tokens never scrubbed alone (they belong to clinic doctors too)
 *   dictionary?: { first: Set<string>, surname: Set<string> }, // folded names of the whole registration
 *   clinicalTokens?: Set<string>,    // folded words that are medicines or clinical terms, never a person
 * }} person
 */
export function createScrubber(person) {
  const own = significant(nameTokens(person.name));
  const guard = new Set((person.protectedTokens ?? []).map((t) => foldSameLength(t)));
  const relativeRuns = (person.relatives ?? []).map((n) => significant(nameTokens(n))).filter((t) => t.length >= 2);
  const idDigits = [...new Set((person.digits ?? []).map((d) => String(d ?? '').replace(/\D/g, '')).filter((d) => d.length >= 5))];
  const phoneTails = [...new Set((person.phones ?? []).map((p) => String(p ?? '').replace(/\D/g, '')).filter((d) => d.length >= 8).map((d) => d.slice(-8)))];
  const emails = [...new Set((person.emails ?? []).map((e) => foldSameLength(e).trim()).filter((e) => e.includes('@')))];
  const streets = [...new Set((person.streets ?? []).map((s) => foldSameLength(s).replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 6))];
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(person.birthDate ?? '') ? person.birthDate : null;
  const dictionary = person.dictionary ?? { first: new Set(), surname: new Set() };
  const clinical = person.clinicalTokens ?? new Set();

  function scrub(input, counter = {}) {
    if (typeof input !== 'string' || !input) return input;
    let t = input;
    // 1. The person: full name and any run of two or more of its tokens.
    for (const run of runs(own, 2)) t = replaceFolded(t, word(sequencePattern(run)), person.label, counter, 'name');
    // 2. Relatives and card holders by full or partial name (two tokens or more).
    for (const tokens of relativeRuns) for (const run of runs(tokens, 2)) t = replaceFolded(t, word(sequencePattern(run)), '[familiar]', counter, 'relative');
    // 3. Clinic doctors become their label; a title before the name goes with it.
    for (const doctor of person.doctors ?? []) {
      for (const name of doctor.names) {
        const tokens = significant(nameTokens(name));
        for (const run of runs(tokens, 2)) t = replaceFolded(t, word(`(?:(?:dr|dra|doutor|doutora)\\.?\\s+)?${sequencePattern(run)}`), doctor.label, counter, 'doctor');
        if (tokens[0]) t = replaceFolded(t, word(`(?:dr|dra|doutor|doutora)\\.?\\s+${escape(tokens[0])}`), doctor.label, counter, 'doctor');
      }
    }
    // 4. Single tokens of the person's own name: the first name, and surnames that
    //    no clinic doctor shares (a shared surname alone must not turn a doctor into the patient).
    own.forEach((token, i) => {
      if (token.length < (i === 0 ? 3 : 5) || guard.has(token)) return;
      t = replaceFolded(t, word(escape(token)), person.label, counter, 'name_token');
    });
    // 5. Identifiers typed as digits, e-mails, street, birth date.
    for (const d of idDigits) t = replaceFolded(t, new RegExp(`(?<!\\d)${digitsPattern(d)}(?!\\d)`, 'g'), '[documento]', counter, 'document');
    for (const tail of phoneTails) t = replaceFolded(t, new RegExp(`(?<!\\d)(?:\\(?\\d{2}\\)?[\\s.-]*)?9?[\\s.-]*${digitsPattern(tail)}(?!\\d)`, 'g'), '[telefone]', counter, 'phone');
    for (const e of emails) t = replaceFolded(t, new RegExp(escape(e), 'g'), '[e-mail]', counter, 'email');
    for (const s of streets) t = replaceFolded(t, new RegExp(escape(s).replace(/ /g, '\\s+'), 'g'), '[endereço]', counter, 'address');
    if (birth) {
      const [y, m, d] = birth.split('-');
      const dd = `0?${Number(d)}`;
      const mm = `0?${Number(m)}`;
      t = replaceFolded(t, new RegExp(`(?<!\\d)${dd}[/.-]${mm}[/.-](?:${y}|${y.slice(2)})(?!\\d)`, 'g'), '[data de nascimento]', counter, 'birth_date');
    }
    // 6. Shapes of identifiers that belong to anyone.
    t = replaceFolded(t, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, '[e-mail]', counter, 'email');
    t = replaceFolded(t, /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-\d{2}(?!\d)/g, '[CPF]', counter, 'cpf_shape');
    t = replaceFolded(t, /(?<!\d)\d{5}-\d{3}(?!\d)/g, '[CEP]', counter, 'cep_shape');
    t = replaceFolded(t, /(?<![\d/])(?:\(\d{2}\)\s*|\b\d{2}\s+)9?\d{4}[-.\s]?\d{4}(?!\d)/g, '[telefone]', counter, 'phone_shape');
    t = replaceFolded(t, /(?<![\d/.-])9\d{4}-\d{4}(?!\d)/g, '[telefone]', counter, 'phone_shape');
    t = replaceFolded(t, /(?<![\d/.-])(\d{4})-(\d{4})(?![\d-])/g, (m) => (/^(19|20)\d\d$/.test(m[1]) && /^(19|20)\d\d$/.test(m[2]) ? m[0] : '[telefone]'), counter, 'phone_shape');
    // A second number written after a slash: "[telefone]/3018-0000".
    t = replaceFolded(t, /(?<=\[telefone\]\s?\/\s?)9?\d{4}-?\d{4}(?!\d)/g, '[telefone]', counter, 'phone_shape');
    // A street with its number, whoever lives there ("Rua Tal, 270 casa 10").
    t = replaceFolded(t, /(?<![a-z])(?:rua|r\.|av\.|avenida|alameda|al\.|travessa|trav\.|tv\.|rodovia|rod\.|estrada|praca)\s+[^\n;:]{2,60}?\d{1,5}(?:\s*,?\s*(?:casa|ap\.?|apto\.?|apartamento|bloco|bl\.?|sala|cj\.?|conj\.?|sobrado|fundos)\s*[a-z0-9]{0,6})*/g,
      // In running prose ("dor na rua ao caminhar 2 quadras") the word is lower case and no name follows it.
      (m, original) => (/^[A-ZÀ-Ý]/.test(original) || /^\S+\s+[A-ZÀ-Ý]/.test(original) ? '[endereço]' : original), counter, 'address_shape');
    // What follows an address on its line is the rest of it (complement, district, city).
    // Bounded, so that a long single-line note does not disappear after an address.
    t = t.replace(/\[endereço\][^\n]{0,80}/g, '[endereço]');
    // 7. Other people named in the text. After a kinship word or a title, a first
    //    name of the registration is a person; elsewhere, two or more names in a row.
    t = scrubThirdParties(t, dictionary, clinical, counter);
    return t;
  }
  return { scrub, tokens: own, leaks: (text) => leaks(text, { own, guard, idDigits, phoneTails, emails, relativeRuns }) };
}

// Words that are also given names but, in a chart, are almost always something else:
// anatomy and exam eponyms, months, adjectives, common nouns.
const NAME_STOP = new Set([
  'paciente', 'medico', 'medica', 'familiar', 'nome', 'dr', 'dra', 'sr', 'sra', 'uso', 'via', 'oral', 'alta',
  'rosa', 'vitoria', 'gloria', 'aurora', 'iris', 'dores', 'graca', 'cruz', 'luz', 'paz', 'socorro', 'conceicao', 'assuncao', 'jesus', 'reis', 'neves', 'pilar',
  'bom', 'boa', 'santa', 'santo', 'sao', 'flora', 'candida', 'candido', 'benigna', 'benigno', 'clara', 'claro', 'branca', 'branco', 'bela', 'belo', 'linda', 'lindo',
  'perola', 'violeta', 'margarida', 'jasmim', 'dalia', 'estela', 'leia', 'sara', 'cora', 'mira', 'vida', 'alma', 'alba', 'pura', 'puro', 'amada', 'amado', 'preciosa',
  'severo', 'severa', 'franco', 'franca', 'justo', 'justa', 'gentil', 'valente', 'modesto', 'sereno', 'placido', 'constante', 'prudente', 'clemente', 'feliz', 'cesar',
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'domingo',
  'natal', 'neonatal', 'parto', 'mama', 'colo', 'alto', 'baixa', 'baixo', 'normal', 'regular',
  'douglas', 'leopold', 'bishop', 'tanner', 'kegel', 'hegar', 'cooper', 'gram', 'burch', 'kelly', 'marshall', 'bartholin', 'naboth', 'schiller', 'doppler', 'apgar',
]);

function scrubThirdParties(text, dictionary, clinical, counter) {
  if (!dictionary.first.size) return text;
  const folded = foldSameLength(text);
  const tokenRe = /[a-z][a-z']+/g;
  const tokens = [...folded.matchAll(tokenRe)].map((m) => ({ at: m.index, end: m.index + m[0].length, folded: m[0], raw: text.slice(m.index, m.index + m[0].length) }));
  const capital = (tk) => /^[A-ZÀ-Ý]/.test(tk.raw);
  const isFirst = (tk) => dictionary.first.has(tk.folded) && !NAME_STOP.has(tk.folded) && !clinical.has(tk.folded) && tk.folded.length >= 3;
  const isNameLike = (tk) => (dictionary.first.has(tk.folded) || dictionary.surname.has(tk.folded)) && !NAME_STOP.has(tk.folded) && !clinical.has(tk.folded) && tk.folded.length >= 3;
  // A given name standing alone ("ISIS 3085g", "Joana veio junto"): four letters or
  // more, so that "ANA" (the antibody), "EVA" or "IDA" are left to the rules above.
  const aloneIsPerson = (tk) => isFirst(tk) && tk.folded.length >= 4;
  const adjacent = (a, b) => /^[\s.]{1,3}$/.test(text.slice(a.end, b.at));
  const kinship = new RegExp(`^${KINSHIP}$`);
  const title = /^(dr|dra|doutor|doutora|enf|enfa|enfermeiro|enfermeira|prof|profa|fisioterapeuta|psicologo|psicologa|nutricionista)$/;
  const mixedCase = (tk) => /^[A-ZÀ-Ý][a-zà-ÿ']+$/.test(tk.raw);
  const allCaps = (tk) => tk.raw.length > 1 && tk.raw === tk.raw.toUpperCase();
  const ordinary = (tk) => NAME_STOP.has(tk.folded) || clinical.has(tk.folded) || tk.folded.length < 3;
  const spans = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i];
    const afterKinship = i > 0 && kinship.test(tokens[i - 1].folded) && adjacent(tokens[i - 1], tk);
    const afterTitle = i > 0 && title.test(tokens[i - 1].folded) && adjacent(tokens[i - 1], tk);
    // After "Dr.", "Dra.", "Enfermeira": a capitalised word is a person even when the registration never saw that name.
    const startsName = capital(tk) && (isFirst(tk) || (afterTitle && !ordinary(tk)));
    if (!startsName) continue;
    let j = i;
    // What follows a name: more names of the registration (connectors allowed, "Maria de Souza"),
    // a capitalised surname the registration does not know ("Joana Dalagnol"), and, after a
    // title, surnames in capitals too ("DRA. JOANA BECKHAUSER DE CAMPOS").
    for (;;) {
      let next = j + 1;
      if (tokens[next] && CONNECTORS.has(tokens[next].folded) && adjacent(tokens[j], tokens[next])) next += 1;
      const candidate = tokens[next];
      if (!candidate || next - i > 5 || !adjacent(tokens[next - 1], candidate) || !capital(candidate)) break;
      const surnameShape = !ordinary(candidate) && ((mixedCase(candidate) && mixedCase(tk)) || (afterTitle && allCaps(candidate)));
      if (!isNameLike(candidate) && !surnameShape) break;
      j = next;
    }
    if (j > i || afterKinship || afterTitle || aloneIsPerson(tk)) {
      spans.push([tk.at, tokens[j].end]);
      i = j;
    }
  }
  if (!spans.length) return text;
  let out = '';
  let last = 0;
  for (const [a, b] of spans) {
    out += `${text.slice(last, a)}[nome]`;
    last = b;
    counter.third_party = (counter.third_party ?? 0) + 1;
  }
  return out + text.slice(last);
}

/** What is still in a text after scrubbing: counts per kind, never the value. */
function leaks(text, { own, guard, idDigits, phoneTails, emails, relativeRuns }) {
  const folded = foldSameLength(String(text ?? ''));
  const count = (re) => [...folded.matchAll(re)].length;
  const out = {};
  const add = (kind, n) => { if (n) out[kind] = (out[kind] ?? 0) + n; };
  if (own.length >= 2) add('full_name', count(word(sequencePattern(own))));
  for (const run of runs(own, 2)) add('name_run', count(word(sequencePattern(run))));
  own.forEach((token, i) => { if (token.length >= (i === 0 ? 3 : 5) && !guard.has(token)) add('name_token', count(word(escape(token)))); });
  for (const tokens of relativeRuns) add('relative', count(word(sequencePattern(tokens))));
  for (const d of idDigits) add('document', count(new RegExp(`(?<!\\d)${digitsPattern(d)}(?!\\d)`, 'g')));
  // The last eight digits, whatever comes before them (area code, the ninth digit).
  for (const tail of phoneTails) add('phone', count(new RegExp(`${digitsPattern(tail)}(?!\\d)`, 'g')));
  for (const e of emails) add('email', count(new RegExp(escape(e), 'g')));
  return out;
}

/** First names and surnames of a registration, folded, for the third-party heuristic. */
export function buildNameDictionary(names, { minFirst = 3, minSurname = 3 } = {}) {
  const first = new Map();
  const surname = new Map();
  for (const name of names) {
    const tokens = significant(nameTokens(name));
    if (!tokens.length) continue;
    first.set(tokens[0], (first.get(tokens[0]) ?? 0) + 1);
    for (const t of tokens.slice(1)) surname.set(t, (surname.get(t) ?? 0) + 1);
  }
  const keep = (map, min) => new Set([...map].filter(([t, n]) => n >= min && t.length >= 3 && /^[a-z]+$/.test(t)).map(([t]) => t));
  return { first: keep(first, minFirst), surname: keep(surname, minSurname) };
}

/** Month precision for a birth date: the age stays right, the day does not identify. */
export const coarseBirthDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? `${iso.slice(0, 7)}-01` : null);
