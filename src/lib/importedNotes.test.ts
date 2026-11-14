import { describe, expect, it } from 'vitest';
import { isImportedNote } from './importedNotes';

describe('imported notes', () => {
  it('recognises the stamp the migration writes on the first line', () => {
    expect(isImportedNote('[Importado do PersonalMed em 2026-11-13 · registro de Médica A]\n\ntexto')).toBe(true);
    expect(isImportedNote('[Importado do PersonalMed em 2026-11-13 · texto original das páginas sem data. Não é uma consulta.]')).toBe(true);
    expect(isImportedNote('[Resumo organizado por IA em 14/11/2026 a partir do prontuário antigo (PersonalMed). Não é uma consulta.]')).toBe(true);
  });
  it('does not take a note written in Cortex for an imported one', () => {
    expect(isImportedNote('**S (Subjetivo):** Paciente refere que o exame foi importado do laboratório.')).toBe(false);
    expect(isImportedNote('Texto livre\n[Importado do PersonalMed em 2026-11-13]')).toBe(false);
    expect(isImportedNote(null)).toBe(false);
    expect(isImportedNote('')).toBe(false);
  });
});
