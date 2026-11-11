// K2 aggregate only: complete counters and one current-owner page, never clinical records or commands.
import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {functionErrorBody} from '@/lib/functionErrors';

const timestamp=z.string().max(40).datetime({offset:true});
const uuid=z.string().uuid().toLowerCase();
const cursor=z.string().length(39).regex(/^a1\.[0-9a-f-]+$/).refine(value=>uuid.safeParse(value.slice(3)).success);
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const inputSchema=z.object({from:timestamp,to:timestamp,before:cursor.nullish(),limit:z.number().int().min(1).max(50).default(50)}).strict().refine(value=>{
  const from=Date.parse(value.from),to=Date.parse(value.to);
  return Number.isFinite(from)&&Number.isFinite(to)&&from<to&&to-from<=31*86_400_000;
});
const ownerSchema=z.object({userId:uuid,name:z.string().min(1).max(256).refine(value=>value.trim().length>0),role:z.enum(['reception','admin']),ambiguous:z.boolean(),openCount:count.refine(value=>value>0)}).strict();
const cohortSchema=z.object({incomingCycles:count,withHumanSend:count,withoutHumanSend:count,medianFirstHumanSendSeconds:count.nullable(),closedWithoutHumanSend:count}).strict().refine(value=>
  value.withHumanSend+value.withoutHumanSend===value.incomingCycles&&value.closedWithoutHumanSend<=value.withoutHumanSend&&
  ((value.withHumanSend===0)===(value.medianFirstHumanSendSeconds===null)));
const labelKey=(name:string)=>name.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
const ownersSchema=z.object({items:z.array(ownerSchema).max(50),nextBefore:cursor.nullable()}).strict().refine(page=>{
  if(!page.items.every((row,i)=>i===0||page.items[i-1].userId<row.userId))return false;
  if(page.nextBefore!==null&&page.nextBefore!==`a1.${page.items[page.items.length-1]?.userId}`)return false;
  const names=new Map<string,number>();for(const row of page.items){const key=labelKey(row.name);names.set(key,(names.get(key)??0)+1);}
  return page.items.every(row=>row.ambiguous||names.get(labelKey(row.name))===1);
});
const openSchema=z.object({total:count,unassigned:count,assignedToIneligible:count,owners:ownersSchema}).strict();
const knownOpenCount=(value:z.infer<typeof openSchema>)=>value.unassigned+value.assignedToIneligible+value.owners.items.reduce((sum,row)=>sum+row.openCount,0);
const dashboardSchema=z.object({
  schemaVersion:z.literal(1),asOf:timestamp,
  window:z.object({from:timestamp,to:timestamp,timeZone:z.literal('America/Sao_Paulo')}).strict(),
  coverage:z.literal('latest_cycle_only'),cohort:cohortSchema,openNow:openSchema,
  unavailable:z.object({abandonment:z.literal('no_explicit_event'),appointments:z.literal('scoped_source_required')}).strict(),
}).strict().refine(value=>{
  const from=Date.parse(value.window.from),to=Date.parse(value.window.to),asOf=Date.parse(value.asOf),known=knownOpenCount(value.openNow);
  return from<to&&to-from<=31*86_400_000&&to<=asOf&&Number.isSafeInteger(known)&&known<=value.openNow.total;
});

export type WhatsAppDashboardInput=z.input<typeof inputSchema>;
export type WhatsAppDashboard=z.infer<typeof dashboardSchema>;
export class WhatsAppDashboardReadError extends Error{
  constructor(message:string,readonly code:string){super(message);this.name='WhatsAppDashboardReadError';}
}
const errors:Record<string,string>={
  forbidden:'Você não tem acesso ao painel de recepção desta clínica.',
  invalid:'Confira o período e a página do painel antes de tentar novamente.',
  directory_unavailable:'Não foi possível conferir os responsáveis. O painel está indisponível.',
  server_not_ready:'O painel da recepção ainda não está disponível.',
  unavailable:'Não foi possível carregar o painel. Verifique o acesso e tente novamente.',
};
function checkCancellation(signal?:AbortSignal){
  if(signal?.aborted)throw new WhatsAppDashboardReadError('A consulta do painel foi cancelada.','cancelled');
}

export async function readWhatsAppDashboard(input:WhatsAppDashboardInput,signal?:AbortSignal):Promise<WhatsAppDashboard>{
  checkCancellation(signal);
  const parsedInput=inputSchema.safeParse(input);
  if(!parsedInput.success)throw new WhatsAppDashboardReadError(errors.invalid,'invalid');
  // The server refuses an end after its own clock. The end is clamped to one minute before this
  // device's clock (whole minutes), so "today" or a default period never fails on a small skew.
  const latest=Math.floor((Date.now()-60_000)/60_000)*60_000;
  const value=parsedInput.data,before=value.before??null,from=new Date(value.from).toISOString(),to=new Date(Math.min(Date.parse(value.to),latest)).toISOString();
  if(!(Date.parse(from)<Date.parse(to)))throw new WhatsAppDashboardReadError(errors.invalid,'invalid');
  const result=await supabase.functions.invoke('whatsapp-api',{body:{action:'dashboard',from,to,before,limit:value.limit},signal}).catch(()=>{
    checkCancellation(signal);throw new WhatsAppDashboardReadError(errors.unavailable,'unavailable');
  });
  checkCancellation(signal);
  if(result.error){
    const payload=await functionErrorBody(result.error);checkCancellation(signal);
    const raw=payload?.code,code=typeof raw==='string'&&Object.prototype.hasOwnProperty.call(errors,raw)?raw:'unavailable';
    throw new WhatsAppDashboardReadError(errors[code],code);
  }
  const page=dashboardSchema.safeParse(result.data);
  if(!page.success||Date.parse(page.data.window.from)!==Date.parse(from)||Date.parse(page.data.window.to)!==Date.parse(to)||
    page.data.openNow.owners.items.length>value.limit||
    (before!==null&&(page.data.openNow.owners.nextBefore===before||page.data.openNow.owners.items.some(row=>row.userId<=before.slice(3))))||
    (before===null&&page.data.openNow.owners.nextBefore===null&&knownOpenCount(page.data.openNow)!==page.data.openNow.total))
    throw new WhatsAppDashboardReadError('A resposta do painel não pôde ser validada. Atualize e tente novamente.','INVALID_RESPONSE');
  return page.data;
}
