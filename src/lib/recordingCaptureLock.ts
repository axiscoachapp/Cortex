// A recording is checkpointed to IndexedDB while it is still being captured
// (and until its upload finishes), so the same browser can recover it after a
// crash. Another tab must not offer that live entry as an "interrupted"
// recording. The tab that owns it holds a Web Lock named after it; the browser
// drops the lock when that tab closes or crashes, which is exactly when the
// entry becomes recoverable. Without the Web Locks API every entry counts as
// recoverable, as before.

const PREFIX = 'cortex-recording-capture:';

type LockCallback = (lock: unknown) => Promise<void> | void;
interface Locks {
  request(name: string, options: { ifAvailable?: boolean }, callback: LockCallback): Promise<unknown>;
  query(): Promise<{ held?: Array<{ name?: string }> }>;
}

function locks(): Locks | null {
  const api = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: Locks }).locks : undefined;
  return api && typeof api.request === 'function' && typeof api.query === 'function' ? api : null;
}

/** Holds the lock for `id` if no other tab holds it. Resolves to the release
 *  function, or to null when another tab owns the recording. */
export function tryHoldCaptureLock(id: string): Promise<(() => void) | null> {
  const api = locks();
  if (!api) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    api
      .request(PREFIX + id, { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(null); return; }
        resolve(release);
        return held;
      })
      .catch(() => resolve(() => {}));
  });
}

/** Ids of recordings that a live tab is still capturing or uploading. */
export async function capturesInProgress(): Promise<Set<string>> {
  const api = locks();
  if (!api) return new Set();
  try {
    const state = await api.query();
    return new Set(
      (state.held ?? [])
        .map((lock) => lock.name ?? '')
        .filter((name) => name.startsWith(PREFIX))
        .map((name) => name.slice(PREFIX.length)),
    );
  } catch {
    return new Set();
  }
}
