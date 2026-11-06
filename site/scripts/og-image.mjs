// Generates public/og-image.png (1200×630) and public/apple-touch-icon.png (180×180)
// with Playwright. Run by hand when the headline or the logo changes:
//   npm run og
// The PNGs are committed; the normal build does not need Playwright.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, siteDir } from './lib/playwright.mjs';

const read = (p) => readFileSync(join(siteDir, p));
const fontB64 = read('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2').toString('base64');
const fontExtB64 = read('node_modules/@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2').toString('base64');
const logoInverse = read('public/brand/cortex-logo-inverse.svg').toString('utf8');
const symbol = read('public/brand/cortex-symbol.svg').toString('utf8');
const tokens = read('src/styles/tokens.css').toString('utf8');
const token = (name) => tokens.match(new RegExp(`--cx-${name}:\\s*(#[0-9a-fA-F]{6})`))[1];

// Concentric arcs, same geometry as src/components/Brand.tsx (ArcPattern).
function arcs({ rings, start, step, cx, cy }) {
  const a = (42 * Math.PI) / 180;
  let d = '';
  for (let i = 0; i < rings; i += 1) {
    const r = start + step * i;
    const x = (cx + r * Math.cos(a)).toFixed(2);
    d += `<path d="M${x} ${(cy - r * Math.sin(a)).toFixed(2)}A${r} ${r} 0 1 0 ${x} ${(cy + r * Math.sin(a)).toFixed(2)}" stroke="#fff" stroke-opacity="0.06" stroke-width="${i % 3 === 0 ? 3 : 1.5}" fill="none" stroke-linecap="round"/>`;
  }
  return d;
}

const fontFace = `
@font-face{font-family:'Manrope';font-weight:200 800;src:url(data:font/woff2;base64,${fontB64}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}
@font-face{font-family:'Manrope';font-weight:200 800;src:url(data:font/woff2;base64,${fontExtB64}) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;}`;

const ogHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${fontFace}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:${token('ink')};font-family:'Manrope',sans-serif;color:#fff;position:relative;overflow:hidden}
.arcs{position:absolute;right:-380px;top:-260px;width:1150px;height:1150px}
.wrap{position:absolute;inset:0;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between}
.logo svg{height:60px;width:auto;display:block}
h1{font-size:72px;line-height:1.06;font-weight:800;letter-spacing:-0.025em;max-width:880px}
h1 span{color:${token('teal-300')}}
p{margin-top:26px;font-size:28px;line-height:1.4;color:${token('muted-on-ink')};max-width:840px;font-weight:500}
.foot{display:flex;align-items:center;gap:14px;font-size:22px;font-weight:700;color:${token('teal-300')}}
.dot{width:14px;height:14px;border-radius:50%;background:${token('signal')}}
</style></head><body>
<svg class="arcs" viewBox="0 0 1200 1200">${arcs({ rings: 10, start: 90, step: 56, cx: 600, cy: 600 })}<circle cx="686" cy="600" r="14" fill="${token('signal')}"/></svg>
<div class="wrap">
  <div class="logo">${logoInverse}</div>
  <div><h1>O prontuário que trabalha <span>junto com o médico.</span></h1>
  <p>Prontuário, consulta com IA revisada pelo médico, documentos, agenda e recepção, com implantação incluída.</p></div>
  <div class="foot"><span class="dot"></span>Para clínicas de especialidade</div>
</div></body></html>`;

const iconHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0}body{width:180px;height:180px;background:${token('teal-700')}}svg{width:180px;height:180px;display:block}
</style></head><body>${symbol.replace(/rx="16"/, 'rx="0"')}</body></html>`;

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(ogHtml, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(join(siteDir, 'public', 'og-image.png'), await page.screenshot({ type: 'png' }));

  const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  await icon.setContent(iconHtml, { waitUntil: 'load' });
  writeFileSync(join(siteDir, 'public', 'apple-touch-icon.png'), await icon.screenshot({ type: 'png' }));
  console.log('public/og-image.png (1200×630) e public/apple-touch-icon.png (180×180) gerados.');
} finally {
  await browser.close();
}
