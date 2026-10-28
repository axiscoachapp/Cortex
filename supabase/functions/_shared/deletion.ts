import { RequestError } from './http.ts';

interface DeletionClient {
  rpc(name: string,args: Record<string,unknown>): PromiseLike<{data:unknown;error:{code?:string}|null}>;
}
/** Do this before storage cleanup or deletion markers. A legacy relationship
 * conflict needs operator repair; deleting either owner's data is not a repair. */
export async function requireSafeDeletion(db:DeletionClient,userId:string,patientId:string|null=null):Promise<void> {
  const {data,error}=await db.rpc('assert_deletion_scope',{p_user_id:userId,p_patient_id:patientId});
  if(error?.code==='P4090') throw new RequestError('Exclusão bloqueada por vínculos antigos inconsistentes. O suporte precisa corrigir esses vínculos antes de excluir os dados.',409);
  if(error || data!==true) throw new RequestError('Não foi possível verificar a exclusão com segurança. Tente novamente.',503);
}
