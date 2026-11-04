import { describe, expect, it } from 'vitest';
import {
  antimicrobialsIn,
  controlledFindings,
  controlledSubstancesIn,
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
