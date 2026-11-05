// Laboratory only. Not deployed, and never a substitute for the SQL fences.
import {AuthError,requireUserContext} from '../../supabase/functions/_shared/auth.ts';

type ConfirmationCode='invalid_request'|'not_authorized'|'conflict'|'retry'|'unavailable';
export class ProvisioningConfirmationError extends Error{
 constructor(public readonly code:ConfirmationCode){super('Não foi possível confirmar o provisionamento.');this.name='ProvisioningConfirmationError';}
}
export type ConfirmationCommand=Readonly<{operationId:string;actorId:string;sessionId:string;aal:'aal2';exp:number}>;
export type ConfirmationReceipt=Readonly<{operationId:string;plannedUserId:string;clinicId:string;expiresAt:string}>;
type CommitConfirmation=(command:ConfirmationCommand)=>Promise<unknown>;
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Auth is fixed here. The port is trusted server infrastructure, not a client
 * argument; its SQL transaction still decides current authority and receipt. */
export async function confirmProvisioningIntent(request:Request,input:unknown,commit:CommitConfirmation):Promise<ConfirmationReceipt>{
 const context=await requireUserContext(request);
 if(context.aal!=='aal2')throw new AuthError('Confirme o segundo fator para continuar.',403,true);
 if(!record(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))
  ||Reflect.ownKeys(input).length!==1)throw new ProvisioningConfirmationError('invalid_request');
 const operationId=uuid(Object.getOwnPropertyDescriptor(input,'operationId')?.value);
 if(!operationId)throw new ProvisioningConfirmationError('invalid_request');
 const command:ConfirmationCommand=Object.freeze({operationId,actorId:context.userId.toLowerCase(),sessionId:context.sessionId.toLowerCase(),aal:'aal2',exp:context.exp});
 let result:unknown;
 try{result=await commit(command);}catch(error){
  const code=record(error)?error.code:null;
  throw new ProvisioningConfirmationError(code==='42501'?'not_authorized':code==='22023'?'conflict':code==='40001'?'retry':'unavailable');
 }
 // A malformed/late response can follow a committed transaction. Refuse the
 // response without claiming rollback or attempting creation/deletion/retry.
 if(!record(result)||result.phase!=='confirmed'||uuid(result.operation_id)!==operationId
  ||uuid(result.actor_id)!==command.actorId||uuid(result.session_id)!==command.sessionId){
  throw new ProvisioningConfirmationError('unavailable');
 }
 const plannedUserId=uuid(result.planned_user_id),clinicId=uuid(result.clinic_id);
 const deadline=typeof result.expires_at==='string'?Date.parse(result.expires_at):NaN;
 const now=Date.now();
 if(!plannedUserId||!clinicId||!Number.isFinite(deadline)||deadline<=now||context.exp<=now/1000){
  throw new ProvisioningConfirmationError('unavailable');
 }
 return Object.freeze({operationId,plannedUserId,clinicId,expiresAt:new Date(deadline).toISOString()});
}
