// Visual and technical check of the built site (dist/), served like Vercel
// (clean URLs + headers from vercel.json, including the CSP).
// For every page, at 390×844 and 1280×800:
//   - full-page screenshot
//   - no horizontal overflow (scrollWidth <= innerWidth)
//   - no console errors (CSP violations show up here) and no failed requests
//   - every internal link points to a built page (and existing #anchor)
// Also exercises the mobile menu and, when a contact channel is configured, the form.
//   SHOTS_DIR=/some/folder npm run screenshots
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, siteDir } from './lib/playwright.mjs';
import { startServer } from './serve.mjs';

const outDir = process.env.SHOTS_DIR ?? join(tmpdir(), 'cortex-site-shots');
mkdirSync(outDir, { recursive: true });

const pages = [
  ['inicio', '/'],
  ['funcionalidades', '/funcionalidades'],
  ['implantacao', '/implantacao'],
  ['seguranca', '/seguranca'],
  ['precos', '/precos'],
  ['contato', '/contato'],
  ['termos', '/termos'],
  ['privacidade', '/privacidade'],
  ['404', '/pagina-que-nao-existe'],
];
const viewports = [
  ['390', { width: 390, height: 844 }],
  ['1280', { width: 1280, height: 800 }],
];

const port = 4300 + Math.floor(Math.random() * 500);
const server = await startServer(port);
const origin = `http://127.0.0.1:${port}`;
const browser = await launchBrowser();

const problems = [];
const rows = [];
const linkCache = new Map();

async function checkLink(href) {
  const url = new URL(href, origin);
  const key = url.pathname + url.hash;
  if (linkCache.has(key)) return linkCache.get(key);
  let error = null;
  const res = await fetch(origin + url.pathname, { redirect: 'manual' });
  if (res.status !== 200) error = `HTTP ${res.status}`;
  else if (url.hash) {
    const html = await res.text();
    const id = decodeURIComponent(url.hash.slice(1));
    if (!html.includes(`id="${id}"`)) error = `âncora #${id} não existe`;
  }
  linkCache.set(key, error);
  return error;
}

try {
  for (const [vpName, viewport] of viewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    for (const [name, path] of pages) {
      const page = await context.newPage();
      const consoleErrors = [];
      const failed = [];
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        // The 404 page is *meant* to answer with HTTP 404; the browser logs that.
        if (name === '404' && msg.location().url === origin + path) return;
        consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(String(err)));
      page.on('requestfailed', (req) => failed.push(`${req.url()} (${req.failure()?.errorText})`));
      page.on('response', (res) => {
        const isExpected404 = name === '404' && res.url() === origin + path;
        if (res.status() >= 400 && !isExpected404) failed.push(`${res.url()} (HTTP ${res.status()})`);
      });

      await page.goto(origin + path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        title: document.title,
        h1: document.querySelectorAll('h1').length,
        links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
        imgsWithoutAlt: [...document.querySelectorAll('img:not([alt])')].length,
      }));

      const internal = [...new Set(metrics.links.filter((h) => h && (h.startsWith('/') || h.startsWith('#'))))];
      const broken = [];
      for (const href of internal) {
        const resolved = href.startsWith('#') ? `${name === '404' ? '/404' : path}${href}` : href;
        const err = await checkLink(resolved);
        if (err) broken.push(`${href} → ${err}`);
      }

      const overflow = metrics.scrollWidth > metrics.innerWidth;
      await page.screenshot({ path: join(outDir, `${name}-${vpName}.png`), fullPage: true });

      rows.push({
        página: path,
        viewport: vpName,
        overflow: overflow ? `SIM (${metrics.scrollWidth}px)` : 'não',
        'erros console': consoleErrors.length,
        'req. falhas': failed.length,
        'links quebrados': broken.length,
        h1: metrics.h1,
      });
      if (overflow) problems.push(`${path} @${vpName}: overflow horizontal (${metrics.scrollWidth} > ${metrics.innerWidth})`);
      if (metrics.h1 !== 1) problems.push(`${path} @${vpName}: ${metrics.h1} elementos h1`);
      if (metrics.imgsWithoutAlt) problems.push(`${path} @${vpName}: ${metrics.imgsWithoutAlt} img sem alt`);
      for (const e of consoleErrors) problems.push(`${path} @${vpName}: console: ${e}`);
      for (const f of failed) problems.push(`${path} @${vpName}: requisição falhou: ${f}`);
      for (const b of broken) problems.push(`${path} @${vpName}: link: ${b}`);
      await page.close();
    }

    // Mobile menu behaviour
    if (vpName === '390') {
      const page = await context.newPage();
      await page.goto(origin + '/', { waitUntil: 'networkidle' });
      const toggle = page.locator('[data-menu-toggle]');
      await toggle.click();
      const opened = (await toggle.getAttribute('aria-expanded')) === 'true' && (await page.locator('#menu-movel').isVisible());
      await page.screenshot({ path: join(outDir, `menu-aberto-390.png`) });
      await page.keyboard.press('Escape');
      const closed = (await toggle.getAttribute('aria-expanded')) === 'false' && !(await page.locator('#menu-movel').isVisible());
      const focusBack = await page.evaluate(() => document.activeElement?.hasAttribute('data-menu-toggle'));
      if (!opened || !closed || !focusBack) problems.push(`menu móvel: abriu=${opened} fechou=${closed} foco voltou=${focusBack}`);
      rows.push({ página: '(menu móvel)', viewport: vpName, overflow: '-', 'erros console': 0, 'req. falhas': 0, 'links quebrados': 0, h1: opened && closed && focusBack ? 'ok' : 'FALHOU' });
      await page.close();
    }

    // Contact form behaviour
    if (vpName === '1280') {
      const page = await context.newPage();
      const errors = [];
      page.on('console', (msg) => {
        // Headless browsers have no mail app: "Failed to launch 'mailto:...'" is expected here.
        if (msg.type() === 'error' && !/mailto:/i.test(msg.text())) errors.push(msg.text());
      });
      await page.goto(origin + '/contato', { waitUntil: 'networkidle' });
      const submit = page.locator('[data-submit]');
      const configured = (await submit.getAttribute('data-enabled')) === 'true';
      let summary;
      if (!configured) {
        summary = (await submit.isDisabled()) ? 'sem canal: botão desativado (ok)' : 'FALHOU: botão ativo sem canal configurado';
      } else {
        await submit.click();
        const invalid = await page.locator('[aria-invalid="true"]').count();
        const summaryVisible = await page.locator('[data-error-summary]').isVisible();
        await page.screenshot({ path: join(outDir, 'contato-erros-1280.png'), fullPage: true });
        await page.fill('#nome', 'Pessoa Teste');
        await page.fill('#clinica', 'Clínica Exemplo');
        await page.fill('#cidade', 'Campinas/SP');
        await page.selectOption('#medicos', '2 a 5 médicos');
        await page.fill('#sistema', 'PersonalMed');
        await page.fill('#telefone', '(11) 91234-5678');
        await page.fill('#email', 'pessoa@exemplo.com.br');
        await page.fill('#mensagem', 'Quero ver a recepção.');
        await submit.click();
        await page.waitForSelector('[data-result]:not([hidden])');
        const mail = await page.locator('[data-result-email]').getAttribute('href');
        const wa = await page.locator('[data-result-whatsapp]').getAttribute('href');
        await page.screenshot({ path: join(outDir, 'contato-pronto-1280.png'), fullPage: true });
        const okMail = !mail || mail.startsWith('mailto:');
        const okWa = !wa || wa.startsWith('https://wa.me/');
        summary = `validação: ${invalid} campos inválidos, resumo ${summaryVisible ? 'visível' : 'OCULTO'}; envio: mailto ${okMail ? 'ok' : 'FALHOU'}, WhatsApp ${okWa ? 'ok' : 'FALHOU'}`;
        if (invalid < 6 || !summaryVisible || !okMail || !okWa) problems.push(`formulário: ${summary}`);
        console.log(`  mailto: ${mail?.slice(0, 140)}…\n  wa.me: ${wa?.slice(0, 140)}…`);
      }
      for (const e of errors) problems.push(`formulário: console: ${e}`);
      console.log(`[form] ${summary}`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.table(rows);
const css = readFileSync(join(siteDir, 'vercel.json'), 'utf8').includes('Content-Security-Policy');
console.log(`Capturas em: ${outDir}${css ? ' (servido com a CSP do vercel.json)' : ''}`);
if (problems.length) {
  console.error(`\n${problems.length} problema(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nNenhum problema encontrado.');
