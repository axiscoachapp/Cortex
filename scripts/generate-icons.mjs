/* One-shot icon + share-image generator.
 *   node scripts/generate-icons.mjs
 *
 * Reads public/favicon.svg and public/og-image.svg, produces:
 *   public/favicon.ico          (16+32+48 multi-size ICO)
 *   public/favicon-16.png
 *   public/favicon-32.png
 *   public/apple-touch-icon.png (180x180)
 *   public/og-image.png         (1200x630)
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const write = (p, buf) => writeFileSync(new URL(p, root), buf);

const faviconSvg = read('public/favicon.svg');
const ogSvg = read('public/og-image.svg');

// ─── PNGs from favicon ──────────────────────────────────────────────────────
const sizes = [
  { name: 'favicon-16.png', size: 16 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-48.png', size: 48 },
  { name: 'apple-touch-icon.png', size: 180 },
];

const pngBuffers = {};
for (const { name, size } of sizes) {
  const buf = await sharp(faviconSvg).resize(size, size).png().toBuffer();
  write(`public/${name}`, buf);
  pngBuffers[size] = buf;
  console.log(`✓ public/${name}  (${buf.length} bytes)`);
}

// ─── Multi-size ICO ─────────────────────────────────────────────────────────
// Minimal ICO writer: header + dir entries + raw PNG payloads (Vista+ supports PNG inside ICO).
function buildIco(images /* {size, buf}[] */) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);                  // reserved
  header.writeUInt16LE(1, 2);                  // type = 1 (icon)
  header.writeUInt16LE(images.length, 4);      // image count

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  const payloads = [];
  images.forEach(({ size, buf }, i) => {
    const off = i * 16;
    dir.writeUInt8(size === 256 ? 0 : size, off + 0);   // width
    dir.writeUInt8(size === 256 ? 0 : size, off + 1);   // height
    dir.writeUInt8(0, off + 2);                          // palette
    dir.writeUInt8(0, off + 3);                          // reserved
    dir.writeUInt16LE(1, off + 4);                       // color planes
    dir.writeUInt16LE(32, off + 6);                      // bits per pixel
    dir.writeUInt32LE(buf.length, off + 8);              // size
    dir.writeUInt32LE(offset, off + 12);                 // offset
    offset += buf.length;
    payloads.push(buf);
  });
  return Buffer.concat([header, dir, ...payloads]);
}

const ico = buildIco([
  { size: 16, buf: pngBuffers[16] },
  { size: 32, buf: pngBuffers[32] },
  { size: 48, buf: pngBuffers[48] },
]);
write('public/favicon.ico', ico);
console.log(`✓ public/favicon.ico  (${ico.length} bytes)`);

// ─── OG image ───────────────────────────────────────────────────────────────
const og = await sharp(ogSvg).resize(1200, 630).png({ compressionLevel: 9 }).toBuffer();
write('public/og-image.png', og);
console.log(`✓ public/og-image.png  (${og.length} bytes)`);
