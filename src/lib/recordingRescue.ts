// Recordings interrupted by an unmount (session ended, sign-out from another
// device, render crash) used to be dropped silently. They are now parked in
// this browser's IndexedDB, scoped to the doctor and patient, so the doctor can
// process them after signing in again. Nothing is written to the Downloads
// folder, and entries are removed as soon as they are processed or discarded.

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

export async function saveRescuedRecording(entry: RescuedRecording): Promise<void> {
  await withStore('readwrite', (store) => store.put(entry));
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

export async function deleteRescuedRecording(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}
