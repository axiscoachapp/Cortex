// Synthetic DTOs for the reception read-only UI. Never used by production handlers.
const at = '2026-11-06T18:30:00.123456+00:00';
export const whatsappReadIds = { first: 'a1000000-0000-4000-8000-000000000001', second: 'a1000000-0000-4000-8000-000000000002', closed: 'a1000000-0000-4000-8000-000000000003' };
export const whatsappBotSessionFixture={status:'handed_off',path:['Agendamento','Médico sintético'],outcome:'queue:agendamento',startedAt:at,updatedAt:at};
const historyId=index=>'a2100000-0000-4000-8000-'+String(index).padStart(12,'0');
export const whatsappHistoryCursors={first:at+'|'+historyId(101),second:at+'|'+historyId(51)};
const listId=index=>'a3100000-0000-4000-8000-'+String(index).padStart(12,'0');
export const whatsappListCursors={first:at+'|'+listId(101),second:at+'|'+listId(51)};
export function createWhatsAppReadFixture(ids,{claimReview=false,releaseReview=false,closeReview=false,reopenReview=false,queueReview=false,revokeReview=false}={}) {
  if([claimReview,releaseReview,closeReview,reopenReview,queueReview,revokeReview].filter(Boolean).length>1)throw new Error('Command fixtures must be isolated');
  const calls = [], failures = new Map();
  const base = { waId: null, contactId: null, caseId: null, queue: 'geral', status: 'open', assignedTo: null, assignedAt: null, openedAt: at, firstResponseAt: null, closedAt: null, lastInboundAt: at, windowOpenUntil: at, lastMessageAt: at, lastMessagePreview: 'Prévia sintética de atendimento', unreadCount: 2, optedOut: false, consented: true, revision: 1 };
  const rows = [
    { ...base, id: whatsappReadIds.first, profileName: (closeReview||reopenReview||queueReview||revokeReview)?'Contato sintético A · '+'PerfilSintéticoLongo'.repeat(7):'Contato sintético A', assignedTo: ids.a,queue:'agendamento' },
    { ...base, id: whatsappReadIds.second, profileName: 'Contato sintético B', lastMessagePreview: 'Sintético'.repeat(38) },
    { ...base, id: whatsappReadIds.closed, profileName: 'Contato sintético encerrado', status: 'closed' },
  ];
  if(reopenReview){for(const i of [0,1])Object.assign(rows[i],{status:'closed',closedAt:at,firstResponseAt:at});rows[2].assignedTo=ids.b;}
  const consentPhones={first:'5511900000000',variant:'551100000000',other:'5511900000001'};
  if(revokeReview){rows[0].waId=consentPhones.first;rows[1].waId=consentPhones.variant;rows[2].waId=consentPhones.other;}
  const sessions=new Map([[whatsappReadIds.first,structuredClone(whatsappBotSessionFixture)]]);
  const initialRows=structuredClone(rows),claimCalls=[],releaseCalls=[],closeCalls=[],reopenCalls=[],queueCalls=[],revokeCalls=[];let claimMode='success',releaseMode='success',closeMode='success',reopenMode='success',queueMode='success',revokeMode='success';
  const pagedRows=Array.from({length:103},(_,offset)=>({...base,id:listId(150-offset),profileName:`Contato paginado sintético ${150-offset}`,assignedTo:offset%2===0?ids.a:null}));
  let historyReview=false,listReview=false;
  return {
    claimCalls,releaseCalls,closeCalls,reopenCalls,queueCalls,revokeCalls,
    resetRevokes(){if(!revokeReview)throw new Error('Withdrawal fixture is not enabled');rows.splice(0,rows.length,...structuredClone(initialRows));revokeMode='success';failures.clear();},
    setRevokeMode(value){if(!revokeReview||!['success','stale','unconfirmed','forbidden','regranted'].includes(value))throw new Error('Invalid withdrawal fixture mode');revokeMode=value;},
    resetQueues(){if(!queueReview)throw new Error('Queue fixture is not enabled');rows.splice(0,rows.length,...structuredClone(initialRows));queueMode='success';failures.clear();},
    setQueueMode(value){if(!queueReview||!['success','stale','unconfirmed','forbidden','replaced'].includes(value))throw new Error('Invalid queue fixture mode');queueMode=value;},
    resetReopens(){if(!reopenReview)throw new Error('Reopen fixture is not enabled');rows.splice(0,rows.length,...structuredClone(initialRows));reopenMode='success';failures.clear();},
    setReopenMode(value){if(!reopenReview||!['success','stale','unconfirmed','forbidden'].includes(value))throw new Error('Invalid reopen fixture mode');reopenMode=value;},
    resetCloses(){if(!closeReview)throw new Error('Close fixture is not enabled');rows.splice(0,rows.length,...structuredClone(initialRows));closeMode='success';failures.clear();},
    setCloseMode(value){if(!closeReview||!['success','stale','unconfirmed','forbidden'].includes(value))throw new Error('Invalid close fixture mode');closeMode=value;},
    resetReleases(){if(!releaseReview)throw new Error('Release fixture is not enabled');rows.splice(0,rows.length,...structuredClone(initialRows));releaseMode='success';failures.clear();},
    setReleaseMode(value){if(!releaseReview||!['success','stale','unconfirmed','forbidden'].includes(value))throw new Error('Invalid release fixture mode');releaseMode=value;},
    resetClaims(){if(!claimReview)throw new Error('Claim fixture is not enabled');rows.splice(0,rows.length,...structuredClone(initialRows));claimMode='success';failures.clear();},
    setClaimMode(value){if(!claimReview||!['success','stale','unconfirmed','forbidden'].includes(value))throw new Error('Invalid claim fixture mode');claimMode=value;},
    snapshotRows:()=>structuredClone(rows),
    setListReview:enabled=>{listReview=enabled===true;},
    setHistoryReview:enabled=>{historyReview=enabled===true;},
    setBotSession:(id,value)=>sessions.set(id,structuredClone(value)),
    calls, setFailure: (action, failure) => { if (failure) failures.set(action, failure); else failures.delete(action); },
    handle(actor, input) {
      calls.push({ actor, input: structuredClone(input) });
      const fail = (code, status) => ({ status, data: { code, error: 'Synthetic read failure' } });
      if (![ids.admin, ids.a, ids.b].includes(actor)) return fail('forbidden', 403);
      const allowed = { state: [], conversations: ['filter', 'search', 'limit', 'before'], messages: ['conversationId', 'before'],botSession:['conversationId'],...(claimReview||releaseReview||closeReview||reopenReview||queueReview||revokeReview?{act:['conversationId','operation','revision',...(queueReview?['queue']:[])]}:{}) };
      if (!Object.hasOwn(allowed, input.action) || Object.keys(input).some(key => key !== 'action' && !allowed[input.action].includes(key))) return fail('invalid', 400);
      if(input.action==='act'){
        if(input.operation!==(revokeReview?'revoke_opt_in':queueReview?'set_queue':reopenReview?'reopen':closeReview?'close':releaseReview?'unassign':'assign')||!Number.isInteger(input.revision)||input.revision<0||input.revision>2147483646)return fail('invalid',400);
        if(queueReview&&(typeof input.queue!=='string'||input.queue.length<1||input.queue.length>40||!/^[a-z0-9]/.test(input.queue)||/[^a-z0-9_-]/.test(input.queue)))return fail('invalid',400);
        const row=rows.find(row=>row.id===input.conversationId);if(!row)return fail('not_found',404);
        const release=input.operation==='unassign',close=input.operation==='close',reopen=input.operation==='reopen',mode=revokeReview?revokeMode:queueReview?queueMode:reopen?reopenMode:close?closeMode:release?releaseMode:claimMode;
        const record={actor,conversationId:row.id,revision:input.revision,applied:false,status:200};(revokeReview?revokeCalls:queueReview?queueCalls:reopen?reopenCalls:close?closeCalls:release?releaseCalls:claimCalls).push(record);
        if(mode==='forbidden'){record.status=403;return fail('forbidden',403);}
        if(mode==='stale'){row.revision++;row.assignedTo=ids.b;if(revokeReview)revokeMode='success';else if(queueReview){queueMode='success';row.queue='retorno';}else if(reopen)reopenMode='success';else if(close)closeMode='success';else if(release)releaseMode='success';else claimMode='success';record.status=409;return fail('stale',409);}
        if(row.revision!==input.revision){record.status=409;return fail('stale',409);}
        if(reopen&&row.status!=='closed')return {status:200,data:{revision:row.revision,status:row.status,assignedTo:row.assignedTo}};
        row.revision++;if(revokeReview){const phones=[consentPhones.first,consentPhones.variant].includes(row.waId)?[consentPhones.first,consentPhones.variant]:[row.waId];for(const candidate of rows)if(phones.includes(candidate.waId))candidate.consented=false;row.optedOut=true;}else if(queueReview){row.queue=input.queue;}else if(reopen){row.status='open';row.openedAt='2026-11-07T13:00:00.000000+00:00';row.firstResponseAt=null;row.closedAt=null;}else if(close){row.status='closed';row.closedAt=at;row.unreadCount=0;}else{row.assignedTo=release?null:actor;row.assignedAt=release?null:at;if(!release){row.status='open';row.closedAt=null;}}record.applied=true;
        const receipt={revision:row.revision,status:row.status,assignedTo:row.assignedTo};if(revokeReview&&mode==='regranted'){const phones=[consentPhones.first,consentPhones.variant].includes(row.waId)?[consentPhones.first,consentPhones.variant]:[row.waId];for(const candidate of rows)if(phones.includes(candidate.waId))candidate.consented=true;row.optedOut=false;row.revision++;}if(queueReview&&mode==='replaced'){row.queue='retorno';row.revision++;}
        return {status:200,data:mode==='unconfirmed'?{unexpected:true}:receipt};
      }
      const mode = failures.get(input.action);
      if (mode === 'forbidden') return fail('forbidden', 403);
      if (mode === 'invalid') return { status: 200, data: { unexpected: true } };
      if (input.action === 'state') return { status: 200, data: { serverReady: true, connected: true, status: 'connected', displayPhone: 'Número sintético', verifiedName: 'Clínica sintética', quality: null, connectedAt: at, canManage: actor === ids.admin, canUseInbox: true, ...(actor === ids.admin ? { lastError: null, webhookUrl: 'https://example.invalid/webhook', phoneNumberId: null, wabaId: null } : {}) } };
      if (input.action === 'conversations') {
        if (!['open', 'closed', 'mine', 'unassigned'].includes(input.filter) || !listReview&&input.before != null || input.limit !== 50 || typeof input.search !== 'string' || input.search.length > 80) return fail('invalid', 400);
        const filtered=(listReview?[...pagedRows,rows[2]]:rows).filter(row => input.filter === 'closed' ? row.status === 'closed' : row.status === 'open' && (input.filter === 'mine' ? row.assignedTo === actor : input.filter === 'unassigned' ? !row.assignedTo : true)).filter(row => row.profileName.toLowerCase().includes(input.search.toLowerCase()));
        const anchor=input.before==null?-1:filtered.findIndex(row=>row.lastMessageAt+'|'+row.id===input.before);
        if(input.before!=null&&anchor<0)return fail('invalid',400);
        const page=filtered.slice(anchor+1,anchor+51),last=page.at(-1);
        return { status: 200, data: { conversations: page, nextBefore:anchor+51<filtered.length?last.lastMessageAt+'|'+last.id:null } };
      }
      const conversation = (listReview?[...rows,...pagedRows]:rows).find(row => row.id === input.conversationId);
      if (!conversation) return fail('not_found', 404);
      if(input.action==='botSession')return {status:200,data:{session:structuredClone(sessions.get(conversation.id)??null)}};
      const message = { direction: 'in', kind: 'text', body: 'Mensagem sintética recebida', media: null, template: null, status: 'received', error: null, sentBy: null, at };
      if(historyReview&&conversation.id===whatsappReadIds.first){
        const page=input.before==null?0:input.before===whatsappHistoryCursors.first?1:input.before===whatsappHistoryCursors.second?2:-1;
        if(page<0)return fail('invalid',400);
        const start=page===0?150:page===1?100:50,count=page===2?3:50;
        return {status:200,data:{conversation,messages:Array.from({length:count},(_,offset)=>({...message,id:historyId(start-offset),body:`Mensagem de histórico sintética ${start-offset}`})),nextBefore:page===0?whatsappHistoryCursors.first:page===1?whatsappHistoryCursors.second:null}};
      }
      if(input.before!=null)return fail('invalid',400);
      return { status: 200, data: { conversation, messages: [
        { ...message, id: 'a2000000-0000-4000-8000-000000000003', kind: 'document', body: '', media: { mime: 'application/pdf', filename: 'arquivo-sintetico-'.repeat(16) + '.pdf', voice: false } },
        { ...message, id: 'a2000000-0000-4000-8000-000000000002', direction: 'out', body: 'Texto sintético longo para conferir a quebra de linhas. '.repeat(10) },
        { ...message, id: 'a2000000-0000-4000-8000-000000000001' },
      ], nextBefore: null } };
    },
  };
}
