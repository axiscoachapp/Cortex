// Loads Playwright without making it a dependency of the site: first from
// site/node_modules (if someone installed it), then from the repository root,
// or from PLAYWRIGHT_MODULE (absolute path to a `playwright` package).
// Launches the installed Microsoft Edge (channel 'msedge'); override with
// PLAYWRIGHT_CHANNEL (e.g. 'chrome') if Edge is not available.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadPlaywright() {
  const attempts = [
    process.env.PLAYWRIGHT_MODULE,
    join(siteDir, 'package.json'),
    join(siteDir, '..', 'package.json'),
  ].filter(Boolean);
  for (const from of attempts) {
    try {
      const req = createRequire(from.endsWith('package.json') ? from : join(from, 'index.js'));
      return req(from.endsWith('package.json') ? 'playwright' : from);
    } catch {
      // try next
    }
  }
  throw new Error(
    'Playwright não encontrado. Instale na raiz do repositório (npm install) ou defina PLAYWRIGHT_MODULE com o caminho do pacote.',
  );
}

export async function launchBrowser() {
  const { chromium } = loadPlaywright();
  return chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
}

export { siteDir };
