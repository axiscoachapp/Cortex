import { afterEach, describe, expect, it } from 'vitest';
import { capturesInProgress, tryHoldCaptureLock } from './recordingCaptureLock';

// In-memory Web Locks: one holder per name, `ifAvailable` gets null when taken.
function fakeLocks() {
  const held = new Set<string>();
  return {
    async request(name: string, _options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<void> | void) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    },
    async query() { return { held: [...held].map((name) => ({ name })) }; },
  };
}
const setLocks = (value: unknown) => Object.defineProperty(navigator, 'locks', { configurable: true, value });
afterEach(() => { delete (navigator as { locks?: unknown }).locks; });

describe('recording capture lock', () => {
  it('marks a recording as in progress until its owner releases it, and refuses a second owner', async () => {
    setLocks(fakeLocks());
    const release = await tryHoldCaptureLock('capture-1');
    expect(release).toBeTypeOf('function');
    expect(await capturesInProgress()).toEqual(new Set(['capture-1']));
    expect(await tryHoldCaptureLock('capture-1')).toBeNull();
    release!();
    await new Promise((done) => setTimeout(done, 0));
    expect(await capturesInProgress()).toEqual(new Set());
  });

  it('treats every recording as recoverable where Web Locks do not exist', async () => {
    expect(await tryHoldCaptureLock('capture-1')).toBeTypeOf('function');
    expect(await capturesInProgress()).toEqual(new Set());
  });
});
