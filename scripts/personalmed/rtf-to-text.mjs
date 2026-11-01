// Minimal RTF -> plain text converter for PersonalMed memo fields (Delphi
// TRichEdit output). Dependency-free. Handles control words, \'hh escapes in
// the document code page, \uN Unicode escapes, paragraph/line/tab breaks and
// skips non-text destinations (font/colour tables, stylesheets, \*\ groups,
// embedded pictures/objects). Also reports what it skipped so callers can
// count embedded images.

import { decodeText } from './paradox-reader.mjs';

const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer',
  'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles',
  'datastore', 'filetbl', 'revtbl', 'pgdsctbl', 'fldinst', 'bkmkstart', 'bkmkend',
]);

const BREAKS = { par: '\n', line: '\n', sect: '\n', page: '\n', row: '\n', tab: '\t', cell: '\t' };
const SPECIAL = { emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ', '~': ' ' };

/**
 * @param {string} rtf  RTF source (as decoded text; \'hh bytes are decoded with codePage)
 * @param {{codePage?: number}} [opts]
 * @returns {{ text: string, pictures: number, objects: number }}
 */
export function rtfToText(rtf, opts = {}) {
  let codePage = opts.codePage ?? 1252;
  let out = '';
  let pictures = 0;
  let objects = 0;
  const stack = [];
  let skip = 0; // depth at which skipping started (0 = not skipping)
  let depth = 0;
  let ucSkip = 1;
  let pendingSkip = 0; // chars to skip after \uN
  let hexBytes = [];

  const flushHex = () => {
    if (!hexBytes.length) return;
    if (!skip) out += decodeText(Uint8Array.from(hexBytes), codePage);
    hexBytes = [];
  };

  let i = 0;
  const n = rtf.length;
  while (i < n) {
    const ch = rtf[i];
    if (ch === '{') {
      flushHex();
      stack.push(ucSkip);
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      flushHex();
      if (skip && depth === skip) skip = 0;
      ucSkip = stack.pop() ?? 1;
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        if (pendingSkip > 0) pendingSkip -= 1;
        else hexBytes.push(parseInt(hex, 16));
        i += 4;
        continue;
      }
      flushHex();
      if (next === '\\' || next === '{' || next === '}') {
        if (!skip) out += next;
        i += 2;
        continue;
      }
      if (next === '*') {
        // \*\destination -> ignorable destination: skip the whole group
        if (!skip) skip = depth;
        i += 2;
        continue;
      }
      if (next === '\n' || next === '\r') {
        if (!skip) out += '\n';
        i += 2;
        continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
      if (!m) {
        // control symbol such as \~ \- \_
        if (!skip && SPECIAL[next]) out += SPECIAL[next];
        else if (!skip && next === '_') out += '-';
        i += 2;
        continue;
      }
      const word = m[1];
      const param = m[2] !== undefined ? Number(m[2]) : null;
      i += 1 + m[0].length;
      if (SKIP_DESTINATIONS.has(word)) {
        if (word === 'pict') pictures += 1;
        if (word === 'object') objects += 1;
        if (!skip) skip = depth;
        continue;
      }
      if (skip) continue;
      if (word === 'ansicpg' && param) codePage = param;
      else if (word === 'uc' && param !== null) ucSkip = param;
      else if (word === 'u' && param !== null) {
        out += String.fromCharCode(param < 0 ? param + 65536 : param);
        pendingSkip = ucSkip;
      } else if (BREAKS[word]) out += BREAKS[word];
      else if (SPECIAL[word]) out += SPECIAL[word];
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    flushHex();
    if (pendingSkip > 0) {
      pendingSkip -= 1;
      i += 1;
      continue;
    }
    if (!skip) out += ch;
    i += 1;
  }
  flushHex();
  const text = out
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, pictures, objects };
}
