// AI evaluation pipeline (Part B5): run every candidate on every case, score
// automatically, and render the report. Real providers are not wired in: they
// need test accounts (user) and decisions D13/D15. Two synthetic candidates
// exercise the whole path without any network call.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreNote, scoreTranscript } from './metrics.mjs';

export function loadCases(dir) {
  const root = dir instanceof URL ? fileURLToPath(dir) : dir;
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(join(root, d.name, 'gold.json'), 'utf8')))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Deterministic damage for the "noisy" synthetic candidate: the kinds of error B3 must catch. */
function damage(text) {
  return text
    .replace(/\b100 mg\b/, '10 mg')
    .replace(/\bNão tive febre\b/, 'Tive febre')
    .replace(/\burocultura\b/, '');
}

/**
 * Candidates: `transcribe(gold)` returns { segments }, `note(gold, transcript)`
 * returns text. Synthetic ones read the gold; real ones would read the audio.
 */
export const CANDIDATES = {
  'sintetico-referencia': {
    synthetic: true,
    transcribe: (gold) => ({ segments: gold.transcript.map((s, i) => ({ speaker: `spk_${s.speaker === 'medico' ? 0 : s.speaker === 'paciente' ? 1 : 2}`, text: s.text, index: i })) }),
    note: (gold) => gold.referenceNote,
  },
  'sintetico-com-erros': {
    synthetic: true,
    // Also merges the companion into the patient, as weak diarisation does.
    transcribe: (gold) => ({ segments: gold.transcript.map((s) => ({ speaker: s.speaker === 'medico' ? 'A' : 'B', text: damage(s.text) })) }),
    // Note: an invented dose (500 mg was never said) and a lost negation.
    note: (gold) => gold.referenceNote.replace(/Nega febre/, 'Febre').replace('Nitrofurantoína 100 mg', 'Nitrofurantoína 500 mg'),
  },
};

/** Run candidates on cases; outputs feed both scoring and the blind package. */
export async function runCandidates(cases, candidateNames, { candidates = CANDIDATES, now = () => Date.now() } = {}) {
  const outputs = [];
  for (const name of candidateNames) {
    const c = candidates[name];
    if (!c) throw new Error(`Unknown candidate ${name}. Real providers need a test account and decisions D13/D15.`);
    for (const gold of cases) {
      const t0 = now();
      const transcript = await c.transcribe(gold);
      const t1 = now();
      const note = await c.note(gold, transcript);
      const t2 = now();
      outputs.push({ candidate: name, caseId: gold.id, task: 'transcricao', content: transcript.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n'), segments: transcript.segments, latencyMs: t1 - t0 });
      outputs.push({ candidate: name, caseId: gold.id, task: 'evolucao', content: note, latencyMs: t2 - t1 });
    }
  }
  return outputs;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Automatic metrics per candidate (B3), averaged over cases. */
export function scoreOutputs(cases, outputs) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const acc = {};
  for (const o of outputs) {
    const gold = byId.get(o.caseId);
    const a = (acc[o.candidate] ??= { wer: [], termErrorRate: [], speaker: [], factRecall: [], critical: 0, latencyMs: [], perCase: [] });
    if (o.task === 'transcricao') {
      const s = scoreTranscript(gold, { segments: o.segments });
      a.wer.push(s.wer.wer);
      a.termErrorRate.push(s.terms.termErrorRate);
      a.speaker.push(s.speakers.accuracy);
      a.critical += s.criticalErrors;
      a.perCase.push({ caseId: o.caseId, task: o.task, criticalErrors: s.criticalErrors, wrongDose: s.terms.wrongDose, invertedNegations: s.negations.inverted, missingTerms: s.terms.missing });
    } else {
      const s = scoreNote(gold, o.content);
      a.factRecall.push(s.facts.recall);
      a.critical += s.criticalErrors;
      a.perCase.push({ caseId: o.caseId, task: o.task, criticalErrors: s.criticalErrors, missingFacts: s.facts.missing, wrongDose: s.terms.wrongDose, inventedDoses: s.inventedDoses, invertedNegations: s.negations.inverted });
    }
    if (typeof o.latencyMs === 'number') a.latencyMs.push(o.latencyMs);
  }
  return Object.fromEntries(
    Object.entries(acc)
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([name, a]) => [
        name,
        {
          wer: mean(a.wer),
          termErrorRate: mean(a.termErrorRate),
          speakerAccuracy: mean(a.speaker),
          factRecall: mean(a.factRecall),
          criticalErrors: a.critical,
          meanLatencyMs: mean(a.latencyMs),
          perCase: a.perCase,
        },
      ]),
  );
}

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const num = (x, digits = 1) => (x == null ? '—' : x.toFixed(digits));

/**
 * Final report (B4): automatic table, the doctors' unblinded scores, and the
 * pass/fail against criteria fixed BEFORE the results were seen.
 * @param criteria { maxCriticalErrors: 0, maxTermErrorRate: 0.02, maxMedianEditMinutes: 2 }
 */
export function renderReport({ automatic, doctors = {}, criteria, title = 'Avaliação de IA — relatório' }) {
  const names = [...new Set([...Object.keys(automatic), ...Object.keys(doctors)])].sort();
  const passes = (name) => {
    const a = automatic[name];
    const d = doctors[name];
    const reasons = [];
    const critical = (a?.criticalErrors ?? 0) + (d?.criticalErrors ?? 0);
    if (critical > criteria.maxCriticalErrors) reasons.push(`${critical} erro(s) crítico(s)`);
    if (a?.termErrorRate != null && a.termErrorRate > criteria.maxTermErrorRate) reasons.push(`erro em termos médicos ${pct(a.termErrorRate)}`);
    if (d?.medianEditMinutes != null && d.medianEditMinutes > criteria.maxMedianEditMinutes) reasons.push(`edição mediana de ${d.medianEditMinutes} min`);
    return reasons;
  };
  const lines = [
    `# ${title}`,
    '',
    `Critérios aprovados antes dos resultados: no máximo ${criteria.maxCriticalErrors} erro crítico; erro em termos médicos até ${pct(criteria.maxTermErrorRate)}; mediana de edição até ${criteria.maxMedianEditMinutes} min.`,
    '',
    '## Resultado',
    '',
    '| Candidato | Erro de palavras | Erro em termos médicos | Quem falou | Fatos da evolução | Erros críticos (auto + médicos) | Edição mediana | Situação |',
    '|---|---|---|---|---|---|---|---|',
    ...names.map((n) => {
      const a = automatic[n] ?? {};
      const d = doctors[n] ?? {};
      const reasons = passes(n);
      return `| ${n} | ${pct(a.wer)} | ${pct(a.termErrorRate)} | ${pct(a.speakerAccuracy)} | ${pct(a.factRecall)} | ${(a.criticalErrors ?? 0) + (d.criticalErrors ?? 0)} | ${d.medianEditMinutes == null ? '—' : `${num(d.medianEditMinutes)} min`} | ${reasons.length ? `Reprovado: ${reasons.join('; ')}` : 'Aprovado'} |`;
    }),
    '',
    '## Erros críticos encontrados automaticamente',
    '',
    ...names.flatMap((n) => {
      const items = (automatic[n]?.perCase ?? []).filter((c) => c.criticalErrors > 0);
      if (!items.length) return [`- **${n}:** nenhum.`];
      return [
        `- **${n}:**`,
        ...items.map((c) => `  - ${c.caseId} (${c.task}): ${[...(c.wrongDose ?? []).map((x) => `dose errada de ${x}`), ...(c.inventedDoses ?? []).map((x) => `dose sem fonte ${x}`), ...(c.invertedNegations ?? []).map((x) => `negação perdida: ${x}`)].join('; ')}`),
      ];
    }),
    '',
    'As notas dos médicos vêm do pacote às cegas (`blind.mjs`), desembaralhado depois da sessão. Os exemplos citados são de casos sintéticos.',
    '',
  ];
  return lines.join('\n');
}
