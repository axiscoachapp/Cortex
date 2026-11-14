/* The profile's free-text fields ("Histórico médico", "Anamnese social") as the
 * screen shows them.
 *
 * The stored value stays plain text, one fact per line, so the doctor edits it
 * in an ordinary text box and every reader (print, sharing, the AI prompts)
 * keeps working. A line that ends with ":" followed by lines that start with a
 * dash is a group:
 *
 *   Cirurgias:
 *   - 2018: hérnia de hiato
 *   - 2024: colecistectomia
 *   Tipo sanguíneo: O+
 *
 * Everything else is a loose fact. Text written before groups existed has no
 * such heading and reads exactly as before.
 */

export interface ProfileTextGroup {
  /** Null for loose facts that belong to no group. */
  heading: string | null;
  items: string[];
}

const DASH = /^\s*[-•*]\s+/;
const isDashed = (line: string) => DASH.test(line);
const undash = (line: string) => line.replace(/^\s*[-•*]\s*/, '').trim();
/** "Cirurgias:" or "Obstétrico (2 gestações registradas):", never a fact that merely ends with a colon after a dash. */
const isHeading = (line: string, next: string | undefined) =>
  !isDashed(line) && line.length <= 90 && /:\s*$/.test(line) && next !== undefined && isDashed(next);

export function parseProfileText(text: string | null | undefined): ProfileTextGroup[] {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  // Old prose saved as one long paragraph still reads as separate facts.
  if (lines.length === 1 && lines[0].length > 90) {
    const sentences = lines[0]
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    return [{ heading: null, items: sentences }];
  }
  const groups: ProfileTextGroup[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isHeading(line, lines[index + 1])) {
      groups.push({ heading: line.replace(/:\s*$/, '').trim(), items: [] });
      continue;
    }
    let open = groups[groups.length - 1];
    // Only dashed lines continue a headed group; any other line is a loose fact and closes it
    // (a note appended later, "[Consulta … — revisão médica] …", must not fall under "Cirurgias").
    if (!open || (open.heading !== null && !isDashed(line))) {
      open = { heading: null, items: [] };
      groups.push(open);
    }
    const item = undash(line);
    if (item) open.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

/** Every fact, in order, without the group headings (counts, searches). */
export const profileTextItems = (text: string | null | undefined): string[] =>
  parseProfileText(text).flatMap((group) => group.items);
