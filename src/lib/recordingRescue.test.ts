import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteRescuedRecording, listRescuedRecordings, saveRecordingCheckpoint, saveRescuedRecording, type RescuedRecording } from './recordingRescue';

// Minimal asynchronous IndexedDB stand-in. Each write completes after its own
// delay, so writes issued back to back would finish out of order unless the
// module serialises them.
const data = new Map<string, RescuedRecording>();
const log: string[] = [];
let delays: number[] = [];
function fakeIndexedDB() {
  return {
    open() {
      const request: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void } = {};
      setTimeout(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          close() {},
          transaction() {
            const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore?: () => unknown } = {};
            const finish = (apply: () => unknown) => {
              const req: { result?: unknown } = {};
              setTimeout(() => { req.result = apply(); tx.oncomplete?.(); }, delays.shift() ?? 0);
              return req;
            };
            tx.objectStore = () => ({
              put: (entry: RescuedRecording) => finish(() => { data.set(entry.id, entry); log.push(`put:${entry.id}:${entry.blob.size}`); return entry.id; }),
              delete: (id: string) => finish(() => { data.delete(id); log.push(`delete:${id}`); }),
              getAll: () => finish(() => [...data.values()]),
            });
            return tx;
          },
        };
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}
const entry = (size: number): RescuedRecording => ({
  id: 'capture-1', userId: 'doctor', patientId: 'A', patientName: 'Paciente A', mimeType: 'audio/webm',
  blob: new Blob(['x'.repeat(size)]), comments: [], createdAt: '2026-11-11T09:00:00.000Z',
});

beforeEach(() => { data.clear(); log.length = 0; delays = []; vi.stubGlobal('indexedDB', fakeIndexedDB()); });
afterEach(() => vi.unstubAllGlobals());

describe('recording rescue store', () => {
  it('a slow checkpoint can never land after the delete that follows the upload', async () => {
    delays = [40, 0]; // the checkpoint write is slow, the delete is fast
    const checkpoint = saveRecordingCheckpoint(entry(3));
    const removed = deleteRescuedRecording('capture-1');
    await Promise.all([checkpoint, removed]);
    expect(data.has('capture-1')).toBe(false);
    expect(await listRescuedRecordings('doctor')).toEqual([]);
  });

  it('collapses checkpoints queued behind a slow write into the latest one', async () => {
    delays = [30];
    const first = saveRescuedRecording(entry(1));
    const checkpoints = [saveRecordingCheckpoint(entry(2)), saveRecordingCheckpoint(entry(3)), saveRecordingCheckpoint(entry(4))];
    await Promise.all([first, ...checkpoints]);
    expect(log).toEqual(['put:capture-1:1', 'put:capture-1:4']);
    expect((await listRescuedRecordings('doctor'))[0].blob.size).toBe(4);
  });

  it('a final save supersedes a queued checkpoint of the same recording', async () => {
    delays = [30];
    const busy = saveRescuedRecording({ ...entry(1), id: 'other' });
    const checkpoint = saveRecordingCheckpoint(entry(2));
    const final = saveRescuedRecording(entry(5));
    await Promise.all([busy, checkpoint, final]);
    expect(log).toEqual(['put:other:1', 'put:capture-1:5']);
  });

  it('reports a failed write to the caller and keeps serving later writes', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(saveRecordingCheckpoint(entry(2))).rejects.toThrow('IndexedDB indisponível');
    vi.stubGlobal('indexedDB', fakeIndexedDB());
    await saveRescuedRecording(entry(3));
    expect(data.get('capture-1')?.blob.size).toBe(3);
  });
});
