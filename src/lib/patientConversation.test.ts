import { describe, expect, it } from 'vitest';
import { conversationMessages, mergeConversationMessages, parseConversationPage } from './patientConversation';

const turn = {id:'turn',question:'Pergunta sintética',status:'complete',createdAt:'2026-11-03T10:00:00Z',updatedAt:'2026-11-03T10:00:01Z',response:{message:'Resposta exata',sources:[]}};
describe('private conversation recovery', () => {
  it('recovers exact questions and replies in their original turn order', () => {
    const messages=conversationMessages(parseConversationPage([turn]));
    expect(messages.map(message=>message.content)).toEqual(['Pergunta sintética','Resposta exata']);
    expect(messages.map(message=>message.id)).toEqual(['turn/user','turn/assistant']);
  });
  it('does not replace a newly arrived response with a stale pending page', () => {
    const local=conversationMessages(parseConversationPage([turn]));
    const stale=conversationMessages(parseConversationPage([{...turn,status:'pending',response:null}]));
    expect(mergeConversationMessages(local,stale).map(message=>message.content)).toEqual(['Pergunta sintética','Resposta exata']);
  });
  it('lets server redaction replace a cached protocol reply', () => {
    const local=conversationMessages(parseConversationPage([turn]));
    const safe=conversationMessages(parseConversationPage([{...turn,response:{message:'Fontes revogadas; texto ocultado',sources:[],redacted:true}}]));
    expect(JSON.stringify(mergeConversationMessages(local,safe))).not.toContain('Resposta exata');
  });
  it('does not silently drop malformed source authorization metadata', () => {
    expect(()=>parseConversationPage([{...turn,response:{message:'Texto privado',sources:[{id:'source',type:'protocol',label:'Fonte',date:'2026-11-03',excerpt:'Segredo'}]}}])).toThrow('Permissão');
    expect(()=>parseConversationPage([{...turn,response:{message:'Texto privado'}}])).toThrow();
  });
  it('keeps failed turns as history without calling a model again', () => {
    const messages=conversationMessages(parseConversationPage([{...turn,status:'failed',response:null}]));
    expect(messages[1].content).toContain('Nenhuma nova resposta é gerada automaticamente');
  });
});
