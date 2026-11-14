// @vitest-environment node
// Scanned PDFs (fax/CCITT, JBIG2, JPEG 2000 images) are drawn with decoders that the pdf.js worker
// imports from the app's own address: public/pdfjs/ (PDF_DECODERS_URL in FileViewerDialog.tsx). They
// are copies of files of the installed pdfjs-dist, so an upgrade must copy them again: otherwise the
// worker of the new version would run the decoders of the old one, or find none.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packaged = new URL('../../node_modules/pdfjs-dist/wasm/', import.meta.url);
const served = new URL('../../public/pdfjs/', import.meta.url);
const { version } = JSON.parse(
  readFileSync(new URL('../../node_modules/pdfjs-dist/package.json', import.meta.url), 'utf8'),
) as { version: string };

/** The JavaScript decoders of the installed version (the WebAssembly ones are not allowed by the CSP). */
const decoders = readdirSync(packaged)
  .filter((name) => name.endsWith('_nowasm_fallback.js'))
  .sort();
const licences = ['LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG'];
const expected = [...decoders, ...licences].sort();

/** Byte for byte, except that Git may check a text file out with Windows line endings. */
const bytes = (folder: URL, name: string) => readFileSync(new URL(name, folder), 'latin1').replace(/\r\n/g, '\n');

describe('pdf.js decoders served by the app', () => {
  it('are the ones of the installed pdfjs-dist', () => {
    expect(
      decoders,
      `pdfjs-dist ${version} changed its set of JavaScript decoders (wasm/*_nowasm_fallback.js): update this list, the licences above and public/pdfjs/`,
    ).toEqual(['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']);
    const stale = expected.filter(
      (name) => !existsSync(new URL(name, served)) || bytes(served, name) !== bytes(packaged, name),
    );
    expect(
      stale,
      `public/pdfjs/ does not match pdfjs-dist ${version}. Copy again from node_modules/pdfjs-dist/wasm/ to public/pdfjs/: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('are the only files in that folder', () => {
    const extra = readdirSync(served).filter((name) => !expected.includes(name));
    expect(
      extra,
      `public/pdfjs/ holds files that pdfjs-dist ${version} does not use (no .wasm either: the CSP does not allow WebAssembly). Remove: ${extra.join(', ')}`,
    ).toEqual([]);
  });

  it('have the names the bundled worker asks for', () => {
    const worker = readFileSync(
      new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
      'latin1',
    );
    for (const name of decoders) expect(worker).toContain(`"${name}"`);
  });
});
