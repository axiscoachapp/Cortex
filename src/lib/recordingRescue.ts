// Recordings interrupted by an unmount (session ended, sign-out from another
// device, render crash) used to be dropped silently. They are now parked in
// this browser's IndexedDB, scoped to the doctor and patient, so the doctor can
// process them after signing in again. While recording, the audio captured so
// far is also checkpointed here every few seconds under the same id the draft
// will use, so a crash, tab discard or screen lock leaves a recoverable entry.
// Nothing is written to the Downloads folder. An entry is removed only after
// its audio is on the server (or the doctor discards it).

import { z } from 'zod';

export interface RescuedRecording {
  id: string;
  userId: string;
  patientId: string;
  patientName: string;
  mimeType: string;
  blob: Blob;
  comments: string[];
  createdAt: string;
}

const DB_NAME = 'cortex-recording-rescue';
const STORE = 'recordings';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Writes from this tab run one at a time, in call order. A checkpoint queued
// while recording can then never land after the delete that follows a
// successful upload and bring the entry back.
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = writes.then(run, run);
  writes = next.catch(() => {});
  return next;
}
const pendingCheckpoints = new Map<string, { entry: RescuedRecording; done: Promise<void> }>();

export function saveRescuedRecording(entry: RescuedRecording): Promise<void> {
  pendingCheckpoints.delete(entry.id);
  return serial(async () => { await withStore('readwrite', (store) => store.put(entry)); });
}

/** Saves the audio captured so far. Checkpoints of one recording that pile up
 *  behind a slow write collapse into the latest one. */
export function saveRecordingCheckpoint(entry: RescuedRecording): Promise<void> {
  const pending = pendingCheckpoints.get(entry.id);
  if (pending) {
    pending.entry = entry;
    return pending.done;
  }
  const slot = { entry, done: Promise.resolve() };
  slot.done = serial(async () => {
    if (pendingCheckpoints.get(entry.id) !== slot) return; // superseded by a final save or a delete
    pendingCheckpoints.delete(entry.id);
    await withStore('readwrite', (store) => store.put(slot.entry));
  });
  pendingCheckpoints.set(entry.id, slot);
  return slot.done;
}

export async function listRescuedRecordings(userId: string): Promise<RescuedRecording[]> {
  try {
    const all = await withStore<RescuedRecording[]>('readonly', (store) => store.getAll() as IDBRequest<RescuedRecording[]>);
    return all.filter((entry) => entry.userId === userId);
  } catch {
    return [];
  }
}

const metadata = z.object({
  id: z.string().uuid(), patientId: z.string().uuid(),
  createdAt: z.string().max(40).datetime({offset:true}),
});
export type RescuedRecordingMetadata = z.infer<typeof metadata>;

/** Bounded metadata only. Storage failure must not masquerade as an empty result. */
export async function listRescuedRecordingMetadata(userId: string, signal?: AbortSignal): Promise<RescuedRecordingMetadata[]> {
  if (!userId) return [];
  const aborted = () => new DOMException('Leitura cancelada', 'AbortError');
  if (signal?.aborted) throw aborted();
  const db = await openDb();
  try {
    if (signal?.aborted) throw aborted();
    return await new Promise<RescuedRecordingMetadata[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'), rows: RescuedRecordingMetadata[] = [];
      let failure: unknown;
      const cancel = () => { try { tx.abort(); } catch { /* Completion may already be queued. */ } };
      signal?.addEventListener('abort', cancel, {once:true});
      const finish = () => signal?.removeEventListener('abort', cancel);
      tx.oncomplete = () => { finish(); if (signal?.aborted) reject(aborted()); else resolve(rows); };
      tx.onerror = tx.onabort = () => { finish(); reject(signal?.aborted ? aborted() : failure ?? tx.error ?? new Error('Falha na leitura local')); };
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        if (signal?.aborted) return;
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value;
        try {
          if (value?.userId === userId) {
            rows.push(metadata.parse({id:value.id,patientId:value.patientId,createdAt:value.createdAt}));
            rows.sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt) || b.id.localeCompare(a.id));
            if (rows.length > 51) rows.pop();
          }
          cursor.continue();
        } catch (error) { failure = error; cancel(); }
      };
    });
  } finally { db.close(); }
}

export function deleteRescuedRecording(id: string): Promise<void> {
  pendingCheckpoints.delete(id);
  return serial(async () => { await withStore('readwrite', (store) => store.delete(id)); });
}
