// @vitest-environment node
// End-to-end with the two synthetic candidates: no network, no real data.
import { describe, expect, it } from 'vitest';
import { buildBlindPackage, reviewPage, unblind } from './blind.mjs';
import { loadCases, renderReport, runCandidates, scoreOutputs } from './pipeline.mjs';

const cases = loadCases(new URL('./cases/', import.meta.url));
const candidates = ['sintetico-referencia', 'sintetico-com-erros'];

describe('evaluation pipeline', () => {
  it('runs every candidate on every case, for transcription and note', async () => {
    const outputs = await runCandidates(cases, candidates);
    expect(outputs).toHaveLength(cases.length * candidates.length * 2);
    await expect(runCandidates(cases, ['provedor-real'])).rejects.toThrow(/test account and decisions D13\/D15/);
  });

  it('scores the reference as perfect and catches the damaged candidate', async () => {
    const auto = scoreOutputs(cases, await runCandidates(cases, candidates));
    expect(auto['sintetico-referencia']).toMatchObject({ wer: 0, termErrorRate: 0, speakerAccuracy: 1, factRecall: 1, criticalErrors: 0 });
    const bad = auto['sintetico-com-erros'];
    expect(bad.criticalErrors).toBeGreaterThanOrEqual(4);
    expect(bad.wer).toBeGreaterThan(0);
    expect(bad.speakerAccuracy).toBeLessThan(1);
    expect(bad.factRecall).toBeLessThan(1);
    expect(bad.perCase.find((c) => c.task === 'transcricao').wrongDose).toEqual(['nitrofurantoína 100 mg']);
    expect(bad.perCase.find((c) => c.task === 'evolucao').inventedDoses).toEqual(['500 mg']);
  });

  it('feeds the blind package and the report, applying criteria fixed beforehand', async () => {
    const outputs = await runCandidates(cases, candidates);
    const pkg = buildBlindPackage(outputs.filter((o) => o.task === 'evolucao'), { seed: 'teste' });
    for (const c of candidates) expect(reviewPage(pkg.items)).not.toContain(c);
    const labelOf = (candidate) => Object.entries(pkg.key['sintetico-01-itu|evolucao']).find(([, x]) => x === candidate)[0];
    const doctors = unblind(
      [{ reviewer: 'Dra. Sintética', scores: {
        [`sintetico-01-itu|evolucao|${labelOf('sintetico-referencia')}`]: { fidelidade: 5, minutos: 1, critico: false },
        [`sintetico-01-itu|evolucao|${labelOf('sintetico-com-erros')}`]: { fidelidade: 2, minutos: 6, critico: true },
      } }],
      pkg.key,
    );
    const report = renderReport({ automatic: scoreOutputs(cases, outputs), doctors, criteria: { maxCriticalErrors: 0, maxTermErrorRate: 0.02, maxMedianEditMinutes: 2 } });
    expect(report).toMatch(/\| sintetico-referencia \| 0\.0% \| 0\.0% \| 100\.0% \| 100\.0% \| 0 \| 1\.0 min \| Aprovado \|/);
    expect(report).toMatch(/\| sintetico-com-erros \|.*Reprovado: \d+ erro\(s\) crítico\(s\); erro em termos médicos .*; edição mediana de 6 min \|/);
    expect(report).toContain('dose errada de nitrofurantoína 100 mg');
    expect(report).toContain('dose sem fonte 500 mg');
  });
});
