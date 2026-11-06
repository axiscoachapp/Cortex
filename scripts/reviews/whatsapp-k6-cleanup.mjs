import assert from 'node:assert/strict';

// A failed daemon query is uncertainty, never evidence that a container was removed.
export function cleanupOwnedContainer({ docker, name, id }) {
  assert.match(name, /^cortex-k6-wa-[0-9a-f]{8}$/);
  if (id !== null) assert.match(id, /^[0-9a-f]{64}$/);
  const result = { verified: false, stopError: null, error: null };
  if (id) {
    try {
      const stopped = docker(['stop', id]);
      if (stopped.status !== 0) result.stopError = stopped.stderr || stopped.error?.message || 'Docker stop failed';
    } catch (error) { result.stopError = error.message; }
  }
  try {
    const found = docker(['ps', '--all', '--no-trunc', '--filter', id ? `id=${id}` : `name=^/${name}$`, '--format', '{{.ID}}']);
    if (found.status !== 0) result.error = found.stderr || found.error?.message || 'Docker absence query failed';
    else if (typeof found.stdout !== 'string') result.error = 'Docker absence query returned no output';
    else if (found.stdout.trim()) result.error = 'Disposable container is still present';
    else result.verified = true;
  } catch (error) { result.error = error.message; }
  return result;
}
