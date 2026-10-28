import { fetchWithDeadline } from './http.ts';

interface CleanupResult { data?: unknown; error: unknown }
interface CleanupQuery extends PromiseLike<CleanupResult> {
  eq(key: string, value: string): CleanupQuery;
  limit(count: number): CleanupQuery;
}
export interface CleanupClient {
  from(table: string): {
    upsert(row: object, options?: { onConflict: string }): PromiseLike<CleanupResult>;
    delete(): CleanupQuery;
    select(columns: string): CleanupQuery;
  };
}
export interface ProviderFileScope { db: { from: unknown }; userId: string; patientId: string }
export async function beginProviderUpload({db,userId,patientId}:ProviderFileScope):Promise<string> {
  const id=crypto.randomUUID();
  const {error}=await (db as CleanupClient).from('provider_upload_leases').upsert({id,user_id:userId,patient_id:patientId});
  if(error) throw new Error('Não foi possível registrar o envio externo. O arquivo de origem foi preservado.');
  return id;
}
export async function completeProviderUpload(db:{from:unknown},userId:string,id:string):Promise<void> {
  const {error}=await (db as CleanupClient).from('provider_upload_leases').delete().eq('user_id',userId).eq('id',id);
  if(error) throw new Error('Não foi possível concluir o registro do envio externo.');
}
export function geminiFileName(uri: string): string {
  const url = new URL(uri);
  if (url.origin !== 'https://generativelanguage.googleapis.com' || url.search || url.hash || !/^\/v1beta\/files\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error('Identidade do arquivo externo inválida.');
  return url.pathname.slice('/v1beta/'.length);
}
async function removeProviderFile(apiKey: string, fileName: string): Promise<boolean> {
  try {
    const response = await fetchWithDeadline(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' }, 15_000, 1024 * 1024);
    return response.ok || response.status === 404;
  } catch { return false; }
}
/** Register before generation; never continue using an untracked external copy. */
export async function trackGeminiFile(apiKey: string, uri: string, db: { from: unknown }, userId: string, patientId: string): Promise<void> {
  const fileName = geminiFileName(uri);
  const { error } = await (db as CleanupClient).from('provider_file_cleanup').upsert({ user_id: userId, patient_id: patientId, provider: 'gemini', file_name: fileName }, { onConflict: 'user_id,provider,file_name' });
  if (error) {
    await removeProviderFile(apiKey, fileName);
    throw new Error('Não foi possível registrar o processamento externo. O arquivo de origem foi preservado.');
  }
}
/** Failed attempts retain the exact patient-linked obligation for retry. */
export async function cleanupGeminiFile(apiKey: string, uri: string, db: { from: unknown }, userId: string): Promise<boolean> {
  const fileName = geminiFileName(uri);
  if (!await removeProviderFile(apiKey, fileName)) return false;
  const { error } = await (db as CleanupClient).from('provider_file_cleanup').delete().eq('user_id', userId).eq('provider', 'gemini').eq('file_name', fileName);
  return !error;
}
export async function retryProviderCleanup(db: { from: unknown }, userId: string, apiKey: string | undefined, patientId?: string): Promise<void> {
  for (;;) {
    let query = (db as CleanupClient).from('provider_file_cleanup').select('file_name').eq('user_id', userId);
    if (patientId) query = query.eq('patient_id', patientId);
    const { data, error } = await query.limit(100);
    if (error || !Array.isArray(data)) throw new Error('Não foi possível verificar as cópias externas.');
    if (!data.length) break;
    if (!apiKey) throw new Error('Existem cópias externas pendentes. A configuração do provedor precisa ser recuperada antes de concluir a exclusão.');
    for (const row of data) {
      if (!row || typeof row !== 'object' || !('file_name' in row) || typeof row.file_name !== 'string' || !/^files\/[A-Za-z0-9_-]+$/.test(row.file_name)) throw new Error('Obrigação de limpeza externa inválida.');
      if (!await cleanupGeminiFile(apiKey, `https://generativelanguage.googleapis.com/v1beta/${row.file_name}`, db, userId)) throw new Error('A remoção das cópias externas está pendente. Tente novamente para concluir.');
    }
  }
  let leases=(db as CleanupClient).from('provider_upload_leases').select('id,created_at').eq('user_id',userId);
  if(patientId) leases=leases.eq('patient_id',patientId);
  const {data:pending,error:leaseError}=await leases.limit(100);
  if(leaseError || !Array.isArray(pending)) throw new Error('Não foi possível verificar os envios externos pendentes.');
  // An upload with an unknown result is not proved absent by a timer. Keep its
  // identity until exact provider reconciliation confirms removal/cancellation.
  if(pending.length) throw new Error('Há um envio externo em andamento ou sem confirmação. Tente novamente após a conclusão. Se o envio foi interrompido, o suporte precisa reconciliar a cópia externa antes de concluir a exclusão.');
}
