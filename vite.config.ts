import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { loadEnv } from "vite";
import { validateSupabaseEnvironment } from "./src/integrations/supabase/environment.ts";

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    validateSupabaseEnvironment(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  }
  return ({
  server: {
    host: "127.0.0.1",
    port: 8080,
    watch: { ignored: ['**/coverage/**', '**/docs/reviews/**'] },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    pool: 'threads',
    maxWorkers: 1,
    coverage: { include: ['src/**/*.{ts,tsx}'], exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/integrations/supabase/types.ts'] },
  },
});
});
