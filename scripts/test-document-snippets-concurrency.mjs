import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Prescription templates against account deletion, with two real connections.
// Standalone runs always own a new disposable database; no hosted credentials.
//   node scripts/test-document-snippets-concurrency.mjs              -> expects the fix
//   node scripts/test-document-snippets-concurrency.mjs --before-fix -> reproduces R1
const FIX = '20261104120000_document_snippets_custody_epoch.sql';
const docker = (args, input) =>
  spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
const required = (result) => {
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
};
const bounds = "set statement_timeout='5s';set lock_timeout='1s';";
const doctor = (actor) =>
  `set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${actor}';`;
const save = (name) => `select public.save_document_snippet(null,null,'${name}','[{"name":"Medicamento sintético"}]')`;

function session(container) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    windowsHide: true,
  });
  let output = '';
  let errors = '';
  const listeners = new Set();
  child.stdout.on('data', (chunk) => {
    output += chunk;
    for (const notify of listeners) notify();
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  child.stdin.on('error', () => {}); // psql may exit on the refused statement before end().
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('close', (status) => resolveDone({ status, stdout: output, stderr: errors }));
  });
  const send = (sql) => child.stdin.write(sql + '\n');
  send(bounds);
  return {
    send,
    wait: (marker) =>
      new Promise((resolveMarker, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check);
          child.kill();
          reject(new Error('Timed out before ' + marker + ': ' + errors));
        }, 10000);
        const check = () => {
          if (output.includes(marker)) {
            clearTimeout(timer);
            listeners.delete(check);
            resolveMarker();
          }
        };
        listeners.add(check);
        check();
      }),
    finish: (sql) => {
      send(sql);
      child.stdin.end();
      return done;
    },
  };
}

export async function testDocumentSnippetsConcurrency(container, { beforeFix = false } = {}) {
  const sql = (source) => required(docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], bounds + source));
  const ids = [1, 2, 3].map((n) => `c4120000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  sql(`insert into auth.users(id,email) values ${ids.map((id, n) => `('${id}','snippet-race-${n}@example.invalid')`).join(',')};`);
  const count = (id) => Number(sql(`select count(*) from public.document_snippets where owner_user_id='${id}'`));
  const intent = (id) => `insert into public.account_deletion_requests(user_id) values('${id}');`;
  const results = {};

  // 1. Old REPEATABLE READ snapshot taken before the deletion intent commits.
  {
    const writer = session(container);
    writer.send(`begin isolation level repeatable read;${doctor(ids[0])}select count(*) from public.document_snippets;\n\\echo SNAPSHOT`);
    await writer.wait('SNAPSHOT');
    sql(`begin;${intent(ids[0])}commit;`);
    const result = await writer.finish(`${save('Snapshot antigo')};commit;`);
    results.staleSnapshot = { status: result.status, created: count(ids[0]) };
    if (beforeFix) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(count(ids[0]), 1, 'R1 not reproduced: the stale snapshot did not create a template');
    } else {
      assert.notEqual(result.status, 0, 'Template saved after the deletion intent');
      assert.match(result.stderr, /ERROR:\s+40001: could not serialize access due to concurrent update/, result.stderr);
      assert.equal(count(ids[0]), 0, 'Refused transaction left a template');
    }
  }

  // 2. Deletion intent still in progress: the save must not wait behind it
  //    indefinitely and must not commit a template after the intent.
  {
    const deleter = session(container);
    deleter.send(`begin;${intent(ids[1])}\n\\echo HELD\nselect pg_sleep(1);commit;`);
    await deleter.wait('HELD');
    const writer = session(container);
    const result = await writer.finish(`begin;${doctor(ids[1])}${save('Durante a exclusão')};commit;`);
    const held = await deleter.finish('');
    assert.equal(held.status, 0, held.stderr);
    results.inProgress = { status: result.status, created: count(ids[1]) };
    assert.notEqual(result.status, 0, 'Template saved while the deletion intent was in progress');
    assert.match(result.stderr, /ERROR:\s+(55000|40001):/, result.stderr);
    assert.equal(count(ids[1]), 0, 'Template committed beside the deletion intent');
  }

  // 3. Control: a doctor without deletion intent still saves, and the
  //    templates go with the owner.
  {
    sql(`begin;${doctor(ids[2])}${save('Controle')};commit;`);
    assert.equal(count(ids[2]), 1, 'Control save failed');
    sql(`delete from auth.users where id='${ids[2]}';`);
    assert.equal(count(ids[2]), 0, 'Templates outlived their owner');
  }
  process.stdout.write(`Document snippet races: ${JSON.stringify(results)}\n`);
}

async function standalone({ beforeFix }) {
  const container = `cortex-snippet-race-${randomUUID().slice(0, 8)}`;
  try {
    required(docker(['run', '--detach', '--rm', '--name', container, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg16']));
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      ready = docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0;
      if (!ready) await new Promise((wait) => setTimeout(wait, 500));
    }
    assert.ok(ready, 'Disposable PostgreSQL did not become ready');
    const apply = (source) => required(docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '--quiet'], source));
    apply(readFileSync(resolve('supabase/tests/bootstrap.sql'), 'utf8'));
    const names = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort();
    for (const name of names.filter((name) => !(beforeFix && name === FIX)))
      apply(readFileSync(resolve('supabase/migrations', name), 'utf8'));
    await testDocumentSnippetsConcurrency(container, { beforeFix });
  } finally {
    docker(['stop', container]);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.ok(process.argv.slice(2).every((arg) => arg === '--before-fix'), 'Unknown option');
  await standalone({ beforeFix: process.argv.includes('--before-fix') });
}
