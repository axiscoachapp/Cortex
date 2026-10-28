export interface ExportFile {
  bucket: string;
  path: string;
  name: string;
  size: number | null;
  objectVersion: string;
}
export interface ExportManifest {
  version: 2;
  exportId: string;
  expiresAt: string;
  exportedAt: string;
  userId: string;
  email: string | null;
  tables: Record<string, unknown[]>;
  files: ExportFile[];
}
type ExportRequest = { action: 'manifest'; exportId?: string } | { action: 'file'; exportId: string; bucket: string; path: string } | { action: 'complete'; exportId: string };
type InvokeExport = (body: ExportRequest) => Promise<{ data: unknown; error: unknown }>;
const MAX_BYTES = 100 * 1024 * 1024;
const LIMIT_MESSAGE = 'Esta exportação excede 100 MB de arquivos. Solicite uma exportação completa ao suporte antes de excluir a conta. Nenhum arquivo parcial foi baixado.';

function validateManifest(raw: unknown, userId: string): ExportManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Manifesto de exportação inválido. Tente novamente.');
  const value = raw as Partial<ExportManifest>;
  if (value.version !== 2 || typeof value.exportId !== 'string' || typeof value.expiresAt !== 'string' || value.userId !== userId || typeof value.exportedAt !== 'string' || !value.tables || typeof value.tables !== 'object' || Array.isArray(value.tables) || !Object.values(value.tables).every(Array.isArray) || !Array.isArray(value.files)) throw new Error('Manifesto de exportação inválido. Tente novamente.');
  const allowed = ['patient-files', 'audio-recordings', 'prescriptions'];
  if (!value.files.every(file => file && allowed.includes(file.bucket) && typeof file.path === 'string' && typeof file.name === 'string' && typeof file.objectVersion === 'string' && (file.size === null || (Number.isFinite(file.size) && file.size >= 0)))) throw new Error('Manifesto de arquivos inválido. Tente novamente.');
  return value as ExportManifest;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}

async function* exportEntries(userId: string, invoke: InvokeExport, progress: (message: string) => void, bounded: boolean) {
  progress('Carregando a relação completa de dados e arquivos…');
  const response = await invoke({ action: 'manifest' });
  if (response.error) throw new Error('Não foi possível carregar a relação de dados. Tente novamente.');
  const manifest = validateManifest(response.data, userId);
  if (bounded && manifest.files.reduce((sum, file) => sum + (file.size ?? 0), 0) > MAX_BYTES) throw new Error(LIMIT_MESSAGE);
  yield { manifest };
  let totalBytes = 0;
  for (const [index, file] of manifest.files.entries()) {
    progress(`Baixando arquivo ${index + 1} de ${manifest.files.length}: ${file.name}`);
    const result = await invoke({ action: 'file', exportId: manifest.exportId, bucket: file.bucket, path: file.path });
    if (result.error || !(result.data instanceof Blob)) throw new Error(`Não foi possível baixar "${file.name}". Nenhum arquivo parcial foi baixado; tente novamente.`);
    totalBytes += result.data.size;
    if (bounded && totalBytes > MAX_BYTES) throw new Error(LIMIT_MESSAGE);
    if (file.size !== null && result.data.size !== file.size) throw new Error(`O arquivo "${file.name}" mudou durante a exportação. Tente novamente para obter uma cópia completa.`);
    const buffer = await result.data.arrayBuffer();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    yield { file: { ...file, size: buffer.byteLength, contentBase64: base64(new Uint8Array(buffer)), sha256 } };
  }
  const completion = await invoke({ action: 'complete', exportId: manifest.exportId });
  if (completion.error || !completion.data || typeof completion.data !== 'object' || !('success' in completion.data) || completion.data.success !== true) throw new Error('Os dados mudaram ou a exportação expirou. Reinicie para obter uma cópia consistente.');
  progress('Preparando o arquivo completo para download…');
}

/** Build a complete bounded archive. No partial archive is returned. */
export async function assembleDataExport(userId: string, invoke: InvokeExport, progress: (message: string) => void) {
  let manifest!: ExportManifest;
  const files: Array<ExportFile & { size: number; contentBase64: string; sha256: string }> = [];
  for await (const entry of exportEntries(userId, invoke, progress, true)) {
    if (entry.manifest) manifest = entry.manifest;
    if (entry.file) files.push(entry.file);
  }
  return { ...manifest, files };
}

/** File System Access writes one bounded file at a time, so total archives may
 * exceed 100 MB. The caller commits only after final server verification and
 * aborts the writable on any error, preserving the previous destination file. */
export async function writeDataExport(userId: string, invoke: InvokeExport, progress: (message: string) => void, write: (chunk: string) => Promise<void>) {
  let count = 0;
  for await (const entry of exportEntries(userId, invoke, progress, false)) {
    if (entry.manifest) {
      const { files: _files, ...metadata } = entry.manifest;
      await write(`${JSON.stringify(metadata).slice(0, -1)},"files":[`);
    }
    if (entry.file) { await write(`${count ? ',' : ''}${JSON.stringify(entry.file)}`); count++; }
  }
  await write(']}');
  return count;
}
