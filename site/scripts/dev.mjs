// Local development: Vite in middleware mode renders each page on request with
// the React components (SSR), so edits show up on reload and CSS updates live.
// Not used in production; `npm run build` writes static HTML instead.
//   npm run dev   →  http://localhost:5173
import { createServer as createHttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5173);

const vite = await createViteServer({
  root: siteDir,
  appType: 'custom',
  server: { middlewareMode: true },
});

const server = createHttpServer((req, res) => {
  vite.middlewares(req, res, async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
    try {
      const mod = await vite.ssrLoadModule('/src/entry-server.tsx');
      const known = mod.routes.some((r) => r.path === pathname);
      const html = mod.render(known ? pathname : '/404', {
        css: ['/src/styles/main.css'],
        js: ['/src/entry-client.ts'],
        fontPreloads: [],
      });
      const out = await vite.transformIndexHtml(url.pathname, html);
      res.writeHead(known ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(out);
    } catch (error) {
      vite.ssrFixStacktrace(error);
      console.error(error);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(error?.stack ?? error));
    }
  });
});

server.listen(port, () => {
  console.log(`Cortex site (dev) em http://localhost:${port}`);
});
