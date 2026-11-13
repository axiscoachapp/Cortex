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

export const PROFILE_SCHEMA = {
  type: 'object',
  required: ['resumo', 'problemas', 'medicacoes_em_uso', 'medicacoes_anteriores', 'alergias', 'alergias_negadas', 'obstetrico', 'cirurgias', 'antecedentes_familiares', 'habitos_sociais', 'exames', 'pendencias'],
  properties: {
    resumo: s,
    problemas: { type: 'array', items: item({ nome: s, cid: s, situacao: { type: 'string', enum: ['ativo', 'resolvido', 'historico'] }, desde: s }) },
    medicacoes_em_uso: { type: 'array', items: item({ nome: s, dose: s, uso: s, ultima_prescricao: s }) },
    medicacoes_anteriores: { type: 'array', items: item({ nome: s, dose: s, periodo: s }) },
    alergias: { type: 'array', items: item({ substancia: s, reacao: s }) },
    alergias_negadas: { type: 'boolean' },
    obstetrico: { type: 'array', items: item({ evento: s, data: s }) },
    cirurgias: { type: 'array', items: item({ nome: s, data: s }) },
    antecedentes_familiares: { type: 'array', items: item({ texto: s }) },
    habitos_sociais: { type: 'array', items: item({ texto: s }) },
    exames: { type: 'array', items: item({ exame: s, data: s, resultado: s }) },
    pendencias: { type: 'array', items: item({ texto: s }) },
  },
};

export const profileSystem = (exportDate) => `Você recebe todo o histórico antigo de uma paciente, importado do sistema PersonalMed de um consultório de ginecologia e obstetrícia (com um urologista), em ordem cronológica e com o médico de cada registro. Monte o perfil clínico dela para o prontuário novo. A data de referência (último dia coberto pelo histórico) é ${exportDate}.

Tudo o que você afirmar precisa estar escrito no histórico, e cada item precisa citar a origem.

Campos:
- "resumo": até 900 caracteres, em ordem cronológica, com o que importa para quem vai atender a paciente hoje: por que ela é acompanhada, os eventos relevantes e a situação mais recente. Sem adjetivos, sem recomendações, sem o nome dela.
- "problemas": diagnósticos e condições registrados; "cid" só se o código estiver escrito (senão ""). "situacao": "ativo" quando os registros mais recentes mostram acompanhamento ou tratamento; "resolvido" quando o histórico diz que resolveu ou é um evento encerrado (gestação concluída, infecção tratada); "historico" quando não dá para saber. "desde": mês/ano do primeiro registro, como "05/2019", ou "".
- "medicacoes_em_uso": só o que os registros dos 12 meses anteriores à data de referência mostram como uso contínuo ou tratamento em curso. "dose": só a dose escrita (ex.: "100 mg"), sem comentário; "uso": o modo de uso como escrito. "ultima_prescricao": data do último registro, "AAAA-MM-DD". Tratamento curto já encerrado não entra aqui.
- "medicacoes_anteriores": outras medicações relevantes prescritas antes; "periodo" como "2019 a 2021" ou "".
- "alergias": só alergia ou intolerância escrita no histórico e com a substância ou o produto identificado ("substancia" é o nome dele; "reacao" é a reação escrita, ou ""). Alergia sem causa identificada não entra aqui: vai em "problemas". Efeito colateral comum de um remédio (enjoo, diarreia, obstipação, sonolência) só entra se o registro disser alergia, intolerância, "não tolera" ou que o remédio foi suspenso por causa dele. Se o histórico registra que ela nega alergias e não há alergia escrita, devolva lista vazia e "alergias_negadas": true. Sem registro nenhum: lista vazia e false.
- "obstetrico": gestações, partos (com tipo), abortos e intercorrências, um item por evento; "data" como escrita ou "".
- "cirurgias", "antecedentes_familiares", "habitos_sociais": como escritos.
- "exames": rastreamentos e exames com resultado registrado (citologia, mamografia, ultrassonografias, densitometria, laboratório relevante): um item por exame e data; "resultado" resumido com os valores como escritos.
- "pendencias": o que os registros mais recentes deixam em aberto de forma explícita (exame pedido sem resultado registrado depois, retorno indicado, tratamento a reavaliar em data futura). Na dúvida, não inclua.

"origem" de cada item: um a três objetos {"data": dia do registro "AAAA-MM-DD" (ou "sem data" para páginas sem data), "trecho": cópia literal, caractere por caractere, de 15 a 120 caracteres do texto que sustenta o item}. Um trecho que não esteja no histórico invalida o item.

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
 * A quote found under another date is accepted and its date corrected.
 */
export function verifyProfile(profile, sources, all) {
  const report = { kept: 0, dropped: 0, dateFixed: 0, byList: {} };
  const locate = (quote) => {
    const q = squash(quote);
    if (q.length < 10) return null;
    for (const [date, text] of sources) if (text.includes(q)) return date;
    return all.includes(q) ? 'sem data' : null;
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
          const found = locate(o.trecho);
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
// 4. Rendering into Cortex fields
//
// Where each piece goes follows how the app shows it:
// - the profile's "Histórico médico" and "Anamnese social" are lists of one fact
//   per line, so they receive the short, lasting facts only;
// - the long lists (exams, past medications) and the summary go into one note of
//   the history, "Resumo do histórico importado", which is also what the
//   assistant and the pre-consultation summary read first;
// - what the last records leave open becomes a pending item for the doctor.

const br = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

/** The organised note followed by the complete original record of the day. */
export function renderDayNote({ stamp, note, original, checked }) {
  const sections = [['S (Subjetivo)', note.s], ['O (Objetivo)', note.o], ['A (Avaliação)', note.a], ['P (Plano)', note.p]].filter(([, v]) => v && v.trim());
  // Fewer than two sections is not a SOAP note for the app: the original alone is clearer.
  if (!checked || sections.length < 2) return `${stamp}\n\n${original}`;
  return `${stamp}\n[Organizado por IA a partir do registro original, que segue completo abaixo]\n\n${sections.map(([label, v]) => `**${label}:** ${v.trim()}`).join('\n\n')}\n\n### Registro original (PersonalMed)\n\n${original}`;
}

const cite = (entry) => {
  const all = [...new Set((entry.origem ?? []).map((o) => o.data))];
  const dated = all.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().map(br);
  const parts = [dated.length ? `${dated.length > 1 ? 'registros' : 'registro'} de ${dated.join(', ')}` : null, all.length > dated.length ? 'página sem data' : null].filter(Boolean);
  return parts.length ? ` (${parts.join('; ')})` : '';
};

/** Entries the chart cannot use: an allergy with no named substance says nothing a doctor can act on. */
export function cleanProfile(profile) {
  const unnamed = /^(n[aã]o\s+(identificad|informad|especificad)|desconhecid|sem\s+causa|indefinid)/i;
  return { ...profile, alergias: (profile.alergias ?? []).filter((a) => a.substancia?.trim() && !unnamed.test(a.substancia.trim())).map((a) => ({ ...a, reacao: unnamed.test((a.reacao ?? '').trim()) ? '' : a.reacao })) };
}

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const problemLine = (p) => `${oneLine(p.nome)}${p.cid ? ` (${p.cid})` : ''}${p.desde ? `, desde ${p.desde}` : ''}`;
const medicationLine = (m) => [oneLine(m.nome), oneLine(m.dose), oneLine(m.uso ?? m.periodo)].filter(Boolean).join(' · ');

/**
 * Profile -> what Cortex stores.
 * @returns {{ diagnoses, medications, allergies, medical_history, social_anamnesis, summaryNote, tasks }}
 */
export function renderProfile(profile, { organizedOn, civilStatus = null, bloodType = null }) {
  const source = `organizado por IA em ${br(organizedOn)} a partir do histórico importado do PersonalMed`;
  // One fact per line: the app shows each line as an item.
  const historyLines = [
    // Stated as a fact about the record, not as a task: the product's own AI reads this field
    // and would otherwise report "check the profile" as the patient's pending item.
    `Perfil ${source}; os itens e as origens estão na nota "Resumo do histórico importado", no histórico.`,
    bloodType ? `Tipo sanguíneo: ${bloodType} (cadastro do PersonalMed)` : null,
    ...profile.obstetrico.map((e) => `Obstétrico: ${oneLine(e.evento)}${e.data ? ` (${oneLine(e.data)})` : ''}`),
    ...profile.cirurgias.map((e) => `Cirurgia: ${oneLine(e.nome)}${e.data ? ` (${oneLine(e.data)})` : ''}`),
    ...profile.antecedentes_familiares.map((e) => `Antecedente familiar: ${oneLine(e.texto)}`),
    ...profile.problemas.filter((p) => p.situacao !== 'ativo').map((p) => `Problema anterior: ${problemLine(p)}`),
    profile.alergias_negadas && !profile.alergias.length ? 'Alergias: nega, segundo o histórico' : null,
  ].filter(Boolean);
  const socialLines = [civilStatus ? `Estado civil: ${civilStatus} (cadastro do PersonalMed)` : null, ...profile.habitos_sociais.map((e) => oneLine(e.texto))].filter(Boolean);

  const list = (title, lines) => (lines.length ? `### ${title}\n\n${lines.map((l) => `- ${l}`).join('\n')}` : null);
  const summaryNote = [
    `[Resumo ${source}. Cada item cita o registro de origem, que está completo nas notas deste histórico. Não é uma consulta.]`,
    profile.resumo?.trim() ? `### Resumo\n\n${profile.resumo.trim()}` : null,
    list('Problemas em acompanhamento', profile.problemas.filter((p) => p.situacao === 'ativo').map((p) => `${problemLine(p)}${cite(p)}`)),
    list('Medicações em uso', profile.medicacoes_em_uso.map((m) => `${medicationLine(m)}${cite(m)}`)),
    profile.alergias.length ? list('Alergias e intolerâncias', profile.alergias.map((a) => `${oneLine(a.substancia)}${a.reacao ? `: ${oneLine(a.reacao)}` : ''}${cite(a)}`)) : profile.alergias_negadas ? '### Alergias e intolerâncias\n\nNega alergias, segundo o histórico.' : null,
    list('Em aberto nos últimos registros', profile.pendencias.map((e) => `${oneLine(e.texto)}${cite(e)}`)),
    list('Antecedentes obstétricos', profile.obstetrico.map((e) => `${oneLine(e.evento)}${e.data ? ` (${oneLine(e.data)})` : ''}${cite(e)}`)),
    list('Cirurgias', profile.cirurgias.map((e) => `${oneLine(e.nome)}${e.data ? ` (${oneLine(e.data)})` : ''}${cite(e)}`)),
    list('Antecedentes familiares', profile.antecedentes_familiares.map((e) => `${oneLine(e.texto)}${cite(e)}`)),
    list('Hábitos e contexto social', profile.habitos_sociais.map((e) => `${oneLine(e.texto)}${cite(e)}`)),
    list('Exames e rastreamentos', profile.exames.map((e) => `${oneLine(e.exame)}${e.data ? ` (${oneLine(e.data)})` : ''}: ${oneLine(e.resultado)}${cite(e)}`)),
    list('Medicações anteriores', profile.medicacoes_anteriores.map((m) => `${medicationLine(m)}${cite(m)}`)),
    list('Problemas anteriores ou sem acompanhamento recente', profile.problemas.filter((p) => p.situacao !== 'ativo').map((p) => `${problemLine(p)}${cite(p)}`)),
  ].filter(Boolean).join('\n\n');

  return {
    diagnoses: profile.problemas.filter((p) => p.situacao === 'ativo').map((p) => ({ code: p.cid ?? '', description: oneLine(p.nome) })),
    // The chart says when the medicine was last recorded, not when it was started: no start date is invented.
    medications: profile.medicacoes_em_uso.map((m) => ({ name: oneLine(m.nome), dosage: oneLine(m.dose), instructions: [oneLine(m.uso), /^\d{4}-\d{2}-\d{2}$/.test(m.ultima_prescricao ?? '') ? `último registro em ${br(m.ultima_prescricao)}` : null].filter(Boolean).join(' · ') })),
    allergies: profile.alergias.map((a) => `${oneLine(a.substancia)}${a.reacao ? ` (${oneLine(a.reacao)})` : ''}`),
    medical_history: historyLines.join('\n'),
    social_anamnesis: socialLines.join('\n') || null,
    summaryNote,
    tasks: profile.pendencias.map((e) => ({ title: oneLine(e.texto).slice(0, 200), content: `Sugerido pela IA a partir do histórico importado do PersonalMed${cite(e)}. Confira antes de agir.` })),
  };
}
