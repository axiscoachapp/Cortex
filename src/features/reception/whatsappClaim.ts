import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';

const uuid=z.string().uuid().toLowerCase();
const inputSchema=z.object({conversationId:uuid,revision:z.number().int().min(0).max(2147483646)}).strict();
const receiptSchema=z.object({revision:z.number().int().positive().max(2147483647),status:z.literal('open'),assignedTo:uuid}).strict();
export type WhatsAppClaimInput=z.input<typeof inputSchema>;
export type WhatsAppClaimReceipt=z.infer<typeof receiptSchema>;
const messages={
  stale:'A conversa mudou. Atualize os dados e confirme novamente antes de assumir.',
  forbidden:'Você não tem permissão para assumir esta conversa.',
  not_found:'Esta conversa não está disponível. Atualize a lista.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  invalid:'Não foi possível assumir esta conversa. Atualize os dados antes de continuar.',
  unavailable:'Não foi possível confirmar a atribuição. Atualize a conversa antes de tentar novamente.',
} as const;
type ClaimCode=keyof typeof messages|'cancelled'|'INVALID_RESPONSE';
export class WhatsAppClaimError extends Error{
  constructor(message:string,readonly code:ClaimCode,readonly needsRefresh:boolean){super(message);this.name='WhatsAppClaimError';}
}
const cancelled=(started:boolean)=>new WhatsAppClaimError(started?'A solicitação foi interrompida. Atualize a conversa para conferir o responsável.':'A solicitação foi cancelada antes do envio.','cancelled',started);

/** The expected actor validates the receipt only; the authenticated server chooses the assignee. */
export async function claimWhatsAppConversation(input:WhatsAppClaimInput,expectedActor:string,signal?:AbortSignal):Promise<WhatsAppClaimReceipt>{
  const parsed=inputSchema.safeParse(input),actor=uuid.safeParse(expectedActor);
  if(!parsed.success||!actor.success)throw new WhatsAppClaimError('Confira a conversa e sua revisão antes de assumir.','invalid',false);
  if(signal?.aborted)throw cancelled(false);
  let result;
  try{
    result=await supabase.functions.invoke('whatsapp-api',{body:{action:'act',operation:'assign',...parsed.data},signal});
  }catch{
    if(signal?.aborted)throw cancelled(true);
    throw new WhatsAppClaimError(messages.unavailable,'unavailable',true);
  }
  if(signal?.aborted)throw cancelled(true);
  if(result.error){
    const payload=await functionErrorBody(result.error);
    if(signal?.aborted)throw cancelled(true);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(messages,raw)?raw as keyof typeof messages:'unavailable';
    throw new WhatsAppClaimError(messages[code],code,true);
  }
  const receipt=receiptSchema.safeParse(result.data);
  if(!receipt.success||receipt.data.revision!==parsed.data.revision+1||receipt.data.assignedTo!==actor.data)
    throw new WhatsAppClaimError('A atribuição não pôde ser conferida. Atualize a conversa para verificar o responsável.','INVALID_RESPONSE',true);
  return receipt.data;
}
