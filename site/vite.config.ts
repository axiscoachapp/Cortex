import { defineConfig } from 'vite';

// Two builds share this file:
// - client (`vite build`): the tiny vanilla entry + Tailwind CSS, with a manifest
//   so the prerender script can inject the hashed file names;
// - SSR (`vite build --ssr src/entry-server.tsx`): the React page components,
//   used only at build time to write static HTML. No React reaches the browser.
export default defineConfig(({ isSsrBuild }) => ({
  publicDir: isSsrBuild ? false : 'public',
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  build: isSsrBuild
    ? { outDir: 'dist-ssr', emptyOutDir: true, target: 'node20', minify: false, copyPublicDir: false }
    : {
        outDir: 'dist',
        emptyOutDir: true,
        manifest: true,
        // Never inline fonts or images as data: URIs (the CSP only allows 'self' for fonts).
        assetsInlineLimit: 0,
        rolldownOptions: { input: 'src/entry-client.ts' },
      },
}));
