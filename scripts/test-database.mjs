import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// Every run owns a newly named disposable database. Never reset a linked project.
const container = process.env.CORTEX_TEST_DB_CONTAINER || `cortex-test-${randomUUID().slice(0,8)}`;
const ownsContainer = !process.env.CORTEX_TEST_DB_CONTAINER;
const run = (args, input) => {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  return result.stdout;
};
const sql = source => run(['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','--quiet'],source);
try {
  if (ownsContainer) run(['run','--detach','--rm','--name',container,'--env','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:pg16']);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{stdio:'ignore'}).status === 0) { ready = true; break; }
    await new Promise(resolveWait => setTimeout(resolveWait,500));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  sql(readFileSync(resolve('supabase/tests/bootstrap.sql'),'utf8'));
  const names = readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')).sort();
  const selected = process.env.CORTEX_TEST_BEFORE_REPAIRS ? names.filter(name=>!name.startsWith('20261028')) : names;
  for (const name of selected) { sql(readFileSync(resolve('supabase/migrations',name),'utf8')); process.stdout.write(`Applied ${name}\n`); }
  for (const name of readdirSync('supabase/tests').filter(name=>name.endsWith('.test.sql')).sort()) {
    sql(readFileSync(resolve('supabase/tests',name),'utf8')); process.stdout.write(`Passed ${name}\n`);
  }
} finally {
  if (ownsContainer) run(['stop',container]);
}
