// A one-page PDF with a title and a few paragraphs, dependency-free. The
// anonymised sample puts it where a legacy image would be: opened in the
// browser, it says what is missing and why, instead of showing a blank square.

const PAGE = { width: 595, height: 842, margin: 56 }; // A4 in points
const BODY = { size: 11, leading: 16, columns: 86 }; // Helvetica 11 pt fits about 86 characters per line

/** Latin-1 text for a PDF string: other characters become "-", then \ ( ) are escaped. */
const pdfString = (s) =>
  [...String(s)]
    .map((c) => (c.charCodeAt(0) <= 0xff && c.charCodeAt(0) >= 0x20 ? c : '-'))
    .join('')
    .replace(/[\\()]/g, (c) => `\\${c}`);

/** Breaks a paragraph at spaces so that no line is longer than `columns`. */
export function wrap(paragraph, columns = BODY.columns) {
  const lines = [];
  let line = '';
  for (const word of String(paragraph).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > columns) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {string} title
 * @param {string[]} paragraphs
 * @returns {Buffer} a PDF 1.4 file
 */
export function textPdf(title, paragraphs) {
  const ops = ['BT', `/F2 16 Tf`, `${PAGE.margin} ${PAGE.height - PAGE.margin - 16} Td`, `(${pdfString(title)}) Tj`, `/F1 ${BODY.size} Tf`, `${BODY.leading} TL`, '0 -14 Td'];
  for (const paragraph of paragraphs) {
    ops.push('T*'); // a blank line before every paragraph
    for (const line of wrap(paragraph)) ops.push(`(${pdfString(line)}) '`);
  }
  ops.push('ET');
  const stream = Buffer.from(ops.join('\n'), 'latin1');
  const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    font('Helvetica'),
    font('Helvetica-Bold'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let at = parts[0].length;
  objects.forEach((body, i) => {
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(at);
    at += chunk.length;
    parts.push(chunk);
  });
  // Every cross-reference line is exactly 20 bytes.
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`), `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`];
  parts.push(Buffer.from(xref.join(''), 'latin1'));
  return Buffer.concat(parts);
}
