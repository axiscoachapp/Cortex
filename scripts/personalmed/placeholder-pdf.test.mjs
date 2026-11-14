import { describe, expect, it } from 'vitest';
import { textPdf, wrap } from './placeholder-pdf.mjs';

describe('placeholder PDF', () => {
  it('breaks a paragraph at spaces, never past the column', () => {
    const lines = wrap('um dois três quatro cinco seis', 10);
    expect(lines).toEqual(['um dois', 'três', 'quatro', 'cinco seis']);
    expect(wrap('   ')).toEqual([]);
  });
  it('writes a file whose cross-reference table points at every object', () => {
    const pdf = textPdf('Imagem não incluída (teste)', ['Primeiro parágrafo com acentuação: ção, é, à.', 'Segundo — com travessão e \\ barra.']);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
    expect(text.slice(start, start + 5)).toBe('xref\n');
    const entries = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(6);
    entries.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // The stream length is the real one.
    const length = Number(/\/Length (\d+)/.exec(text)[1]);
    const from = text.indexOf('stream\n') + 'stream\n'.length;
    expect(text.slice(from + length, from + length + '\nendstream'.length)).toBe('\nendstream');
  });
  it('keeps accents as single Latin-1 bytes and escapes what would break a PDF string', () => {
    const text = textPdf('Título (1)', ['ção — fim \\ ok']).toString('latin1');
    expect(text).toContain('(T\xedtulo \\(1\\)) Tj');
    expect(text).toContain("(\xe7\xe3o - fim \\\\ ok) '");
  });
});
