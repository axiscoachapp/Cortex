import { describe, expect, it, vi } from 'vitest';
import { callGemini, parseModelJson, parseModelObject } from '../../supabase/functions/_shared/gemini';
import { mergeMedications } from './medicationMerge';
import { createPaginatedWriter, wrapMeasuredText, validateDocumentCounts } from '../../supabase/functions/_shared/documentLayout';

describe('clinical generation boundaries', () => {
  it('rejects truncated, blocked and empty model responses', async () => {
    for (const response of [
      { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] },
      { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] },
      { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '' }] } }] },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }));
      await expect(callGemini('test', [])).rejects.toThrow();
    }
    vi.unstubAllGlobals();
  });
  it('joins all non-thinking text parts after a complete response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thought', thought: true }, { text: 'first ' }, { text: 'second' }] } }] }) }));
    await expect(callGemini('test', [])).resolves.toMatchObject({ text: 'first second' });
    vi.unstubAllGlobals();
  });
  it('does not accept JSON primitives/arrays as a clinical object', () => {
    for (const input of ['[]', 'null', '"text"', '7']) expect(parseModelJson(input)).toBeNull();
  });
  it('requires the full response contract including array element types', () => {
    const schema = { type: 'object', required: ['soap', 'alerts'], properties: { soap: { type: 'string' }, alerts: { type: 'array', items: { type: 'string' } } } };
    expect(() => parseModelObject('{"soap":"draft"}', schema)).toThrow();
    expect(() => parseModelObject('{"soap":"draft","alerts":[1]}', schema)).toThrow();
    expect(parseModelObject('{"soap":"draft","alerts":[]}', schema)).toEqual({ soap: 'draft', alerts: [] });
  });
});

describe('medication reconciliation', () => {
  it('applies a reviewed dose change while retaining start date and other medications', () => {
    const old = [{ name: 'Losartana', dosage: '50 mg', instructions: '1x/dia', startedAt: '2026-01-01' }, { name: 'Metformina', dosage: '500 mg', instructions: '2x/dia' }];
    expect(mergeMedications(old, [{ name: 'losartana', dosage: '100 mg', instructions: '1x/dia' }])).toEqual([{ ...old[0], name: 'losartana', dosage: '100 mg' }, old[1]]);
    expect(old[0].dosage).toBe('50 mg');
  });
  it('deduplicates newly repeated suggestions', () => {
    const med = { name: 'Losartana', dosage: '50 mg', instructions: '1x/dia' };
    expect(mergeMedications([], [med, med])).toHaveLength(1);
  });
});

describe('clinical PDF completeness', () => {
  it('wraps long words and measures proportional text widths', () => {
    const measure = (s: string) => [...s].reduce((n, c) => n + (c === 'W' ? 10 : 2), 0);
    const lines = wrapMeasuredText('WWW abc aaaaaaaaaaaaaaaaaaaaaaaaa', 20, measure);
    expect(lines.every(line => measure(line) <= 20)).toBe(true);
    expect(lines.join('').replace(/\s/g, '')).toBe('WWWabcaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
  it('adds pages before any body line touches the reserved footer', () => {
    const positions: Array<{ text: string; y: number }> = [];
    const font = { widthOfTextAtSize: (text: string) => text.length * 6 };
    let pages = 1;
    const writer = createPaginatedWriter({ page: 1, width: 595, top: 785, bottom: 190, margin: 56,
      regular: font, bold: font, ink: 'black', continuation: 'Paciente A', addPage: () => ++pages,
      draw: (_page, text, options) => positions.push({ text, y: options.y }) });
    for (let i = 0; i < 65; i++) { writer.text(`dose ${i}`); writer.down(15); }
    expect(pages).toBeGreaterThan(1);
    expect(positions.filter(row => row.text.startsWith('dose'))).toHaveLength(65);
    expect(positions.every(row => row.y >= 190)).toBe(true);
  });
  it('rejects selections that would otherwise be silently clipped', () => {
    expect(() => validateDocumentCounts('receita_simples', 16, 0)).toThrow();
    expect(() => validateDocumentCounts('solicitacao_exames', 0, 21)).toThrow();
    expect(() => validateDocumentCounts('receita_simples', 15, 0)).not.toThrow();
  });
});
