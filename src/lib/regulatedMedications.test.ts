import { describe, expect, it } from 'vitest';
import {
  antimicrobialsIn,
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
