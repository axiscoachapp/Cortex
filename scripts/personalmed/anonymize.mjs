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
        // The stamp under a prescription: initials and the surname ("R.C.Sobrenome CRM 12345").
        if (tokens.length > 1) t = replaceFolded(t, word(`(?:[a-z]\\.\\s*){1,4}${escape(tokens.at(-1))}`), doctor.label, counter, 'doctor');
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
    // A mobile typed without any separator ("991839523"), a number with spaces around the dash
    // ("3242 - 4749", never two years), and a professional licence ("CRM 12345", "CRM-PR 12.345").
    t = replaceFolded(t, /(?<![\d/.,-])9[6-9]\d{7}(?![\d/.,-]\d)(?!\d)/g, '[telefone]', counter, 'phone_shape');
    t = replaceFolded(t, /(?<![\d/.-])(\d{4}) ?- ?(\d{4})(?![\d-])/g, (m) => (/^(19|20)\d\d$/.test(m[1]) && /^(19|20)\d\d$/.test(m[2]) ? m[0] : '[telefone]'), counter, 'phone_shape');
    t = replaceFolded(t, /(?<![a-z])(crm|coren|crefito|crp|cro|crn)\s*[-/:]?\s*(?:[a-z]{2}\s*[-/:]?\s*)?\d[\d.]{2,7}(?!\d)/g, (m) => `${m[1].toUpperCase()} [documento]`, counter, 'licence_shape');
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
    // 8. Where the person works or studies, when it is named ("trabalha na Empresa Tal",
    //    "faz administração na FAE"): the kind of work stays, the name of the place goes.
    t = scrubWorkplace(t, counter);
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
  // Words the registration holds as if they were names (typed in the name field, or kinship used as a name).
  'marido', 'esposo', 'esposa', 'irma', 'irmao', 'filho', 'filha', 'plano', 'acomodacao', 'essa', 'esse', 'particular', 'cortesia', 'retorno', 'teste',
  // Health plans and places that are also given names.
  'america', 'bradesco', 'cassi', 'copel', 'sanepar', 'italia', 'franca', 'india', 'china', 'israel', 'florida', 'vitoria',
]);

// Surnames of the registration that, in lower case, are almost always an ordinary word of the
// note ("julia leite materno", "com a bruna pontos ok"). They end a lower-case name; in capitals
// after a first name they are still taken for a surname.
const COMMON_SURNAME_WORDS = new Set([
  'leite', 'pinto', 'costa', 'lima', 'rocha', 'campos', 'campo', 'salgado', 'coelho', 'cordeiro', 'carneiro', 'lobo', 'pena', 'rios', 'serra', 'pedra', 'barros', 'matos',
  'ferro', 'prata', 'guerra', 'sol', 'lua', 'mar', 'monte', 'vale', 'prado', 'fontes', 'lago', 'porto', 'ponte', 'torres', 'castelo', 'vila', 'casa', 'casas', 'jardim',
  'leal', 'bravo', 'negro', 'preto', 'pardo', 'ruivo', 'louro', 'moreno', 'calvo', 'magro', 'velho', 'novo', 'neto', 'sobrinho', 'primo', 'junior', 'segundo', 'maior',
  'menor', 'grande', 'pequeno', 'doce', 'amaro', 'dias', 'nascimento', 'guia', 'sala', 'canal', 'quadro', 'parada', 'paredes', 'pontos', 'tome', 'sera', 'partir', 'dedo',
  'cima', 'verde', 'vermelho', 'seguro', 'pessoa', 'pais', 'maes', 'mora', 'marcar', 'deixou', 'coleto', 'nora', 'endo', 'gest', 'mass', 'doca', 'forte', 'fortes',
  'portugal', 'franca', 'parana', 'unimed', 'amil', 'medica', 'medico',
]);

/** After an exam, the name of who did it: "eco tv arildo", "mamog joana". */
const EXAM_CUE = new Set(['eco', 'tv', 'usg', 'ultrassom', 'mamog', 'mamografia', 'laudo', 'rx', 'rm', 'tc']);
/** What follows "dr"/"dra" in a note without being a name: the specialty, a verb, a connective. */
const TITLE_FOLLOWERS = new Set([
  'cardio', 'cardiologista', 'gastro', 'gastroenterologista', 'endocrino', 'endocrinologista', 'endocrinologia', 'neuro', 'neurologista', 'orto', 'ortopedista', 'uro', 'urologista',
  'gineco', 'ginecologista', 'derma', 'dermatologista', 'psiq', 'psiquiatra', 'oftalmo', 'oftalmologista', 'otorrino', 'otorrinolaringologista', 'reumato', 'reumatologista',
  'pneumo', 'pneumologista', 'nefro', 'nefrologista', 'hemato', 'hematologista', 'onco', 'oncologista', 'masto', 'mastologista', 'procto', 'proctologista', 'angio', 'angiologista',
  'vascular', 'geriatra', 'pediatra', 'clinico', 'clinica', 'cirurgiao', 'cirurgia', 'anestesista', 'radiologista', 'plastico', 'plastica', 'obstetra', 'infectologista', 'nutrologo',
  'pediu', 'solicitou', 'disse', 'orientou', 'falou', 'acha', 'quer', 'indicou', 'prescreveu', 'recomendou', 'mandou', 'encaminhou', 'operou', 'avaliou', 'liberou', 'suspendeu',
  'para', 'pela', 'pelo', 'como', 'quando', 'onde', 'tambem', 'ainda', 'esta', 'este', 'essa', 'esse', 'dele', 'dela', 'nosso', 'nossa', 'outro', 'outra', 'mesmo', 'mesma',
  'particular', 'convenio', 'plantao', 'plantonista', 'assistente', 'responsavel', 'cirurgico', 'hoje', 'ontem', 'amanha', 'semana', 'retorno', 'consulta', 'exame', 'exames',
]);

/** Words after which a first name, even typed in lower case, is a person ("eco com giovana", "enc para dulce"). */
const PERSON_CUE = new Set(['com', 'para', 'pra', 'pelo', 'pela', 'falar', 'falei', 'ligar', 'ligou', 'avisar', 'avisei']);

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
  // Old notes are often typed all in lower case: "dr eduardo paiva", "eco com giovana",
  // "ok. marcia". Without the capital letter, a word is a person only when it is a first
  // name of the registration AND something around it says so.
  const lowerPerson = (tk) => !capital(tk) && isFirst(tk) && tk.folded.length >= 4;
  const lowerSurname = (tk) => isNameLike(tk) && !COMMON_SURNAME_WORDS.has(tk.folded);
  const between = (a, b) => text.slice(a.end, b.at);
  const afterCue = (i) => i > 0 && PERSON_CUE.has(tokens[i - 1].folded) && /^\s+(?:[oa]s?\s+)?$/.test(between(tokens[i - 1], tokens[i]));
  // The last word of a line, after punctuation: who wrote or took the note ("exames ok. marcia").
  const signs = (tk) => /[.,;:!?–-]\s*$/.test(text.slice(Math.max(0, tk.at - 4), tk.at)) && /^\s*[.!]?\s*(?:\n|$)/.test(text.slice(tk.end, tk.end + 8));
  // Two first names side by side with a slash, a comma or "e" ("era milton / willian").
  const listedWith = (a, b) => a && b && lowerPerson(a) && lowerPerson(b) && /^\s*(?:\/|,|\be\b)\s*$/.test(between(a, b));
  // After a title the next word is a person far more often than not, whatever a catalogue of
  // medicines says of it ("DR. ANTÔNIO"): only an ordinary word we know stops it.
  const plainWord = (tk) => NAME_STOP.has(tk.folded) || COMMON_SURNAME_WORDS.has(tk.folded) || tk.folded.length < 4;
  // Not a name: a listed follower, a specialty by its ending ("dentista", "pediatra", "psicólogo")
  // or a verb by its ending ("explicou", "pediu", "operando").
  const unknownAfterTitle = (tk) => !plainWord(tk) && !clinical.has(tk.folded) && !TITLE_FOLLOWERS.has(tk.folded) && !/(?:ista|iatra|logo|loga|logia|peuta|ou|iu|aram|eram|ando|endo|indo)$/.test(tk.folded);
  // "mulher do rached", "paciente da bruna", "indicada pelo antunes".
  const afterWhose = (tk) => /(?:mulher|esposa|marido|filh[oa]|mae|pai|irmao?|irma|amig[oa]|secretaria|pacientes?|pcte|indicad[oa]|indicacao)\s+(?:d[oa]s?|pel[oa])\s+$/.test(folded.slice(Math.max(0, tk.at - 32), tk.at));
  // "o marcelo prescreve", "a bruna ligou": the article before a first name of the registration.
  const afterArticle = (tk) => tk.folded.length >= 5 && /(?:^|[\s(,;:])[oa]\s+$/.test(folded.slice(Math.max(0, tk.at - 4), tk.at));
  const kinAfter = /^(?:esposo|esposa|marido|filho|filha|mae|pai|irma|irmao|sogra|sogro)$/;
  const spans = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i];
    const afterKinship = i > 0 && kinship.test(tokens[i - 1].folded) && adjacent(tokens[i - 1], tk);
    const afterTitle = i > 0 && title.test(tokens[i - 1].folded) && adjacent(tokens[i - 1], tk);
    const next1 = tokens[i + 1];
    const beforeKin = next1 && adjacent(tk, next1) && kinAfter.test(next1.folded);
    const lowerStart = !capital(tk) && (
      // "dr regis", "dra raquel", "dr paiva", and a name the registration never saw ("dr lucar").
      (afterTitle && ((isNameLike(tk) && tk.folded.length >= 4) || unknownAfterTitle(tk)))
      || (lowerPerson(tk) && (afterKinship || afterCue(i) || signs(tk) || listedWith(tokens[i - 1], tk) || listedWith(tk, next1) || afterArticle(tk)
        || (i > 0 && EXAM_CUE.has(tokens[i - 1].folded) && adjacent(tokens[i - 1], tk))
        // "eduardo paiva", "luiz marcelo": a first name followed by another name of the registration.
        || (next1 && adjacent(tk, next1) && lowerSurname(next1) && next1.folded.length >= 4)))
      // A surname alone, said to be someone's: "mulher do rached", "bittencourt esposo".
      || (lowerSurname(tk) && tk.folded.length >= 5 && (afterWhose(tk) || beforeKin))
    );
    // "repetiu eco com a Cris": after "com a", "para o", a capitalised word that is nothing we know.
    // The article is required: "Retorno com Exames" is a title, not a person.
    const namedAfterCue = capital(tk) && mixedCase(tk) && afterCue(i) && /\s[oa]\s+$/.test(text.slice(Math.max(0, tk.at - 4), tk.at)) && !plainWord(tk) && !clinical.has(tk.folded);
    // After "Dr.", "Dra.", "Enfermeira": a capitalised word is a person even when the registration never saw that name.
    const startsName = (capital(tk) && (isFirst(tk) || (afterTitle && !plainWord(tk)) || (afterTitle && !ordinary(tk)))) || lowerStart || namedAfterCue;
    if (!startsName) continue;
    let j = i;
    // What follows a name: more names of the registration (connectors allowed, "Maria de Souza"),
    // a capitalised surname the registration does not know ("Joana Dalagnol"), and, after a
    // title, surnames in capitals too ("DRA. JOANA BECKHAUSER DE CAMPOS").
    for (;;) {
      let next = j + 1;
      if (tokens[next] && CONNECTORS.has(tokens[next].folded) && adjacent(tokens[j], tokens[next])) next += 1;
      const candidate = tokens[next];
      if (!candidate || next - i > 5 || !adjacent(tokens[next - 1], candidate)) break;
      if (!capital(candidate)) {
        // In lower case only names the registration knows, and never a word that is usually not a name.
        if (!lowerSurname(candidate) || candidate.folded.length < 4) break;
        j = next;
        continue;
      }
      const surnameShape = !ordinary(candidate) && ((mixedCase(candidate) && mixedCase(tk)) || (afterTitle && allCaps(candidate)));
      // A name that is also an ordinary word ("CESAR", "ROSA", "CRUZ") is part of the run when
      // another name follows it: "Sr João CESAR CORREA".
      let after = tokens[next + 1];
      if (after && CONNECTORS.has(after.folded) && adjacent(candidate, after)) after = tokens[next + 2];
      // Never a title or a kinship word: "DRA. JOANA LEMOS DRA. MARTA" is two people.
      const namedBetween = NAME_STOP.has(candidate.folded) && candidate.folded.length >= 4 && !title.test(candidate.folded) && !kinship.test(candidate.folded)
        && !clinical.has(candidate.folded) && (dictionary.first.has(candidate.folded) || dictionary.surname.has(candidate.folded))
        && after && /^[\s.]{1,3}(?:(?:de|da|do|dos|das|e)[\s.]{1,3})?$/i.test(text.slice(candidate.end, after.at)) && capital(after) && isNameLike(after);
      if (!isNameLike(candidate) && !surnameShape && !namedBetween) break;
      j = next;
    }
    if (j > i || afterKinship || afterTitle || aloneIsPerson(tk) || lowerStart || namedAfterCue) {
      spans.push([tk.at, tokens[j].end]);
      i = j;
    }
  }
  let out = '';
  let last = 0;
  for (const [a, b] of spans) {
    out += `${text.slice(last, a)}[nome]`;
    last = b;
    counter.third_party = (counter.third_party ?? 0) + 1;
  }
  out += text.slice(last);
  // A list of contacts: whoever is written in capitals right before a telephone is a person,
  // known to the registration or not ("FULANA DE TAL : [telefone]").
  return out.replace(/(?<![A-Za-zÀ-ÿ\]])(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+ +(?:(?:de|da|do|dos|das|e) +)?){1,4}[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?= *:? *\[telefone\])/g, () => {
    counter.third_party = (counter.third_party ?? 0) + 1;
    return '[nome]';
  });
}

/** The name of an employer or a school after "trabalha na", "estuda no", "faz … na": capitalised words only. */
function scrubWorkplace(text, counter = {}) {
  const cue = /(?<![a-z])((?:trabalh[a-z]+|estud[a-z]+|estagi[a-z]+|funcionari[ao]|leciona|formad[ao]|formou-se|faz\s+[a-z]+(?:\s+[a-z]+)?)\s+(?:n[ao]s?|d[ao]s?|em|pel[ao])\s+)(?=(\S+(?:\s+\S+){0,2}))/g;
  const folded = foldSameLength(text);
  let out = '';
  let last = 0;
  for (const m of folded.matchAll(cue)) {
    const at = m.index + m[1].length;
    // Capitalised words in a row, as typed: "Bleymed", "FAE", "Colégio Tal". A lower-case word ends the name.
    const named = /^(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9&'-]*)(?:\s+(?:(?:de|da|do|dos|das|e)\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9&'-]*){0,2}/.exec(text.slice(at, at + m[2].length));
    if (!named || at < last) continue;
    out += `${text.slice(last, at)}[local]`;
    last = at + named[0].length;
    counter.workplace = (counter.workplace ?? 0) + 1;
  }
  return out + text.slice(last);
}

/**
 * Only the rules about OTHER people (no patient identifiers needed): for text that was written
 * from already anonymised notes, such as an AI summary, when the rules have since improved.
 */
export function scrubOtherPeople(text, { dictionary, clinicalTokens = new Set() }, counter = {}) {
  if (typeof text !== 'string' || !text) return text;
  return scrubWorkplace(scrubThirdParties(text, dictionary, clinicalTokens, counter), counter);
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
