import type { ChatMessage } from '@/types/patient';

export interface ConversationTurn {
  id: string;
  question: string;
  status: 'pending' | 'complete' | 'failed' | 'retryable';
  createdAt: string;
  updatedAt: string;
  response: { message: string; sources: NonNullable<ChatMessage['sources']>; coverage?: ChatMessage['coverage']; safety?: ChatMessage['safety']; redacted?: boolean } | null;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseConversationPage(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Histórico de conversa inválido');
  for (const turn of value) {
    if (!record(turn) || typeof turn.id !== 'string' || typeof turn.question !== 'string' ||
      !['pending','complete','failed','retryable'].includes(String(turn.status)) || typeof turn.createdAt !== 'string' || !Number.isFinite(Date.parse(turn.createdAt)) || typeof turn.updatedAt !== 'string') throw new Error('Histórico de conversa inválido');
    if (turn.status !== 'complete') { if (turn.response !== null) throw new Error('Resposta inválida'); continue; }
    const reply = turn.response;
    if (!record(reply) || typeof reply.message !== 'string' || !Array.isArray(reply.sources)) throw new Error('Resposta inválida');
    for (const source of reply.sources) {
      if (!record(source) || typeof source.id !== 'string' || typeof source.type !== 'string' || typeof source.label !== 'string' || typeof source.date !== 'string' || typeof source.excerpt !== 'string') throw new Error('Fonte da conversa inválida');
      if (['knowledge','protocol'].includes(source.type) && (!Number.isInteger(source.authorizationRevision) || !Number.isInteger(source.sourceReviewRevision))) throw new Error('Permissão da fonte indisponível');
    }
  }
  return value as ConversationTurn[];
}

export function conversationMessages(turns: ConversationTurn[]): ChatMessage[] {
  return [...turns].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).flatMap(turn => {
    const base = Date.parse(turn.createdAt);
    const user: ChatMessage = {id:turn.id+'/user',type:'user',title:'Você',content:turn.question,timestamp:new Date(base)};
    const reply = turn.response;
    if (turn.status === 'complete' && reply) return [user,{id:turn.id+'/assistant',type:'assistant',title:'Assistente Clínico',content:reply.message,timestamp:new Date(base+1),sources:reply.sources,coverage:reply.coverage,safety:reply.safety}];
    const waiting = turn.status === 'pending' && Date.now()-Date.parse(turn.updatedAt)<300_000;
    return [user,{id:turn.id+'/status',type:'system',title:waiting?'Pergunta em processamento':'Pergunta não concluída',content:waiting?'A resposta será recuperada sem reenviar a pergunta.':'A operação não foi concluída. Nenhuma nova resposta é gerada automaticamente; você pode reenviar a pergunta.',timestamp:new Date(base+1)}];
  });
}

/** Server rows override cached copies, including a revoked/redacted reply. */
export function mergeConversationMessages(local: ChatMessage[], stored: ChatMessage[]): ChatMessage[] {
  const merged = new Map(local.map(message => [message.id,message]));
  for (const message of stored) merged.set(message.id,message);
  for (const id of merged.keys()) if (id.endsWith('/status') && merged.has(id.replace(/\/status$/, '/assistant'))) merged.delete(id);
  return [...merged.values()].sort((a,b)=>a.timestamp.getTime()-b.timestamp.getTime() || a.id.localeCompare(b.id));
}
