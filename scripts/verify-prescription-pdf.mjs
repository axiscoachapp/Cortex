// Synthetic runtime fixture: executes the production edge handler with real PDF
// and QR libraries. Pass directories containing pdf-lib and qrcode respectively.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/verify-prescription-pdf.mjs <pdf-node-modules> <qr-node-modules>');
const pdf = require(path.resolve(process.argv[2], 'pdf-lib'));
const qr = require(path.resolve(process.argv[3], 'qrcode'));
const user = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
let storedPdf;
const rows = {};
const database = {
  from(table) {
    let operation = 'select', value;
    const query = {
      select: () => query, eq: () => query,
      insert: input => { operation = 'insert'; value = input; return query; },
      update: input => { operation = 'update'; value = input; return query; },
      delete: () => { operation = 'delete'; return query; },
      maybeSingle: async () => execute(),
      then: resolve => Promise.resolve(execute()).then(resolve),
    };
    function execute() {
      if (table === 'user_settings') return { data: { doctor_name: 'Dra. Profissional Sintética de Verificação', crm_number: '00000', crm_uf: 'SP', professional_address: 'Rua de Verificação Sintética, 1000, Consultório 20 - São Paulo, SP' }, error: null };
      if (table === 'patients') return { data: { id: patientId, name: 'Paciente Sintético com Nome Extenso para Verificar a Quebra de Linha e Continuidade em Todas as Páginas do Receituário', age: 44, medications: [] }, error: null };
      if (operation === 'insert') rows[table] = { ...value };
      if (operation === 'update') Object.assign(rows[table], value);
      return { data: rows[table] ?? null, error: null };
    }
    return query;
  },
  storage: { from: () => ({ upload: async (_name, bytes) => { storedPdf = bytes; return { error: null }; }, createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/synthetic.pdf' }, error: null }), remove: async () => ({ error: null }) }) },
};
function compile(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function localModule(relative) {
  const exports = {};
  new Function('exports', compile(relative))(exports);
  return exports;
}
const layout = localModule('supabase/functions/_shared/documentLayout.ts');
const http = localModule('supabase/functions/_shared/http.ts');
let handler;
const dependencies = id => {
  if (id.includes('/http/server.ts')) return { serve: value => { handler = value; } };
  if (id.includes('@supabase/supabase-js')) return { createClient: () => database };
  if (id.includes('pdf-lib@')) return pdf;
  if (id.includes('qrcode@')) return qr;
  if (id === '../_shared/documentLayout.ts') return layout;
  if (id === '../_shared/http.ts') return http;
  if (id === '../_shared/auth.ts') return { requireUser: async () => ({ userId: user }), AuthError: class extends Error {} };
  throw new Error(`Unexpected dependency ${id}`);
};
const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', ALLOWED_ORIGIN: 'https://example.invalid' };
new Function('require', 'exports', 'Deno', compile('supabase/functions/generate-prescription/index.ts'))(dependencies, {}, { env: { get: key => env[key] } });
const footerPages = new Set();
const drawing = [];
const drawText = pdf.PDFPage.prototype.drawText, drawLine = pdf.PDFPage.prototype.drawLine, drawImage = pdf.PDFPage.prototype.drawImage;
let qrImages = 0;
pdf.PDFPage.prototype.drawImage = function(image, options) { qrImages++; return drawImage.call(this, image, options); };
pdf.PDFPage.prototype.drawLine = function(options) { if (options.start.y === 168) footerPages.add(this); return drawLine.call(this, options); };
pdf.PDFPage.prototype.drawText = function(text, options) {
  drawing.push({ text, page: this, body: !footerPages.has(this), ...options });
  return drawText.call(this, text, options);
};
const medications = Array.from({ length: 15 }, (_, i) => ({
  name: `Medicamento ${String(i + 1).padStart(2, '0')} de verificação sintética com nome prolongado`, dosage: '500 mg',
  instructions: `Instrução ${String(i + 1).padStart(2, '0')}: ` + 'Orientação sintética extensa para testar a preservação integral do texto em todas as páginas. '.repeat(8),
}));
const response = await handler(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ patientId, docType: 'receita_simples', medications }) }));
if (!response.ok || !storedPdf) throw new Error(`PDF fixture failed: ${await response.text()}`);
const loaded = await pdf.PDFDocument.load(storedPdf);
if (loaded.getPageCount() < 3) throw new Error('Long fixture did not exercise at least three pages');
if (qrImages !== loaded.getPageCount()) throw new Error('QR generation did not run on every page');
for (let i = 1; i <= 15; i++) {
  if (!drawing.some(row => row.text.startsWith(`${i}. Medicamento ${String(i).padStart(2, '0')}`))) throw new Error(`Medication ${i} missing`);
}
for (const row of drawing.filter(row => row.body)) {
  if (row.y < 190) throw new Error(`Body overlaps reserved footer at ${row.y}`);
  if (row.font.widthOfTextAtSize(row.text, row.size) > 595.28 - 56 - row.x + 0.01) throw new Error('Text exceeds the page width');
}
if (drawing.filter(row => row.text.startsWith('Documento gerado eletronicamente')).some(row => row.y >= 58)) throw new Error('Signature notice overlaps the QR code');
if ((drawing.filter(row => row.body).map(row => row.text).join(' ').match(/Orientação/g) ?? []).length !== 120) throw new Error('Prescription instructions were lost');
const sha256 = createHash('sha256').update(storedPdf).digest('hex');
const out = path.join(root, `docs/reviews/2026-10-27/remediation/prescription-verified-${sha256.slice(0, 12)}.pdf`);
fs.mkdirSync(path.dirname(out), { recursive: true });
if (!fs.existsSync(out)) fs.writeFileSync(out, storedPdf, { flag: 'wx' });
console.log(JSON.stringify({ path: out, sha256, pages: loaded.getPageCount(), medications: medications.length, bodyLines: drawing.filter(row => row.body).length, footers: footerPages.size, qrImages }));
