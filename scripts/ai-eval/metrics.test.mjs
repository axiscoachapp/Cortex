// @vitest-environment node
// Synthetic case and hand-made hypotheses only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alignWords, medicalTermErrors, negationErrors, normalize, scoreTranscript, speakerAccuracy, wordErrorRate } from './metrics.mjs';

const gold = JSON.parse(readFileSync(new URL('./cases/sintetico-01-itu/gold.json', import.meta.url), 'utf8'));
const goldText = gold.transcript.map((s) => s.text).join(' ');

describe('normalisation and word error rate', () => {
  it('treats accents, case, punctuation and dose spacing as equal', () => {
    expect(normalize('Nitrofurantoína 100mg, 1,5 ML!')).toBe('nitrofurantoina 100 mg 1d5 ml');
    expect(normalize('nitrofurantoina 100 mg 1.5 ml')).toBe('nitrofurantoina 100 mg 1d5 ml');
  });

  it('counts substitutions, deletions and insertions against the reference', () => {
    expect(wordErrorRate('a b c d', 'a b c d')).toMatchObject({ wer: 0, refWords: 4 });
    expect(wordErrorRate('a b c d', 'a x c')).toMatchObject({ substitutions: 1, deletions: 1, insertions: 0, wer: 0.5 });
    expect(wordErrorRate('a b', 'a b c')).toMatchObject({ insertions: 1, wer: 0.5 });
    expect(alignWords('a b', 'b').map((o) => o.op)).toEqual(['del', 'ok']);
  });
});

describe('medical terms and negations (critical errors)', () => {
  it('finds a missing drug and a wrong dose', () => {
    const r = medicalTermErrors(gold.terms, 'prescrevo nitrofurantoína 10 mg e peço urocultura');
    expect(r).toMatchObject({ total: 3, missing: ['fenazopiridina'], wrongDose: ['nitrofurantoína 100 mg'] });
    expect(r.termErrorRate).toBeCloseTo(2 / 3);
  });

  it('accepts the dose written without a space', () => {
    expect(medicalTermErrors([{ name: 'nitrofurantoína', dose: '100 mg' }], 'Nitrofurantoina 100mg 6/6h')).toMatchObject({ missing: [], wrongDose: [] });
  });

  it('flags a negation that disappears', () => {
    expect(negationErrors(gold.negations, 'teve febre e nega alergia')).toEqual({ total: 2, missing: [], inverted: ['febre'] });
    expect(negationErrors(gold.negations, 'nada a declarar')).toMatchObject({ missing: ['febre', 'alergia'] });
  });
});

describe('speaker attribution', () => {
  it('maps provider labels to roles and scores matched words', () => {
    const hyp = gold.transcript.map((s) => ({ speaker: s.speaker === 'medico' ? 'spk_1' : s.speaker === 'paciente' ? 'spk_0' : 'spk_2', text: s.text }));
    expect(speakerAccuracy(gold.transcript, hyp)).toMatchObject({ accuracy: 1, mapping: { spk_0: 'paciente', spk_1: 'medico', spk_2: 'acompanhante' } });
    // Companion merged into the patient: those words count as wrong.
    const merged = gold.transcript.map((s) => ({ speaker: s.speaker === 'medico' ? 'A' : 'B', text: s.text }));
    const r = speakerAccuracy(gold.transcript, merged);
    expect(r.accuracy).toBeLessThan(1);
    expect(r.accuracy).toBeGreaterThan(0.8);
  });
});

describe('scoreTranscript on the synthetic case', () => {
  it('is perfect for the gold transcript itself', () => {
    const r = scoreTranscript(gold, { segments: gold.transcript });
    expect(r).toMatchObject({ criticalErrors: 0, terms: { missing: [], wrongDose: [] }, negations: { inverted: [] } });
    expect(r.wer.wer).toBe(0);
  });

  it('counts a wrong dose and a lost negation as critical errors', () => {
    const segments = gold.transcript.map((s) => ({
      speaker: s.speaker,
      text: s.text.replace('nitrofurantoína 100 mg', 'nitrofurantoína 50 mg').replace('Não tive febre', 'Tive febre'),
    }));
    const r = scoreTranscript(gold, { segments });
    expect(r.criticalErrors).toBe(2);
    expect(r.terms.wrongDose).toEqual(['nitrofurantoína 100 mg']);
    expect(r.negations.inverted).toEqual(['febre']);
    expect(r.wer.substitutions + r.wer.deletions).toBeGreaterThan(0);
    expect(goldText.length).toBeGreaterThan(100);
  });
});
