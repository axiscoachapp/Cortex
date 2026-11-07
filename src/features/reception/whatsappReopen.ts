import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';
import {WhatsAppClaimError} from './whatsappClaim';

const uuid=z.string().uuid().toLowerCase();
const inputSchema=z.object({conversationId:uuid,revision:z.number().int().min(0).max(2147483646),status:z.literal('closed'),assignedTo:uuid.nullable()}).strict();
const receiptSchema=z.object({revision:z.number().int().positive().max(2147483647),status:z.literal('open'),assignedTo:uuid.nullable()}).strict();
export type WhatsAppReopenInput=z.input<typeof inputSchema>;
export type WhatsAppReopenReceipt=z.infer<typeof receiptSchema>;
const messages={
  stale:'A conversa mudou. Atualize os dados e confirme novamente antes de reabrir.',
  forbidden:'Você não tem permissão para reabrir esta conversa.',
  not_found:'Esta conversa não está disponível. Atualize a lista.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  invalid:'Não foi possível reabrir esta conversa. Atualize os dados antes de continuar.',
  unavailable:'Não foi possível confirmar a reabertura. Atualize a conversa antes de tentar novamente.',
} as const;
export class WhatsAppReopenError extends WhatsAppClaimError{
  constructor(message:string,code:ConstructorParameters<typeof WhatsAppClaimError>[1],needsRefresh:boolean){super(message,code,needsRefresh);this.name='WhatsAppReopenError';}
}
const cancelled=(started:boolean)=>new WhatsAppReopenError(started?'A reabertura foi interrompida. Atualize a conversa para conferir o estado.':'A solicitação foi cancelada antes do envio.','cancelled',started);

/** Closed/owner context is a local snapshot, never request authority or implicit assignment. */
export async function reopenWhatsAppConversation(input:WhatsAppReopenInput,expectedActor:string,signal?:AbortSignal):Promise<WhatsAppReopenReceipt>{
  const parsed=inputSchema.safeParse(input),actor=uuid.safeParse(expectedActor);
  if(!parsed.success||!actor.success||(parsed.data.assignedTo!==null&&parsed.data.assignedTo!==actor.data))throw new WhatsAppReopenError('Confira se a conversa está encerrada, sob sua responsabilidade ou sem responsável, antes de reabrir.','invalid',false);
  if(signal?.aborted)throw cancelled(false);
  let result;
  try{result=await supabase.functions.invoke('whatsapp-api',{body:{action:'act',operation:'reopen',conversationId:parsed.data.conversationId,revision:parsed.data.revision},signal});}
  catch{if(signal?.aborted)throw cancelled(true);throw new WhatsAppReopenError(messages.unavailable,'unavailable',true);}
  if(signal?.aborted)throw cancelled(true);
  if(result.error){
    const payload=await functionErrorBody(result.error);if(signal?.aborted)throw cancelled(true);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(messages,raw)?raw as keyof typeof messages:'unavailable';
    throw new WhatsAppReopenError(messages[code],code,true);
  }
  const receipt=receiptSchema.safeParse(result.data);
  if(!receipt.success||receipt.data.revision!==parsed.data.revision+1||receipt.data.assignedTo!==parsed.data.assignedTo)throw new WhatsAppReopenError('A reabertura não pôde ser conferida. Atualize a conversa para verificar o estado.','INVALID_RESPONSE',true);
  return receipt.data;
}
