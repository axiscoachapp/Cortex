import { describe, expect, it } from 'vitest';
import { parseProfileText, profileTextItems } from './profileText';

describe('profile text groups', () => {
  it('reads text written before groups existed as loose facts, with or without dashes', () => {
    expect(parseProfileText('Cesárea em 2015\n- Nega tabagismo\n\n• Asma na infância')).toEqual([
      { heading: null, items: ['Cesárea em 2015', 'Nega tabagismo', 'Asma na infância'] },
    ]);
    expect(parseProfileText('')).toEqual([]);
    expect(parseProfileText(null)).toEqual([]);
  });
  it('splits one long legacy paragraph into sentences', () => {
    const prose =
      'Paciente sintética com histórico de cesárea em 2015 sem intercorrências registradas no prontuário. Nega tabagismo e etilismo.';
    expect(parseProfileText(prose)).toEqual([
      {
        heading: null,
        items: [
          'Paciente sintética com histórico de cesárea em 2015 sem intercorrências registradas no prontuário.',
          'Nega tabagismo e etilismo.',
        ],
      },
    ]);
  });
  it('groups the dashed lines that follow a heading', () => {
    const text = [
      'Tipo sanguíneo: O+',
      'Cirurgias:',
      '- 2018: hérnia de hiato',
      '- 2024: colecistectomia',
      'Obstétrico (2 gestações registradas):',
      '- 1ª: cesárea em 09/07/2021',
    ].join('\n');
    expect(parseProfileText(text)).toEqual([
      { heading: null, items: ['Tipo sanguíneo: O+'] },
      { heading: 'Cirurgias', items: ['2018: hérnia de hiato', '2024: colecistectomia'] },
      { heading: 'Obstétrico (2 gestações registradas)', items: ['1ª: cesárea em 09/07/2021'] },
    ]);
  });
  it('keeps a line added later out of the last group', () => {
    const text = 'Cirurgias:\n- 2018: hérnia de hiato\n[Consulta 1 — revisão médica] - Histerectomia em 2026\n- Segunda linha da mesma revisão';
    expect(parseProfileText(text)).toEqual([
      { heading: 'Cirurgias', items: ['2018: hérnia de hiato'] },
      { heading: null, items: ['[Consulta 1 — revisão médica] - Histerectomia em 2026', 'Segunda linha da mesma revisão'] },
    ]);
  });
  it('does not take a fact that ends with a colon for a heading', () => {
    // No dashed line follows, so it is a fact like any other.
    expect(parseProfileText('Alergias:\nNega alergias')).toEqual([{ heading: null, items: ['Alergias:', 'Nega alergias'] }]);
    expect(parseProfileText('- Em uso:\n- DIU')).toEqual([{ heading: null, items: ['Em uso:', 'DIU'] }]);
  });
  it('lists every fact without the headings', () => {
    expect(profileTextItems('Cirurgias:\n- A\n- B\nSolta')).toEqual(['A', 'B', 'Solta']);
  });
});
