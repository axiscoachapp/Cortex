import { describe, expect, it } from 'vitest';
import { applyPresentation, parsePresentation, presentationOptions, registration9Of } from './cmedPresentation';

// Texts in the format of the CMED list (Anvisa, public data); none of them is
// printed on a prescription.
describe('CMED presentation text', () => {
  it.each([
    ['40 MG COM REV CT BL AL AL X 14', '40 mg', 'comprimido revestido', 'comprimidos', 'comprimido'],
    ['16MG COM CT BL AL AL X 30', '16 mg', 'comprimido', 'comprimidos', 'comprimido'],
    ['10 MG COM SUBL CT BL AL AL X 7', '10 mg', 'comprimido sublingual', 'comprimidos', 'comprimido'],
    ['300 MG COM REV LIB PROL CT BL AL PLAS PVC OPC X 30', '300 mg', 'comprimido revestido de liberação prolongada', 'comprimidos', 'comprimido'],
    ['100 MG CAP DURA CT BL AL PLAS PVC/PCTFE OPC X 56', '100 mg', 'cápsula', 'cápsulas', 'cápsula'],
    ['3 MG + 0,03 MG COM REV CT BL AL PLAS TRANS X 84', '3 mg + 0,03 mg', 'comprimido revestido', 'comprimidos', 'comprimido'],
    ['(600 + 70 + 100) MG COM CT BL AL PLAS PVC AMB X 80', '(600 + 70 + 100) mg', 'comprimido', 'comprimidos', 'comprimido'],
    ['50000 UI COM REV CT BL AL AL X 60', '50000 UI', 'comprimido revestido', 'comprimidos', 'comprimido'],
    ['2,5 MG/ML SOL OR CT FR GOT VD AMB X 20 ML', '2,5 mg/mL', 'solução oral', 'frascos', null],
    ['50 MG/G CREM DERM CT BG AL X 10 G', '50 mg/g', 'creme', 'bisnagas', null],
    ['28,2 MG/G + 52,6 MG/G + 13,3 MG/G POM CT PT PLAS OPC X 30 G', '28,2 mg/g + 52,6 mg/g + 13,3 mg/g', 'pomada', 'potes', null],
    ['120 MG/2,4 ML SOL INJ CT FA VD TRANS X 2,4 ML', '120 mg/2,4 mL', 'solução injetável', 'frascos-ampola', null],
    ['20 MG/ML SOL INJ IV/IM CX 100 AMP VD TRANS X 5 ML', '20 mg/mL', 'solução injetável', 'ampolas', null],
    ['7,5 MG/ML + 9,1 MCG / ML SOL INJ CX 10 EST FA VD TRANS X 20 ML', '7,5 mg/mL + 9,1 mcg/mL', 'solução injetável', 'frascos-ampola', null],
    ['5.000.000 UI PO INJ CX 50 FA', '5.000.000 UI', 'pó injetável', 'frascos-ampola', null],
    ['10 MG/G GEL CT BG AL X 50 G', '10 mg/g', 'gel', 'bisnagas', null],
    // Spelling variants found in the official file.
    ['1 G PÓ  SOL INJ CX FA VD TRANS X 50', '1 g', 'pó para solução injetável', 'frascos-ampola', null],
    ['150 MG/ML SUSP INJ CT FA VD INC X 1 ML', '150 mg/mL', 'suspensão injetável', 'frascos-ampola', null],
    ['1 MG/G CR DERM CX 50 BG AL X 10 G', '1 mg/g', 'creme', 'bisnagas', null],
    ['20 MG COMP REV CT BL AL X 30', '20 mg', 'comprimido revestido', 'comprimidos', 'comprimido'],
    ['1 MG/G EMU DERM CT BG AL X 20 G', '1 mg/g', 'emulsão', 'bisnagas', null],
    ['32 MCG SUS SPR NAS CT FR VD AMB X 120 ACION', '32 mcg', 'spray nasal', 'frascos', null],
    ['0,3 MG/ML SOL GOT OFT CT FR GOT PLAS PEBD OPC X 3 ML', '0,3 mg/mL', 'solução oftálmica', 'frascos', null],
    ['0,5 MEQ/ML (54 MG/ML) SOL INJ IV CX 50 AMP VD TRANS X 5 ML', '0,5 mEq/mL (54 mg/mL)', 'solução injetável', 'ampolas', null],
    ['2 MG GOMA MAST CT BL AL PLAS X 30', '2 mg', 'goma de mascar', 'gomas', 'goma'],
    // The product's own container comes first; a diluent listed after it does not count.
    ['3.000 UI PO LIOF SOL INJ CT FA VD TRANS + AMP DIL X 2 ML', '3.000 UI', 'pó liofilizado para solução injetável', 'frascos-ampola', null],
    ['12,5 MG/ML SOL INJ SC CT CAR VD TRANS X 2,4 ML + CAN APLIC', '12,5 mg/mL', 'solução injetável', 'carpules', null],
    ['25,0 MG COM CT BL AL AL X 30', '25 mg', 'comprimido', 'comprimidos', 'comprimido'],
  ])('%s', (text, strength, form, unit, doseUnit) => {
    expect(parsePresentation(text)).toEqual({ strength, form, unit, doseUnit });
  });

  it('leaves out what it cannot read with confidence', () => {
    expect(parsePresentation('SUS OR CT SER PREENC VD TRANS X 1,5 ML')).toBeNull(); // no strength
    expect(parsePresentation('XPE CT FR PLAS OPC X 150 ML + CP MED')).toBeNull();
    expect(parsePresentation('30 MG CAP DURA LIB RETARD + 500 MG COM REV + 500 MG CAP DURA CT BL AL PLAS TRANS X 28')).toBeNull(); // kit
    expect(parsePresentation('50 MG XYZ CT X 10')).toBeNull(); // unknown form
    expect(parsePresentation('')).toBeNull();
    expect(parsePresentation(null)).toBeNull();
  });
});

describe('presentation options for one product', () => {
  const rows = [
    { presentation: '50 MG COM CT BL AL PLAS TRANS X 30', hospital_only: false },
    { presentation: '50 MG COM CT BL AL PLAS TRANS X 60', hospital_only: false }, // same strength and form
    { presentation: '100 MG COM CT BL AL PLAS TRANS X 30', hospital_only: false },
    { presentation: '25 MG COM CT BL AL PLAS TRANS X 30', hospital_only: false },
    { presentation: '25 MG COM CT BL AL PLAS TRANS X 500', hospital_only: true },
    { presentation: 'XPE CT FR X 100 ML', hospital_only: false },
  ];
  it('groups by strength and form, in numeric order, without hospital-only or unreadable rows', () => {
    expect(presentationOptions(rows).map((o) => o.label)).toEqual(['25 mg · comprimido', '50 mg · comprimido', '100 mg · comprimido']);
  });

  it('reads the 9-digit Anvisa registration from either catalog', () => {
    expect(registration9Of('1.0043.0066')).toBe('100430066');
    expect(registration9Of('1004300660015')).toBe('100430066');
    expect(registration9Of('12345')).toBeNull();
    expect(registration9Of(null)).toBeNull();
  });
});

describe('applying a presentation to a prescription item', () => {
  const option = presentationOptions([{ presentation: '50 MG COM REV CT BL AL X 30', hospital_only: false }])[0];
  const other = presentationOptions([{ presentation: '100 MG COM REV CT BL AL X 30', hospital_only: false }])[0];

  it('adds the strength to the name and fills the empty strength and unit fields', () => {
    expect(applyPresentation({ name: 'Losartana Potássica' }, option)).toEqual({
      name: 'Losartana Potássica 50 mg', baseName: 'Losartana Potássica', presentationKey: option.key,
      concentration: '50 mg', unit: 'comprimidos', doseUnit: 'comprimido',
    });
  });

  it('switching presentation replaces only what the previous one filled', () => {
    const first = applyPresentation({ name: 'Losartana Potássica' }, option);
    expect(applyPresentation(first, other)).toMatchObject({ name: 'Losartana Potássica 100 mg', concentration: '100 mg', unit: 'comprimidos' });
    // What the doctor typed is kept.
    const typed = { ...first, concentration: '50mg (meio comprimido)', unit: 'unidades' };
    expect(applyPresentation(typed, other)).toMatchObject({ concentration: '50mg (meio comprimido)', unit: 'unidades' });
  });

  it('never writes the strength twice in the name', () => {
    expect(applyPresentation({ name: 'Clonazepam 2 mg' }, option).name).toBe('Clonazepam 2 mg');
  });

  it('clearing the choice restores the name and the fields it filled', () => {
    const first = applyPresentation({ name: 'Losartana Potássica' }, option);
    expect(applyPresentation(first, null)).toEqual({
      name: 'Losartana Potássica', baseName: undefined, presentationKey: undefined, concentration: '', unit: '', doseUnit: undefined,
    });
  });
});
