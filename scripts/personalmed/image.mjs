// Images embedded in the legacy tables: find the image inside the blob and turn
// BMP into PNG (Cortex stores PDF and photo formats, not BMP). Dependency-free.

import { deflateSync } from 'node:zlib';

/**
 * The image inside a legacy blob. Paradox "graphic" fields carry an 8-byte
 * prefix before the image, plain blobs do not.
 * @returns {{ format: 'jpeg' | 'bmp' | 'png', bytes: Buffer } | null}
 */
export function findImage(raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 16) return null;
  for (const offset of [0, 8]) {
    const b = raw.subarray(offset);
    if (b[0] === 0xff && b[1] === 0xd8) return { format: 'jpeg', bytes: b };
    if (b[0] === 0x42 && b[1] === 0x4d) return { format: 'bmp', bytes: b };
    if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return { format: 'png', bytes: b };
  }
  return null;
}

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGB rows (top-down, 3 bytes per pixel) -> PNG. */
export function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // filter byte 0 stays
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Uncompressed Windows BMP (1, 4, 8, 16, 24 or 32 bits per pixel) -> PNG.
 * 16-bit is the default 5-5-5 layout (the exam images of Co31_1 use it).
 * Compressed BMP (RLE, bitfields other than plain 32-bit) is not converted: null.
 */
export function bmpToPng(bmp) {
  if (!Buffer.isBuffer(bmp) || bmp.length < 54 || bmp[0] !== 0x42 || bmp[1] !== 0x4d) return null;
  const dataOffset = bmp.readUInt32LE(10);
  const headerSize = bmp.readUInt32LE(14);
  if (headerSize < 40) return null;
  const width = bmp.readInt32LE(18);
  const rawHeight = bmp.readInt32LE(22);
  const bpp = bmp.readUInt16LE(28);
  const compression = bmp.readUInt32LE(30);
  const height = Math.abs(rawHeight);
  if (width <= 0 || height <= 0 || width > 20000 || height > 20000) return null;
  if (!(compression === 0 || (compression === 3 && bpp === 32)) || ![1, 4, 8, 16, 24, 32].includes(bpp)) return null;
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
  if (dataOffset + rowSize * height > bmp.length) return null;
  const paletteAt = 14 + headerSize;
  const colours = bpp <= 8 ? (bmp.readUInt32LE(46) || 1 << bpp) : 0;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const src = dataOffset + (rawHeight > 0 ? height - 1 - y : y) * rowSize; // positive height = bottom-up
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      if (bpp >= 24) {
        const p = src + x * (bpp / 8);
        rgb[o] = bmp[p + 2];
        rgb[o + 1] = bmp[p + 1];
        rgb[o + 2] = bmp[p];
      } else if (bpp === 16) {
        // X1 R5 G5 B5, little-endian; five bits spread over eight.
        const v = bmp.readUInt16LE(src + x * 2);
        const wide = (c) => (c << 3) | (c >> 2);
        rgb[o] = wide((v >> 10) & 31);
        rgb[o + 1] = wide((v >> 5) & 31);
        rgb[o + 2] = wide(v & 31);
      } else {
        const index = bpp === 8 ? bmp[src + x] : bpp === 4 ? (bmp[src + (x >> 1)] >> (x & 1 ? 0 : 4)) & 0x0f : (bmp[src + (x >> 3)] >> (7 - (x & 7))) & 1;
        const p = paletteAt + Math.min(index, colours - 1) * 4;
        rgb[o] = bmp[p + 2];
        rgb[o + 1] = bmp[p + 1];
        rgb[o + 2] = bmp[p];
      }
    }
  }
  return encodePng(width, height, rgb);
}

/** What Cortex can store: JPEG and PNG as they are, BMP converted. */
export function storableImage(raw) {
  const found = findImage(raw);
  if (!found) return null;
  if (found.format === 'jpeg') return { mime: 'image/jpeg', bytes: found.bytes };
  if (found.format === 'png') return { mime: 'image/png', bytes: found.bytes };
  const png = bmpToPng(found.bytes);
  return png ? { mime: 'image/png', bytes: png } : null;
}
