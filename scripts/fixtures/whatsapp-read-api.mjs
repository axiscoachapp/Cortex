// Synthetic DTOs for the reception read-only UI. Never used by production handlers.
const at = '2026-11-06T18:30:00.123456+00:00';
export const whatsappReadIds = { first: 'a1000000-0000-4000-8000-000000000001', second: 'a1000000-0000-4000-8000-000000000002', closed: 'a1000000-0000-4000-8000-000000000003' };
export const whatsappBotSessionFixture={status:'handed_off',path:['Agendamento','Médico sintético'],outcome:'queue:agendamento',startedAt:at,updatedAt:at};
export function createWhatsAppReadFixture(ids) {
  const calls = [], failures = new Map();
  const base = { waId: null, contactId: null, caseId: null, queue: 'geral', status: 'open', assignedTo: null, assignedAt: null, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: at, lastMessageAt: at, lastMessagePreview: 'Prévia sintética de atendimento', unreadCount: 2, optedOut: false, consented: true, revision: 1 };
  const rows = [
    { ...base, id: whatsappReadIds.first, profileName: 'Contato sintético A', assignedTo: ids.a,queue:'agendamento' },
    { ...base, id: whatsappReadIds.second, profileName: 'Contato sintético B', lastMessagePreview: 'Sintético'.repeat(38) },
    { ...base, id: whatsappReadIds.closed, profileName: 'Contato sintético encerrado', status: 'closed' },
  ];
  const sessions=new Map([[whatsappReadIds.first,structuredClone(whatsappBotSessionFixture)]]);
  return {
    setBotSession:(id,value)=>sessions.set(id,structuredClone(value)),
    calls, setFailure: (action, failure) => { if (failure) failures.set(action, failure); else failures.delete(action); },
    handle(actor, input) {
      calls.push({ actor, input: structuredClone(input) });
      const fail = (code, status) => ({ status, data: { code, error: 'Synthetic read failure' } });
      if (![ids.admin, ids.a, ids.b].includes(actor)) return fail('forbidden', 403);
      const allowed = { state: [], conversations: ['filter', 'search', 'limit', 'before'], messages: ['conversationId', 'before'],botSession:['conversationId'] };
      if (!Object.hasOwn(allowed, input.action) || Object.keys(input).some(key => key !== 'action' && !allowed[input.action].includes(key))) return fail('invalid', 400);
      const mode = failures.get(input.action);
      if (mode === 'forbidden') return fail('forbidden', 403);
      if (mode === 'invalid') return { status: 200, data: { unexpected: true } };
      if (input.action === 'state') return { status: 200, data: { serverReady: true, connected: true, status: 'connected', displayPhone: 'Número sintético', verifiedName: 'Clínica sintética', quality: null, connectedAt: at, canManage: actor === ids.admin, canUseInbox: true, ...(actor === ids.admin ? { lastError: null, webhookUrl: 'https://example.invalid/webhook', phoneNumberId: null, wabaId: null } : {}) } };
      if (input.action === 'conversations') {
        if (!['open', 'closed', 'mine', 'unassigned'].includes(input.filter) || input.before != null || input.limit !== 50 || typeof input.search !== 'string' || input.search.length > 80) return fail('invalid', 400);
        return { status: 200, data: { conversations: rows.filter(row => input.filter === 'closed' ? row.status === 'closed' : row.status === 'open' && (input.filter === 'mine' ? row.assignedTo === actor : input.filter === 'unassigned' ? !row.assignedTo : true)).filter(row => row.profileName.toLowerCase().includes(input.search.toLowerCase())), nextBefore: null } };
      }
      const conversation = rows.find(row => row.id === input.conversationId);
      if (!conversation || input.before != null) return fail('not_found', 404);
      if(input.action==='botSession')return {status:200,data:{session:structuredClone(sessions.get(conversation.id)??null)}};
      const message = { direction: 'in', kind: 'text', body: 'Mensagem sintética recebida', media: null, template: null, status: 'received', error: null, sentBy: null, at };
      return { status: 200, data: { conversation, messages: [
        { ...message, id: 'a2000000-0000-4000-8000-000000000003', kind: 'document', body: '', media: { mime: 'application/pdf', filename: 'arquivo-sintetico-'.repeat(16) + '.pdf', voice: false } },
        { ...message, id: 'a2000000-0000-4000-8000-000000000002', direction: 'out', body: 'Texto sintético longo para conferir a quebra de linhas. '.repeat(10) },
        { ...message, id: 'a2000000-0000-4000-8000-000000000001' },
      ], nextBefore: null } };
    },
  };
}
