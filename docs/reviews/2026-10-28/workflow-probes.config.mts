import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['docs/reviews/2026-10-28/workflow-probes/*.probe.{ts,tsx}'],
    css: false,
    pool: 'threads',
    maxWorkers: 1,
  },
});
