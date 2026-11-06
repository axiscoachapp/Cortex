// Writes one static HTML file per route into dist/, injecting the hashed CSS/JS
// from the client build manifest. Also writes sitemap.xml and robots.txt.
// Runs after `vite build` (client) and `vite build --ssr src/entry-server.tsx`.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'production';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(siteDir, 'dist');
const ssrEntry = join(siteDir, 'dist-ssr', 'entry-server.js');
const manifestPath = join(distDir, '.vite', 'manifest.json');

if (!existsSync(manifestPath) || !existsSync(ssrEntry)) {
  console.error('[prerender] Rode antes `vite build` e `vite build --ssr src/entry-server.tsx` (ou `npm run build`).');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entry = manifest['src/entry-client.ts'];
if (!entry) {
  console.error('[prerender] src/entry-client.ts não está no manifest do Vite.');
  process.exit(1);
}

const css = (entry.css ?? []).map((f) => `/${f}`);
const js = [`/${entry.file}`];
// Preload only the Latin subset of Manrope (the one every page uses).
const fontPreloads = readdirSync(join(distDir, 'assets'))
  .filter((f) => /^manrope-latin-wght-normal-.*\.woff2$/.test(f))
  .map((f) => `/assets/${f}`);

const { render, routes, siteConfig, missingConfig } = await import(pathToFileURL(ssrEntry).href);

const assets = { css, js, fontPreloads };
const written = [];
for (const route of routes) {
  const html = render(route.path, assets);
  const out = join(distDir, route.file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  written.push([route.file, statSync(out).size]);
}

// robots.txt and sitemap.xml
const siteUrl = siteConfig.siteUrl;
const robots = ['User-agent: *', 'Allow: /'];
if (siteUrl) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = routes
    .filter((r) => r.index)
    .map((r) => `  <url><loc>${siteUrl}${r.path}</loc><lastmod>${today}</lastmod></url>`)
    .join('\n');
  writeFileSync(
    join(distDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
  robots.push('', `Sitemap: ${siteUrl}/sitemap.xml`);
}
writeFileSync(join(distDir, 'robots.txt'), `${robots.join('\n')}\n`);

// The manifest is a build artefact, not something to publish.
rmSync(join(distDir, '.vite'), { recursive: true, force: true });

// Report
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log('\n[prerender] Páginas geradas:');
for (const [file, size] of written) console.log(`  dist/${file.padEnd(28)} ${kb(size)}`);
console.log(`  dist/robots.txt${siteUrl ? ' + dist/sitemap.xml' : ' (sem sitemap.xml: falta VITE_SITE_URL)'}`);

const missing = missingConfig(siteConfig);
if (missing.length) {
  console.warn('\n\x1b[33m[prerender] ATENÇÃO — dados do site ainda não configurados (ver .env.example):\x1b[0m');
  for (const m of missing) console.warn(`  - ${m}`);
  console.warn('');
}
