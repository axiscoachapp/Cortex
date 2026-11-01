// Read-only reader for a detached SQL Server 2000 (MSDE 2000) data file (.mdf),
// as shipped next to the PersonalMed 2005 Paradox tables. Lets the export be
// analysed without attaching it to any database server.
//
// Scope: enough of the on-disk format to list user tables, their columns and
// row counts, and to decode in-row values plus text/ntext/image (LOB) data.
// Not supported: row compression, sparse columns, SQL 2005+ catalog layout.
//
// Format notes (verified against this file, not assumed):
//  - 8 KB pages, 96-byte header; slot array grows backwards from the page end.
//  - SQL 2000 headers carry the real object id (m_objId @24) and index id
//    (m_indexId @6; 0 = data, 255 = text/image).
//  - Torn-page detection is on: when m_flagBits & 0x100, the low two bits of
//    the last byte of sectors 1..15 hold a toggle pattern, and the original
//    bits live in m_tornBits (@60) at bit positions 2*sector.
//  - PFS pages (page 1, then every 8088 pages) say whether a page is allocated;
//    unallocated pages may still hold stale rows and are skipped.
//
// This module never prints values. The data are patient records; callers must
// keep output to schema and aggregates.

import { readFileSync } from 'node:fs';
import { decodeText } from './paradox-reader.mjs';

const PAGE = 8192;
const PFS_INTERVAL = 8088;

export const SQL_TYPES = {
  34: 'image', 35: 'text', 36: 'uniqueidentifier', 48: 'tinyint', 52: 'smallint', 56: 'int',
  58: 'smalldatetime', 59: 'real', 60: 'money', 61: 'datetime', 62: 'float', 99: 'ntext',
  104: 'bit', 106: 'decimal', 108: 'numeric', 122: 'smallmoney', 127: 'bigint',
  165: 'varbinary', 167: 'varchar', 173: 'binary', 175: 'char', 189: 'timestamp',
  231: 'nvarchar', 239: 'nchar',
};

// Map SQL types onto the Paradox-style type names used by inventory.mjs.
const TYPE_TO_PX = {
  int: 'long', smallint: 'short', tinyint: 'short', bigint: 'number', bit: 'logical',
  datetime: 'timestamp', smalldatetime: 'timestamp', float: 'number', real: 'number',
  money: 'currency', smallmoney: 'currency', decimal: 'number', numeric: 'number',
  char: 'alpha', varchar: 'alpha', nchar: 'alpha', nvarchar: 'alpha',
  text: 'memo', ntext: 'memo', image: 'blob',
  binary: 'bytes', varbinary: 'bytes', uniqueidentifier: 'bytes', timestamp: 'bytes',
};

// Paradox day number of 1900-01-01 (SQL Server datetime epoch).
const SQL_EPOCH_PARADOX_DAY = 693_596;

// LOB structure types observed in this file (empirically verified):
//  3 = DATA fragment: payload from offset 14 to the record length.
//  2 = INTERNAL node, 4 = root (84 bytes): MaxLinks@14, CurLinks@16, Level@18,
//      links from @24, 12 bytes each {cumulative end offset u32, RID 8 bytes}.
//  8 = indirection root: CurLinks@16 == 0 means empty text; otherwise the RID
//      at @28 (link 0) points at the root that holds the data (often another
//      type 8 or a type 4) - observed after text updates.
//  0 = small root (data inline from @20, size u16@14) - kept for completeness.
const LOB = { SMALL_ROOT: 0, INTERNAL: 2, DATA: 3, ROOT: 4, INDIRECT: 8 };

export class Mdf {
  constructor(path, opts = {}) {
    this.path = path;
    this.buf = readFileSync(path);
    this.pageCount = Math.floor(this.buf.length / PAGE);
    this.textCodePage = opts.codePage ?? 1252;
    this.tornFixed = 0;
    this.fixTornPages();
    this.indexPages();
    this.readCatalog();
  }

  fixTornPages() {
    const buf = this.buf;
    for (let p = 0; p < this.pageCount; p += 1) {
      const o = p * PAGE;
      if (buf[o] !== 1 || !(buf.readUInt16LE(o + 4) & 0x100)) continue;
      const torn = buf.readUInt32LE(o + 60);
      for (let s = 1; s < 16; s += 1) {
        const b = o + s * 512 + 511;
        buf[b] = (buf[b] & ~3) | ((torn >>> (2 * s)) & 3);
      }
      this.tornFixed += 1;
    }
  }

  isAllocated(page) {
    const pfs = page < PFS_INTERVAL ? 1 : Math.floor(page / PFS_INTERVAL) * PFS_INTERVAL;
    const base = page < PFS_INTERVAL ? 0 : pfs;
    return (this.buf[pfs * PAGE + 100 + (page - base)] & 0x40) !== 0;
  }

  indexPages() {
    this.dataPages = new Map(); // objId -> [page numbers] (type 1, allocated)
    this.stalePages = new Map(); // objId -> count of unallocated data pages
    this.lobPageCount = new Map();
    for (let p = 0; p < this.pageCount; p += 1) {
      const o = p * PAGE;
      if (this.buf[o] !== 1) continue;
      const type = this.buf[o + 1];
      const objId = this.buf.readInt32LE(o + 24);
      if (type === 1) {
        if (!this.isAllocated(p)) {
          this.stalePages.set(objId, (this.stalePages.get(objId) ?? 0) + 1);
          continue;
        }
        if (!this.dataPages.has(objId)) this.dataPages.set(objId, []);
        this.dataPages.get(objId).push(p);
      } else if (type === 3 || type === 4) {
        if (this.isAllocated(p)) this.lobPageCount.set(objId, (this.lobPageCount.get(objId) ?? 0) + 1);
      }
    }
  }

  /** Parse the FixedVar record at absolute offset `base`. */
  parseRecord(base) {
    const buf = this.buf;
    const statusA = buf[base];
    const type = (statusA >> 1) & 7;
    const fixedEnd = buf.readUInt16LE(base + 2);
    const ncol = buf.readUInt16LE(base + fixedEnd);
    const nullLen = Math.ceil(ncol / 8);
    const nullOff = base + fixedEnd + 2;
    const vars = [];
    if (statusA & 0x20) {
      const vo = nullOff + nullLen;
      const nv = buf.readUInt16LE(vo);
      let start = vo + 2 + nv * 2;
      for (let i = 0; i < nv; i += 1) {
        const raw = buf.readUInt16LE(vo + 2 + i * 2);
        const end = base + (raw & 0x7fff);
        vars.push([start, end]);
        start = end;
      }
    }
    return { base, type, fixedEnd, ncol, nullOff, vars };
  }

  /** Yield parsed live (primary or forwarded) records of an object's data pages. */
  *rawRecords(objId) {
    const buf = this.buf;
    for (const p of this.dataPages.get(objId) ?? []) {
      const o = p * PAGE;
      const slots = buf.readUInt16LE(o + 22);
      for (let s = 0; s < slots; s += 1) {
        const off = buf.readUInt16LE(o + PAGE - 2 - 2 * s);
        if (off < 96 || off >= PAGE) continue;
        const rec = this.parseRecord(o + off);
        if (rec.type === 0 || rec.type === 1) yield rec;
      }
    }
  }

  varBytes(rec, idx) {
    const v = rec.vars[idx];
    return v && v[1] > v[0] ? this.buf.subarray(v[0], v[1]) : null;
  }

  readCatalog() {
    const buf = this.buf;
    this.objects = new Map();
    for (const r of this.rawRecords(1)) {
      const id = buf.readInt32LE(r.base + 4);
      const xtype = buf.toString('latin1', r.base + 8, r.base + 10).trim();
      const name = this.varBytes(r, 0)?.toString('utf16le') ?? '';
      this.objects.set(id, { id, xtype, name });
    }
    this.columns = new Map();
    for (const r of this.rawRecords(3)) {
      const id = buf.readInt32LE(r.base + 4);
      const col = {
        name: this.varBytes(r, 0)?.toString('utf16le') ?? '',
        xtype: buf[r.base + 8],
        length: buf.readInt16LE(r.base + 12),
        prec: buf[r.base + 14],
        scale: buf[r.base + 15],
        colid: buf.readInt16LE(r.base + 16),
        xoffset: buf.readInt16LE(r.base + 18),
        bitpos: buf[r.base + 20],
        colstat: buf.readInt16LE(r.base + 22),
        number: buf.readInt16LE(r.base + 32),
      };
      col.sqlType = SQL_TYPES[col.xtype] ?? `xtype${col.xtype}`;
      col.identity = (col.colstat & 1) !== 0;
      if (!this.columns.has(id)) this.columns.set(id, []);
      this.columns.get(id).push(col);
    }
    for (const cols of this.columns.values()) cols.sort((a, b) => a.colid - b.colid);
    this.sysindexes = [];
    for (const r of this.rawRecords(2)) {
      this.sysindexes.push({
        id: buf.readInt32LE(r.base + 4),
        indid: buf.readInt16LE(r.base + 18),
        rowcnt: Number(buf.readBigInt64LE(r.base + 44)),
        name: this.varBytes(r, 1)?.toString('utf16le') ?? null,
      });
    }
  }

  userTables() {
    return [...this.objects.values()].filter((o) => o.xtype === 'U' && o.name !== 'dtproperties');
  }

  table(name) {
    const obj = [...this.objects.values()].find((o) => o.xtype === 'U' && o.name.toLowerCase() === name.toLowerCase());
    if (!obj) throw new Error(`table ${name} not found in ${this.path}`);
    return new MdfTable(this, obj);
  }

  // --- LOB ------------------------------------------------------------------

  lobRecord(page, slot) {
    if (page <= 0 || page >= this.pageCount) throw new Error('LOB page out of range');
    const o = page * PAGE;
    const t = this.buf[o + 1];
    if (t !== 3 && t !== 4) throw new Error(`LOB pointer to page type ${t}`);
    const off = this.buf.readUInt16LE(o + PAGE - 2 - 2 * slot);
    if (off < 96 || off >= PAGE) throw new Error('bad LOB slot');
    const base = o + off;
    return { base, length: this.buf.readUInt16LE(base + 2), lobType: this.buf.readUInt16LE(base + 12) };
  }

  /**
   * Resolve a 16-byte text pointer. Returns { size, chunks(maxBytes) } or throws.
   * Structures handled: SMALL_ROOT, LARGE_ROOT, INTERNAL, DATA.
   */
  readLob(ptr, maxBytes = Infinity) {
    const page = ptr.readUInt32LE(8);
    const slot = ptr.readUInt16LE(14);
    const buf = this.buf;
    const parts = [];
    let collected = 0;
    const visit = (pg, sl, depth) => {
      if (depth > 32) throw new Error('LOB structure too deep');
      const rec = this.lobRecord(pg, sl);
      const b = rec.base;
      switch (rec.lobType) {
        case LOB.SMALL_ROOT: {
          const size = buf.readUInt16LE(b + 14);
          parts.push(buf.subarray(b + 20, b + 20 + size));
          collected += size;
          return;
        }
        case LOB.DATA: {
          const data = buf.subarray(b + 14, b + rec.length);
          parts.push(data);
          collected += data.length;
          return;
        }
        case LOB.INDIRECT: {
          if (buf.readUInt16LE(b + 16) === 0) return; // empty text
          visit(buf.readUInt32LE(b + 28), buf.readUInt16LE(b + 34), depth + 1);
          return;
        }
        case LOB.ROOT:
        case LOB.INTERNAL: {
          // Root links: from @24, 12 bytes {end u32, RID}. Internal-node
          // links: from @20, 16 bytes {end u64, RID}.
          const curLinks = buf.readUInt16LE(b + 16);
          const isRoot = rec.lobType === LOB.ROOT;
          const start = isRoot ? 24 : 20;
          const width = isRoot ? 12 : 16;
          if (start + curLinks * width > rec.length) throw new Error('implausible LOB link count');
          let prevEnd = 0;
          for (let i = 0; i < curLinks && collected < maxBytes; i += 1) {
            const l = b + start + i * width;
            const end = isRoot ? buf.readUInt32LE(l) : Number(buf.readBigUInt64LE(l));
            if (end < prevEnd) throw new Error('LOB links out of order');
            prevEnd = end;
            const rid = l + width - 8;
            visit(buf.readUInt32LE(rid), buf.readUInt16LE(rid + 6), depth + 1);
          }
          return;
        }
        default:
          throw new Error(`unsupported LOB structure type ${rec.lobType}`);
      }
    };
    visit(page, slot, 0);
    const data = Buffer.concat(parts);
    return { size: data.length, data: maxBytes < data.length ? data.subarray(0, maxBytes) : data };
  }

  decodeDateTime(buf, off) {
    const ticks = buf.readUInt32LE(off);
    const days = buf.readInt32LE(off + 4);
    return { days: days + SQL_EPOCH_PARADOX_DAY, msOfDay: Math.round(ticks * (1000 / 300)) };
  }
}

export class MdfTable {
  constructor(mdf, obj) {
    this.mdf = mdf;
    this.obj = obj;
    this.name = obj.name;
    this.source = 'mssql';
    const cols = mdf.columns.get(obj.id) ?? [];
    this.fields = cols.map((c, index) => ({
      index,
      name: c.name || `col${c.colid}`,
      typeName: TYPE_TO_PX[c.sqlType] ?? c.sqlType,
      sqlType: c.sqlType,
      size: c.length,
      col: c,
    }));
    const ix = mdf.sysindexes.find((i) => i.id === obj.id && (i.indid === 0 || i.indid === 1));
    this.header = {
      numRecords: ix ? ix.rowcnt : null,
      encrypted: false,
      dataPages: (mdf.dataPages.get(obj.id) ?? []).length,
      lobPages: mdf.lobPageCount.get(obj.id) ?? 0,
      stalePages: mdf.stalePages.get(obj.id) ?? 0,
    };
    this.codePage = mdf.textCodePage;
    this.hasBlobFields = this.fields.some((f) => ['memo', 'blob'].includes(f.typeName));
    this.mb = this.hasBlobFields ? true : null;
  }

  /**
   * Iterate rows as arrays aligned with `fields`.
   * blobs: 'none' -> { length: null, pointer: true } for non-null LOBs;
   *        'raw'  -> Buffer of LOB bytes; 'text' -> decoded string.
   */
  *records(opts = {}) {
    const wanted = opts.fields ? new Set(opts.fields.map((f) => f.toLowerCase())) : null;
    const blobs = opts.blobs ?? 'none';
    const m = this.mdf;
    const buf = m.buf;
    // Null bitmap: one bit per column in colid order (verified: no var
    // column with its null bit set carries data in this file).
    this.blobErrors = 0;
    for (const rec of m.rawRecords(this.obj.id)) {
      const row = new Array(this.fields.length);
      for (const f of this.fields) {
        if (wanted && !wanted.has(f.name.toLowerCase())) continue;
        const c = f.col;
        const nullBit = c.colid - 1;
        const isNull = nullBit < rec.ncol && (buf[rec.nullOff + (nullBit >> 3)] & (1 << (nullBit & 7))) !== 0;
        if (c.xoffset < 0) {
          const vIdx = (-c.xoffset & 0xff) - 1;
          const bytes = m.varBytes(rec, vIdx);
          if (isNull || !bytes) {
            row[f.index] = null;
            continue;
          }
          row[f.index] = this.decodeVar(c, bytes, blobs);
        } else {
          if (isNull) {
            row[f.index] = null;
            continue;
          }
          row[f.index] = this.decodeFixed(c, rec.base + c.xoffset);
        }
      }
      yield row;
    }
  }

  decodeFixed(c, off) {
    const buf = this.mdf.buf;
    switch (c.sqlType) {
      case 'int': return buf.readInt32LE(off);
      case 'smallint': return buf.readInt16LE(off);
      case 'tinyint': return buf[off];
      case 'bigint': return Number(buf.readBigInt64LE(off));
      case 'bit': return (buf[off] & (1 << c.bitpos)) !== 0;
      case 'datetime': return this.mdf.decodeDateTime(buf, off);
      case 'smalldatetime': return { days: buf.readUInt16LE(off + 2) + SQL_EPOCH_PARADOX_DAY, msOfDay: buf.readUInt16LE(off) * 60000 };
      case 'float': return buf.readDoubleLE(off);
      case 'real': return buf.readFloatLE(off);
      case 'money': return Number(buf.readBigInt64LE(off)) / 10000;
      case 'smallmoney': return buf.readInt32LE(off) / 10000;
      case 'char': return decodeText(buf.subarray(off, off + c.length), this.codePage).trimEnd() || null;
      case 'nchar': return buf.subarray(off, off + c.length).toString('utf16le').trimEnd() || null;
      case 'binary':
      case 'uniqueidentifier':
      case 'timestamp': return buf.subarray(off, off + c.length);
      case 'decimal':
      case 'numeric': {
        const sign = buf[off] === 1 ? 1 : -1;
        let v = 0n;
        for (let i = c.length - 1; i >= 1; i -= 1) v = (v << 8n) | BigInt(buf[off + i]);
        return sign * Number(v) / 10 ** c.scale;
      }
      default: return undefined;
    }
  }

  decodeVar(c, bytes, blobs) {
    switch (c.sqlType) {
      case 'varchar': return decodeText(bytes, this.codePage);
      case 'nvarchar': return bytes.toString('utf16le');
      case 'varbinary': return bytes;
      case 'text':
      case 'ntext':
      case 'image': {
        if (bytes.length !== 16) return { length: bytes.length, inRow: true };
        if (blobs === 'none') return { length: null, pointer: true };
        try {
          const { data } = this.mdf.readLob(bytes);
          if (blobs === 'raw') return data;
          return c.sqlType === 'ntext' ? data.toString('utf16le') : decodeText(data, this.codePage);
        } catch (err) {
          this.blobErrors += 1;
          return { length: null, error: err.message };
        }
      }
      default: return bytes;
    }
  }
}
