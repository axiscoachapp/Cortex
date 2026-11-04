import { describe, expect, it } from 'vitest';
import {
  antimicrobialsIn,
  controlledFindings,
  controlledSubstancesIn,
  formulaError,
  formulaLines,
  formulaSubstances,
  toWinAnsi,
} from '../../supabase/functions/_shared/regulatedMedications';

describe('regulated medication safety net', () => {
  it('flags controlled substances regardless of accents, case and strength text', () => {
    expect(controlledSubstancesIn('Clonazepam 2 mg')).toEqual(['clonazepam']);
    expect(controlledSubstancesIn('CIPIONATO DE TESTOSTERONA 200mg/ml')).toEqual(['testosterona']);
    expect(controlledSubstancesIn('Ácido Valproico 500 mg')).toContain('acido valproico');
    expect(controlledSubstancesIn('Isotretinoína 20 mg')).toEqual(['isotretinoina']);
  });
  it('does not flag common non-controlled drugs or partial-word matches', () => {
    expect(controlledSubstancesIn('Losartana potássica 50 mg')).toEqual([]);
    expect(controlledSubstancesIn('Dipirona 1 g')).toEqual([]);
    expect(controlledSubstancesIn('Tretinoína creme 0,05%')).toEqual([]);
  });
  it('flags antimicrobials, including free-text items', () => {
    expect(antimicrobialsIn('Amoxicilina + clavulanato 875/125 mg')).toEqual(['amoxicilina']);
    expect(antimicrobialsIn('nitrofurantoína 100mg')).toEqual(['nitrofurantoina']);
    expect(antimicrobialsIn('Paracetamol 750 mg')).toEqual([]);
  });
  it('maps frequent brands, Brazilian spellings and glued doses to the substance', () => {
    expect(controlledSubstancesIn('Rivotril 2mg')).toEqual(['clonazepam']);
    expect(controlledSubstancesIn('Tylex 30mg')).toEqual(['codeina']);
    expect(controlledSubstancesIn('Roacutan 20 mg')).toEqual(['isotretinoina']);
    expect(controlledSubstancesIn('Clonazepam2mg')).toEqual(['clonazepam']);
    expect(antimicrobialsIn('Monuril 3 g')).toEqual(['fosfomicina']);
    expect(antimicrobialsIn('Bactrim F')).toEqual(['sulfametoxazol']);
    expect(antimicrobialsIn('Ciprofloxacina 500mg')).toEqual(['ciprofloxacino']);
    expect(antimicrobialsIn('Amoxicilina500mg')).toEqual(['amoxicilina']);
    expect(controlledSubstancesIn('Dipirona 500mg')).toEqual([]);
    expect(antimicrobialsIn('Ácido fólico 5 mg')).toEqual([]);
  });
});

describe('toWinAnsi', () => {
  it('keeps Portuguese text intact', () => {
    expect(toWinAnsi('Atenção: tomar após as refeições — 8/8h')).toBe('Atenção: tomar após as refeições — 8/8h');
  });
  it('replaces characters the PDF standard fonts cannot encode instead of failing', () => {
    expect(toWinAnsi('Se febre ≥ 38 °C → retornar')).toBe('Se febre >= 38 °C -> retornar');
    expect(toWinAnsi('Wiśniewska')).toBe('Wisniewska');
    expect(toWinAnsi('β-hCG')).toBe('beta-hCG');
  });
});

describe('controlled substances by Portaria 344 list (D8)', () => {
  const forms = (name: string) => controlledFindings(name).map((f) => `${f.substance}:${f.list}:${f.form}`);
  it('sends C1 and C5 to the Receita de Controle Especial', () => {
    expect(forms('Sertralina 50 mg')).toEqual(['sertralina:C1:receita_controle_especial']);
    expect(forms('Pregabalina 75 mg')).toEqual(['pregabalina:C1:receita_controle_especial']);
    expect(forms('Cipionato de testosterona 200 mg/ml')).toEqual(['testosterona:C5:receita_controle_especial']);
  });
  it('applies the dose adendos for codeine and tramadol and the phenobarbital adendo', () => {
    expect(forms('Tylex 30mg')).toEqual(['codeina:A2:receita_controle_especial']);
    expect(forms('Tramadol 50 mg')).toEqual(['tramadol:A2:receita_controle_especial']);
    expect(forms('Tramadol')).toEqual(['tramadol:A2:notificacao_a']);
    expect(forms('Codeína 120 mg')).toEqual(['codeina:A2:notificacao_a']);
    expect(forms('Fenobarbital 100 mg')).toEqual(['fenobarbital:B1:receita_controle_especial']);
  });
  it('keeps notification-only lists and hospital-only misoprostol out of the RCE', () => {
    expect(forms('Rivotril 2mg')).toEqual(['clonazepam:B1:notificacao_b']);
    expect(forms('Ritalina 10 mg')).toEqual(['metilfenidato:A3:notificacao_a']);
    expect(forms('Roacutan 20 mg')).toEqual(['isotretinoina:C2:notificacao_especial_retinoides']);
    expect(forms('Sibutramina 15 mg')).toEqual(['sibutramina:B2:notificacao_b2']);
    expect(forms('Cytotec 200 mcg')).toEqual(['misoprostol:C1:uso_hospitalar']);
    expect(forms('Dipirona 500 mg')).toEqual([]);
  });
});

describe('compounded formula rules', () => {
  const ok = { components: [{ substance: 'Substância sintética', amount: '100 mg' }], form: 'cápsula', quantity: '30 cápsulas' };
  it('accepts a complete formula and lists its substances and printed lines', () => {
    expect(formulaError(ok)).toBeNull();
    expect(formulaSubstances(ok)).toEqual(['Substância sintética']);
    expect(formulaLines({ ...ok, vehicle: 'Excipiente q.s.p. 1 cápsula' })).toEqual(['Substância sintética 100 mg', 'Excipiente q.s.p. 1 cápsula', 'Manipular 30 cápsulas (cápsula).']);
  });
  it('refuses missing or oversized parts', () => {
    expect(formulaError(null)).toContain('inválida');
    expect(formulaError({ ...ok, components: [] })).toContain('de 1 a 12');
    expect(formulaError({ ...ok, components: Array.from({ length: 13 }, () => ok.components[0]) })).toContain('de 1 a 12');
    expect(formulaError({ ...ok, components: [{ substance: '', amount: '1 mg' }] })).toContain('nome de cada componente');
    expect(formulaError({ ...ok, quantity: 'muitas' })).toContain('quanto manipular');
    expect(formulaError({ ...ok, form: '' })).toContain('forma farmacêutica');
    expect(formulaError({ ...ok, vehicle: 'x'.repeat(81) })).toContain('excipiente');
    expect(formulaError({ ...ok, components: [{ substance: 'A', amount: '1 mg', price: 2 }] })).toContain('inválido');
  });
  it('recognises controlled and antimicrobial components by their substance', () => {
    expect(controlledSubstancesIn(formulaSubstances({ ...ok, components: [{ substance: 'Testosterona', amount: '1%' }] }).join(' '))).toContain('testosterona');
    expect(antimicrobialsIn('Metronidazol')).toContain('metronidazol');
  });
});

// Same cases as supabase/tests/reference-catalogs.test.sql (valid_snippet_formula):
// the server rule and the template guard must agree.
describe('formula rules shared with the template guard', () => {
  const base = { components: [{ substance: 'A', amount: '1 mg' }], form: 'cápsula', quantity: '30' };
  const cases: Array<[string, unknown, boolean]> = [
    ['empty object', {}, false],
    ['missing form and quantity', { components: base.components }, false],
    ['null', null, false],
    ['null form', { ...base, form: null }, false],
    ['line break in a component', { ...base, components: [{ substance: 'A\nB', amount: '1 mg' }] }, false],
    ['tab in the form', { ...base, form: 'cáp\tsula' }, false],
    ['blank substance', { ...base, components: [{ substance: '   ', amount: '1 mg' }] }, false],
    ['blank vehicle', { ...base, vehicle: '   ' }, false],
    ['empty vehicle', { ...base, vehicle: '' }, true],
    ['quantity over 40', { ...base, quantity: '9'.repeat(41) }, false],
    ['trimmed quantity of 40', { ...base, quantity: `  ${'9'.repeat(40)}  ` }, true],
    ['numeric substance', { ...base, components: [{ substance: 1, amount: '1 mg' }] }, false],
  ];
  it.each(cases)('%s', (_label, formula, valid) => {
    expect(formulaError(formula) === null).toBe(valid);
  });
});
