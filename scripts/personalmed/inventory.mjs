#!/usr/bin/env node
// Schema + aggregate inventory of a PersonalMed 2005 export: the Paradox
// tables (.DB/.MB) plus the SQL Server 2000 data file (.mdf) shipped with them.
// Tables are looked up in the Paradox set first, then inside the .mdf.
//
// PRIVACY: the export holds real patient health data (LGPD sensitive data).
// This script prints ONLY schema and aggregates: table/field names, types,
// record counts, file sizes, null rates, distinct counts, value-length
// distributions, date ranges at month precision, masked value shapes
// (every digit -> 9, letter runs -> "a") that occur at least K times,
// and category counts for code-like fields (never for patient keys or
// person-identifying fields). It never prints a patient value.
// --lookup prints code -> label pairs and refuses tables with patient keys or
// person fields; use it only on configuration tables.
//
// Usage (run from the repo; pass the export folder as an argument, never run
// anything from inside the export folder):
//   node scripts/personalmed/inventory.mjs <exportDir>                 # table list + schemas
//   node scripts/personalmed/inventory.mjs <exportDir> --stats [T ...] # per-field aggregates
//   node scripts/personalmed/inventory.mjs <exportDir> --join T1.f=T2.g [--join T1.a+b=T2.a+b]
//   node scripts/personalmed/inventory.mjs <exportDir> --dupes T:f1+f2[+f3]
//   node scripts/personalmed/inventory.mjs <exportDir> --count T:f    # records-per-key quantiles
//   node scripts/personalmed/inventory.mjs <exportDir> --crosstab T:f1,f2?[:past|:k1]
//        (f? = present/null only; :past buckets dates as past/future; :k1 shows
//         single-row cells, allowed only on tables without patient keys)
//   node scripts/personalmed/inventory.mjs <exportDir> --lookup T:code:label[:filterField=value]
//   ... --json <file>   also write the aggregates as JSON (aggregates only)
//   ... --charset       code-page sanity check over all alpha fields
//   ... --mdf <file>    SQL Server data file (default: first *.mdf in exportDir); --no-mdf to skip

import { statSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  ParadoxTable,
  BLOB_TYPES,
  listTables,
  toCalendarDate,
  decodeText,
} from './paradox-reader.mjs';
import { Mdf } from './mssql2000-reader.mjs';
import { rtfToText } from './rtf-to-text.mjs';

const MIN_GROUP = 5; // k-threshold: shapes/categories rarer than this are never shown

function parseArgs(argv) {
  const args = { dir: null, mdf: undefined, stats: null, joins: [], dupes: [], counts: [], crosstabs: [], lookups: [], json: null, charset: false, schema: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--stats') {
      args.stats = [];
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.stats.push(argv[(i += 1)]);
    } else if (a === '--join') args.joins.push(argv[(i += 1)]);
    else if (a === '--dupes') args.dupes.push(argv[(i += 1)]);
    else if (a === '--count') args.counts.push(argv[(i += 1)]);
    else if (a === '--crosstab') args.crosstabs.push(argv[(i += 1)]);
    else if (a === '--lookup') args.lookups.push(argv[(i += 1)]);
    else if (a === '--json') args.json = argv[(i += 1)];
    else if (a === '--charset') args.charset = true;
    else if (a === '--mdf') args.mdf = argv[(i += 1)];
    else if (a === '--no-mdf') args.mdf = null;
    else if (a === '--no-schema') args.schema = false;
    else if (!args.dir) args.dir = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!args.dir) throw new Error('usage: inventory.mjs <exportDir> [--stats [tables]] [--join A.f=B.g] [--dupes T:f1+f2] [--json out]');
  if (args.stats || args.joins.length || args.dupes.length || args.counts.length || args.crosstabs.length || args.lookups.length || args.charset) {
    if (!argv.includes('--schema')) args.schema = false;
  }
  return args;
}

// --- helpers ------------------------------------------------------------------

const fileIndex = new Map(); // lower-case stem -> [{ext, size, mtime}]
function indexDir(dir) {
  for (const f of readdirSync(dir)) {
    const stem = basename(f, extname(f)).toLowerCase();
    const st = statSync(join(dir, f));
    if (!fileIndex.has(stem)) fileIndex.set(stem, []);
    fileIndex.get(stem).push({ ext: extname(f).toUpperCase(), size: st.size, mtime: st.mtime });
  }
}

function sizeOf(stem, ext) {
  return (fileIndex.get(stem.toLowerCase()) ?? []).filter((x) => x.ext === ext).reduce((s, x) => s + x.size, 0);
}

function mtimeOf(stem) {
  const db = (fileIndex.get(stem.toLowerCase()) ?? []).find((x) => x.ext === '.DB');
  return db ? db.mtime.toISOString().slice(0, 10) : '';
}

function fmtBytes(n) {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)}M`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)}K`;
  return `${n}`;
}

const TYPE_ABBR = {
  alpha: 'A', date: 'D', short: 'S', long: 'I', currency: '$', number: 'N', logical: 'L',
  memo: 'M', blob: 'B', fmtmemo: 'F', ole: 'O', graphic: 'G', time: 'T', timestamp: '@',
  autoinc: '+', bcd: '#', bytes: 'Y',
};

function fieldSig(f) {
  const abbr = TYPE_ABBR[f.typeName] ?? f.typeName;
  return f.typeName === 'alpha' || BLOB_TYPES.has(f.typeName) || f.typeName === 'bytes' || f.typeName === 'bcd'
    ? `${f.name}:${abbr}${f.size}`
    : `${f.name}:${abbr}`;
}

/** Mask a value: digits -> 9, runs of letters -> a, whitespace runs -> single space. */
export function maskShape(s) {
  return s
    .replace(/\p{L}+/gu, 'a')
    .replace(/\p{N}/gu, '9')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function quantiles(arr, qs) {
  if (!arr.length) return qs.map(() => null);
  const a = Float64Array.from(arr).sort();
  return qs.map((q) => a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]);
}

function classifyBlob(raw) {
  if (!raw || !raw.length) return 'empty';
  const head = raw.subarray(0, 16);
  const ascii = head.toString('latin1');
  if (ascii.startsWith('{\\rtf')) return 'rtf';
  if (/^\s*<(html|!doctype|body|p|div)/i.test(ascii)) return 'html';
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg';
  if (ascii.startsWith('BM')) return 'bmp';
  if (ascii.startsWith('\x89PNG')) return 'png';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (ascii.startsWith('PK\x03\x04')) return 'zip/office';
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'ole2/doc';
  if (ascii.startsWith('II*\0') || ascii.startsWith('MM\0*')) return 'tiff';
  if (ascii.startsWith('RIFF')) return 'riff(wav/avi)';
  // Paradox graphic fields carry an 8-byte prefix before the image.
  const g = raw.subarray(8, 24).toString('latin1');
  if (g.startsWith('BM')) return 'graphic-bmp';
  if (raw[8] === 0xff && raw[9] === 0xd8) return 'graphic-jpeg';
  let ctrl = 0;
  const n = Math.min(raw.length, 4096);
  for (let i = 0; i < n; i += 1) {
    const b = raw[i];
    if (b < 0x09 || (b > 0x0d && b < 0x20)) ctrl += 1;
  }
  return ctrl / n < 0.02 ? 'text' : 'binary';
}

// dd/mm/yy(yy) date stamps inside free text (used only as a count).
const DATE_STAMP = /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](\d{4}|\d{2})\b/g;

// Fields whose values must never be listed, even as categories.
const PATIENT_KEY = /^(p|pa)?cod$|pcod|patient|pac(iente)?(cod|id)?$|^id$/i;
const PERSON_FIELD = /name|nome|owner|mother|father|m(a|\u00e3)e|pai|prof|medic|address|ender|phone|fone|fax|cel|mail|cpf|cgc|rg|registration|matric|obs|text|content|nota|indicated|homeborn|occupation|district|city|zip|title/i;

function classifyText(s) {
  const head = s.slice(0, 64).trimStart();
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (/^<(html|!doctype|body|p|div|\?xml)/i.test(head)) return 'html/xml';
  return 'text';
}

// Portuguese-specific letters vs characters that indicate a wrong code page.
const PT_LETTERS = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/gu;
const SUSPICIOUS = /[\u2500-\u25ff\u0370-\u03ff\u2200-\u22ff\u0080-\u009f\ufffd]|[\u0192\u2017\u00a4\u00f0\u00d0\u00fe\u00de]/gu;

// --- per-field statistics ----------------------------------------------------------

class FieldStats {
  constructor(field) {
    this.field = field;
    this.total = 0;
    this.nulls = 0;
    this.distinct = new Set();
    this.distinctCapped = false;
    this.lengths = [];
    this.shapes = new Map();
    this.cats = new Map();
    this.min = null;
    this.max = null;
    this.ints = true;
    this.dateYears = new Map();
    this.invalidDates = 0;
    this.futureDates = 0;
    this.blobKinds = new Map();
    this.blobErrors = 0;
    this.plainLengths = [];
    this.dateStamps = [];
    this.rtfPictures = 0;
    this.docsWithPictures = 0;
    this.emptyAfterStrip = 0;
    this.whitespaceOnly = 0;
    this.highBytes = 0;
    this.ptLetters = 0;
    this.suspicious = 0;
  }

  add(v) {
    this.total += 1;
    const t = this.field.typeName;
    if (v === null || v === undefined) {
      this.nulls += 1;
      return;
    }
    if (t === 'alpha') {
      if (!v.trim()) {
        this.whitespaceOnly += 1;
        this.nulls += 1;
        return;
      }
      this.track(v.trim().toUpperCase());
      this.lengths.push(v.length);
      const shape = maskShape(v.trim());
      this.shapes.set(shape, (this.shapes.get(shape) ?? 0) + 1);
      this.cats.set(v.trim(), (this.cats.get(v.trim()) ?? 0) + 1);
      this.ptLetters += (v.match(PT_LETTERS) ?? []).length;
      this.suspicious += (v.match(SUSPICIOUS) ?? []).length;
      return;
    }
    if (t === 'date' || t === 'timestamp') {
      const d = toCalendarDate(v);
      if (!d || d.y < 1880 || d.y > 2100) {
        this.invalidDates += 1;
        return;
      }
      const ym = d.iso.slice(0, 7);
      if (d.iso > new Date().toISOString().slice(0, 10)) this.futureDates += 1;
      if (this.min === null || ym < this.min) this.min = ym;
      if (this.max === null || ym > this.max) this.max = ym;
      this.dateYears.set(d.y, (this.dateYears.get(d.y) ?? 0) + 1);
      this.track(d.iso);
      return;
    }
    if (t === 'time') {
      this.track(v.timeMs);
      return;
    }
    if (BLOB_TYPES.has(t)) {
      if (typeof v === 'string') {
        // Already-decoded text (SQL Server ntext/text).
        if (!v.trim()) {
          this.blobKinds.set('empty', (this.blobKinds.get('empty') ?? 0) + 1);
          return;
        }
        this.lengths.push(v.length);
        const kind = classifyText(v);
        this.blobKinds.set(kind, (this.blobKinds.get(kind) ?? 0) + 1);
        this.textFeatures(kind === 'rtf' ? v : null, kind === 'rtf' ? null : v);
      } else if (Buffer.isBuffer(v)) {
        const raw = v;
        this.lengths.push(raw.length);
        const kind = classifyBlob(raw);
        this.blobKinds.set(kind, (this.blobKinds.get(kind) ?? 0) + 1);
        if (kind === 'text' || kind === 'rtf') {
          const s = decodeText(raw, this.codePage ?? 1252);
          this.textFeatures(kind === 'rtf' ? s : null, kind === 'rtf' ? null : s);
        }
      } else if (v && v.error) {
        this.blobErrors += 1;
      } else if (v && typeof v.length === 'number') {
        this.lengths.push(v.length);
      }
      return;
    }
    if (typeof v === 'number') {
      this.track(v);
      if (!Number.isInteger(v)) this.ints = false;
      if (this.min === null || v < this.min) this.min = v;
      if (this.max === null || v > this.max) this.max = v;
      this.cats.set(String(v), (this.cats.get(String(v)) ?? 0) + 1);
      return;
    }
    if (typeof v === 'boolean') {
      this.cats.set(String(v), (this.cats.get(String(v)) ?? 0) + 1);
      this.track(v);
      return;
    }
    if (Buffer.isBuffer(v)) this.track(v.toString('hex'));
  }

  /** Aggregate features of memo text: plain length, embedded pictures, date-like stamps. */
  textFeatures(rtf, plain) {
    let text = plain;
    if (rtf !== null) {
      const r = rtfToText(rtf, { codePage: this.codePage ?? 1252 });
      text = r.text;
      this.rtfPictures += r.pictures + r.objects;
      if (r.pictures + r.objects) this.docsWithPictures += 1;
    }
    this.plainLengths.push(text.length);
    if (!text.trim()) this.emptyAfterStrip += 1;
    const dates = (text.match(DATE_STAMP) ?? []).length;
    this.dateStamps.push(dates);
    const head = text.slice(0, 8192);
    this.ptLetters += (head.match(PT_LETTERS) ?? []).length;
    this.suspicious += (head.match(SUSPICIOUS) ?? []).length;
  }

  track(key) {
    if (this.distinct.size < 2_000_000) this.distinct.add(key);
    else this.distinctCapped = true;
  }

  summary() {
    const t = this.field.typeName;
    const nonNull = this.total - this.nulls;
    const out = {
      field: this.field.name,
      type: t,
      size: this.field.size,
      nullPct: this.total ? +(100 * this.nulls / this.total).toFixed(1) : null,
      nonNull,
      distinct: this.distinct.size + (this.distinctCapped ? '+' : ''),
    };
    if (t === 'alpha') {
      const [p50, p90, mx] = quantiles(this.lengths, [0.5, 0.9, 1]);
      out.len = { p50, p90, max: mx };
      out.shapes = [...this.shapes.entries()]
        .filter(([, c]) => c >= MIN_GROUP)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, c]) => `${s} (${c})`);
      // Category counts only for code-like values: short codes with few
      // distinct entries, or fixed labels (<= 6 values over >= 1000 rows) in
      // fields that are not person-identifying.
      const codeLike = mx !== null && mx <= 3 && this.cats.size <= 12 && nonNull >= 30;
      const labelLike = this.cats.size <= 6 && nonNull >= 1000 && !PERSON_FIELD.test(this.field.name);
      if ((codeLike || labelLike) && !PATIENT_KEY.test(this.field.name)) out.categories = this.categoryList();
      if (this.ptLetters || this.suspicious) out.charset = { ptLetters: this.ptLetters, suspicious: this.suspicious };
    } else if (t === 'date' || t === 'timestamp') {
      out.range = this.min ? `${this.min} .. ${this.max}` : null;
      if (this.invalidDates) out.invalidDates = this.invalidDates;
      if (this.futureDates) out.futureDates = this.futureDates;
    } else if (BLOB_TYPES.has(t)) {
      const [p50, p90, mx] = quantiles(this.lengths, [0.5, 0.9, 1]);
      out.len = { p50, p90, max: mx };
      if (this.blobKinds.size) out.kinds = Object.fromEntries(this.blobKinds);
      if (this.blobErrors) out.blobErrors = this.blobErrors;
      if (this.plainLengths.length) {
        const [tp50, tp90, tmax] = quantiles(this.plainLengths, [0.5, 0.9, 1]);
        const [d50, d90, dmax] = quantiles(this.dateStamps, [0.5, 0.9, 1]);
        out.plainText = { p50: tp50, p90: tp90, max: tmax, emptyAfterStrip: this.emptyAfterStrip };
        out.dateStampsPerDoc = { p50: d50, p90: d90, max: dmax, docsWith2plus: this.dateStamps.filter((x) => x >= 2).length };
        if (this.rtfPictures) out.embeddedPictures = { total: this.rtfPictures, docs: this.docsWithPictures };
      }
      if (this.ptLetters || this.suspicious) out.charset = { ptLetters: this.ptLetters, suspicious: this.suspicious };
    } else if (['short', 'long', 'autoinc', 'number', 'currency', 'bcd'].includes(t)) {
      out.integer = this.ints;
      // Small integers are keys/codes; large ones may be CPF/phone numbers
      // stored numerically, so only their digit counts are shown.
      if (this.ints && this.min !== null) {
        const big = Math.max(Math.abs(this.min), Math.abs(this.max)) >= 1e7;
        const digits = (x) => String(Math.abs(x)).length;
        out.range = big ? `digits ${digits(this.min)}..${digits(this.max)}` : `${this.min} .. ${this.max}`;
      }
      if (this.cats.size <= 12 && nonNull >= 30 && !PATIENT_KEY.test(this.field.name)) out.categories = this.categoryList();
    } else if (t === 'logical') {
      out.categories = this.categoryList();
    }
    return out;
  }

  categoryList() {
    const shown = [];
    let other = 0;
    for (const [k, c] of [...this.cats.entries()].sort((a, b) => b[1] - a[1])) {
      if (c >= MIN_GROUP) shown.push(`${k}=${c}`);
      else other += c;
    }
    if (other) shown.push(`other(<${MIN_GROUP} each)=${other}`);
    return shown;
  }
}

// --- table access ------------------------------------------------------------------

const tableCache = new Map();
let mdfPath = null; // set in main
let mdfInstance;
function getMdf() {
  if (mdfInstance === undefined) mdfInstance = mdfPath ? new Mdf(mdfPath) : null;
  return mdfInstance;
}

/** Open a Paradox table, or (if no .DB has that name) a table inside the .mdf. */
function openTable(dir, name) {
  const key = name.toLowerCase();
  if (!tableCache.has(key)) {
    const file = readdirSync(dir).find((f) => extname(f).toLowerCase() === '.db' && basename(f, extname(f)).toLowerCase() === key);
    if (file) tableCache.set(key, new ParadoxTable(join(dir, file)));
    else if (getMdf()) tableCache.set(key, getMdf().table(name));
    else throw new Error(`table ${name} not found`);
  }
  return tableCache.get(key);
}

function fieldIndex(table, name) {
  const f = table.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!f) throw new Error(`field ${name} not found in ${table.name}`);
  return f.index;
}

/** Normalise a key value for joins: trim/upper strings, dates to ISO. */
function keyOf(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    return s ? s.replace(/^0+(?=\d)/, '') : null;
  }
  if (typeof v === 'number') return String(v);
  if (v.timeMs !== undefined) return String(v.timeMs);
  if (v.days !== undefined || v.ms !== undefined) return toCalendarDate(v)?.iso ?? null;
  return String(v);
}

// --- modes ------------------------------------------------------------------

function schemaReport(dir) {
  const rows = [];
  for (const p of listTables(dir)) {
    const t = new ParadoxTable(p);
    const h = t.header;
    rows.push({
      table: t.name,
      records: h.numRecords,
      fields: h.numFields,
      keyFields: h.primaryKeyFields,
      recordSize: h.recordSize,
      dbBytes: sizeOf(t.name, '.DB'),
      mbBytes: sizeOf(t.name, '.MB'),
      codePage: h.codePage,
      sortOrder: h.sortOrderName,
      encrypted: h.encrypted,
      modified: mtimeOf(t.name),
      schema: t.fields.map(fieldSig),
    });
  }
  const mdf = getMdf();
  if (mdf) {
    for (const o of mdf.userTables()) {
      const t = mdf.table(o.name);
      let n = 0;
      for (const _ of mdf.rawRecords(o.id)) n += 1;
      rows.push({
        table: `${t.name} (mssql)`,
        records: n,
        fields: t.fields.length,
        keyFields: null,
        dbBytes: t.header.dataPages * 8192,
        mbBytes: t.header.lobPages * 8192,
        codePage: t.codePage,
        sortOrder: `sysindexes.rowcnt=${t.header.numRecords}`,
        encrypted: false,
        modified: '',
        schema: t.fields.map((f) => `${f.name}:${f.sqlType}${['varchar', 'char', 'nvarchar', 'nchar', 'binary', 'varbinary'].includes(f.sqlType) ? `(${f.size})` : ''}`),
      });
    }
  }
  for (const r of rows) {
    console.log(
      `${r.table}\trecs=${r.records}\tflds=${r.fields}\tkey=${r.keyFields}\tdb=${fmtBytes(r.dbBytes)}\tmb=${fmtBytes(r.mbBytes)}\tcp=${r.codePage}\t${r.sortOrder}\t${r.encrypted ? 'ENCRYPTED' : ''}\tmod=${r.modified}`,
    );
    console.log(`  ${r.schema.join(', ')}`);
  }
  return rows;
}

function statsReport(dir, names) {
  const targets = names.length
    ? names
    : [...listTables(dir).map((p) => basename(p, extname(p))), ...(getMdf()?.userTables().map((o) => o.name) ?? [])];
  const results = [];
  for (const name of targets) {
    const t = openTable(dir, name);
    if (t.header.encrypted) {
      console.log(`\n## ${t.name}: ENCRYPTED (skipped)`);
      results.push({ table: t.name, encrypted: true });
      continue;
    }
    const stats = t.fields.map((f) => {
      const s = new FieldStats(f);
      s.codePage = t.codePage;
      return s;
    });
    const blobs = t.source === 'mssql' ? 'text' : t.hasBlobFields && t.mb ? 'raw' : 'none';
    let n = 0;
    for (const row of t.records({ blobs })) {
      n += 1;
      for (let i = 0; i < stats.length; i += 1) stats[i].add(row[i]);
    }
    const summary = stats.map((s) => s.summary());
    console.log(`\n## ${t.name} (${n} records, header says ${t.header.numRecords}${t.chainError ? `, chain error: ${t.chainError}` : ''})`);
    for (const s of summary) {
      const { field, type, size, ...rest } = s;
      console.log(`  ${field} [${type}${size ? ` ${size}` : ''}] ${JSON.stringify(rest)}`);
    }
    results.push({ table: t.name, records: n, fields: summary });
    tableCache.delete(name.toLowerCase());
  }
  return results;
}

/** spec: "Table.field" or "Table.f1+f2+f3" (composite key). */
function collectKeys(dir, spec) {
  const dot = spec.indexOf('.');
  const tname = spec.slice(0, dot);
  const fnames = spec.slice(dot + 1).split('+');
  const t = openTable(dir, tname);
  const idxs = fnames.map((f) => fieldIndex(t, f));
  const keys = new Map();
  let nulls = 0;
  let total = 0;
  for (const row of t.records({ fields: fnames })) {
    total += 1;
    const parts = idxs.map((i) => keyOf(row[i]));
    if (parts.some((x) => x === null)) {
      nulls += 1;
      continue;
    }
    const k = parts.join('|');
    keys.set(k, (keys.get(k) ?? 0) + 1);
  }
  return { table: t.name, field: fnames.join('+'), keys, nulls, total };
}

/** Value used in cross-tabs: dates collapse to year, numbers/strings as-is. */
function bucketOf(v, mode) {
  if (v === null || v === undefined) return '(null)';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v.timeMs !== undefined) return `${String(Math.floor(v.timeMs / 3600000)).padStart(2, '0')}h`;
  if (typeof v === 'object' && (v.days !== undefined || v.ms !== undefined)) {
    const d = toCalendarDate(v);
    if (!d) return '(invalid)';
    if (mode === 'past') return d.iso <= new Date().toISOString().slice(0, 10) ? 'past' : 'future';
    return String(d.y);
  }
  if (typeof v === 'object' && v.length !== undefined) return '(present)';
  if (Buffer.isBuffer(v)) return '(present)';
  return String(v).trim();
}

/**
 * Cross-tab of low-cardinality fields: "T:f1,f2[:past]". Refuses person and
 * patient-key fields; suppresses cells below MIN_GROUP.
 */
function crosstabReport(dir, spec) {
  const [tname, fieldList, mode] = spec.split(':');
  const fields = fieldList.split(',').map((f) => f.replace(/\?$/, ''));
  const presence = new Set(fieldList.split(',').filter((f) => f.endsWith('?')).map((f) => f.slice(0, -1)));
  const t = openTable(dir, tname);
  const hasPatientKey = t.fields.some((f) => PATIENT_KEY.test(f.name));
  // Staff/configuration tables (no patient key) may use mode "k1" to show
  // single-row cells; tables with patient data always keep the k threshold.
  const minCell = mode === 'k1' && !hasPatientKey ? 1 : MIN_GROUP;
  for (const f of fields) {
    const fd = t.fields.find((x) => x.name.toLowerCase() === f.toLowerCase());
    const identifying = PATIENT_KEY.test(f) || (fd?.typeName === 'alpha' && PERSON_FIELD.test(f));
    if (!presence.has(f) && identifying) throw new Error(`refusing to cross-tab identifying field ${f} (use ${f}? for null/present only)`);
  }
  const idxs = fields.map((f) => fieldIndex(t, f));
  const cells = new Map();
  let total = 0;
  for (const row of t.records({ fields })) {
    total += 1;
    const key = idxs.map((i, j) => {
      const v = row[i];
      if (presence.has(fields[j])) return v === null || v === undefined || (typeof v === 'string' && !v.trim()) ? '(null)' : '(present)';
      return bucketOf(v, mode);
    }).join(' | ');
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  if (cells.size > 200) throw new Error(`cross-tab too wide (${cells.size} cells); pick lower-cardinality fields`);
  const shown = [...cells.entries()].sort((a, b) => b[1] - a[1]);
  let suppressed = 0;
  const lines = [];
  for (const [k, c] of shown) {
    if (c < minCell) suppressed += c;
    else lines.push(`  ${k} = ${c}`);
  }
  console.log(`crosstab ${t.name} [${fields.join(' | ')}] rows=${total}`);
  console.log(lines.join('\n'));
  if (suppressed) console.log(`  (cells < ${minCell} suppressed: ${suppressed} rows)`);
  return { spec, total, cells: Object.fromEntries(shown.filter(([, c]) => c >= minCell)), suppressed };
}

/**
 * Print code -> label pairs of a configuration/lookup table: "T:codeField:labelField".
 * Refuses any table that has patient keys or person-identifying fields.
 */
function lookupReport(dir, spec) {
  const [tname, codeField, labelField, filter] = spec.split(':');
  const t = openTable(dir, tname);
  const bad = t.fields.filter((f) => /pcod|patient|^pac/i.test(f.name) || /^(name|nome|address|phone|fone|email|cpf|cgc_cpf|birthdate|pass|webpassword)$/i.test(f.name));
  if (bad.length) throw new Error(`refusing lookup on ${t.name}: has identifying fields (${bad.map((f) => f.name).join(', ')})`);
  const ci = fieldIndex(t, codeField);
  const li = fieldIndex(t, labelField);
  const [ff, fv] = filter ? filter.split('=') : [];
  const fi = ff ? fieldIndex(t, ff) : -1;
  const out = [];
  for (const row of t.records({ fields: ff ? [codeField, labelField, ff] : [codeField, labelField] })) {
    if (fi >= 0 && bucketOf(row[fi]) !== fv) continue;
    out.push([bucketOf(row[ci]), typeof row[li] === 'string' ? row[li].trim().slice(0, 60) : bucketOf(row[li])]);
  }
  console.log(`lookup ${t.name} ${codeField} -> ${labelField} (${out.length} rows)`);
  for (const [c, l] of out.slice(0, 120)) console.log(`  ${c}\t${l}`);
  return { spec, rows: out.length, pairs: out.slice(0, 120) };
}

function joinReport(dir, spec) {
  const [left, right] = spec.split('=');
  const L = collectKeys(dir, left);
  const R = collectKeys(dir, right);
  let matchedRows = 0;
  let matchedKeys = 0;
  for (const [k, c] of L.keys) {
    if (R.keys.has(k)) {
      matchedRows += c;
      matchedKeys += 1;
    }
  }
  const nonNull = L.total - L.nulls;
  const rightDupKeys = [...R.keys.values()].filter((c) => c > 1).length;
  let rightReferenced = 0;
  for (const k of R.keys.keys()) if (L.keys.has(k)) rightReferenced += 1;
  const res = {
    join: spec,
    leftRows: L.total,
    leftNull: L.nulls,
    leftDistinct: L.keys.size,
    leftRowsMatched: matchedRows,
    leftRowsMatchedPct: nonNull ? +(100 * matchedRows / nonNull).toFixed(1) : null,
    leftKeysMatched: matchedKeys,
    rightRows: R.total,
    rightDistinct: R.keys.size,
    rightDuplicateKeys: rightDupKeys,
    rightKeysReferenced: rightReferenced,
    rightKeysReferencedPct: R.keys.size ? +(100 * rightReferenced / R.keys.size).toFixed(1) : null,
  };
  console.log(JSON.stringify(res));
  return res;
}

function dupesReport(dir, spec) {
  const [tname, fieldList] = spec.split(':');
  const fields = fieldList.split('+');
  const t = openTable(dir, tname);
  const idxs = fields.map((f) => fieldIndex(t, f));
  const groups = new Map();
  let incomplete = 0;
  let total = 0;
  for (const row of t.records({ fields })) {
    total += 1;
    const parts = idxs.map((i) => {
      const k = keyOf(row[i]);
      return k === null ? null : k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    });
    if (parts.some((p) => p === null)) {
      incomplete += 1;
      continue;
    }
    const key = parts.join('\u0001');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const dupGroups = [...groups.values()].filter((c) => c > 1);
  const res = {
    dupes: spec,
    rows: total,
    rowsMissingAKeyPart: incomplete,
    distinctCombos: groups.size,
    duplicateGroups: dupGroups.length,
    rowsInDuplicateGroups: dupGroups.reduce((s, c) => s + c, 0),
    largestGroup: dupGroups.length ? Math.max(...dupGroups) : 0,
  };
  console.log(JSON.stringify(res));
  return res;
}

function countReport(dir, spec) {
  const [tname, fname] = spec.split(':');
  const { keys, nulls, total } = collectKeys(dir, `${tname}.${fname}`);
  const per = [...keys.values()];
  const [p50, p90, p99, mx] = quantiles(per, [0.5, 0.9, 0.99, 1]);
  const res = { count: spec, rows: total, nullKey: nulls, distinctKeys: keys.size, perKey: { p50, p90, p99, max: mx } };
  console.log(JSON.stringify(res));
  return res;
}

function charsetReport(dir) {
  const totals = { highBytes: 0, ptLetters: 0, suspicious: 0 };
  const byCp = {};
  for (const p of listTables(dir)) {
    const t = new ParadoxTable(p);
    if (t.header.encrypted) continue;
    const alpha = t.fields.filter((f) => f.typeName === 'alpha').map((f) => f.name);
    if (!alpha.length) continue;
    const cp = t.codePage;
    byCp[cp] ??= { tables: 0, highBytes: 0, ptLetters: 0, suspicious: 0, alt: {} };
    byCp[cp].tables += 1;
    for (const f of t.fields.filter((x) => x.typeName === 'alpha')) {
      for (const { offset, count } of t.blocks()) {
        for (let r = 0; r < count; r += 1) {
          const base = offset + r * t.header.recordSize + f.offset;
          let end = base;
          while (end < base + f.size && t.buf[end] !== 0) end += 1;
          const bytes = t.buf.subarray(base, end);
          let hi = 0;
          for (const b of bytes) if (b >= 0x80) hi += 1;
          if (!hi) continue;
          byCp[cp].highBytes += hi;
          const s = decodeText(bytes, cp);
          byCp[cp].ptLetters += (s.match(PT_LETTERS) ?? []).length;
          byCp[cp].suspicious += (s.match(SUSPICIOUS) ?? []).length;
          for (const alt of [437, 850, 860, 1252]) {
            if (alt === cp) continue;
            const a = decodeText(bytes, alt);
            byCp[cp].alt[alt] ??= { ptLetters: 0, suspicious: 0 };
            byCp[cp].alt[alt].ptLetters += (a.match(PT_LETTERS) ?? []).length;
            byCp[cp].alt[alt].suspicious += (a.match(SUSPICIOUS) ?? []).length;
          }
        }
      }
    }
  }
  console.log(JSON.stringify(byCp, null, 1));
  return byCp;
}

// --- main ------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
indexDir(args.dir);
if (args.mdf !== null) {
  mdfPath = args.mdf ?? (readdirSync(args.dir).filter((f) => extname(f).toLowerCase() === '.mdf').map((f) => join(args.dir, f))[0] ?? null);
}
const out = {};
if (args.schema) out.schema = schemaReport(args.dir);
if (args.stats) out.stats = statsReport(args.dir, args.stats);
if (args.joins.length) out.joins = args.joins.map((j) => joinReport(args.dir, j));
if (args.dupes.length) out.dupes = args.dupes.map((d) => dupesReport(args.dir, d));
if (args.counts.length) out.counts = args.counts.map((c) => countReport(args.dir, c));
if (args.crosstabs.length) out.crosstabs = args.crosstabs.map((c) => crosstabReport(args.dir, c));
if (args.lookups.length) out.lookups = args.lookups.map((l) => lookupReport(args.dir, l));
if (args.charset) out.charset = charsetReport(args.dir);
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
