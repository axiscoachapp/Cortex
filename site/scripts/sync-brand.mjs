// Copies the brand source of truth (../brand) into the site before each build.
// - logos  → public/brand/*.svg and public/favicon.svg
// - tokens → src/styles/tokens.css (imported by the CSS and parsed by tailwind.config.js)
// The copies are committed so the site still builds when ../brand is not available
// (for example a Vercel project that only checks out the `site` folder).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = resolve(siteDir, '..', 'brand');

const targets = [];
if (existsSync(brandDir)) {
  const logoDir = join(brandDir, 'logo');
  for (const name of readdirSync(logoDir).filter((n) => n.endsWith('.svg'))) {
    targets.push([join(logoDir, name), join(siteDir, 'public', 'brand', name)]);
  }
  targets.push([join(logoDir, 'favicon.svg'), join(siteDir, 'public', 'favicon.svg')]);
  targets.push([join(brandDir, 'tokens.css'), join(siteDir, 'src', 'styles', 'tokens.css')]);

  let changed = 0;
  for (const [from, to] of targets) {
    mkdirSync(dirname(to), { recursive: true });
    const before = existsSync(to) ? readFileSync(to, 'utf8') : null;
    copyFileSync(from, to);
    if (before !== readFileSync(to, 'utf8')) changed += 1;
  }
  console.log(`[sync-brand] ${targets.length} arquivos de ../brand conferidos (${changed} atualizados).`);
} else {
  const required = [join(siteDir, 'src', 'styles', 'tokens.css'), join(siteDir, 'public', 'brand', 'cortex-logo.svg')];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length) {
    console.error(`[sync-brand] ../brand não encontrado e faltam cópias: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.warn('[sync-brand] ../brand não encontrado; usando as cópias versionadas em site/.');
}
