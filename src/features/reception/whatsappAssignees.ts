// Delivered C4 catalogue only. Eligibility and global label ambiguity remain server responsibilities.
import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';

const uuid=z.string().uuid().toLowerCase();
const cursor=z.string().length(39).regex(/^a1\.[0-9a-f-]+$/).refine(value=>uuid.safeParse(value.slice(3)).success);
const inputSchema=z.object({before:cursor.nullish(),limit:z.number().int().min(1).max(50).default(50)}).strict();
const itemSchema=z.object({userId:uuid,name:z.string().min(1).max(256).refine(name=>name.trim().length>0),role:z.enum(['reception','admin']),ambiguous:z.boolean()}).strict();
const labelKey=(name:string)=>name.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
const pageSchema=z.object({items:z.array(itemSchema).max(50),nextBefore:cursor.nullable()}).strict().refine(page=>{
  if(!page.items.every((row,i)=>i===0||page.items[i-1].userId<row.userId))return false;
  if(page.nextBefore!==null&&page.nextBefore!==`a1.${page.items.at(-1)?.userId}`)return false;
  const counts=new Map<string,number>();
  for(const row of page.items){const key=labelKey(row.name);counts.set(key,(counts.get(key)??0)+1);}
  return page.items.every(row=>row.ambiguous||(counts.get(labelKey(row.name))??0)===1);
});

export type WhatsAppAssignee=z.infer<typeof itemSchema>;
export type WhatsAppAssigneePage=z.infer<typeof pageSchema>;
export type WhatsAppAssigneeReadInput=z.input<typeof inputSchema>;
export class WhatsAppAssigneeReadError extends Error {
  constructor(message:string,readonly code:string){super(message);this.name='WhatsAppAssigneeReadError';}
}
const errors:Record<string,string>={
  forbidden:'Você não tem acesso aos atendentes desta clínica.',
  not_connected:'O WhatsApp desta clínica não está conectado.',
  server_not_ready:'A conexão do WhatsApp ainda não está disponível.',
  directory_unavailable:'Não foi possível conferir todos os nomes da equipe. O catálogo está indisponível.',
  not_found:'O catálogo de atendentes não está disponível.',
  invalid:'Confira a página de atendentes antes de tentar novamente.',
  unavailable:'Não foi possível consultar os atendentes. Verifique o acesso e tente novamente.',
};
function checkCancellation(signal?:AbortSignal){
  if(signal?.aborted)throw new WhatsAppAssigneeReadError('A consulta dos atendentes foi cancelada.','cancelled');
}

/** A returned person is neither an authorization nor a selected transfer target. */
export async function readWhatsAppAssignees(input:WhatsAppAssigneeReadInput={},signal?:AbortSignal):Promise<WhatsAppAssigneePage>{
  checkCancellation(signal);
  const parsedInput=inputSchema.safeParse(input);
  if(!parsedInput.success)throw new WhatsAppAssigneeReadError(errors.invalid,'invalid');
  const value=parsedInput.data,before=value.before??null;
  const result=await supabase.functions.invoke('whatsapp-api',{body:{action:'assignees',before,limit:value.limit},signal}).catch(()=>{
    checkCancellation(signal);throw new WhatsAppAssigneeReadError(errors.unavailable,'unavailable');
  });
  checkCancellation(signal);
  if(result.error){
    const payload=await functionErrorBody(result.error);checkCancellation(signal);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(errors,raw)?raw:'unavailable';
    throw new WhatsAppAssigneeReadError(errors[code],code);
  }
  const page=pageSchema.safeParse(result.data);
  if(!page.success||page.data.items.length>value.limit||
    (before!==null&&(page.data.nextBefore===before||page.data.items.some(row=>row.userId<=before.slice(3)))))
    throw new WhatsAppAssigneeReadError('A página de atendentes não pôde ser validada. Atualize e tente novamente.','INVALID_RESPONSE');
  return page.data;
}
