// Dependency-free reader for Borland Paradox tables (.DB + .MB), as produced by
// the BDE (Paradox 3.x-7.x). Used to analyse the PersonalMed 2005 export before
// a migration into Cortex. Read-only: never writes to the source files.
//
// Format reference: pxlib (http://pxlib.sourceforge.net) and Kevin Mitchell's
// "Paradox file format" notes. Multi-byte numbers in the header are
// little-endian; numbers inside records are big-endian with the sign bit
// flipped so they sort bytewise.
//
// This module only decodes bytes. It never prints values; callers decide what
// (if anything) to output. The PersonalMed export contains patient health
// data: keep output to schema and aggregates.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export const FIELD_TYPES = {
  0x01: 'alpha',
  0x02: 'date',
  0x03: 'short',
  0x04: 'long',
  0x05: 'currency',
  0x06: 'number',
  0x09: 'logical',
  0x0c: 'memo',
  0x0d: 'blob',
  0x0e: 'fmtmemo',
  0x0f: 'ole',
  0x10: 'graphic',
  0x14: 'time',
  0x15: 'timestamp',
  0x16: 'autoinc',
  0x17: 'bcd',
  0x18: 'bytes',
};

export const BLOB_TYPES = new Set(['memo', 'blob', 'fmtmemo', 'ole', 'graphic']);

export const FILE_TYPES = {
  0: 'indexed .DB',
  1: 'primary index .PX',
  2: 'non-indexed .DB',
  3: 'non-incremental secondary index .Xnn',
  4: 'secondary index .Ynn',
  5: 'incremental secondary index .Xnn',
  6: 'non-incremental secondary index .XGn',
  7: 'secondary index .YGn',
  8: 'incremental secondary index .XGn',
};

const VERSION_BY_ID = { 3: 30, 4: 35, 5: 40, 6: 40, 7: 40, 8: 40, 9: 40, 10: 50, 11: 50, 12: 70 };

// --- code pages -----------------------------------------------------------

// Upper halves (0x80-0xFF) of the DOS code pages a Brazilian BDE install may use.
const CP437_HI =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const CP850_HI =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';
const CP860_HI =
  'ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function tableDecoder(hi) {
  const chars = Array.from(hi);
  if (chars.length !== 128) throw new Error('code page table must have 128 entries');
  return (bytes) => {
    let out = '';
    for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : chars[b - 0x80];
    return out;
  };
}

const win1252 = new TextDecoder('windows-1252');
const DECODERS = {
  437: tableDecoder(CP437_HI),
  850: tableDecoder(CP850_HI),
  860: tableDecoder(CP860_HI),
  1252: (bytes) => win1252.decode(bytes),
};

export const SUPPORTED_CODE_PAGES = Object.keys(DECODERS).map(Number);

export function decodeText(bytes, codePage = 1252) {
  const decoder = DECODERS[codePage] ?? DECODERS[1252];
  return decoder(bytes);
}

// --- header ---------------------------------------------------------------

function readCString(buf, offset, max = 512) {
  let end = offset;
  const limit = Math.min(buf.length, offset + max);
  while (end < limit && buf[end] !== 0) end += 1;
  return { bytes: buf.subarray(offset, end), next: end + 1 };
}

/**
 * Parse a Paradox .DB header. Field names are decoded as latin-ish text;
 * they are schema, not data.
 */
export function readHeader(buf) {
  if (buf.length < 0x58) throw new Error('file too small for a Paradox header');
  const h = {
    recordSize: buf.readUInt16LE(0x00),
    headerSize: buf.readUInt16LE(0x02),
    fileType: buf.readUInt8(0x04),
    maxTableSize: buf.readUInt8(0x05),
    numRecords: buf.readUInt32LE(0x06),
    usedBlocks: buf.readUInt16LE(0x0a),
    fileBlocks: buf.readUInt16LE(0x0c),
    firstBlock: buf.readUInt16LE(0x0e),
    lastBlock: buf.readUInt16LE(0x10),
    modifiedFlags1: buf.readUInt8(0x14),
    indexFieldNumber: buf.readUInt8(0x15),
    numFields: buf.readUInt16LE(0x21),
    primaryKeyFields: buf.readUInt16LE(0x23),
    encryption1: buf.readUInt32LE(0x25),
    sortOrder: buf.readUInt8(0x29),
    modifiedFlags2: buf.readUInt8(0x2a),
    changeCount1: buf.readUInt8(0x2d),
    changeCount2: buf.readUInt8(0x2e),
    writeProtected: buf.readUInt8(0x38),
    fileVersionId: buf.readUInt8(0x39),
    maxBlocks: buf.readUInt16LE(0x3a),
    auxPasswords: buf.readUInt8(0x3d),
    autoInc: buf.readUInt32LE(0x49),
    indexUpdateRequired: buf.readUInt8(0x4f),
    refIntegrity: buf.readUInt8(0x55),
  };
  h.fileTypeName = FILE_TYPES[h.fileType] ?? `unknown(${h.fileType})`;
  h.version = VERSION_BY_ID[h.fileVersionId] ?? null;
  h.blockSize = h.maxTableSize * 0x400;

  const isDataFile = h.fileType === 0 || h.fileType === 2;
  const extended = h.fileVersionId >= 5 && h.fileType !== 1;
  let off = 0x58;
  h.encryption2 = 0;
  h.codePage = null;
  if (extended) {
    h.fileVerId2 = buf.readUInt16LE(0x58);
    h.fileVerId3 = buf.readUInt16LE(0x5a);
    h.encryption2 = buf.readUInt32LE(0x5c);
    h.fileUpdateTime = buf.readUInt32LE(0x60);
    h.hiFieldId = buf.readUInt16LE(0x64);
    h.codePage = buf.readUInt16LE(0x6a);
    off = 0x78;
  }
  // v4+ tables store 0xFF00FF00 in encryption1 as a marker and the real key
  // checksum in encryption2 (0 = not password-protected). Older tables use
  // encryption1 directly.
  h.encrypted = extended
    ? h.encryption2 !== 0 || (h.encryption1 !== 0 && h.encryption1 !== 0xff00ff00)
    : h.encryption1 !== 0;

  const fields = [];
  for (let i = 0; i < h.numFields; i += 1) {
    const type = buf.readUInt8(off + i * 2);
    const size = buf.readUInt8(off + i * 2 + 1);
    fields.push({ index: i, type, typeName: FIELD_TYPES[type] ?? `unknown(0x${type.toString(16)})`, size });
  }
  off += h.numFields * 2;

  if (isDataFile || h.fileType >= 3) {
    off += 4; // table name pointer
    off += h.numFields * 4; // field name pointers
    const tableNameLen = h.version !== null && h.version >= 70 ? 261 : 79;
    h.tableName = readCString(buf, off, tableNameLen).bytes.toString('latin1');
    off += tableNameLen;
    for (const field of fields) {
      const { bytes, next } = readCString(buf, off, 256);
      field.name = decodeText(bytes, h.codePage ?? 1252);
      off = next;
    }
    // After the names: one uint16 field number per field, then the sort order id.
    const sortOff = off + h.numFields * 2;
    if (sortOff < h.headerSize) {
      const s = readCString(buf, sortOff, 64).bytes;
      h.sortOrderName = /^[\x20-\x7e]*$/.test(s.toString('latin1')) ? s.toString('latin1') : null;
    }
  }

  let recOff = 0;
  for (const field of fields) {
    field.offset = recOff;
    recOff += field.size;
  }
  h.computedRecordSize = recOff;
  h.fields = fields;
  return h;
}

// --- value decoding -------------------------------------------------------

const MS_PER_DAY = 86_400_000;
// Paradox day 1 is 0001-01-01 (proleptic Gregorian); Unix day 0 is Paradox day 719163.
const PARADOX_EPOCH_OFFSET_DAYS = 719_163;

function isAllZero(buf, start, len) {
  for (let i = start; i < start + len; i += 1) if (buf[i] !== 0) return false;
  return true;
}

function readFlippedInt(buf, off, size) {
  if (isAllZero(buf, off, size)) return null;
  if (size === 2) return (buf.readUInt16BE(off) ^ 0x8000) << 16 >> 16;
  if (size === 4) return (buf.readUInt32BE(off) ^ 0x80000000) | 0;
  throw new Error(`unsupported integer size ${size}`);
}

function readFlippedDouble(buf, off) {
  if (isAllZero(buf, off, 8)) return null;
  const tmp = Buffer.from(buf.subarray(off, off + 8));
  if (tmp[0] & 0x80) {
    tmp[0] &= 0x7f;
  } else {
    for (let i = 0; i < 8; i += 1) tmp[i] = ~tmp[i] & 0xff;
  }
  return tmp.readDoubleBE(0);
}

function readBcd(buf, off, decimals) {
  if (isAllZero(buf, off, 17)) return null;
  const positive = (buf[off] & 0x80) !== 0;
  const flip = positive ? 0 : 0x0f;
  let digits = '';
  for (let i = 2; i < 34; i += 1) {
    const byte = buf[off + (i >> 1)];
    const nibble = ((i % 2) ? byte & 0x0f : byte >> 4) ^ flip;
    digits += String(nibble);
  }
  const intPart = digits.slice(0, 32 - decimals).replace(/^0+(?=\d)/, '');
  const frac = digits.slice(32 - decimals);
  const n = Number(`${intPart}${frac ? `.${frac}` : ''}`);
  return positive ? n : -n;
}

/** Paradox day number -> { y, m, d, iso } (proleptic Gregorian, UTC). */
export function paradoxDayToDate(days) {
  const ms = (days - PARADOX_EPOCH_OFFSET_DAYS) * MS_PER_DAY;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), iso: dt.toISOString().slice(0, 10) };
}

// --- BLOB file (.MB) --------------------------------------------------------

export class MbFile {
  constructor(path) {
    this.path = path;
    this.buf = readFileSync(path);
  }

  /**
   * Resolve a blob pointer from a record. Returns a Buffer slice, or throws.
   * Low byte of `offset` = index inside a sub-allocated block (0xFF = single
   * blob that owns whole 4k blocks).
   */
  read(offset, length) {
    const index = offset & 0xff;
    const blockOff = offset & ~0xff;
    const buf = this.buf;
    if (blockOff + 12 > buf.length) throw new Error('blob pointer beyond end of .MB');
    if (index === 0xff) {
      const type = buf[blockOff];
      if (type !== 0x02) throw new Error(`expected single-blob block (0x02), found 0x${type.toString(16)}`);
      const size = buf.readUInt32LE(blockOff + 3);
      const start = blockOff + 9;
      const take = Math.min(size, length || size);
      if (start + take > buf.length) throw new Error('single blob runs past end of .MB');
      return buf.subarray(start, start + take);
    }
    const type = buf[blockOff];
    if (type !== 0x03) throw new Error(`expected sub-allocated block (0x03), found 0x${type.toString(16)}`);
    const ptr = blockOff + 12 + index * 5;
    const dataOff = buf[ptr];
    const dataLenUnits = buf[ptr + 1];
    const remainder = buf[ptr + 4];
    if (dataOff === 0) throw new Error('empty sub-allocation slot');
    const size = (dataLenUnits - 1) * 16 + remainder;
    const start = blockOff + dataOff * 16;
    const take = Math.min(size, length || size);
    if (start + take > buf.length) throw new Error('sub-allocated blob runs past end of .MB');
    return buf.subarray(start, start + take);
  }
}

// --- table ------------------------------------------------------------------

function findSibling(path, ext) {
  const dir = dirname(path);
  const stem = basename(path, extname(path)).toLowerCase();
  const match = readdirSync(dir).find((f) => {
    const e = extname(f).toLowerCase();
    return e === ext.toLowerCase() && basename(f, extname(f)).toLowerCase() === stem;
  });
  return match ? join(dir, match) : null;
}

export class ParadoxTable {
  /**
   * @param {string} path  path to the .DB file
   * @param {{codePage?: number}} [opts]  override the header code page
   */
  constructor(path, opts = {}) {
    this.path = path;
    this.name = basename(path, extname(path));
    this.buf = readFileSync(path);
    this.header = readHeader(this.buf);
    this.codePage = opts.codePage ?? (SUPPORTED_CODE_PAGES.includes(this.header.codePage) ? this.header.codePage : 1252);
    this.mbPath = findSibling(path, '.MB');
    this._mb = undefined;
  }

  get fields() {
    return this.header.fields;
  }

  get hasBlobFields() {
    return this.fields.some((f) => BLOB_TYPES.has(f.typeName));
  }

  get mb() {
    if (this._mb === undefined) this._mb = this.mbPath && existsSync(this.mbPath) ? new MbFile(this.mbPath) : null;
    return this._mb;
  }

  /** Walk the data-block chain. Yields { block, offset, count }. */
  *blocks() {
    const h = this.header;
    if (h.fileType !== 0 && h.fileType !== 2) throw new Error(`not a data table (${h.fileTypeName})`);
    if (h.blockSize === 0 || h.recordSize === 0) return;
    const seen = new Set();
    let n = h.firstBlock;
    while (n !== 0 && !seen.has(n)) {
      seen.add(n);
      const offset = h.headerSize + (n - 1) * h.blockSize;
      if (offset + 6 > this.buf.length) {
        this.chainError = `block ${n} beyond end of file`;
        return;
      }
      const next = this.buf.readUInt16LE(offset);
      const addDataSize = this.buf.readInt16LE(offset + 4);
      const count = addDataSize >= 0 ? Math.floor(addDataSize / h.recordSize) + 1 : 0;
      yield { block: n, offset: offset + 6, count };
      n = next;
    }
    if (n !== 0) this.chainError = `cycle in block chain at block ${n}`;
  }

  /**
   * Iterate records. Each record is an array aligned with `fields`.
   * Options:
   *  - fields: subset of field names to decode (others are undefined)
   *  - blobs: 'none' | 'raw' (Buffer) | 'text' (decoded string) ; default 'none'
   *           with 'none', blob fields decode to { length } only
   */
  *records(opts = {}) {
    const h = this.header;
    if (h.encrypted) throw new Error('table is encrypted');
    const wanted = opts.fields
      ? new Set(opts.fields.map((f) => f.toLowerCase()))
      : null;
    const fields = this.fields.map((f) => ({ ...f, wanted: !wanted || wanted.has(f.name.toLowerCase()) }));
    const blobs = opts.blobs ?? 'none';
    const buf = this.buf;
    this.blobErrors = 0;
    for (const { offset, count } of this.blocks()) {
      for (let r = 0; r < count; r += 1) {
        const base = offset + r * h.recordSize;
        if (base + h.recordSize > buf.length) {
          this.chainError = 'record beyond end of file';
          return;
        }
        const row = new Array(fields.length);
        for (const f of fields) {
          if (!f.wanted) continue;
          row[f.index] = this.decodeField(f, base + f.offset, blobs);
        }
        yield row;
      }
    }
  }

  decodeField(f, off, blobs) {
    const buf = this.buf;
    switch (f.typeName) {
      case 'alpha': {
        let end = off;
        const limit = off + f.size;
        while (end < limit && buf[end] !== 0) end += 1;
        if (end === off) return null;
        return decodeText(buf.subarray(off, end), this.codePage);
      }
      case 'date': {
        const v = readFlippedInt(buf, off, 4);
        return v === null ? null : { days: v };
      }
      case 'short':
        return readFlippedInt(buf, off, 2);
      case 'long':
      case 'autoinc':
        return readFlippedInt(buf, off, 4);
      case 'currency':
      case 'number':
        return readFlippedDouble(buf, off);
      case 'logical': {
        const b = buf[off];
        return b & 0x80 ? (b & 0x7f) !== 0 : null;
      }
      case 'time': {
        const v = readFlippedInt(buf, off, 4);
        return v === null ? null : { timeMs: v }; // milliseconds since midnight
      }
      case 'timestamp': {
        const v = readFlippedDouble(buf, off);
        return v === null ? null : { ms: v };
      }
      case 'bcd':
        return readBcd(buf, off, f.size);
      case 'bytes':
        return isAllZero(buf, off, f.size) ? null : buf.subarray(off, off + f.size);
      default:
        if (BLOB_TYPES.has(f.typeName)) return this.decodeBlob(f, off, blobs);
        return undefined;
    }
  }

  decodeBlob(f, off, blobs) {
    const buf = this.buf;
    const leader = f.size - 10;
    const ptrOff = off + leader;
    const mbOffset = buf.readUInt32LE(ptrOff);
    const length = buf.readUInt32LE(ptrOff + 4);
    if (length === 0) return null;
    if (blobs === 'none') return { length, inline: mbOffset === 0 };
    let raw;
    try {
      if (mbOffset === 0 && length <= leader) raw = buf.subarray(off, off + length);
      else if (this.mb) raw = this.mb.read(mbOffset, length);
      else throw new Error('missing .MB file');
    } catch (err) {
      this.blobErrors = (this.blobErrors ?? 0) + 1;
      return { length, error: err.message };
    }
    if (blobs === 'raw') return raw;
    return decodeText(raw, this.codePage);
  }
}

/** Convert a decoded date/timestamp value to { y, m, d, iso } or null. */
export function toCalendarDate(value) {
  if (value == null) return null;
  if (typeof value.days === 'number') return paradoxDayToDate(value.days);
  if (typeof value.ms === 'number') return paradoxDayToDate(Math.floor(value.ms / MS_PER_DAY));
  return null;
}

/** List the .DB tables in a directory (case-insensitive extension). */
export function listTables(dir) {
  return readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() === '.db')
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .map((f) => join(dir, f));
}
