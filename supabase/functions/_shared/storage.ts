/** Privileged Storage requests must never accept URL-normalization aliases. */
export function assertCanonicalPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[%\\?#]/.test(value) ||
    [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error('Caminho de arquivo inválido');
  }
  if (value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Caminho de arquivo inválido');
  }
  return value;
}

export function assertAudioPath(value: unknown, userId: string): string {
  const path = assertCanonicalPath(value);
  if (!path.startsWith(`consultations/${userId}/`)) throw new Error('Arquivo não autorizado');
  return path;
}

export function assertPatientFilePath(value: unknown, userId: string, patientId: string): string {
  const path = assertCanonicalPath(value);
  if (!path.startsWith(`patients/${userId}/${patientId}/`)) throw new Error('Arquivo não autorizado');
  return path;
}

export function assertPrescriptionPath(value: unknown, userId: string, prescriptionId: string): string {
  const path = assertCanonicalPath(value);
  if (path !== `rx/${userId}/${prescriptionId}.pdf`) throw new Error('Arquivo não autorizado');
  return path;
}

export function assertOwnedStoragePath(bucket: unknown, value: unknown, userId: string): string {
  const roots: Record<string,string> = {'patient-files':'patients','audio-recordings':'consultations','prescriptions':'rx'};
  if (typeof bucket !== 'string' || !Object.prototype.hasOwnProperty.call(roots,bucket)) throw new Error('Repositório de arquivos inválido');
  const path = assertCanonicalPath(value);
  if (!path.startsWith(`${roots[bucket]}/${userId}/`)) throw new Error('Arquivo não autorizado');
  return path;
}

type StorageResult<T> = { data: T | null; error: unknown };
interface StorageClient {
  from(bucket: string): {
    list(prefix: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }): PromiseLike<StorageResult<Array<{name: string; id: string | null; metadata?: {size?:number} | null}>>>;
    remove(paths: string[]): PromiseLike<StorageResult<unknown>>;
  };
}
export interface StoredObject { bucket: string; path: string; name: string; size: number | null }

/** Traverse virtual folders, including objects with no database metadata. */
export async function listStoragePrefix(storage: StorageClient, bucket: string, prefix: string): Promise<StoredObject[]> {
  assertCanonicalPath(prefix);
  const api = storage.from(bucket);
  const files: StoredObject[] = [];
  async function visit(folder: string, depth: number): Promise<void> {
    if (depth > 20) throw new Error('Estrutura de arquivos excede o limite de exclusão');
    const entries: Array<{ name: string; id: string | null; metadata?: {size?:number} | null }> = [];
    for (let offset = 0; ; offset += 100) {
      const {data, error} = await api.list(folder, {limit: 100, offset, sortBy: {column: 'name', order: 'asc'}});
      if (error || !data) throw new Error('Não foi possível listar todos os arquivos');
      entries.push(...data);
      if (data.length < 100) break;
    }
    for (const entry of entries) {
      // Storage object names are data too. Never walk outside the authorized prefix.
      if (entry.name.includes('/')) throw new Error('Nome de arquivo inválido');
      // list/remove send keys in JSON, not URL paths. Preserve even legacy '%'
      // names so cleanup can remove every object under the authorized prefix.
      const path = `${folder}/${entry.name}`;
      if (entry.id === null) await visit(path, depth + 1);
      else files.push({bucket,path,name:entry.name,size:typeof entry.metadata?.size==='number' ? entry.metadata.size : null});
    }
  }
  await visit(prefix, 0);
  return files;
}

export async function removeStoragePrefix(storage: StorageClient, bucket: string, prefix: string): Promise<void> {
  assertCanonicalPath(prefix);
  const api = storage.from(bucket);
  async function drain(folder:string,depth:number):Promise<void> {
    if(depth>20) throw new Error('Estrutura de arquivos excede o limite de exclusão');
    // Deletion intent blocks new writes. Always restart at zero because another
    // authorized deletion can shift the listing while cleanup is in progress.
    for (;;) {
      const {data,error} = await api.list(folder,{limit:100,offset:0,sortBy:{column:'name',order:'asc'}});
      if(error || !data) throw new Error('Não foi possível listar todos os arquivos');
      if(!data.length) return;
      const paths:string[]=[];
      for(const entry of data) {
        if(entry.name.includes('/')) throw new Error('Nome de arquivo inválido');
        const path=`${folder}/${entry.name}`;
        if(entry.id===null) await drain(path,depth+1);
        else paths.push(path);
      }
      if(paths.length) {
        const {error:removeError}=await api.remove(paths);
        if(removeError) throw new Error('Não foi possível excluir todos os arquivos');
      }
    }
  }
  await drain(prefix,0);
}
