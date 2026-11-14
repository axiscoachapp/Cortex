/* Notes brought from a clinic's previous system.
 *
 * The migration writes a stamp on the first line of every note it creates
 * ("[Importado do PersonalMed em 2026-11-13 · registro de …]" for a converted
 * day, "[Resumo organizado por IA em … a partir do prontuário antigo …]" for
 * the summary it adds). The screens use it to say what the note is: its title
 * is not a complaint taken in a Cortex consultation.
 */
const STAMP = /^\s*\[(?:Importado d[oae]s? |Resumo organizado por IA )/;

export const isImportedNote = (soapNote: string | null | undefined): boolean => STAMP.test(soapNote ?? '');
