import { describe, expect, it } from 'vitest';
import { checkDay, cleanProfile, dayBatches, numbersOf, originalBody, renderDayNote, renderProfile, squash, verifyProfile } from './organize.mjs';

// Invented chart text only.
const source = '### Evolução\n\nPA 120/80, peso 58,5 kg. Refere cefaleia há 3 dias.\n\n### Documentos emitidos\n\n**Receita**\n\nMEDICAMENTO SINTÉTICO 500 mg ___ 1 cx\nTomar 1 cp de 8/8h por 5 dias';

describe('an organised day is checked against its source', () => {
  it('accepts a note that only reuses the numbers of the source', () => {
    const check = checkDay({ titulo: 'Cefaleia; receita', s: 'Cefaleia há 3 dias.', o: 'PA 120/80. Peso 58,5 kg.', a: '', p: 'Medicamento sintético 500 mg, 1 cp de 8/8h por 5 dias.' }, source);
    expect(check.ok).toBe(true);
    // Section headings and routine words of the source do not have to come back in the note.
    expect(check.coverage).toBeGreaterThan(0.3);
  });
  it('flags a number that is not in the source, however it is written', () => {
    expect(checkDay({ titulo: '', s: '', o: 'PA 130/80.', a: '', p: '' }, source)).toMatchObject({ ok: false, newNumbers: ['130'] });
    expect(checkDay({ titulo: '', s: '', o: '', a: '', p: 'por 7 dias' }, source).newNumbers).toEqual(['7']);
    // The same digits with another separator are still the source's number.
    expect(checkDay({ titulo: '', s: '', o: 'Peso 58.5 kg', a: '', p: '' }, source).ok).toBe(true);
  });
  it('reads numbers as typed', () => {
    expect(numbersOf('HB 11,9 e 147.000 plaquetas em 03/2021')).toEqual(['11,9', '147.000', '3', '2021']);
  });
});

describe('profile items must quote the chart', () => {
  const sources = new Map([['2024-05-23', squash('Tipo sanguíneo da paciente: B+. GBS: NEGATIVO. ALERGIA: NEGA')], ['sem data', squash('CITOLOGIA ONCÓTICA 05/2019 = NL')]]);
  const all = [...sources.values()].join('');
  const profile = {
    resumo: 'x',
    exames: [
      { exame: 'GBS', data: '', resultado: 'negativo', origem: [{ data: '2024-05-23', trecho: 'GBS : NEGATIVO' }] },
      { exame: 'Citologia', data: '05/2019', resultado: 'NL', origem: [{ data: '2024-05-23', trecho: 'CITOLOGIA ONCÓTICA 05/2019 = NL' }] },
      { exame: 'Mamografia', data: '2023', resultado: 'BI-RADS 2', origem: [{ data: '2024-05-23', trecho: 'mamografia de 2023 BI-RADS 2' }] },
      { exame: 'Sem origem', data: '', resultado: '', origem: [] },
    ],
    alergias: [],
  };
  it('keeps a quote that exists, fixes the date of one found elsewhere, drops what is not in the chart', () => {
    const { profile: out, report } = verifyProfile(profile, sources, all);
    expect(out.exames.map((e) => e.exame)).toEqual(['GBS', 'Citologia']);
    expect(out.exames[1].origem[0].data).toBe('sem data');
    expect(report).toMatchObject({ kept: 2, dropped: 2, dateFixed: 1 });
  });
  it('drops an allergy without a named substance and an empty reaction text', () => {
    const cleaned = cleanProfile({ alergias: [{ substancia: 'Não identificada', reacao: 'Não informada', origem: [] }, { substancia: 'Dipirona', reacao: 'não especificada', origem: [] }] });
    expect(cleaned.alergias).toEqual([{ substancia: 'Dipirona', reacao: '', origem: [] }]);
  });
});

describe('what is written to the chart', () => {
  const stamp = '[Importado do PersonalMed em 2026-11-13 · registro de Médica A]';
  it('keeps the complete original under the organised note', () => {
    const text = renderDayNote({ stamp, note: { s: 'Cefaleia.', o: 'PA 120/80.', a: '', p: 'Receita.' }, original: source, checked: true });
    expect(text.startsWith(stamp)).toBe(true);
    expect(text).toContain('**S (Subjetivo):** Cefaleia.');
    expect(text).not.toContain('**A (Avaliação):**');
    expect(text.endsWith(source)).toBe(true);
  });
  it('falls back to the original alone when the note is not trusted or has a single section', () => {
    expect(renderDayNote({ stamp, note: { s: 'Cefaleia.', o: 'PA 120/80.', a: '', p: '' }, original: source, checked: false })).toBe(`${stamp}\n\n${source}`);
    expect(renderDayNote({ stamp, note: { s: '', o: 'PA 120/80.', a: '', p: '' }, original: source, checked: true })).toBe(`${stamp}\n\n${source}`);
  });
  it('strips only the import stamp from a converted note', () => {
    expect(originalBody('[Importado do PersonalMed em 2026-11-13]\n\n### Evolução\n\ntexto')).toBe('### Evolução\n\ntexto');
  });
  it('puts short lasting facts in the profile, the long lists in the summary note and open items in tasks', () => {
    const o = [{ data: '2024-05-23', trecho: 'x' }];
    const out = renderProfile({
      resumo: 'Acompanhamento de rotina.',
      problemas: [{ nome: 'Condição sintética', cid: 'N95.1', situacao: 'ativo', desde: '05/2019', origem: o }, { nome: 'Evento antigo', cid: '', situacao: 'resolvido', desde: '', origem: o }],
      medicacoes_em_uso: [{ nome: 'Medicamento sintético', dose: '500 mg', uso: '1 cp ao dia', ultima_prescricao: '2026-06-19', origem: o }],
      medicacoes_anteriores: [{ nome: 'Outro sintético', dose: '', periodo: '2019 a 2021', origem: o }],
      alergias: [], alergias_negadas: true,
      obstetrico: [{ evento: 'Cesárea', data: '09/07/21', origem: o }], cirurgias: [], antecedentes_familiares: [], habitos_sociais: [{ texto: 'Não fuma', origem: o }],
      exames: [{ exame: 'Citologia', data: '05/2019', resultado: 'NL', origem: [{ data: 'sem data', trecho: 'x' }] }],
      pendencias: [{ texto: 'Citologia coletada sem resultado registrado', origem: o }],
    }, { organizedOn: '2026-11-13', civilStatus: 'Casado(a)', bloodType: 'B+' });
    expect(out.diagnoses).toEqual([{ code: 'N95.1', description: 'Condição sintética' }]);
    expect(out.medications).toEqual([{ name: 'Medicamento sintético', dosage: '500 mg', instructions: '1 cp ao dia', startedAt: '2026-06-19' }]);
    expect(out.allergies).toEqual([]);
    // One fact per line, no markdown: the app shows each line as an item.
    expect(out.medical_history.split('\n')).toEqual(expect.arrayContaining(['Tipo sanguíneo: B+ (cadastro do PersonalMed)', 'Obstétrico: Cesárea (09/07/21)', 'Problema anterior: Evento antigo', 'Alergias: nega, segundo o histórico']));
    expect(out.medical_history).not.toMatch(/^#|^- /m);
    expect(out.social_anamnesis).toBe('Estado civil: Casado(a) (cadastro do PersonalMed)\nNão fuma');
    expect(out.summaryNote).toContain('### Exames e rastreamentos\n\n- Citologia (05/2019): NL (página sem data)');
    expect(out.summaryNote).toContain('- Medicamento sintético · 500 mg · 1 cp ao dia (registro de 23/05/2024)');
    expect(out.tasks).toEqual([{ title: 'Citologia coletada sem resultado registrado', content: expect.stringContaining('Confira antes de agir') }]);
  });
  it('batches days by size', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, text: 'x'.repeat(1000) }));
    const batches = dayBatches(days, { maxChars: 9000, maxDays: 14 });
    expect(batches.flat()).toHaveLength(30);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(9);
  });
});
