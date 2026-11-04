// Blind review package for the doctors (Part B3/B4 of
// docs/ai/PLANO_IA_EFICIENCIA_E_AVALIACAO.md). Outputs are shuffled per case
// and labelled A/B/C...; the key that maps labels back to candidates is
// written apart from the review material and must not reach the reviewers.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Rubric of B3, 1 to 5 each, plus the critical-error flag and edit time. */
export const RUBRIC = [
  { id: 'fidelidade', label: 'Fidelidade ao que foi dito' },
  { id: 'omissoes', label: 'Sem omissões importantes' },
  { id: 'inventado', label: 'Sem informação inventada' },
  { id: 'negacoes', label: 'Negações corretas' },
  { id: 'medicacao', label: 'Medicação e dose corretas' },
  { id: 'soap', label: 'Organização SOAP' },
];

/** Deterministic shuffle: same seed and case give the same order. */
function shuffled(list, seed, salt) {
  const keyed = list.map((item) => ({ item, k: createHash('sha256').update(`${seed}|${salt}|${item}`).digest('hex') }));
  return keyed.sort((a, b) => (a.k < b.k ? -1 : 1)).map((x) => x.item);
}

/**
 * @param outputs [{ candidate, caseId, task, content }] where content is text
 * @param seed    any string; record it with the key
 * @returns { items: [{ caseId, task, label, content }], key: { [caseId|task]: { label: candidate } } }
 */
export function buildBlindPackage(outputs, { seed }) {
  if (!seed) throw new Error('A seed is required so the package can be rebuilt and audited.');
  const groups = new Map();
  for (const o of outputs) {
    const g = `${o.caseId}|${o.task}`;
    if (!groups.has(g)) groups.set(g, new Map());
    if (groups.get(g).has(o.candidate)) throw new Error(`Duplicate output for ${o.candidate} in ${g}`);
    groups.get(g).set(o.candidate, o.content);
  }
  const candidates = [...new Set(outputs.map((o) => o.candidate))].sort();
  const items = [];
  const key = {};
  for (const [g, byCandidate] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const missing = candidates.filter((c) => !byCandidate.has(c));
    if (missing.length) throw new Error(`${g} lacks outputs from ${missing.join(', ')}: every candidate must answer every case`);
    const [caseId, task] = g.split('|');
    key[g] = {};
    shuffled(candidates, seed, g).forEach((candidate, i) => {
      const label = String.fromCharCode(65 + i);
      key[g][label] = candidate;
      items.push({ caseId, task, label, content: byCandidate.get(candidate) });
    });
  }
  return { items, key, seed };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Self-contained review page: no network, scores exported as a JSON file. */
export function reviewPage(items, { title = 'Avaliação às cegas — Cortex' } = {}) {
  const groups = new Map();
  for (const it of items) {
    const g = `${it.caseId}|${it.task}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const rubricRows = (g, label) =>
    RUBRIC.map(
      (r) =>
        `<label class="row"><span>${escapeHtml(r.label)}</span><select data-g="${escapeHtml(g)}" data-l="${label}" data-c="${r.id}"><option value="">—</option>${[1, 2, 3, 4, 5]
          .map((n) => `<option>${n}</option>`)
          .join('')}</select></label>`,
    ).join('');
  const sections = [...groups]
    .map(
      ([g, list]) => `
<section>
  <h2>${escapeHtml(g.replace('|', ' · '))}</h2>
  <div class="grid">${list
    .map(
      (it) => `
    <article>
      <h3>Saída ${it.label}</h3>
      <pre>${escapeHtml(it.content)}</pre>
      ${rubricRows(g, it.label)}
      <label class="row"><span>Minutos para deixar aprovável</span><input type="number" min="0" step="0.5" data-g="${escapeHtml(g)}" data-l="${it.label}" data-c="minutos"></label>
      <label class="row crit"><span>Erro crítico (dose, medicamento, achado inventado, negação invertida)</span><input type="checkbox" data-g="${escapeHtml(g)}" data-l="${it.label}" data-c="critico"></label>
      <textarea placeholder="Comentário (opcional)" data-g="${escapeHtml(g)}" data-l="${it.label}" data-c="comentario"></textarea>
    </article>`,
    )
    .join('')}
  </div>
</section>`,
    )
    .join('');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#2b2620;--muted:#6b6258;--line:#e4ddd2;--accent:#7a5a1c;--crit:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#1d1a16;--fg:#ece6dc;--muted:#a89f93;--line:#3a342c;--accent:#d8b46a;--crit:#ff8a80}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
h1{font-size:1.4rem}h2{font-size:1.1rem;border-top:1px solid var(--line);padding-top:16px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
article{border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.45 ui-monospace,monospace;max-height:420px;overflow:auto}
.row{display:flex;justify-content:space-between;gap:8px;margin:6px 0;align-items:center}
.crit span{color:var(--crit)}textarea{width:100%;box-sizing:border-box;min-height:56px}
button{background:var(--accent);color:var(--bg);border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
.note{color:var(--muted)}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="note">As saídas não têm o nome do serviço. A ordem muda em cada caso. Dê as notas de 1 (ruim) a 5 (ótimo), marque qualquer erro crítico e, no fim, exporte o arquivo de notas.</p>
<label class="row"><span>Seu nome ou iniciais</span><input id="reviewer" autocomplete="off"></label>
${sections}
<p><button id="export">Exportar notas</button></p>
<script>
document.getElementById('export').addEventListener('click', () => {
  const scores = {};
  for (const el of document.querySelectorAll('[data-g]')) {
    const k = el.dataset.g + '|' + el.dataset.l;
    scores[k] = scores[k] || {};
    scores[k][el.dataset.c] = el.type === 'checkbox' ? el.checked : el.value === '' ? null : el.type === 'number' || el.tagName === 'SELECT' ? Number(el.value) : el.value;
  }
  const blob = new Blob([JSON.stringify({ reviewer: document.getElementById('reviewer').value, exportedAt: new Date().toISOString(), scores }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notas-avaliacao-cortex.json';
  a.click();
});
</script>
</body></html>
`;
}

/** Review material and key in separate folders: hand out only `review/`. */
export function writeBlindPackage(dir, pkg) {
  mkdirSync(join(dir, 'review'), { recursive: true });
  mkdirSync(join(dir, 'key'), { recursive: true });
  writeFileSync(join(dir, 'review', 'index.html'), reviewPage(pkg.items));
  writeFileSync(join(dir, 'key', 'key.json'), `${JSON.stringify({ seed: pkg.seed, key: pkg.key }, null, 2)}\n`);
}

/**
 * Exported score files + key -> per-candidate results.
 * @param exports [{ reviewer, scores: { 'case|task|A': { fidelidade: 4, ..., minutos, critico } } }]
 */
export function unblind(exports, key) {
  const byCandidate = {};
  for (const ex of exports) {
    for (const [k, s] of Object.entries(ex.scores)) {
      const [caseId, task, label] = k.split('|');
      const candidate = key[`${caseId}|${task}`]?.[label];
      if (!candidate) throw new Error(`Score ${k} has no entry in the key`);
      const c = (byCandidate[candidate] ??= { ratings: {}, minutes: [], critical: 0, reviews: 0 });
      c.reviews += 1;
      if (s.critico) c.critical += 1;
      if (typeof s.minutos === 'number') c.minutes.push(s.minutos);
      for (const r of RUBRIC) if (typeof s[r.id] === 'number') (c.ratings[r.id] ??= []).push(s[r.id]);
    }
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return Object.fromEntries(
    Object.entries(byCandidate)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([candidate, c]) => [
        candidate,
        {
          reviews: c.reviews,
          criticalErrors: c.critical,
          medianEditMinutes: median(c.minutes),
          meanByCriterion: Object.fromEntries(RUBRIC.map((r) => [r.id, mean(c.ratings[r.id] ?? [])])),
        },
      ]),
  );
}
