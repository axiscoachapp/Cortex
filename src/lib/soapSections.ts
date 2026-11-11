/* Shared SOAP note parser for the screen (SoapNoteView) and print (printDoc).
 *
 * A note is split into line-contiguous blocks: SOAP sections and free text
 * (preamble, labelled lines such as "**Alergias:**", trailing notes). Every
 * line of the input belongs to exactly one block, and the result is only
 * returned when that holds and at least two distinct S/O/A/P sections exist;
 * otherwise callers render the note as plain markdown. Nothing is dropped.
 */

export type SoapLetter = 'S' | 'O' | 'A' | 'P';

export type SoapBlock =
  | { kind: 'section'; letter: SoapLetter; title: string; content: string }
  | { kind: 'text'; content: string };

const DEFAULT_NAMES: Record<SoapLetter, string> = {
  S: 'Subjetivo',
  O: 'Objetivo',
  A: 'Avaliação',
  P: 'Plano',
};

const WORD_LETTERS: Record<string, SoapLetter> = {
  subjetivo: 'S',
  objetivo: 'O',
  avaliacao: 'A',
  'avaliação': 'A',
  plano: 'P',
};

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

/** Parse the label of a header ("S (Subjetivo)", "S", "S — Subjetivo", "Plano"). */
function soapLabel(raw: string): { letter: SoapLetter; title: string } | null {
  const label = raw.trim().replace(/:\s*$/, '').trim();
  const lettered = label.match(/^([SOAP])(?:\s*\(([^)]*)\)|\s*[—–-]\s*(.+))?$/);
  if (lettered) {
    const letter = lettered[1] as SoapLetter;
    const name = (lettered[2] ?? lettered[3] ?? '').trim() || DEFAULT_NAMES[letter];
    return { letter, title: `${letter} (${name})` };
  }
  const word = WORD_LETTERS[normalizeWord(label)];
  return word ? { letter: word, title: `${word} (${DEFAULT_NAMES[word]})` } : null;
}

type HeaderLine =
  | { kind: 'section'; letter: SoapLetter; title: string; rest: string }
  | { kind: 'text' };

// "**Label:** rest", "**Label**: rest", "**Label** rest" (label may contain parentheses).
const BOLD_HEADER = /^\s*\*\*([^*\n]+?)\*\*\s*(:?)\s*(.*)$/;
// "## Label", "### S — Subjetivo".
const MD_HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
// Manual consultation templates: "S — Queixa e história:" (em/en dash, colon).
const PLAIN_HEADER = /^\s*([SOAP])\s+[—–]\s+([^:\n]{1,80}):\s*(.*)$/;

function classify(line: string): HeaderLine | null {
  const bold = line.match(BOLD_HEADER);
  if (bold) {
    const [, label, colonAfter, rest] = bold;
    const labelled = soapLabel(label);
    if (labelled) return { kind: 'section', ...labelled, rest };
    // A non-SOAP bold label line ("**Alergias:** …") starts its own text block.
    if (label.trim().endsWith(':') || colonAfter) return { kind: 'text' };
    return null;
  }
  const heading = line.match(MD_HEADING);
  if (heading) {
    const labelled = soapLabel(heading[1]);
    return labelled ? { kind: 'section', ...labelled, rest: '' } : { kind: 'text' };
  }
  const plain = line.match(PLAIN_HEADER);
  if (plain) {
    const letter = plain[1] as SoapLetter;
    return { kind: 'section', letter, title: `${letter} (${plain[2].trim()})`, rest: plain[3] };
  }
  return null;
}

/** Blocks covering every line of `text`, or null when the note is not sectioned. */
export function parseSoapBlocks(text: string): SoapBlock[] | null {
  const lines = text.split('\n');
  type Draft = { header: HeaderLine | null; lines: string[] };
  const drafts: Draft[] = [];
  for (const line of lines) {
    const header = classify(line);
    if (header || drafts.length === 0) drafts.push({ header, lines: [line] });
    else drafts[drafts.length - 1].lines.push(line);
  }
  // Every input line must be in exactly one block.
  if (drafts.flatMap((draft) => draft.lines).join('\n') !== text) return null;

  const blocks: SoapBlock[] = [];
  for (const { header, lines: blockLines } of drafts) {
    if (header?.kind === 'section') {
      const content = [header.rest, ...blockLines.slice(1)].join('\n').trim();
      blocks.push({ kind: 'section', letter: header.letter, title: header.title, content });
    } else {
      const content = blockLines.join('\n').trim();
      if (content) blocks.push({ kind: 'text', content });
    }
  }
  const letters = new Set(blocks.flatMap((block) => (block.kind === 'section' ? [block.letter] : [])));
  return letters.size >= 2 ? blocks : null;
}

/* ── Print helpers ──────────────────────────────────────────────────── */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escaped HTML for a markdown-ish clinical text: bold becomes <strong>,
 * headings become bold lines, list markers become bullets, and no literal
 * markdown markers reach the paper. Use inside a `white-space:pre-wrap` box.
 */
export function markdownToPrintHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
      const body = heading ? `**${heading[1]}**` : line.replace(/^(\s*)[-*+]\s+/, '$1• ');
      return escapeHtml(body)
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
        .replace(/\*\*/g, '');
    })
    .join('\n');
}
