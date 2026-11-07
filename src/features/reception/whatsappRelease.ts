import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';
import {WhatsAppClaimError} from './whatsappClaim';

const uuid=z.string().uuid().toLowerCase();
const inputSchema=z.object({conversationId:uuid,revision:z.number().int().min(0).max(2147483646),assignedTo:uuid}).strict();
const receiptSchema=z.object({revision:z.number().int().positive().max(2147483647),status:z.literal('open'),assignedTo:z.null()}).strict();
export type WhatsAppReleaseInput=z.input<typeof inputSchema>;
export type WhatsAppReleaseReceipt=z.infer<typeof receiptSchema>;
const messages={
  stale:'A conversa mudou. Atualize os dados e confirme novamente antes de devolver à fila.',
  forbidden:'Você não tem permissão para devolver esta conversa à fila.',
  not_found:'Esta conversa não está disponível. Atualize a lista.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  invalid:'Não foi possível devolver esta conversa à fila. Atualize os dados antes de continuar.',
  unavailable:'Não foi possível confirmar a devolução. Atualize a conversa antes de tentar novamente.',
} as const;
export class WhatsAppReleaseError extends WhatsAppClaimError{
  constructor(message:string,code:ConstructorParameters<typeof WhatsAppClaimError>[1],needsRefresh:boolean){super(message,code,needsRefresh);this.name='WhatsAppReleaseError';}
}
const cancelled=(started:boolean)=>new WhatsAppReleaseError(started?'A devolução foi interrompida. Atualize a conversa para conferir o responsável.':'A solicitação foi cancelada antes do envio.','cancelled',started);

/** Owner context validates the local snapshot only; it never becomes request authority. */
export async function releaseWhatsAppConversation(input:WhatsAppReleaseInput,expectedActor:string,signal?:AbortSignal):Promise<WhatsAppReleaseReceipt>{
  const parsed=inputSchema.safeParse(input),actor=uuid.safeParse(expectedActor);
  if(!parsed.success||!actor.success||parsed.data.assignedTo!==actor.data)throw new WhatsAppReleaseError('Confira se esta conversa está sob sua responsabilidade antes de devolver à fila.','invalid',false);
  if(signal?.aborted)throw cancelled(false);
  let result;
  try{result=await supabase.functions.invoke('whatsapp-api',{body:{action:'act',operation:'unassign',conversationId:parsed.data.conversationId,revision:parsed.data.revision},signal});}
  catch{if(signal?.aborted)throw cancelled(true);throw new WhatsAppReleaseError(messages.unavailable,'unavailable',true);}
  if(signal?.aborted)throw cancelled(true);
  if(result.error){
    const payload=await functionErrorBody(result.error);if(signal?.aborted)throw cancelled(true);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(messages,raw)?raw as keyof typeof messages:'unavailable';
    throw new WhatsAppReleaseError(messages[code],code,true);
  }
  const receipt=receiptSchema.safeParse(result.data);
  if(!receipt.success||receipt.data.revision!==parsed.data.revision+1)throw new WhatsAppReleaseError('A devolução não pôde ser conferida. Atualize a conversa para verificar o responsável.','INVALID_RESPONSE',true);
  return receipt.data;
}
