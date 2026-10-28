import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const files = readdirSync('supabase/functions', { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== '_shared')
  .map(entry => resolve('supabase/functions', entry.name, 'index.ts'));
if (!process.env.npm_execpath) throw new Error('Run this check with npm run typecheck:edge');
const result = spawnSync(process.execPath,
  [process.env.npm_execpath,'exec','--yes','--package=deno@2.9.6','--','deno','check','--no-config',...files], { stdio:'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
