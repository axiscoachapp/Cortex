import { describe, expect, it } from 'vitest';
import { getSpecialtyPrompt, buildCustomTemplatePrompt } from '../../supabase/functions/_shared/specialty_prompts';

// The recorded transcription has no speaker labels. Measured on 2026-11-11 with a real
// two-voice recording: forbidding any attribution left the note empty in 2 of 3 runs and
// hedged in the third. The rule is now attribution from context, with the doubt registered
// only when it changes the clinical meaning, and no authorship caveats inside the note.
describe('speaker attribution after recorded transcription', () => {
  for (const specialty of ['geral','psiquiatria','cardiologia','pediatria','ginecologia','prenatal','urologia','dermatologia','neurologia','ortopedia','endocrinologia',undefined]) {
    it(`attributes speakers from context, without assuming labels, for ${specialty ?? 'default'}`, () => {
      const prompt = getSpecialtyPrompt(specialty);
      expect(prompt).not.toMatch(/A transcrição usa os rótulos/);
      expect(prompt).not.toContain('Não atribua falas ao médico ou ao paciente por inferência');
      expect(prompt).toContain('A transcrição não identifica quem fala. Identifique pelo contexto');
      expect(prompt).toContain('NÃO escreva ressalvas de autoria no texto da evolução');
      expect(prompt).toContain('registre a\ndúvida em clarifications');
    });
    it(`keeps the visit as the only source of the note and the chart as background for ${specialty ?? 'default'}`, () => {
      const prompt = getSpecialtyPrompt(specialty);
      expect(prompt).toContain('EXCLUSIVAMENTE a partir do que foi dito na transcrição desta consulta');
      expect(prompt).toContain('NUNCA use-o para preencher seções com informações não discutidas');
      expect(prompt).toContain('Uma lista vazia NÃO\nsignifica ausência de interação ou de contraindicação');
    });
  }
  it('applies the same rules when a custom template is used', () => {
    const prompt = buildCustomTemplatePrompt('## Estrutura sintética');
    expect(prompt).not.toMatch(/A transcrição usa os rótulos/);
    expect(prompt).toContain('A transcrição não identifica quem fala. Identifique pelo contexto');
    expect(prompt).toContain('## Estrutura sintética');
  });
});
