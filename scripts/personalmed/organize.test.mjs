import { describe, expect, it } from 'vitest';
import { PROFILE_PARTS, PROFILE_SCHEMA, checkDay, cleanProfile, dateKey, dayBatches, groupProcedures, numbersOf, originalBody, profilePartSchema, profilePartSystem, quoteDay, recordSpan, renderDayNote, renderProfile, spanNote, squash, tidyDate, tidyName, verifyProfile } from './organize.mjs';

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
  it('dates a quote found on other days by the record nearest to the date the model gave', () => {
    const many = new Map([['2013-08-27', squash('Mamografia: BI-RADS 2, sem nódulos')], ['2021-05-31', squash('mamografia BI-RADS 2, sem nódulos.')], ['2025-07-11', squash('Mamografia - BI-RADS 2, sem nódulos')]]);
    const { profile: out } = verifyProfile({ exames: [{ exame: 'Mamografia', origem: [{ data: '2021-06-02', trecho: 'BI-RADS 2, sem nódulos' }] }] }, many, [...many.values()].join(''));
    expect(out.exames[0].origem[0].data).toBe('2021-05-31');
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
  describe('the profile', () => {
    const at = (...days) => days.map((data) => ({ data, trecho: 'x' }));
    const profile = {
      resumo: 'Acompanhamento de rotina.',
      problemas: [
        { nome: 'Achado sintético', cid: '', tipo: 'achado', situacao: 'ativo', origem: at('2021-05-31', '2026-06-19') },
        { nome: 'Condição sintética', cid: 'N95.1', tipo: 'condicao', situacao: 'ativo', origem: at('2019-05-10', '2026-08-14') },
        { nome: 'Condição de um registro só', cid: '', tipo: 'condicao', situacao: 'ativo', origem: at('2026-03-02') },
        { nome: 'Evento antigo', cid: '', tipo: 'condicao', situacao: 'resolvido', origem: at('1999-01-21') },
        { nome: 'Cistos sintéticos', cid: 'N83.2', tipo: 'achado', situacao: 'historico', origem: at('2013-04-24', '2023-12-11') },
      ],
      contracepcao: [
        { metodo: 'Pílula sintética', hormonal: true, situacao: 'encerrado', inicio: '', origem: at('2016-05-06') },
        { metodo: 'DIU hormonal sintético', hormonal: true, situacao: 'em uso', inicio: '16/11/21', origem: at('2021-11-16', '2026-06-19') },
      ],
      medicacoes_em_uso: [
        { nome: 'Medicamento sintético', dose: '500 mg', uso: '1 cp ao dia', duracao: 'continuo', origem: at('2025-01-10', '2026-06-19') },
        { nome: 'Óvulo sintético', dose: '', uso: 'por 30 dias', duracao: 'prazo definido', origem: at('2026-08-14') },
      ],
      medicacoes_anteriores: [{ nome: 'Outro sintético', dose: '', periodo: '2019 a 2021', origem: at('2019-05-10') }],
      alergias: [{ substancia: 'Lactose', reacao: '', tipo: 'intolerancia', origem: at('2022-10-21') }, { substancia: 'Dipirona', reacao: 'urticária', tipo: 'alergia', origem: at('2020-01-02') }],
      alergias_negadas: false,
      gestacoes: [
        { ordem: '1', desfecho: 'cesarea', data: '9/7/21', detalhes: 'RN 3085 g', origem: at('2021-07-20') },
        { ordem: '2', desfecho: 'aborto', data: '', detalhes: '', origem: at('2023-02-01') },
      ],
      marcos_ginecologicos: [{ marco: 'menopausa', texto: 'Menopausa aos 50 anos', origem: at('2024-01-05') }],
      cirurgias: [{ nome: 'Colecistectomia', data: '', origem: at('2015-03-03') }, { nome: 'Hérnia de hiato', data: '28/8/18', origem: at('2018-09-21') }],
      antecedentes_familiares: [{ parente: 'Mãe', condicao: 'câncer de mama', origem: at('2010-01-01') }],
      habitos_sociais: [{ texto: 'Não fuma', origem: at('2010-01-01') }],
      exames: [
        { tipo: 'mamografia', exame: 'Mamografia', data: '20/8/13', resultado: 'BI-RADS 2', origem: at('2013-08-27') },
        { tipo: 'mamografia', exame: 'Mamografia', data: '06/2025', resultado: 'BI-RADS 1', origem: at('2025-07-11') },
        { tipo: 'citologia', exame: 'Citologia', data: '', resultado: 'NL', origem: [{ data: 'sem data', trecho: 'x' }] },
        { tipo: 'laboratorio', exame: 'Vitamina D', data: '', resultado: '23', origem: at('2020-10-07') },
      ],
      pendencias: [{ texto: 'Citologia coletada sem resultado registrado', origem: at('2026-08-14') }],
    };
    const out = renderProfile(profile, { organizedOn: '2026-11-14', civilStatus: 'Casado(a)', bloodType: 'B+', lastRecord: '2026-08-14', exportDate: '2026-08-24' });

    it('lists the problems under follow-up, conditions first, each saying since when and its last record', () => {
      expect(out.diagnoses).toEqual([
        { code: 'N95.1', description: 'Condição sintética', note: 'desde 05/2019 · último registro em 14/08/2026' },
        { code: '', description: 'Condição de um registro só', note: 'registro de 02/03/2026' },
        { code: '', description: 'Achado sintético', note: 'achado de exame · desde 05/2021 · último registro em 19/06/2026' },
      ]);
    });
    it('keeps the last record of a medicine apart from its instructions and places a hormonal method in use with the medicines', () => {
      expect(out.medications).toEqual([
        { name: 'Medicamento sintético', dosage: '500 mg', instructions: '1 cp ao dia', note: 'último registro em 19/06/2026' },
        { name: 'Óvulo sintético', dosage: '', instructions: 'por 30 dias', note: 'tratamento com prazo · último registro em 14/08/2026' },
        { name: 'DIU hormonal sintético', dosage: '', instructions: 'método contraceptivo em uso', note: 'início ou troca em 16/11/2021 · último registro em 19/06/2026' },
      ]);
    });
    it('says which entries are an intolerance', () => {
      expect(out.allergies).toEqual(['Lactose (intolerância)', 'Dipirona (urticária)']);
    });
    it('writes the history as headed groups, newest first, with dates in one format', () => {
      expect(out.medical_history.split('\n')).toEqual([
        'Tipo sanguíneo: B+ (cadastro do PersonalMed)',
        'Ginecológico:',
        '- Contracepção em uso: DIU hormonal sintético, início ou troca em 16/11/2021 (último registro em 19/06/2026)',
        '- Menopausa aos 50 anos',
        '- Métodos anteriores: Pílula sintética (2016)',
        'Obstétrico (2 gestações registradas no prontuário antigo):',
        '- 1ª gestação: cesárea em 09/07/2021; RN 3085 g',
        '- 2ª gestação: aborto (registro de 01/02/2023)',
        'Cirurgias e procedimentos:',
        '- 28/08/2018: Hérnia de hiato',
        '- registro de 03/03/2015: Colecistectomia',
        'Últimos exames de rastreamento:',
        '- Citologia (preventivo), sem data: NL',
        '- Mamografia, 06/2025: BI-RADS 1',
        'Antecedentes familiares:',
        '- Mãe: câncer de mama',
        'Problemas anteriores ou sem registro recente:',
        '- 2013 a 2023: Cistos sintéticos (N83.2)',
        '- 1999: Evento antigo',
        'Origem: perfil organizado por IA em 14/11/2026 a partir do prontuário antigo (PersonalMed); os itens e os trechos de origem estão na nota "Resumo do histórico importado", no histórico.',
      ]);
      expect(out.social_anamnesis).toBe('Estado civil: Casado(a) (cadastro do PersonalMed)\nNão fuma');
    });
    it('puts every exam, by kind, and the source of each item in the summary note', () => {
      expect(out.summaryNote).toContain('### Exames: Mamografia\n\n- 06/2025: BI-RADS 1 (registro de 11/07/2025)\n- 20/08/2013: BI-RADS 2 (registro de 27/08/2013)');
      expect(out.summaryNote).toContain('### Exames: Laboratório\n\n- Vitamina D, registro de 07/10/2020: 23 (registro de 07/10/2020)');
      expect(out.summaryNote).toContain('### Problemas em acompanhamento\n\n- Condição sintética (N95.1) (registros de 10/05/2019, 14/08/2026)\n- Condição de um registro só (registro de 02/03/2026)\n- Achado sintético [achado de exame] (registros de 31/05/2021, 19/06/2026)');
      expect(out.summaryNote).toContain('- Óvulo sintético · por 30 dias [tratamento com prazo] (registro de 14/08/2026)');
      expect(out.summaryNote).toContain('- Em uso: DIU hormonal sintético, início ou troca em 16/11/2021 (registros de 16/11/2021, 19/06/2026)');
      expect(out.tasks).toEqual([{ title: 'Citologia coletada sem resultado registrado (registro de 14/08/2026)', content: expect.stringContaining('Confira antes de agir') }]);
    });
    it('holds "under follow-up" to the records: inside the window, and more than one record unless recent', () => {
      const at2 = (...days) => days.map((data) => ({ data, trecho: 'x' }));
      const problem = (nome, ...days) => ({ nome, cid: '', tipo: 'condicao', situacao: 'ativo', origem: at2(...days) });
      const held = renderProfile(
        {
          ...profile,
          problemas: [
            problem('Seguida há anos', '2015-01-10', '2025-02-01'),
            problem('Um registro recente', '2026-01-20'),
            problem('Um registro antigo', '2025-03-01'),
            problem('Sem registro há três anos', '2019-01-01', '2023-05-05'),
            // Pages without date: a line that starts with its own date is dated by it.
            { ...problem('Anotada em página sem data'), origem: [{ data: 'sem data', trecho: '14/08/26 laser facial para a condição sintética' }] },
            { ...problem('Antecedente do cadastro'), origem: [{ data: 'sem data', trecho: 'Antecedentes: condição sintética' }] },
            { ...problem('Achado sem data'), tipo: 'achado', origem: [{ data: 'sem data', trecho: 'achado sintético em exame' }] },
          ],
        },
        { organizedOn: '2026-11-14', lastRecord: '2026-08-14', exportDate: '2026-08-24' },
      );
      expect(held.diagnoses).toEqual([
        { code: '', description: 'Anotada em página sem data', note: 'registro de 14/08/2026' },
        { code: '', description: 'Um registro recente', note: 'registro de 20/01/2026' },
        { code: '', description: 'Seguida há anos', note: 'desde 01/2015 · último registro em 01/02/2025' },
        { code: '', description: 'Antecedente do cadastro', note: 'página sem data do prontuário antigo' },
      ]);
      expect(held.medical_history).toContain('Problemas anteriores ou sem registro recente:\n- 2025: Um registro antigo\n- 2019 a 2023: Sem registro há três anos\n- sem data: Achado sem data');
      expect(held.summaryNote).toContain('- Anotada em página sem data (página sem data, anotação de 14/08/2026)');
    });
    it('does not presume in use the medicines of a patient last seen long before the export', () => {
      const old = renderProfile(profile, { organizedOn: '2026-11-14', lastRecord: '2023-10-23', exportDate: '2026-08-24' });
      // The hormonal method stays: it is said to be in use by its own last record.
      expect(old.medications.map((m) => m.name)).toEqual(['DIU hormonal sintético']);
      expect(old.medical_history).toContain('Medicações no último acompanhamento (23/10/2023):\n- Medicamento sintético · 500 mg · 1 cp ao dia\n- Óvulo sintético · por 30 dias');
      expect(old.summaryNote).toContain('### Medicações no último acompanhamento (23/10/2023)');
    });
    it('says that she denies allergies only when none is written', () => {
      const none = renderProfile({ ...profile, alergias: [], alergias_negadas: true }, { organizedOn: '2026-11-14' });
      expect(none.medical_history.split('\n')[0]).toBe('Alergias: nega, segundo o histórico');
      expect(none.allergies).toEqual([]);
    });
  });
  it('takes what is not a problem out of the problem list and a repeated caesarean out of the surgeries', () => {
    const cleaned = cleanProfile({
      problemas: [{ nome: 'Uso de DIU Mirena' }, { nome: 'Reposição de ferro e vitamina B12' }, { nome: 'Osteopenia' }, { nome: '  ' }],
      contracepcao: [{ metodo: '' }, { metodo: 'DIU' }],
      gestacoes: [{ desfecho: 'cesarea' }],
      cirurgias: [{ nome: 'Cesárea' }, { nome: 'Cesáreas' }, { nome: 'Cesárea com laqueadura' }, { nome: 'Laqueadura' }],
      alergias: [{ substancia: 'Lactose', reacao: 'Intolerância', tipo: 'intolerancia' }],
    });
    expect(cleaned.problemas.map((p) => p.nome)).toEqual(['Osteopenia']);
    expect(cleaned.contracepcao).toEqual([{ metodo: 'DIU' }]);
    expect(cleaned.cirurgias.map((c) => c.nome)).toEqual(['Cesárea com laqueadura', 'Laqueadura']);
    expect(cleaned.alergias[0].reacao).toBe('');
    // Without a caesarean among the pregnancies, the surgery is the only place that says it.
    expect(cleanProfile({ gestacoes: [], cirurgias: [{ nome: 'Cesárea' }] }).cirurgias).toHaveLength(1);
  });
  it('writes dates in one format and orders by them', () => {
    expect(tidyDate('5/3/19')).toBe('05/03/2019');
    expect(tidyDate('28/8/98')).toBe('28/08/1998');
    expect(tidyDate('3/2019')).toBe('03/2019');
    expect(tidyDate('maio de 2020')).toBe('maio de 2020');
    expect(dateKey('5/3/19')).toBe('2019-03-05');
    expect(dateKey('06/2025')).toBe('2025-06');
    expect(dateKey('maio de 2020')).toBe('2020');
    expect(dateKey('na infância')).toBeNull();
  });
  it('writes a procedure done several times as one line with its first and last day', () => {
    const at3 = (data) => [{ data, trecho: 'x' }];
    const groups = groupProcedures([
      { nome: 'Laser vaginal', data: '', origem: at3('2022-11-11') },
      { nome: 'Plástica sintética', data: '13/7/24', origem: at3('2024-07-13') },
      { nome: 'laser vaginal', data: '14/08/2026', origem: at3('2026-08-14') },
      { nome: 'Laser vaginal', data: '', origem: at3('2024-09-13') },
    ]);
    expect(groups.map((g) => g.line)).toEqual(['11/11/2022 a 14/08/2026: laser vaginal (3 vezes)', '13/07/2024: Plástica sintética']);
    expect(groups[0].items).toHaveLength(3);
  });
  it('writes a name typed in one case as a name, and leaves the rest alone', () => {
    expect(tidyName('MIRENA')).toBe('Mirena');
    expect(tidyName('cerazette')).toBe('Cerazette');
    expect(tidyName('ANEL VAGINAL')).toBe('Anel vaginal');
    expect(tidyName('DIU T CU')).toBe('DIU T CU');
    expect(tidyName('DIU MIRENA')).toBe('DIU MIRENA');
    expect(tidyName('DIU Mirena')).toBe('DIU Mirena');
    expect(tidyName('DIU')).toBe('DIU');
  });
  it('reads the date a line of an undated page starts with, as a day or as a month', () => {
    expect(quoteDay({ data: '2021-05-31', trecho: '14/08/26 qualquer' })).toBe('2021-05-31');
    expect(quoteDay({ data: 'sem data', trecho: '14/08/26 LASER FACIAL' })).toBe('2026-08-14');
    expect(quoteDay({ data: 'sem data', trecho: ' 2/2/1998: cirurgia' })).toBe('1998-02-02');
    expect(quoteDay({ data: 'sem data', trecho: '06/2022 = hemangiomas 12 mm' })).toBe('2022-06');
    // Not a date: a blood pressure, a dose, a month that does not exist.
    expect(quoteDay({ data: 'sem data', trecho: '120/80 mmHg' })).toBeNull();
    expect(quoteDay({ data: 'sem data', trecho: '45/13/2020 valor' })).toBeNull();
    expect(quoteDay({ data: 'sem data', trecho: 'Antecedentes: 14/08/26' })).toBeNull();
    expect(recordSpan({ origem: [{ data: 'sem data', trecho: '06/2022 = achado' }, { data: 'sem data', trecho: '08/2023= idem' }] })).toEqual({ first: '2022-06', last: '2023-08' });
    expect(spanNote({ origem: [{ data: 'sem data', trecho: '06/2022 = achado' }, { data: 'sem data', trecho: '08/2023= idem' }] })).toBe('desde 06/2022 · último registro em 08/2023');
  });
  it('places an item by its record when the written date says no year', () => {
    const [group] = groupProcedures([{ nome: 'Retirada de cálculo', data: 'MÊS DE MAIO', origem: [{ data: '2020-06-15', trecho: 'x' }] }]);
    expect(group.line).toBe('registro de 15/06/2020: Retirada de cálculo (mês de maio)');
  });
  it('asks a long chart in two parts that together are the whole profile', () => {
    expect(PROFILE_PARTS.flat().sort()).toEqual([...PROFILE_SCHEMA.required].sort());
    const [first, tails] = PROFILE_PARTS.map(profilePartSchema);
    expect(tails.required).toEqual(['medicacoes_anteriores', 'exames']);
    expect(first.properties.problemas).toBe(PROFILE_SCHEMA.properties.problemas);
    expect(Object.keys(first.properties)).not.toContain('exames');
    expect(profilePartSystem('2026-08-14', tails.required)).toMatch(/Nesta chamada, devolva somente estes campos: "medicacoes_anteriores", "exames"\.$/);
  });
  it('dates an item by the records it quotes', () => {
    expect(recordSpan({ origem: [{ data: '2021-05-31' }, { data: 'sem data' }, { data: '2019-01-02' }] })).toEqual({ first: '2019-01-02', last: '2021-05-31' });
    expect(spanNote({ origem: [{ data: 'sem data' }] })).toBe('página sem data do prontuário antigo');
    expect(spanNote({ origem: [] })).toBe('');
  });
  it('batches days by size', () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, text: 'x'.repeat(1000) }));
    const batches = dayBatches(days, { maxChars: 9000, maxDays: 14 });
    expect(batches.flat()).toHaveLength(30);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(9);
  });
});
