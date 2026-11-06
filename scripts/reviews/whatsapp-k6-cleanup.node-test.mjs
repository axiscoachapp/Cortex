import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupOwnedContainer } from './whatsapp-k6-cleanup.mjs';

const name = 'cortex-k6-wa-1234abcd', id = 'a'.repeat(64);
function fake(results) {
  const calls = [];
  return { calls, docker: values => { calls.push(values); const result = results.shift(); if (result instanceof Error) throw result; return result; } };
}
test('stops only the owned full ID and positively verifies absence', () => {
  const f = fake([{ status: 0 }, { status: 0, stdout: '' }]);
  assert.equal(cleanupOwnedContainer({ ...f, name, id }).verified, true);
  assert.deepEqual(f.calls, [['stop', id], ['ps', '--all', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}']]);
});
test('a failed Docker query never proves absence', () => {
  const f = fake([{ status: 0 }, { status: 1, stderr: 'daemon unavailable' }]);
  assert.deepEqual(cleanupOwnedContainer({ ...f, name, id }), { verified: false, stopError: null, error: 'daemon unavailable' });
});
test('a surviving container fails cleanup', () => {
  const f = fake([{ status: 0 }, { status: 0, stdout: `${id}\n` }]);
  assert.equal(cleanupOwnedContainer({ ...f, name, id }).verified, false);
});
test('a stop exception is recorded and the absence query still runs', () => {
  const f = fake([new Error('stop failed'), { status: 0, stdout: '' }]);
  assert.deepEqual(cleanupOwnedContainer({ ...f, name, id }), { verified: true, stopError: 'stop failed', error: null });
});
test('a query exception becomes a failed result instead of skipping the report', () => {
  const f = fake([{ status: 0 }, new Error('pipe unavailable')]);
  assert.deepEqual(cleanupOwnedContainer({ ...f, name, id }), { verified: false, stopError: null, error: 'pipe unavailable' });
});
test('without a successful creation, verifies the unique name and never stops it', () => {
  const f = fake([{ status: 0, stdout: '' }]);
  assert.equal(cleanupOwnedContainer({ ...f, name, id: null }).verified, true);
  assert.deepEqual(f.calls, [['ps', '--all', '--no-trunc', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']]);
});
test('rejects invalid ownership identifiers before any Docker operation', () => {
  const f = fake([]);
  assert.throws(() => cleanupOwnedContainer({ ...f, name: 'other', id }));
  assert.throws(() => cleanupOwnedContainer({ ...f, name, id: 'short' }));
  assert.equal(f.calls.length, 0);
});
