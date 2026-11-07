import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';
import {WhatsAppClaimError} from './whatsappClaim';

const uuid=z.string().uuid().toLowerCase();
const inputSchema=z.object({conversationId:uuid,revision:z.number().int().min(0).max(2147483646),status:z.literal('open'),assignedTo:uuid,consented:z.literal(true)}).strict();
const receiptSchema=z.object({revision:z.number().int().positive().max(2147483647),status:z.literal('open'),assignedTo:uuid}).strict();
export type WhatsAppRevokeConsentInput=z.input<typeof inputSchema>;
export type WhatsAppRevokeConsentReceipt=z.infer<typeof receiptSchema>;
export type WhatsAppRevokeConsentResult={receipt:WhatsAppRevokeConsentReceipt;needsRefresh:true};
const messages={
  stale:'A conversa mudou. Atualize os dados e confirme novamente antes de retirar a autorização.',
  forbidden:'Você não tem permissão para retirar a autorização nesta conversa.',
  not_found:'Esta conversa não está disponível. Atualize a lista.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  invalid:'Não foi possível solicitar a retirada da autorização. Atualize os dados antes de continuar.',
  unavailable:'Não foi possível conferir a autorização. Atualize a conversa antes de tentar novamente.',
} as const;
export class WhatsAppRevokeConsentError extends WhatsAppClaimError{
  constructor(message:string,code:ConstructorParameters<typeof WhatsAppClaimError>[1],needsRefresh:boolean){super(message,code,needsRefresh);this.name='WhatsAppRevokeConsentError';}
}
const cancelled=(started:boolean)=>new WhatsAppRevokeConsentError(started?'A solicitação foi interrompida. Atualize a conversa para conferir a autorização.':'A solicitação foi cancelada antes do envio.','cancelled',started);

/** act omits consent flags: a valid receipt still requires read-back, never inferred revocation. */
export async function revokeWhatsAppConsent(input:WhatsAppRevokeConsentInput,expectedActor:string,signal?:AbortSignal):Promise<WhatsAppRevokeConsentResult>{
  const parsed=inputSchema.safeParse(input),actor=uuid.safeParse(expectedActor);
  if(!parsed.success||!actor.success||parsed.data.assignedTo!==actor.data)throw new WhatsAppRevokeConsentError('Confira se a conversa está aberta, sob sua responsabilidade e com autorização vigente antes de continuar.','invalid',false);
  if(signal?.aborted)throw cancelled(false);
  let result;
  try{result=await supabase.functions.invoke('whatsapp-api',{body:{action:'act',operation:'revoke_opt_in',conversationId:parsed.data.conversationId,revision:parsed.data.revision},signal});}
  catch{if(signal?.aborted)throw cancelled(true);throw new WhatsAppRevokeConsentError(messages.unavailable,'unavailable',true);}
  if(signal?.aborted)throw cancelled(true);
  if(result.error){
    const payload=await functionErrorBody(result.error);if(signal?.aborted)throw cancelled(true);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(messages,raw)?raw as keyof typeof messages:'unavailable';
    throw new WhatsAppRevokeConsentError(messages[code],code,true);
  }
  const receipt=receiptSchema.safeParse(result.data);
  if(!receipt.success||receipt.data.revision!==parsed.data.revision+1||receipt.data.assignedTo!==parsed.data.assignedTo)throw new WhatsAppRevokeConsentError('O resultado não pôde ser conferido. Atualize a conversa para verificar a autorização.','INVALID_RESPONSE',true);
  return {receipt:receipt.data,needsRefresh:true};
}
