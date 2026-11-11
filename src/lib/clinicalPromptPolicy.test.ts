// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getSpecialtyPrompt, buildCustomTemplatePrompt } from '../../supabase/functions/_shared/specialty_prompts';
describe('speaker attribution after recorded transcription', () => {
  for (const specialty of ['geral','psiquiatria','cardiologia','pediatria','ginecologia','prenatal','urologia','dermatologia','neurologia','ortopedia','endocrinologia',undefined]) {
    it(`does not assume speaker labels for ${specialty ?? 'default'}`, () => {
      const prompt = getSpecialtyPrompt(specialty);
      expect(prompt).not.toMatch(/A transcrição usa os rótulos/);
      expect(prompt).toContain('Não atribua falas ao médico ou ao paciente por inferência');
    });
  }
  it('retains the same attribution rule when regenerating a custom template', () => {
    const prompt = buildCustomTemplatePrompt('## Estrutura sintética');
    expect(prompt).not.toMatch(/A transcrição usa os rótulos/);
    expect(prompt).toContain('Não atribua falas ao médico ou ao paciente por inferência');
    expect(prompt).toContain('## Estrutura sintética');
  });
});
