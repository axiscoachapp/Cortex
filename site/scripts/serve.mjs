// Serves dist/ the way Vercel will: clean URLs, no trailing slash, 404.html,
// and the response headers from vercel.json (including the CSP), so local
// checks catch CSP violations before deploy.
//   node scripts/serve.mjs [--port 4173]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(siteDir, 'dist');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const vercel = JSON.parse(readFileSync(join(siteDir, 'vercel.json'), 'utf8'));
const headerRules = (vercel.headers ?? []).map((rule) => ({
  re: new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`),
  headers: rule.headers,
}));

function applyHeaders(res, pathname) {
  for (const rule of headerRules) {
    if (rule.re.test(pathname)) for (const h of rule.headers) res.setHeader(h.key, h.value);
  }
}

function resolveFile(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const base = join(distDir, safe);
  if (!base.startsWith(distDir)) return null;
  const candidates = [base, `${base}.html`, join(base, 'index.html')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export function startServer(port = 4173) {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('dist/ não existe. Rode `npm run build` antes.');
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let { pathname } = url;

    // trailingSlash: false → /x/ redirects to /x ; cleanUrls → /x.html and /x/index.html redirect to /x
    let redirect = null;
    if (pathname.endsWith('/index.html')) redirect = pathname.slice(0, -'/index.html'.length) || '/';
    else if (pathname.endsWith('.html') && pathname !== '/404.html') redirect = pathname.slice(0, -'.html'.length);
    else if (pathname.length > 1 && pathname.endsWith('/')) redirect = pathname.replace(/\/+$/, '');
    if (redirect !== null) {
      res.writeHead(308, { Location: redirect + url.search });
      res.end();
      return;
    }

    applyHeaders(res, pathname);
    let file = resolveFile(pathname);
    let status = 200;
    if (!file) {
      file = join(distDir, '404.html');
      status = 404;
    }
    const type = types[extname(file)] ?? 'application/octet-stream';
    res.writeHead(status, { 'Content-Type': type });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  });
  return new Promise((resolveListen) => {
    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--port');
  const port = i > -1 ? Number(process.argv[i + 1]) : 4173;
  startServer(port).then(() => {
    console.log(`Site estático (dist/) em http://localhost:${port}  — Ctrl+C para parar`);
  });
}

export { distDir };
