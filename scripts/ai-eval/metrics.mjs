// Automatic metrics for the AI evaluation (docs/ai/PLANO_IA_EFICIENCIA_E_AVALIACAO.md,
// Part B3). Pure functions over text: no provider call, no patient data.
// Every case is synthetic and written or approved by the clinic's doctors.

/** Lower case, no accents, punctuation as spaces; numbers and units stay. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // "100mg" and "100 mg" are the same dose; then "1,5" and "1.5" become one
    // token ("1d5"). The unit split must run first or it would split "1d5".
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/(\d)[,.](\d)/g, '$1d$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const words = (text) => (normalize(text) ? normalize(text).split(' ') : []);

/**
 * Word-level edit alignment (Levenshtein). Returns the operations in order:
 * { op: 'ok'|'sub'|'del'|'ins', ref, hyp, refIndex, hypIndex }.
 */
export function alignWords(reference, hypothesis) {
  const r = Array.isArray(reference) ? reference : words(reference);
  const h = Array.isArray(hypothesis) ? hypothesis : words(hypothesis);
  const cost = Array.from({ length: r.length + 1 }, (_, i) => {
    const row = new Uint32Array(h.length + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= h.length; j++) cost[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      cost[i][j] = Math.min(cost[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
  const ops = [];
  let i = r.length;
  let j = h.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1)) {
      ops.push({ op: r[i - 1] === h[j - 1] ? 'ok' : 'sub', ref: r[i - 1], hyp: h[j - 1], refIndex: i - 1, hypIndex: j - 1 });
      i--;
      j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      ops.push({ op: 'del', ref: r[i - 1], hyp: null, refIndex: i - 1, hypIndex: null });
      i--;
    } else {
      ops.push({ op: 'ins', ref: null, hyp: h[j - 1], refIndex: null, hypIndex: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

/** WER = (substitutions + deletions + insertions) / reference words. */
export function wordErrorRate(reference, hypothesis) {
  const ops = alignWords(reference, hypothesis);
  const count = (op) => ops.filter((o) => o.op === op).length;
  const refWords = ops.filter((o) => o.op !== 'ins').length;
  const substitutions = count('sub');
  const deletions = count('del');
  const insertions = count('ins');
  return { wer: refWords ? (substitutions + deletions + insertions) / refWords : 0, substitutions, deletions, insertions, refWords };
}

/**
 * Medical terms (the main criterion of B3): each gold term is a drug or exam,
 * optionally with a dose. A term is `missing` when the name is absent, and
 * `wrongDose` when the name is present but no occurrence carries the dose
 * within `window` words after it. A wrong dose is a critical error.
 *
 * @param terms [{ name: 'nitrofurantoína', dose?: '100 mg' }]
 */
export function medicalTermErrors(terms, hypothesis, { window = 6 } = {}) {
  const h = words(hypothesis);
  const find = (needle, from = 0) => {
    for (let k = from; k + needle.length <= h.length; k++) if (needle.every((w, n) => h[k + n] === w)) return k;
    return -1;
  };
  const missing = [];
  const wrongDose = [];
  for (const term of terms) {
    const name = words(term.name);
    const positions = [];
    for (let at = find(name); at >= 0; at = find(name, at + 1)) positions.push(at);
    if (!positions.length) {
      missing.push(term.name);
      continue;
    }
    if (!term.dose) continue;
    const dose = words(term.dose);
    const ok = positions.some((at) => {
      const start = at + name.length;
      const near = h.slice(start, start + window + dose.length);
      return near.some((_, k) => dose.every((w, n) => near[k + n] === w));
    });
    if (!ok) wrongDose.push(`${term.name} ${term.dose}`);
  }
  const total = terms.length;
  return { total, missing, wrongDose, termErrorRate: total ? (missing.length + wrongDose.length) / total : 0 };
}

/**
 * Negations ("nega alergia") must survive: `inverted` when the hypothesis
 * keeps the subject but not the negation cue, a critical error.
 * @param negations [{ cue: 'nega', subject: 'alergia' }]
 */
export function negationErrors(negations, hypothesis, { window = 5 } = {}) {
  const h = words(hypothesis);
  const cues = (cue) => new Set([...words(cue), 'nao', 'nega', 'negou', 'sem', 'nunca', 'nenhum', 'nenhuma']);
  const missing = [];
  const inverted = [];
  for (const n of negations) {
    const subject = words(n.subject);
    // "alergia" also matches "alergias": plural endings only, nothing looser.
    const same = (w, x) => x === w || (x.startsWith(w) && /^(s|es)$/.test(x.slice(w.length)));
    const hits = [];
    for (let k = 0; k + subject.length <= h.length; k++) if (subject.every((w, m) => same(w, h[k + m]))) hits.push(k);
    if (!hits.length) {
      missing.push(n.subject);
      continue;
    }
    const negated = hits.some((k) => h.slice(Math.max(0, k - window), k).some((w) => cues(n.cue).has(w)));
    if (!negated) inverted.push(n.subject);
  }
  return { total: negations.length, missing, inverted };
}

/**
 * Speaker attribution: align the words of the gold transcript with the
 * hypothesis, map each hypothesis label ("spk_0") to the gold role it
 * matches most, then count matched words with the right role.
 * @param gold [{ speaker: 'medico', text }]
 * @param hyp  [{ speaker: 'spk_0', text }]
 */
export function speakerAccuracy(gold, hyp) {
  const goldWords = gold.flatMap((s) => words(s.text).map((w) => ({ w, speaker: s.speaker })));
  const hypWords = hyp.flatMap((s) => words(s.text).map((w) => ({ w, speaker: s.speaker })));
  const ops = alignWords(goldWords.map((x) => x.w), hypWords.map((x) => x.w)).filter((o) => o.op === 'ok');
  const votes = new Map();
  for (const o of ops) {
    const label = hypWords[o.hypIndex].speaker;
    const role = goldWords[o.refIndex].speaker;
    const v = votes.get(label) ?? new Map();
    v.set(role, (v.get(role) ?? 0) + 1);
    votes.set(label, v);
  }
  const mapping = Object.fromEntries([...votes].map(([label, v]) => [label, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
  const correct = ops.filter((o) => mapping[hypWords[o.hypIndex].speaker] === goldWords[o.refIndex].speaker).length;
  return { accuracy: ops.length ? correct / ops.length : 0, matchedWords: ops.length, mapping };
}

const DOSE = /\b(\d+(?:d\d+)?) (mg|mcg|g|ml|ui|gotas?|comprimidos?|capsulas?)\b/g;

/** Doses written in the note that nobody said in the consultation. */
export function unsupportedDoses(noteText, transcriptText) {
  const said = ` ${words(transcriptText).join(' ')} `;
  const found = [...new Set([...words(noteText).join(' ').matchAll(DOSE)].map((m) => m[0]))];
  return found.filter((d) => !said.includes(` ${d} `));
}

/** Which of S, O, A, P the note has as headings ("## S", "Subjetivo:", "S:"). */
export function soapSections(noteText) {
  const names = { S: 'subjetivo', O: 'objetivo', A: 'avaliacao', P: 'plano' };
  const lines = String(noteText ?? '').split(/\r?\n/).map((l) => normalize(l.replace(/^#+\s*/, '')));
  return Object.fromEntries(Object.entries(names).map(([k, full]) => [k, lines.some((l) => l === k.toLowerCase() || l.startsWith(`${full}`) || l.startsWith(`${k.toLowerCase()} `))]));
}

/**
 * Key-fact recall for a note or a patient synthesis. Each fact lists accepted
 * phrasings; a fact is present when any of them appears.
 * @param facts [{ id, match: ['disuria', 'ardencia para urinar'] }]
 */
export function factRecall(facts, text) {
  const t = ` ${words(text).join(' ')} `;
  const missing = facts.filter((f) => !f.match.some((m) => t.includes(` ${words(m).join(' ')} `))).map((f) => f.id);
  return { total: facts.length, missing, recall: facts.length ? (facts.length - missing.length) / facts.length : 1 };
}

/**
 * Everything B3 measures automatically for one SOAP note: key facts, doses
 * with no source in the transcript (invented), lost negations and the four
 * sections. Invented doses and inverted negations are critical errors.
 */
export function scoreNote(gold, noteText) {
  const transcriptText = gold.transcript.map((s) => s.text).join(' ');
  const facts = factRecall(gold.keyFacts ?? [], noteText);
  const invented = unsupportedDoses(noteText, transcriptText);
  const terms = medicalTermErrors(gold.terms ?? [], noteText);
  const negations = negationErrors(gold.negations ?? [], noteText);
  const sections = soapSections(noteText);
  return {
    facts,
    inventedDoses: invented,
    terms,
    negations,
    sections,
    criticalErrors: invented.length + terms.wrongDose.length + negations.inverted.length,
  };
}

/** Everything B3 measures automatically for one transcript. */
export function scoreTranscript(gold, hypothesis) {
  const goldText = gold.transcript.map((s) => s.text).join(' ');
  const hypText = hypothesis.segments.map((s) => s.text).join(' ');
  const terms = medicalTermErrors(gold.terms ?? [], hypText);
  const negations = negationErrors(gold.negations ?? [], hypText);
  return {
    wer: wordErrorRate(goldText, hypText),
    terms,
    negations,
    speakers: speakerAccuracy(gold.transcript, hypothesis.segments),
    criticalErrors: terms.wrongDose.length + negations.inverted.length,
  };
}
