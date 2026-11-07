import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';
import {WhatsAppClaimError} from './whatsappClaim';

const uuid=z.string().uuid().toLowerCase();
const inputSchema=z.object({conversationId:uuid,revision:z.number().int().min(0).max(2147483646),status:z.literal('open'),assignedTo:uuid}).strict();
const receiptSchema=z.object({revision:z.number().int().positive().max(2147483647),status:z.literal('closed'),assignedTo:uuid}).strict();
export type WhatsAppCloseInput=z.input<typeof inputSchema>;
export type WhatsAppCloseReceipt=z.infer<typeof receiptSchema>;
const messages={
  stale:'A conversa mudou. Atualize os dados e confirme novamente antes de encerrar.',
  forbidden:'Você não tem permissão para encerrar esta conversa.',
  not_found:'Esta conversa não está disponível. Atualize a lista.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  invalid:'Não foi possível encerrar esta conversa. Atualize os dados antes de continuar.',
  unavailable:'Não foi possível confirmar o encerramento. Atualize a conversa antes de tentar novamente.',
} as const;
export class WhatsAppCloseError extends WhatsAppClaimError{
  constructor(message:string,code:ConstructorParameters<typeof WhatsAppClaimError>[1],needsRefresh:boolean){super(message,code,needsRefresh);this.name='WhatsAppCloseError';}
}
const cancelled=(started:boolean)=>new WhatsAppCloseError(started?'O encerramento foi interrompido. Atualize a conversa para conferir o estado.':'A solicitação foi cancelada antes do envio.','cancelled',started);

/** Open/owner context validates the local snapshot only; it is never request authority. */
export async function closeWhatsAppConversation(input:WhatsAppCloseInput,expectedActor:string,signal?:AbortSignal):Promise<WhatsAppCloseReceipt>{
  const parsed=inputSchema.safeParse(input),actor=uuid.safeParse(expectedActor);
  if(!parsed.success||!actor.success||parsed.data.assignedTo!==actor.data)throw new WhatsAppCloseError('Confira se a conversa está aberta e sob sua responsabilidade antes de encerrar.','invalid',false);
  if(signal?.aborted)throw cancelled(false);
  let result;
  try{result=await supabase.functions.invoke('whatsapp-api',{body:{action:'act',operation:'close',conversationId:parsed.data.conversationId,revision:parsed.data.revision},signal});}
  catch{if(signal?.aborted)throw cancelled(true);throw new WhatsAppCloseError(messages.unavailable,'unavailable',true);}
  if(signal?.aborted)throw cancelled(true);
  if(result.error){
    const payload=await functionErrorBody(result.error);if(signal?.aborted)throw cancelled(true);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(messages,raw)?raw as keyof typeof messages:'unavailable';
    throw new WhatsAppCloseError(messages[code],code,true);
  }
  const receipt=receiptSchema.safeParse(result.data);
  if(!receipt.success||receipt.data.revision!==parsed.data.revision+1||receipt.data.assignedTo!==actor.data)throw new WhatsAppCloseError('O encerramento não pôde ser conferido. Atualize a conversa para verificar o estado.','INVALID_RESPONSE',true);
  return receipt.data;
}
