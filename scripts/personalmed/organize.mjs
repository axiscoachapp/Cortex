// AI organisation of an imported chart: prompts, output schemas, the checks
// that every statement of the model is tied to the imported text, and the
// rendering into the fields Cortex shows. Pure functions; the network call
// lives in sample-organize.mjs.
//
// Principle: the converted legacy text stays in the chart, complete and
// unchanged. What the model writes is a layer on top of it, kept only when it
// can be traced back to that text.

import { foldSameLength } from './anonymize.mjs';

export const ORGANIZE_VERSION = 'pm-organize-v2';

// ---------------------------------------------------------------------------
// 1. Each day of care -> an organised note

export const DAY_SYSTEM = `Você organiza registros antigos de prontuário, importados do sistema PersonalMed de um consultório de ginecologia e obstetrícia (que também tem um urologista), para o prontuário novo. Cada registro é o que o médico escreveu ou emitiu num dia de atendimento, muitas vezes com abreviações.

Para cada dia recebido devolva uma nota organizada:
- "titulo": até 80 caracteres dizendo o que foi o atendimento. Exemplos de formato: "Pré-natal de 37 semanas; internação para cesárea", "Rotina ginecológica; coleta de citologia", "Receita de anticoncepcional". Nunca o nome da paciente.
- "s": queixas, história e o que a paciente relatou.
- "o": exame físico, sinais vitais, medidas e resultados de exames registrados naquele dia.
- "a": diagnósticos e impressões que o médico escreveu, com o CID quando houver.
- "p": condutas: prescrições (nome, dose e modo de uso), exames pedidos, encaminhamentos, atestados, internações, orientações, retorno.

Regras:
1. Use somente o que está escrito no registro daquele dia. Não deduza diagnóstico, não complete dose, não calcule datas, não traga informação de outro dia nem conhecimento de fora.
2. Copie números, doses, datas, nomes de medicamentos e resultados exatamente como estão. Não converta unidades e não corrija valores.
3. Pode escrever por extenso as abreviações de uso corrente (PA, FC, DUM, DPP, IG, USG, BCF, AU, CO como citologia oncótica, MMG como mamografia). Abreviação que não seja de uso corrente fica como está, entre aspas, sem interpretação. Palavra com erro de digitação cujo sentido não seja evidente também fica como está, entre aspas: não troque por outra palavra.
3a. Registro telegráfico (uma linha de números e siglas, como "22,3 PESO 58,5"): mantenha os termos na ordem em que estão, no campo "o", entre aspas quando não souber o que são. Nunca coloque número solto em "a".
4. Campo sem informação no registro: devolva "" (vazio). Não escreva "não informado" nem "sem alterações".
5. Documentos emitidos (receita, atestado, carta, pedido de exame) entram em "p" de forma resumida: o que foi emitido e o essencial (cada medicamento com dose e modo de uso; exames pedidos; motivo e datas de atestado ou internação). Listas longas de orientações de rotina podem virar uma linha ("orientações pré-operatórias entregues por escrito").
6. Português claro, frases curtas, sem markdown e sem repetir o nome do campo.
7. "Paciente 1", "Médica A", "[nome]", "[telefone]", "[familiar]" e semelhantes são marcas de anonimização: mantenha exatamente como estão.
8. Devolva um item para cada dia recebido, com o mesmo "id".`;

export const DAY_SCHEMA = {
  type: 'object',
  required: ['dias'],
  properties: {
    dias: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'titulo', 's', 'o', 'a', 'p'],
        properties: { id: { type: 'string' }, titulo: { type: 'string' }, s: { type: 'string' }, o: { type: 'string' }, a: { type: 'string' }, p: { type: 'string' } },
      },
    },
  },
};

/** The stamp line and the markdown headings of the converter are structure, not clinical text. */
export const originalBody = (soapNote) => String(soapNote ?? '').replace(/^\[Importado do PersonalMed em [^\]]+\]\s*/, '').trim();

/** Days in batches that fit one answer: by characters of source text. */
export function dayBatches(days, { maxChars = 9000, maxDays = 14 } = {}) {
  const out = [];
  let current = [];
  let size = 0;
  for (const d of days) {
    if (current.length && (size + d.text.length > maxChars || current.length >= maxDays)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(d);
    size += d.text.length;
  }
  if (current.length) out.push(current);
  return out;
}

export function dayPrompt(patient, batch) {
  const who = [patient.sex === 'feminino' ? 'sexo feminino' : patient.sex === 'masculino' ? 'sexo masculino' : null, patient.birthYear ? `nascida(o) em ${patient.birthYear}` : null].filter(Boolean).join(', ');
  return `${patient.label}${who ? ` (${who})` : ''}. Registros a organizar, um por dia:\n\n${batch.map((d) => `=== id ${d.id} | dia ${d.date} | ${d.doctor} ===\n${d.text}`).join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// 2. The whole chart -> the profile

const origin = { type: 'array', items: { type: 'object', required: ['data', 'trecho'], properties: { data: { type: 'string' }, trecho: { type: 'string' } } } };
const item = (extra) => ({ type: 'object', required: [...Object.keys(extra), 'origem'], properties: { ...extra, origem: origin } });
const s = { type: 'string' };

/** The profile call has its own version: changing it re-asks the profiles and leaves the days' cache alone. */
export const PROFILE_VERSION = 'pm-profile-v3';

const oneOf = (...values) => ({ type: 'string', enum: values });
const list = (extra) => ({ type: 'array', items: item(extra) });

export const PROBLEM_KINDS = ['condicao', 'achado', 'queixa'];
export const EXAM_KINDS = ['citologia', 'mamografia', 'usg_mamas', 'usg_transvaginal', 'densitometria', 'colonoscopia', 'psa', 'laboratorio', 'outro_imagem', 'outro'];
export const OUTCOMES = ['parto vaginal', 'cesarea', 'parto sem tipo registrado', 'aborto', 'ectopica', 'em curso', 'sem registro do desfecho'];

export const PROFILE_SCHEMA = {
  type: 'object',
  required: ['resumo', 'problemas', 'contracepcao', 'medicacoes_em_uso', 'medicacoes_anteriores', 'alergias', 'alergias_negadas', 'gestacoes', 'marcos_ginecologicos', 'cirurgias', 'antecedentes_familiares', 'habitos_sociais', 'exames', 'pendencias'],
  properties: {
    resumo: s,
    problemas: list({ nome: s, cid: s, tipo: oneOf(...PROBLEM_KINDS), situacao: oneOf('ativo', 'resolvido', 'historico') }),
    contracepcao: list({ metodo: s, hormonal: { type: 'boolean' }, situacao: oneOf('em uso', 'encerrado', 'sem informacao'), inicio: s }),
    medicacoes_em_uso: list({ nome: s, dose: s, uso: s, duracao: oneOf('continuo', 'prazo definido') }),
    medicacoes_anteriores: list({ nome: s, dose: s, periodo: s }),
    alergias: list({ substancia: s, reacao: s, tipo: oneOf('alergia', 'intolerancia') }),
    alergias_negadas: { type: 'boolean' },
    gestacoes: list({ ordem: s, desfecho: oneOf(...OUTCOMES), data: s, detalhes: s }),
    marcos_ginecologicos: list({ marco: oneOf('menarca', 'menopausa', 'outro'), texto: s }),
    cirurgias: list({ nome: s, data: s }),
    antecedentes_familiares: list({ parente: s, condicao: s }),
    habitos_sociais: list({ texto: s }),
    exames: list({ tipo: oneOf(...EXAM_KINDS), exame: s, data: s, resultado: s }),
    pendencias: list({ texto: s }),
  },
};

/**
 * A long chart does not fit one answer inside the adapter's time limit: the same
 * question is then asked in two parts, the long tails (every exam, past
 * medicines) apart from the rest. Each part is the same schema with fewer fields.
 */
export const PROFILE_PARTS = [
  ['resumo', 'problemas', 'contracepcao', 'medicacoes_em_uso', 'alergias', 'alergias_negadas', 'gestacoes', 'marcos_ginecologicos', 'cirurgias', 'antecedentes_familiares', 'habitos_sociais', 'pendencias'],
  ['medicacoes_anteriores', 'exames'],
];
export const profilePartSchema = (keys) => ({ type: 'object', required: keys, properties: Object.fromEntries(keys.map((k) => [k, PROFILE_SCHEMA.properties[k]])) });
export const profilePartSystem = (lastRecord, keys) => `${profileSystem(lastRecord)}\n\nNesta chamada, devolva somente estes campos: ${keys.map((k) => `"${k}"`).join(', ')}.`;

/**
 * @param lastRecord the day of the patient's own last record: "active" and "in use" are judged
 *   against it, not against the day the data was exported (a patient last seen years ago still
 *   has the problems of her last follow-up, shown with their dates).
 */
export const profileSystem = (lastRecord) => `Você recebe todo o histórico antigo de uma paciente, importado do sistema PersonalMed de um consultório de ginecologia e obstetrícia (com um urologista), em ordem cronológica e com o médico de cada registro. Monte o perfil clínico dela para o prontuário novo. O último registro desta paciente é de ${lastRecord}: essa é a data de referência.

Tudo o que você afirmar precisa estar escrito no histórico, e cada item precisa citar a origem.

Campos:
- "resumo": até 900 caracteres, em ordem cronológica, com o que importa para quem vai atender a paciente hoje: por que ela é acompanhada, os eventos relevantes e a situação mais recente. Sem adjetivos, sem recomendações, sem o nome dela.
- "problemas": a lista de problemas que um médico manteria no prontuário: doenças, síndromes e condições. Um item por problema, com o nome curto e usual, sem lateralidade nem medidas (elas mudam a cada exame e ficam em "exames").
  NÃO é problema e não entra aqui: método contraceptivo, DIU, implante ou outro dispositivo (vai em "contracepcao"); gestação, parto ou puerpério sem doença (vai em "gestacoes"); cirurgia ou procedimento (vai em "cirurgias"); tratamento, reposição ou uso de remédio ("reposição de ferro" não é problema; o problema é "anemia", se estiver escrito); exame normal; orientação; alergia com substância identificada (vai em "alergias").
  "tipo": "condicao" para doença ou condição diagnosticada (inclusive climatério, TPM e infecção de repetição); "achado" para achado de exame de imagem ou de laboratório acompanhado sem diagnóstico de doença (cisto simples, hemangioma, nódulo benigno, vitamina baixa); "queixa" para sintoma sem diagnóstico firmado.
  "cid": só se o código estiver escrito (senão "").
  "situacao": "ativo" só para doença crônica ou condição que os registros dos 24 meses anteriores à data de referência mostram presente, em acompanhamento ou em tratamento. "resolvido" quando o histórico diz que resolveu, quando um exame posterior veio normal, ou quando é um evento agudo já tratado, mesmo recente (infecção, fissura, gastrite tratada, alergia de pele passageira, cisto que sumiu, lesão retirada). "historico" quando foi registrado antes e não dá para saber a situação atual. Queixa ou achado citado em um único registro, sem acompanhamento depois, é "historico".
- "contracepcao": métodos contraceptivos e dispositivos registrados (DIU de cobre, DIU hormonal, implante, pílula, injetável, anel, adesivo, laqueadura, vasectomia do parceiro, preservativo), um item por método ou por troca, do mais antigo ao mais recente. "metodo": o nome como escrito (ex.: "DIU Mirena"). "hormonal": true para método com hormônio. "situacao": "em uso" quando o registro mais recente sobre o assunto mostra o método presente (ex.: "DIU tópico" no último exame); "encerrado" quando foi retirado, trocado ou suspenso; "sem informacao" quando não dá para saber. "inicio": data de inserção, troca ou início como escrita, ou "".
- "medicacoes_em_uso": só o que os registros dos 12 meses anteriores à data de referência mostram como uso contínuo ou tratamento em curso. "dose": só a dose escrita (ex.: "100 mg"), sem comentário; "uso": o modo de uso como escrito. "duracao": "continuo" para uso contínuo ou sem prazo escrito; "prazo definido" quando a prescrição tem duração escrita (dias, semanas, meses). Tratamento com prazo prescrito mais de 3 meses antes da data de referência não entra. Método contraceptivo não entra aqui.
- "medicacoes_anteriores": outras medicações relevantes prescritas antes; "periodo" como "2019 a 2021" ou "".
- "alergias": só alergia ou intolerância escrita no histórico e com a substância ou o produto identificado ("substancia" é o nome dele; "reacao" é a reação escrita, ou ""; "tipo": "alergia" ou "intolerancia"). Alergia sem causa identificada não entra aqui: vai em "problemas". Efeito colateral comum de um remédio (enjoo, diarreia, obstipação, sonolência) só entra se o registro disser alergia, intolerância, "não tolera" ou que o remédio foi suspenso por causa dele; remédio que continua prescrito nos registros seguintes não entra. Se o histórico registra que ela nega alergias e não há alergia escrita, devolva lista vazia e "alergias_negadas": true. Sem registro nenhum: lista vazia e false.
- "gestacoes": um item por gestação, em ordem. "ordem": "1", "2"… "desfecho": "parto vaginal", "cesarea", "parto sem tipo registrado", "aborto", "ectopica", "em curso" (em andamento no último registro) ou "sem registro do desfecho". "data": a data do parto ou do desfecho como escrita, ou "". "detalhes": até 120 caracteres com o que vale como antecedente (intercorrência, idade gestacional do parto, peso do recém-nascido), sem DUM nem DPP; "" se não houver.
- "marcos_ginecologicos": menarca e menopausa, com a idade ou o ano como escritos, e outro marco escrito que não caiba nos demais campos. "marco": "menarca", "menopausa" ou "outro".
- "cirurgias": cirurgias e procedimentos invasivos (inclusive laqueadura), sem repetir as cesáreas, que já estão em "gestacoes". "data": como escrita, ou "".
- "antecedentes_familiares": doença em parente registrada como antecedente (câncer, trombose, diabetes, doença cardiovascular e outras). "parente" e "condicao" como escritos. Acontecimento com familiar que não seja antecedente de doença não entra.
- "habitos_sociais": tabagismo, álcool, atividade física, trabalho e contexto social escritos; um fato por item.
- "exames": rastreamentos e exames com resultado registrado, um item por exame e data. "tipo": "citologia" (preventivo, citopatológico, colpocitologia), "mamografia", "usg_mamas", "usg_transvaginal" (inclui pélvica), "densitometria", "colonoscopia", "psa", "laboratorio", "outro_imagem" ou "outro"; laudo que junta dois exames vira dois itens. "data": a data do exame como escrita, ou "" quando só há a data do registro. "resultado": resumido, com os valores como escritos.
- "pendencias": o que os registros mais recentes deixam em aberto de forma explícita (exame pedido sem resultado registrado depois, retorno indicado, tratamento a reavaliar em data futura). Na dúvida, não inclua.

"origem" de cada item: um a três objetos {"data": dia do registro "AAAA-MM-DD" (ou "sem data" para páginas sem data), "trecho": cópia literal, caractere por caractere, de 15 a 120 caracteres do texto que sustenta o item}. Um trecho que não esteja no histórico invalida o item. Em "problemas", "contracepcao" e "medicacoes_em_uso", cite o PRIMEIRO registro que menciona o item e o MAIS RECENTE (um objeto só quando houver um único registro): as datas dessas origens são mostradas ao médico como "desde" e "último registro". Nas outras listas, uma origem por item basta.

Regras: não deduza nem complete; não use conhecimento de fora; copie números, doses e datas como estão; abreviação que não seja de uso corrente fica entre aspas; "Paciente 1", "Médica A", "[nome]" e semelhantes são marcas de anonimização e ficam como estão. Lista sem item: devolva [].`;

export function profilePrompt(patient, days, undated) {
  const who = [patient.sex === 'feminino' ? 'sexo feminino' : patient.sex === 'masculino' ? 'sexo masculino' : null, patient.birthYear ? `nascida(o) em ${patient.birthYear}` : null, patient.civilStatus ? `estado civil: ${patient.civilStatus}` : null, patient.bloodType ? `tipo sanguíneo no cadastro: ${patient.bloodType}` : null, patient.profession ? `profissão: ${patient.profession}` : null].filter(Boolean).join('; ');
  const pages = undated.map((u) => `=== sem data | ${u.doctor} | ${u.title} ===\n${u.text}`).join('\n\n');
  return `${patient.label}. Cadastro: ${who || 'sem dados'}.\n\n${pages ? `PÁGINAS SEM DATA\n\n${pages}\n\n` : ''}REGISTROS POR DIA\n\n${days.map((d) => `=== dia ${d.date} | ${d.doctor} ===\n${d.text}`).join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// 3. Checks: what the model wrote must be in the imported text

/** Letters and digits only, folded: quotes survive spacing, case, accent and punctuation differences. */
export const squash = (text) => foldSameLength(String(text ?? '')).replace(/[^a-z0-9]/g, '');

/** Numbers as typed (with decimal comma or point), for the "no new number" check. */
export const numbersOf = (text) => [...String(text ?? '').matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/^0+(?=\d)/, ''));

/**
 * An organised day against its source: every number of the note must exist in
 * the source, and the note must cover the source's own words.
 * @returns {{ ok: boolean, newNumbers: string[], coverage: number }}
 */
export function checkDay(note, sourceText) {
  const sourceNumbers = new Set(numbersOf(sourceText));
  const sourceDigits = squash(sourceText);
  const written = [note.titulo, note.s, note.o, note.a, note.p].join('\n');
  // A number rewritten with another separator ("37,1" as "37 semanas e 1 dia") is caught here:
  // it has to appear digit by digit in the source.
  const newNumbers = [...new Set(numbersOf(written).filter((n) => !sourceNumbers.has(n) && !sourceDigits.includes(n.replace(/[^0-9]/g, ''))))];
  const words = (t) => new Set(foldSameLength(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 5));
  const source = words(sourceText);
  const kept = words(written);
  const coverage = source.size ? [...source].filter((w) => kept.has(w)).length / source.size : 1;
  return { ok: newNumbers.length === 0, newNumbers, coverage };
}

/**
 * Keep only the profile items whose quotes exist in the chart.
 * sources: Map(date | 'sem data' -> squashed text); all: squashed text of everything.
 * A quote found under another date is accepted and its date corrected to the
 * record nearest to the date the model stated (a phrase such as "BI-RADS 2"
 * is in many records: the first match would date an item years off).
 */
export function verifyProfile(profile, sources, all) {
  const report = { kept: 0, dropped: 0, dateFixed: 0, byList: {} };
  const dayNumber = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? Date.parse(`${date}T00:00:00Z`) / 86_400_000 : null);
  const locate = (quote, stated) => {
    const q = squash(quote);
    if (q.length < 10) return null;
    const found = [...sources].filter(([, text]) => text.includes(q)).map(([date]) => date);
    if (!found.length) return all.includes(q) ? 'sem data' : null;
    const wanted = dayNumber(stated);
    const dated = found.filter((date) => dayNumber(date) !== null);
    if (wanted === null || !dated.length) return found[0];
    return dated.reduce((best, date) => (Math.abs(dayNumber(date) - wanted) < Math.abs(dayNumber(best) - wanted) ? date : best));
  };
  const out = { ...profile };
  for (const [key, value] of Object.entries(profile)) {
    if (!Array.isArray(value)) continue;
    const list = [];
    for (const entry of value) {
      const origem = [];
      for (const o of entry.origem ?? []) {
        const q = squash(o.trecho);
        const stated = sources.get(o.data);
        if (q.length >= 10 && stated?.includes(q)) origem.push(o);
        else {
          const found = locate(o.trecho, o.data);
          if (found) {
            origem.push({ ...o, data: found });
            report.dateFixed += 1;
          }
        }
      }
      if (origem.length) {
        list.push({ ...entry, origem });
        report.kept += 1;
      } else report.dropped += 1;
      report.byList[key] = { kept: list.length, dropped: (report.byList[key]?.dropped ?? 0) + (origem.length ? 0 : 1) };
    }
    out[key] = list;
  }
  return { profile: out, report };
}

// ---------------------------------------------------------------------------
// 4. Dates the doctor can trust
//
// "Since" and "last record" are not asked from the model as numbers: they are
// the days of the records it quoted, and a quote is only kept when it is in the
// record of that day. The model is told to quote the first and the latest
// record of each problem, medicine and method. (Searching the item's own name
// in every record was considered and left out: "nega hipertensão" at the first
// visit would date a later diagnosis from that day.)

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
/** A day ("2026-08-14") or a month ("2022-06") as the chart reads: "14/08/2026", "06/2022". */
const br = (iso) => (ISO_DAY.test(iso ?? '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ISO_MONTH.test(iso ?? '') ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const monthYear = (iso) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The day a quote belongs to. A dated record: its day. A page without date:
 * the date the line itself starts with, when it has one ("14/08/26 laser…",
 * "06/2022 = hemangiomas…"), as a day or as a month. Otherwise null.
 * The undated pages of the old system are running logs of dated lines; reading
 * that date is what keeps a current problem from looking undated.
 */
export function quoteDay(origin) {
  if (ISO_DAY.test(origin?.data ?? '')) return origin.data;
  const text = String(origin?.trecho ?? '');
  const full = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?!\d)/.exec(text);
  if (full) {
    const [day, month] = [Number(full[1]), Number(full[2])];
    const year = Number(full[3].length === 4 ? full[3] : `${Number(full[3]) <= 30 ? '20' : '19'}${full[3]}`);
    return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1950 && year <= 2035 ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
  }
  const monthOnly = /^\s*(\d{1,2})\/((?:19|20)\d{2})(?!\d)/.exec(text);
  return monthOnly && Number(monthOnly[1]) >= 1 && Number(monthOnly[1]) <= 12 ? `${monthOnly[2]}-${monthOnly[1].padStart(2, '0')}` : null;
}

/** First and last dated record among the quotes of an item (a day, or a month for a line dated by month). */
export function recordSpan(entry) {
  const dated = [...new Set((entry.origem ?? []).map(quoteDay).filter(Boolean))].sort();
  return dated.length ? { first: dated[0], last: dated.at(-1) } : null;
}

/** "desde 02/2010 · último registro em 14/08/2026", "registro de 26/04/2023", or where an undated item came from. */
export function spanNote(entry) {
  const span = recordSpan(entry);
  if (!span) return (entry.origem ?? []).length ? 'página sem data do prontuário antigo' : '';
  if (span.first === span.last) return `registro de ${br(span.last)}`;
  return `desde ${monthYear(span.first)} · último registro em ${br(span.last)}`;
}

/** "5/3/19" and "05/03/2019" -> "05/03/2019"; "3/2019" -> "03/2019"; anything else stays as written. */
export function tidyDate(text) {
  const t = oneLine(text).replace(/[.;,]+$/, '');
  const full = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (full) {
    const year = full[3].length === 4 ? full[3] : `${Number(full[3]) <= 30 ? '20' : '19'}${full[3]}`;
    return `${full[1].padStart(2, '0')}/${full[2].padStart(2, '0')}/${year}`;
  }
  const month = /^(\d{1,2})\/(\d{4})$/.exec(t);
  return month ? `${month[1].padStart(2, '0')}/${month[2]}` : t;
}

/** A sortable key ("2019-03-05", "2019-03", "2019") for a date as written, or null. */
export function dateKey(text) {
  const t = tidyDate(text);
  const full = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (full) return `${full[3]}-${full[2]}-${full[1]}`;
  const month = /^(\d{2})\/(\d{4})$/.exec(t);
  if (month) return `${month[2]}-${month[1]}`;
  return /\b((?:19|20)\d{2})\b/.exec(t)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// 5. Rendering into Cortex fields
//
// Where each piece goes follows how the app shows it:
// - "Diagnósticos" is the list of problems under follow-up, each with a note
//   that says since when and when it was last recorded; a contraceptive, a
//   treatment or a pregnancy is not a diagnosis;
// - "Medicações" is what is in use, with the last record of each;
// - "Histórico médico" is plain text in groups ("Cirurgias:" followed by dashed
//   lines), which the app shows as headed lists and the doctor edits as text;
// - the long lists (every exam, past medications) and the summary go into one
//   note of the history, "Resumo do histórico importado", which is also what
//   the assistant and the pre-consultation summary read first;
// - what the last records leave open becomes a pending item for the doctor.

/** The organised note followed by the complete original record of the day. */
export function renderDayNote({ stamp, note, original, checked }) {
  const sections = [['S (Subjetivo)', note.s], ['O (Objetivo)', note.o], ['A (Avaliação)', note.a], ['P (Plano)', note.p]].filter(([, v]) => v && v.trim());
  // Fewer than two sections is not a SOAP note for the app: the original alone is clearer.
  if (!checked || sections.length < 2) return `${stamp}\n\n${original}`;
  return `${stamp}\n[Organizado por IA a partir do registro original, que segue completo abaixo]\n\n${sections.map(([label, v]) => `**${label}:** ${v.trim()}`).join('\n\n')}\n\n### Registro original (PersonalMed)\n\n${original}`;
}

/**
 * Where an item comes from. `lineDates: false` for items that carry their own date (an exam, a
 * surgery, a delivery): there the date a line of an undated page starts with is often another
 * exam's ("05/2019 = NL 05/2020 = NL …") and would contradict the item.
 */
const cite = (entry, { lineDates = true } = {}) => {
  const origins = entry.origem ?? [];
  const dated = [...new Set(origins.map((o) => o.data).filter((d) => ISO_DAY.test(d ?? '')))].sort().map(br);
  // A page without date, and the date its own line starts with when it has one.
  const loose = origins.filter((o) => !ISO_DAY.test(o.data ?? ''));
  const written = lineDates ? [...new Set(loose.map(quoteDay).filter(Boolean))].sort().map(br) : [];
  const parts = [
    dated.length ? `${dated.length > 1 ? 'registros' : 'registro'} de ${dated.join(', ')}` : null,
    loose.length ? `página sem data${written.length ? `, ${written.length > 1 ? 'anotações' : 'anotação'} de ${written.join(', ')}` : ''}` : null,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join('; ')})` : '';
};

const CESAREAN = /ces[aá]r[ei]a/i;

/**
 * Entries the chart cannot use, and entries the model put in the wrong list:
 * - an allergy with no named substance says nothing a doctor can act on;
 * - a caesarean listed again as a surgery when the pregnancies already say it;
 * - a "problem" that is a contraceptive, a device or a treatment.
 */
export function cleanProfile(profile) {
  const unnamed = /^(n[aã]o\s+(identificad|informad|especificad)|desconhecid|sem\s+causa|indefinid)/i;
  const notAProblem = /^(uso\s+de\s+|usu[aá]ria\s+de\s+|em\s+uso\s+de\s+|reposi[cç][aã]o\s+|suplementa[cç][aã]o\s+|diu\b|implante\b|anticoncep|contracep|laqueadura|vacina)/i;
  const hasCesarean = (profile.gestacoes ?? []).some((g) => g.desfecho === 'cesarea');
  return {
    ...profile,
    alergias: (profile.alergias ?? []).filter((a) => a.substancia?.trim() && !unnamed.test(a.substancia.trim())).map((a) => ({ ...a, reacao: unnamed.test((a.reacao ?? '').trim()) || /^intoler[aâ]ncia.?$/i.test((a.reacao ?? '').trim()) ? '' : a.reacao })),
    problemas: (profile.problemas ?? []).filter((p) => p.nome?.trim() && !notAProblem.test(p.nome.trim())),
    contracepcao: (profile.contracepcao ?? []).filter((c) => c.metodo?.trim()),
    cirurgias: (profile.cirurgias ?? []).filter((c) => c.nome?.trim() && !(hasCesarean && /^ces[aá]r[ei]as?\.?$/i.test(c.nome.trim()))),
  };
}

const KIND_ORDER = { condicao: 0, achado: 1, queixa: 2 };
const KIND_NOTE = { achado: 'achado de exame', queixa: 'queixa' };
const OUTCOME_LABEL = { 'parto vaginal': 'parto vaginal', cesarea: 'cesárea', 'parto sem tipo registrado': 'parto (tipo não registrado)', aborto: 'aborto', ectopica: 'gestação ectópica', 'em curso': 'em curso no último registro', 'sem registro do desfecho': 'desfecho não registrado' };
const EXAM_LABEL = { citologia: 'Citologia (preventivo)', mamografia: 'Mamografia', usg_mamas: 'Ultrassonografia de mamas', usg_transvaginal: 'Ultrassonografia transvaginal ou pélvica', densitometria: 'Densitometria óssea', colonoscopia: 'Colonoscopia', psa: 'PSA', laboratorio: 'Laboratório', outro_imagem: 'Outros exames de imagem', outro: 'Outros exames' };
/** The screening exams whose latest result belongs in the profile itself. */
const SCREENING = ['citologia', 'mamografia', 'usg_mamas', 'usg_transvaginal', 'densitometria', 'colonoscopia', 'psa'];
/** Months after which a patient's last medicines are no longer presumed in use. */
export const MEDICATION_STALE_MONTHS = 18;

/** Whole months from one day or month to another; 0 when either is unknown. */
const monthsBetween = (from, to) => (/^\d{4}-\d{2}/.test(from ?? '') && /^\d{4}-\d{2}/.test(to ?? '') ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) : 0);
const years = (entry) => {
  const span = recordSpan(entry);
  if (!span) return 'sem data';
  return span.first.slice(0, 4) === span.last.slice(0, 4) ? span.first.slice(0, 4) : `${span.first.slice(0, 4)} a ${span.last.slice(0, 4)}`;
};
const lastDay = (entry) => recordSpan(entry)?.last ?? '';
/** "MIRENA" and "cerazette" as a name reads: "Mirena", "Cerazette". Anything in mixed case, or in several capital words ("DIU T CU"), stays as written. */
export const tidyName = (text) => {
  const t = oneLine(text);
  if (/^[a-zà-ú]/.test(t) && t === t.toLowerCase()) return t[0].toUpperCase() + t.slice(1);
  // Capital words of four letters or more ("MIRENA", "ANEL VAGINAL"); a short one may be an acronym ("DIU").
  if (/^[A-ZÀ-Ú]{4,}(?: [A-ZÀ-Ú]{4,})*$/.test(t)) return t[0] + t.slice(1).toLowerCase();
  return t;
};
/** Months a problem may go without a record, counted back from the patient's last record, and still be "under follow-up". */
export const ACTIVE_WINDOW_MONTHS = 24;
/** A problem seen in one record only counts as under follow-up when that record is this recent. */
export const SINGLE_RECORD_MONTHS = 12;
const problemName = (p) => `${oneLine(p.nome)}${p.cid ? ` (${p.cid})` : ''}`;
const medicationText = (m) => [tidyName(m.nome), oneLine(m.dose), oneLine(m.uso ?? m.periodo)].filter(Boolean).join(' · ');
/** "Sem intercorrências" after a semicolon reads as part of the line; an acronym ("RN 3085 g") stays. */
const lowerFirst = (text) => (/^[A-ZÀ-Ú][a-zà-ú]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);
const ordinal = (text, index) => `${/^\d+$/.test(oneLine(text)) ? oneLine(text) : index + 1}ª gestação`;
// Without a written date, the day of the record that tells the outcome places it in time.
const pregnancyLine = (g, index) => `${ordinal(g.ordem, index)}: ${OUTCOME_LABEL[g.desfecho] ?? 'desfecho não registrado'}${g.data ? ` em ${tidyDate(g.data)}` : recordSpan(g) ? ` (registro de ${br(recordSpan(g).last)})` : ''}${oneLine(g.detalhes) ? `; ${lowerFirst(oneLine(g.detalhes).replace(/[.;]+$/, ''))}` : ''}`;
/** The day an exam happened, for ordering: its written date when readable, else the day of the record. */
const examDay = (e) => dateKey(e.data) ?? recordSpan(e)?.last ?? '';
const examLine = (e) => `${e.data ? tidyDate(e.data) : recordSpan(e) ? `registro de ${br(recordSpan(e).last)}` : 'sem data'}: ${oneLine(e.resultado)}`;
const surgeryDay = (c) => dateKey(c.data) ?? recordSpan(c)?.last ?? '';
/** The written date when it places the item in time; "mês de maio" does not: then the record does, and the words stay beside the name. */
const writtenDay = (c) => (c.data && dateKey(c.data) ? tidyDate(c.data) : null);
const surgeryLine = (c) => {
  const record = recordSpan(c) ? `registro de ${br(recordSpan(c).last)}` : 'sem data';
  return writtenDay(c) ? `${writtenDay(c)}: ${oneLine(c.nome)}` : `${record}: ${oneLine(c.nome)}${oneLine(c.data) ? ` (${oneLine(c.data).toLowerCase()})` : ''}`;
};
/**
 * A procedure done several times ("Laser vaginal", six sessions) is one line
 * with its first and last day, so that it does not bury the surgeries.
 * @returns {{ day: string, line: string, items: object[] }[]} newest first
 */
export function groupProcedures(list) {
  const groups = new Map();
  for (const c of list) groups.set(squash(c.nome), [...(groups.get(squash(c.nome)) ?? []), c]);
  const when = (c) => writtenDay(c) ?? (recordSpan(c) ? br(recordSpan(c).last) : 'sem data');
  return [...groups.values()]
    .map((items) => {
      const sorted = [...items].sort((a, b) => (surgeryDay(a) < surgeryDay(b) ? -1 : 1));
      const last = sorted.at(-1);
      return { day: surgeryDay(last), items: sorted, line: sorted.length === 1 ? surgeryLine(last) : `${when(sorted[0])} a ${when(last)}: ${oneLine(last.nome)} (${sorted.length} vezes)` };
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}
// The method in use says when it started (as written) and when it was last recorded; "since" from
// the quoted records would compete with the written start.
const contraceptionLine = (c) => `${tidyName(c.metodo)}${c.inicio ? `, início ou troca em ${tidyDate(c.inicio)}` : ''}${lastDay(c) ? ` (último registro em ${br(lastDay(c))})` : ''}`;
const formerMethod = (c) => `${tidyName(c.metodo)}${recordSpan(c) ? ` (${years(c)})` : ''}`;
const byDayDesc = (day) => (a, b) => (day(a) < day(b) ? 1 : day(a) > day(b) ? -1 : 0);

/**
 * Profile -> what Cortex stores.
 * @param options.lastRecord day of the patient's last record (ISO)
 * @param options.exportDate last day covered by the export (ISO)
 * @returns {{ diagnoses, medications, allergies, medical_history, social_anamnesis, summaryNote, tasks }}
 */
export function renderProfile(profile, { organizedOn, civilStatus = null, bloodType = null, lastRecord = null, exportDate = null }) {
  const source = `organizado por IA em ${br(organizedOn)} a partir do prontuário antigo (PersonalMed)`;
  const group = (title, lines) => (lines.filter(Boolean).length ? [`${title}:`, ...lines.filter(Boolean).map((l) => `- ${l}`)] : []);
  const get = (key) => profile[key] ?? [];

  // "Under follow-up" is the model's reading, held to the records: a dated record inside the
  // window before the patient's last record, and more than one record unless it is recent.
  const reference = lastRecord ?? get('problemas').map(lastDay).sort().at(-1) ?? null;
  const followed = (p) => {
    if (p.situacao !== 'ativo') return false;
    const span = recordSpan(p);
    // A condition written only on a page with no date at all (the antecedents taken at
    // registration: "hipotireoidismo") stays on the list, said to be undated; an undated
    // finding or complaint does not.
    if (!span) return p.tipo === 'condicao' && (p.origem ?? []).length > 0;
    const idle = monthsBetween(span.last, reference);
    return idle <= ACTIVE_WINDOW_MONTHS && (span.first !== span.last || idle <= SINGLE_RECORD_MONTHS);
  };
  const active = get('problemas').filter(followed).sort((a, b) => (KIND_ORDER[a.tipo] ?? 0) - (KIND_ORDER[b.tipo] ?? 0) || byDayDesc(lastDay)(a, b));
  const past = get('problemas').filter((p) => !followed(p)).sort(byDayDesc(lastDay));
  const inUse = get('contracepcao').filter((c) => c.situacao === 'em uso');
  const formerMethods = get('contracepcao').filter((c) => c.situacao !== 'em uso').sort((a, b) => ((recordSpan(a)?.first ?? '') < (recordSpan(b)?.first ?? '') ? -1 : 1));
  // A patient last seen long before the export: her last medicines are history, not "in use".
  const staleMedication = monthsBetween(lastRecord, exportDate) > MEDICATION_STALE_MONTHS;
  const medicines = get('medicacoes_em_uso');
  const pregnancies = get('gestacoes');
  const surgeries = groupProcedures(get('cirurgias'));
  const latestScreening = SCREENING.map((kind) => [kind, get('exames').filter((e) => e.tipo === kind).sort(byDayDesc(examDay))[0]]).filter(([, e]) => e);
  const milestones = get('marcos_ginecologicos').map((m) => oneLine(m.texto)).filter(Boolean);

  // Grouped plain text: a heading line that ends with ":" and its facts as dashed lines.
  const historyLines = [
    bloodType ? `Tipo sanguíneo: ${bloodType} (cadastro do PersonalMed)` : null,
    profile.alergias_negadas && !get('alergias').length ? 'Alergias: nega, segundo o histórico' : null,
    ...group('Ginecológico', [
      ...inUse.map((c) => `Contracepção em uso: ${contraceptionLine(c)}`),
      ...milestones,
      formerMethods.length ? `Métodos anteriores: ${formerMethods.map(formerMethod).join('; ')}` : null,
    ]),
    ...group(`Obstétrico (${pregnancies.length === 1 ? '1 gestação registrada' : `${pregnancies.length} gestações registradas`} no prontuário antigo)`, pregnancies.map(pregnancyLine)),
    ...group('Cirurgias e procedimentos', surgeries.map((g) => g.line)),
    ...group('Últimos exames de rastreamento', latestScreening.map(([kind, e]) => `${EXAM_LABEL[kind]}, ${examLine(e)}`)),
    ...group('Antecedentes familiares', get('antecedentes_familiares').map((e) => [tidyName(e.parente), oneLine(e.condicao ?? e.texto)].filter(Boolean).join(': '))),
    ...(staleMedication ? group(`Medicações no último acompanhamento (${br(lastRecord)})`, medicines.map(medicationText)) : []),
    ...group('Problemas anteriores ou sem registro recente', past.map((p) => `${years(p)}: ${problemName(p)}`)),
    // Stated as a fact about the record, not as a task: the product's own AI reads this field
    // and would otherwise report "check the profile" as the patient's pending item.
    `Origem: perfil ${source}; os itens e os trechos de origem estão na nota "Resumo do histórico importado", no histórico.`,
  ].filter(Boolean);
  const socialLines = [civilStatus ? `Estado civil: ${civilStatus} (cadastro do PersonalMed)` : null, ...get('habitos_sociais').map((e) => oneLine(e.texto))].filter(Boolean);

  const section = (title, lines) => (lines.length ? `### ${title}\n\n${lines.map((l) => `- ${l}`).join('\n')}` : null);
  const examKinds = EXAM_KINDS.map((kind) => [kind, get('exames').filter((e) => (EXAM_KINDS.includes(e.tipo) ? e.tipo : 'outro') === kind).sort(byDayDesc(examDay))]).filter(([, list2]) => list2.length);
  const summaryNote = [
    `[Resumo ${source}. Cada item cita o registro de origem, que está completo nas notas deste histórico. Não é uma consulta.]`,
    profile.resumo?.trim() ? `### Resumo\n\n${profile.resumo.trim()}` : null,
    section('Problemas em acompanhamento', active.map((p) => `${problemName(p)}${KIND_NOTE[p.tipo] ? ` [${KIND_NOTE[p.tipo]}]` : ''}${cite(p)}`)),
    section(staleMedication ? `Medicações no último acompanhamento (${br(lastRecord)})` : 'Medicações em uso', medicines.map((m) => `${medicationText(m)}${m.duracao === 'prazo definido' ? ' [tratamento com prazo]' : ''}${cite(m)}`)),
    section('Contracepção e dispositivos', get('contracepcao').map((c) => `${c.situacao === 'em uso' ? 'Em uso' : c.situacao === 'encerrado' ? 'Encerrado' : 'Sem informação atual'}: ${tidyName(c.metodo)}${c.inicio ? `, início ou troca em ${tidyDate(c.inicio)}` : ''}${cite(c)}`)),
    get('alergias').length ? section('Alergias e intolerâncias', get('alergias').map((a) => `${tidyName(a.substancia)}${a.tipo === 'intolerancia' ? ' (intolerância)' : ''}${a.reacao ? `: ${oneLine(a.reacao)}` : ''}${cite(a)}`)) : profile.alergias_negadas ? '### Alergias e intolerâncias\n\nNega alergias, segundo o histórico.' : null,
    section('Em aberto nos últimos registros', get('pendencias').map((e) => `${oneLine(e.texto)}${cite(e)}`)),
    section('Gestações', pregnancies.map((g, i) => `${pregnancyLine(g, i)}${cite(g, { lineDates: false })}`)),
    section('Marcos ginecológicos', get('marcos_ginecologicos').map((m) => `${oneLine(m.texto)}${cite(m)}`)),
    section('Cirurgias e procedimentos', surgeries.map((g) => `${g.line}${cite({ origem: g.items.flatMap((c) => c.origem ?? []) }, { lineDates: false })}`)),
    section('Antecedentes familiares', get('antecedentes_familiares').map((e) => `${[tidyName(e.parente), oneLine(e.condicao ?? e.texto)].filter(Boolean).join(': ')}${cite(e)}`)),
    section('Hábitos e contexto social', get('habitos_sociais').map((e) => `${oneLine(e.texto)}${cite(e)}`)),
    ...examKinds.map(([kind, list2]) => section(`Exames: ${EXAM_LABEL[kind]}`, list2.map((e) => `${kind.startsWith('outro') || kind === 'laboratorio' ? `${oneLine(e.exame)}, ` : ''}${examLine(e)}${cite(e, { lineDates: false })}`))),
    section('Medicações anteriores', get('medicacoes_anteriores').map((m) => `${medicationText(m)}${cite(m)}`)),
    section('Problemas anteriores ou sem registro recente', past.map((p) => `${years(p)}: ${problemName(p)}${cite(p)}`)),
  ].filter(Boolean).join('\n\n');

  const medicationRows = staleMedication ? [] : medicines.map((m) => ({
    name: tidyName(m.nome), dosage: oneLine(m.dose), instructions: oneLine(m.uso),
    // The chart says when the medicine was last recorded, not when it was started: no start date is invented.
    note: [m.duracao === 'prazo definido' ? 'tratamento com prazo' : null, lastDay(m) ? `último registro em ${br(lastDay(m))}` : null].filter(Boolean).join(' · '),
  }));
  // A hormonal method in use matters to whoever prescribes: it sits with the medicines, said for what it is.
  const deviceRows = inUse.filter((c) => c.hormonal).map((c) => ({
    name: tidyName(c.metodo), dosage: '', instructions: 'método contraceptivo em uso',
    note: [c.inicio ? `início ou troca em ${tidyDate(c.inicio)}` : null, lastDay(c) ? `último registro em ${br(lastDay(c))}` : null].filter(Boolean).join(' · '),
  }));

  return {
    diagnoses: active.map((p) => {
      const note = [KIND_NOTE[p.tipo], spanNote(p)].filter(Boolean).join(' · ');
      return { code: p.cid ?? '', description: oneLine(p.nome), ...(note ? { note } : {}) };
    }),
    medications: [...medicationRows, ...deviceRows].map(({ note, ...m }) => (note ? { ...m, note } : m)),
    allergies: get('alergias').map((a) => `${tidyName(a.substancia)}${a.tipo === 'intolerancia' || a.reacao ? ` (${[a.tipo === 'intolerancia' ? 'intolerância' : null, oneLine(a.reacao) || null].filter(Boolean).join(': ')})` : ''}`),
    medical_history: historyLines.join('\n'),
    social_anamnesis: socialLines.join('\n') || null,
    summaryNote,
    // The day of the record goes in the title: an item left open years ago must not read as today's.
    tasks: get('pendencias').map((e) => ({ title: `${oneLine(e.texto).replace(/[.;]+$/, '').slice(0, 170)}${recordSpan(e) ? ` (registro de ${br(recordSpan(e).last)})` : ''}`, content: `Sugerido pela IA a partir do histórico importado do PersonalMed${cite(e)}. Confira antes de agir.` })),
  };
}
