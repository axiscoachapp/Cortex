// @vitest-environment node
// Synthetic outputs only; candidate names are placeholders.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUBRIC, buildBlindPackage, reviewPage, unblind, writeBlindPackage } from './blind.mjs';

const candidates = ['provedor-alfa', 'provedor-beta', 'provedor-gama'];
const cases = ['caso-01', 'caso-02', 'caso-03', 'caso-04'];
const outputs = cases.flatMap((caseId) =>
  candidates.map((candidate) => ({ candidate, caseId, task: 'evolucao', content: `S: texto sintético de ${caseId}\nP: conduta ${caseId}` })),
);

describe('blind package', () => {
  it('labels every candidate in every case and the key maps labels back', () => {
    const pkg = buildBlindPackage(outputs, { seed: 'sessao-1' });
    expect(pkg.items).toHaveLength(cases.length * candidates.length);
    for (const caseId of cases) {
      const map = pkg.key[`${caseId}|evolucao`];
      expect(Object.keys(map)).toEqual(['A', 'B', 'C']);
      expect(Object.values(map).sort()).toEqual(candidates);
    }
  });

  it('is deterministic for a seed and varies the order between cases', () => {
    expect(buildBlindPackage(outputs, { seed: 'sessao-1' }).key).toEqual(buildBlindPackage(outputs, { seed: 'sessao-1' }).key);
    const orders = new Set(Object.values(buildBlindPackage(outputs, { seed: 'sessao-1' }).key).map((m) => m.A));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('refuses a case where a candidate did not answer, and duplicates', () => {
    expect(() => buildBlindPackage(outputs.slice(1), { seed: 's' })).toThrow(/every candidate must answer/);
    expect(() => buildBlindPackage([...outputs, outputs[0]], { seed: 's' })).toThrow(/Duplicate/);
    expect(() => buildBlindPackage(outputs, {})).toThrow(/seed/);
  });

  it('never shows a candidate name in the review page, and escapes content', () => {
    const pkg = buildBlindPackage(
      [...outputs.filter((o) => o.caseId !== 'caso-04'), ...candidates.map((candidate) => ({ candidate, caseId: 'caso-04', task: 'evolucao', content: '<script>alert(1)</script>' }))],
      { seed: 's' },
    );
    const html = reviewPage(pkg.items);
    for (const c of candidates) expect(html).not.toContain(c);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    for (const r of RUBRIC) expect(html).toContain(r.label);
  });

  it('writes the review page and the key in separate folders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-eval-'));
    try {
      writeBlindPackage(dir, buildBlindPackage(outputs, { seed: 's' }));
      expect(readdirSync(join(dir, 'review'))).toEqual(['index.html']);
      expect(readdirSync(join(dir, 'key'))).toEqual(['key.json']);
      expect(readFileSync(join(dir, 'review', 'index.html'), 'utf8')).not.toMatch(/provedor-/);
      expect(JSON.parse(readFileSync(join(dir, 'key', 'key.json'), 'utf8')).seed).toBe('s');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('unblind', () => {
  it('turns exported scores into per-candidate means, critical errors and edit time', () => {
    const { key } = buildBlindPackage(outputs, { seed: 'sessao-1' });
    const labelOf = (caseId, candidate) => Object.entries(key[`${caseId}|evolucao`]).find(([, c]) => c === candidate)[0];
    const scores = {};
    for (const caseId of cases) {
      scores[`${caseId}|evolucao|${labelOf(caseId, 'provedor-alfa')}`] = { fidelidade: 5, medicacao: 5, minutos: 1, critico: false };
      scores[`${caseId}|evolucao|${labelOf(caseId, 'provedor-beta')}`] = { fidelidade: 3, medicacao: 2, minutos: 4, critico: caseId === 'caso-02' };
    }
    const r = unblind([{ reviewer: 'Dra. Sintética', scores }], key);
    expect(r['provedor-alfa']).toMatchObject({ reviews: 4, criticalErrors: 0, medianEditMinutes: 1, meanByCriterion: { fidelidade: 5, medicacao: 5, soap: null } });
    expect(r['provedor-beta']).toMatchObject({ reviews: 4, criticalErrors: 1, medianEditMinutes: 4, meanByCriterion: { fidelidade: 3, medicacao: 2 } });
    expect(r['provedor-gama']).toBeUndefined();
    expect(() => unblind([{ scores: { 'caso-99|evolucao|A': {} } }], key)).toThrow(/no entry in the key/);
  });
});
