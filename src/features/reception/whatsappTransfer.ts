import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';
import {WhatsAppClaimError} from './whatsappClaim';

const uuid=z.string().uuid().toLowerCase();
const inputSchema=z.object({conversationId:uuid,revision:z.number().int().min(0).max(2147483646),status:z.literal('open'),assignedTo:uuid,targetUserId:uuid}).strict();
const receiptSchema=z.object({revision:z.number().int().positive().max(2147483647),status:z.literal('open'),assignedTo:uuid}).strict();
export type WhatsAppTransferInput=z.input<typeof inputSchema>;
export type WhatsAppTransferReceipt=z.infer<typeof receiptSchema>;
const messages={
  stale:'A conversa mudou. Atualize os dados e confirme novamente antes de transferir.',
  forbidden:'Você não tem permissão para transferir esta conversa.',
  not_found:'Esta conversa não está disponível. Atualize a lista.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  invalid:'Não foi possível transferir esta conversa. Atualize os dados e confira o destinatário.',
  unavailable:'Não foi possível confirmar a transferência. Atualize a conversa antes de tentar novamente.',
} as const;
export class WhatsAppTransferError extends WhatsAppClaimError{
  constructor(message:string,code:ConstructorParameters<typeof WhatsAppClaimError>[1],needsRefresh:boolean){super(message,code,needsRefresh);this.name='WhatsAppTransferError';}
}
const cancelled=(started:boolean)=>new WhatsAppTransferError(started?'A transferência foi interrompida. Atualize a conversa para conferir o responsável.':'A solicitação foi cancelada antes do envio.','cancelled',started);

/** Local owner context is not authority; the explicit target is an action parameter. */
export async function transferWhatsAppConversation(input:WhatsAppTransferInput,expectedActor:string,signal?:AbortSignal):Promise<WhatsAppTransferReceipt>{
  const parsed=inputSchema.safeParse(input),actor=uuid.safeParse(expectedActor);
  if(!parsed.success||!actor.success||parsed.data.assignedTo!==actor.data||parsed.data.targetUserId===actor.data)throw new WhatsAppTransferError('Confira se a conversa está aberta e sob sua responsabilidade e selecione outra pessoa.','invalid',false);
  if(signal?.aborted)throw cancelled(false);
  let result;
  try{result=await supabase.functions.invoke('whatsapp-api',{body:{action:'act',operation:'assign',conversationId:parsed.data.conversationId,revision:parsed.data.revision,targetUserId:parsed.data.targetUserId},signal});}
  catch{if(signal?.aborted)throw cancelled(true);throw new WhatsAppTransferError(messages.unavailable,'unavailable',true);}
  if(signal?.aborted)throw cancelled(true);
  if(result.error){
    const payload=await functionErrorBody(result.error);if(signal?.aborted)throw cancelled(true);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(messages,raw)?raw as keyof typeof messages:'unavailable';
    throw new WhatsAppTransferError(messages[code],code,true);
  }
  const receipt=receiptSchema.safeParse(result.data);
  if(!receipt.success||receipt.data.revision!==parsed.data.revision+1||receipt.data.assignedTo!==parsed.data.targetUserId)throw new WhatsAppTransferError('A transferência não pôde ser conferida. Atualize a conversa para verificar o responsável.','INVALID_RESPONSE',true);
  return receipt.data;
}
