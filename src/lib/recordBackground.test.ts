import { describe, expect, it } from 'vitest';
import { assessmentAndPlan, buildPatientSummary } from '../../supabase/functions/_shared/gemini';

const note = (a: string, p: string, heading = '**A (Avaliação):**') =>
  `**S (Subjetivo):** queixa.\n\n**O (Objetivo):** exame.\n\n${heading} ${a}\n\n**P (Plano):** ${p}`;

describe('assessmentAndPlan', () => {
  it('finds the assessment in the formats the app writes', () => {
    for (const heading of ['**A (Avaliação):**', '**A:**', '**A — Avaliação**', '## Avaliação', '### A']) {
      const out = assessmentAndPlan(note('hipotireoidismo compensado.', 'manter 88 mcg; retorno em 60 dias.', heading));
      expect(out.startsWith(heading)).toBe(true);
      expect(out).toContain('retorno em 60 dias');
      expect(out).not.toContain('queixa');
    }
  });

  it('keeps the end of the plan and marks a cut', () => {
    const long = note('avaliação.', `${'item do plano; '.repeat(300)}dosar vitamina D em 3 meses.`);
    expect(assessmentAndPlan(long, 6000)).toContain('dosar vitamina D em 3 meses');
    const cut = assessmentAndPlan(long, 800);
    expect(cut.endsWith('[texto cortado]')).toBe(true);
    expect(cut.length).toBeLessThan(830);
  });

  it('uses the end of a note without a recognizable heading, and says so', () => {
    const free = `${'texto livre da consulta. '.repeat(200)}Conduta final: biópsia pendente.`;
    const out = assessmentAndPlan(free, 500);
    expect(out.startsWith('[início omitido]')).toBe(true);
    expect(out).toContain('biópsia pendente');
    expect(assessmentAndPlan('Nota curta sem seções.')).toBe('Nota curta sem seções.');
    expect(assessmentAndPlan('')).toBe('');
  });

  it('does not take a word starting with A for the heading', () => {
    const out = assessmentAndPlan('**Alergias:** dipirona.\n\n**A:** estável.\n\n**P:** manter.');
    expect(out.startsWith('**A:** estável')).toBe(true);
  });
});

describe('buildPatientSummary with record background', () => {
  const patient = {
    name: 'Paciente Sintética', date_of_birth: '1978-04-12', diagnoses: [{ code: 'E03.9', description: 'Hipotireoidismo' }],
    medications: [{ name: 'Levotiroxina 88 mcg', dosage: '1 comprimido' }], allergies: ['Sulfa'],
    medical_history: 'TVP em 2019, no puerpério.',
  };
  const last = { created_at: '2026-10-06T17:00:00Z', chief_complaint: 'Decidiu iniciar terapia hormonal', soap_note: note('estrogênio oral contraindicado.', 'retorno em 60 dias.') };

  it('is unchanged without background', () => {
    const out = buildPatientSummary(patient, '');
    expect(out).not.toContain('CONTEXTO DO PRONTUÁRIO');
    expect(out).not.toContain('TVP');
    expect(out).toContain('Alergias: Sulfa');
  });

  it('adds the medical history and the last visit, marked as not being this consultation', () => {
    const out = buildPatientSummary(patient, '', { lastConsultation: last });
    expect(out.startsWith('CONTEXTO DO PRONTUÁRIO (não é conteúdo desta consulta')).toBe(true);
    expect(out.endsWith('FIM DO CONTEXTO DO PRONTUÁRIO')).toBe(true);
    expect(out).toContain('História médica (cadastro): TVP em 2019');
    expect(out).toContain('Última consulta registrada (06/10/2026) — queixa: Decidiu iniciar terapia hormonal');
    expect(out).toContain('estrogênio oral contraindicado');
    expect(out).not.toContain('**S (Subjetivo)');
  });

  it('adds nothing when the chart has neither history nor a previous visit', () => {
    const out = buildPatientSummary({ ...patient, medical_history: '' }, '', { lastConsultation: null });
    expect(out).not.toContain('CONTEXTO DO PRONTUÁRIO');
  });
});
