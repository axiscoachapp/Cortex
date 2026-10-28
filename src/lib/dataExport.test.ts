import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { assembleDataExport } from './dataExport';

const manifest = { version: 1, exportedAt: '2026-10-27T12:00:00Z', userId: 'doctor', email: 'review@example.invalid', tables: { patients: [{ id: 'p' }] }, files: [{ bucket: 'patient-files', path: 'patients/doctor/p/file', name: 'file.pdf', size: 3 }] };
describe('Complete data export', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob); });
  afterEach(() => vi.unstubAllGlobals());
  it('includes file bytes, checksum and table data before reporting completion', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ data: manifest, error: null }).mockResolvedValueOnce({ data: new NodeBlob([new Uint8Array([1, 2, 3])]), error: null });
    const result = await assembleDataExport('doctor', invoke, vi.fn());
    expect(result.tables.patients).toEqual([{ id: 'p' }]);
    expect(result.files[0]).toMatchObject({ contentBase64: 'AQID', sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81', size: 3 });
  });
  it('aborts rather than returning a partial archive if any file fails', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ data: manifest, error: null }).mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await expect(assembleDataExport('doctor', invoke, vi.fn())).rejects.toThrow(/não foi possível baixar/i);
  });
  it('rejects a foreign manifest and an oversized export before fetching files', async () => {
    const foreign = vi.fn().mockResolvedValue({ data: { ...manifest, userId: 'another' }, error: null });
    await expect(assembleDataExport('doctor', foreign, vi.fn())).rejects.toThrow(/manifesto/i);
    const oversized = vi.fn().mockResolvedValue({ data: { ...manifest, files: [{ ...manifest.files[0], size: 101 * 1024 * 1024 }] }, error: null });
    await expect(assembleDataExport('doctor', oversized, vi.fn())).rejects.toThrow(/100 MB/i);
    expect(oversized).toHaveBeenCalledTimes(1);
  });
});
