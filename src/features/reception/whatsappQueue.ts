import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';
import {WhatsAppClaimError} from './whatsappClaim';

const uuid=z.string().uuid().toLowerCase();
// Separate character check also rejects final line breaks, which JavaScript $ can accept.
const queue=z.string().min(1).max(40).regex(/^[a-z0-9]/).refine(value=>!/[^a-z0-9_-]/.test(value));
const inputSchema=z.object({conversationId:uuid,revision:z.number().int().min(0).max(2147483646),status:z.literal('open'),assignedTo:uuid,currentQueue:z.string().min(1).max(128),queue}).strict();
const receiptSchema=z.object({revision:z.number().int().positive().max(2147483647),status:z.literal('open'),assignedTo:uuid}).strict();
export type WhatsAppQueueInput=z.input<typeof inputSchema>;
export type WhatsAppQueueReceipt=z.infer<typeof receiptSchema>;
export type WhatsAppQueueResult={receipt:WhatsAppQueueReceipt;needsRefresh:true};
const messages={
  stale:'A conversa mudou. Atualize os dados e confirme novamente antes de mudar a fila.',
  forbidden:'Você não tem permissão para mudar a fila desta conversa.',
  not_found:'Esta conversa não está disponível. Atualize a lista.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  invalid:'Não foi possível mudar a fila. Atualize os dados e confira a fila escolhida.',
  unavailable:'Não foi possível conferir a fila. Atualize a conversa antes de tentar novamente.',
} as const;
export class WhatsAppQueueError extends WhatsAppClaimError{
  constructor(message:string,code:ConstructorParameters<typeof WhatsAppClaimError>[1],needsRefresh:boolean){super(message,code,needsRefresh);this.name='WhatsAppQueueError';}
}
const cancelled=(started:boolean)=>new WhatsAppQueueError(started?'A solicitação foi interrompida. Atualize a conversa para conferir a fila.':'A solicitação foi cancelada antes do envio.','cancelled',started);

/** The act receipt omits queue: even a valid receipt always requires read-back. */
export async function setWhatsAppConversationQueue(input:WhatsAppQueueInput,expectedActor:string,signal?:AbortSignal):Promise<WhatsAppQueueResult>{
  const parsed=inputSchema.safeParse(input),actor=uuid.safeParse(expectedActor);
  if(!parsed.success||!actor.success||parsed.data.assignedTo!==actor.data||parsed.data.queue===parsed.data.currentQueue)throw new WhatsAppQueueError('Confira se a conversa está aberta e sob sua responsabilidade e escolha outra fila.','invalid',false);
  if(signal?.aborted)throw cancelled(false);
  let result;
  try{result=await supabase.functions.invoke('whatsapp-api',{body:{action:'act',operation:'set_queue',conversationId:parsed.data.conversationId,revision:parsed.data.revision,queue:parsed.data.queue},signal});}
  catch{if(signal?.aborted)throw cancelled(true);throw new WhatsAppQueueError(messages.unavailable,'unavailable',true);}
  if(signal?.aborted)throw cancelled(true);
  if(result.error){
    const payload=await functionErrorBody(result.error);if(signal?.aborted)throw cancelled(true);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(messages,raw)?raw as keyof typeof messages:'unavailable';
    throw new WhatsAppQueueError(messages[code],code,true);
  }
  const receipt=receiptSchema.safeParse(result.data);
  if(!receipt.success||receipt.data.revision!==parsed.data.revision+1||receipt.data.assignedTo!==parsed.data.assignedTo)throw new WhatsAppQueueError('O resultado não pôde ser conferido. Atualize a conversa para verificar a fila.','INVALID_RESPONSE',true);
  return {receipt:receipt.data,needsRefresh:true};
}
