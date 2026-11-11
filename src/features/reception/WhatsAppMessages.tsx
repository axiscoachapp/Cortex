import { useCallback, useEffect, useLayoutEffect, useRef,useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappApi, type WhatsAppConversation, type WhatsAppMessage } from './whatsappApi';
import { readWhatsAppAssignees } from './whatsappAssignees';
import { markWhatsAppConversationRead } from './whatsappSend';
import { clinicDateLabel, clinicTime } from './dates';
import { WhatsAppBotSession } from './WhatsAppBotSession';
import {WhatsAppCloseAction} from './WhatsAppCloseAction';
import {WhatsAppReopenAction} from './WhatsAppReopenAction';
import {WhatsAppTransferAction} from './WhatsAppTransferAction';
import {WhatsAppQueueAction} from './WhatsAppQueueAction';
import {WhatsAppRevokeConsentAction} from './WhatsAppRevokeConsentAction';
import { WhatsAppComposer, emptyDraft, type ComposerDrafts, type RequestIds } from './WhatsAppComposer';
import { useBackgroundRefresh } from './useBackgroundRefresh';

const kindLabels: Record<string, string> = { image: 'Imagem', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha', location: 'Localização', unsupported: 'Mensagem não disponível' };
const outboundLabels: Record<string, string> = { pending: 'Enviando', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falhou', unknown: 'Envio não confirmado' };
const validPhone = (phone: string | null): phone is string => typeof phone === 'string' && phone.length >= 7 && phone.length <= 15 && !/[^0-9]/.test(phone);
const localDrafts = (): ComposerDrafts => { const map = new Map<string, typeof emptyDraft>(); return { get: id => map.get(id) ?? emptyDraft, set: (id, draft) => { map.set(id, draft); } }; };
const localRequestIds = (): RequestIds => Object.assign(() => crypto.randomUUID(), { reset: () => undefined });

type Props = { actor: string; clinic: string; conversation: WhatsAppConversation; onClose: () => void;onClaim?:(conversation:WhatsAppConversation)=>void;onRelease?:(conversation:WhatsAppConversation)=>void;onCloseConversation?:(conversation:WhatsAppConversation)=>void;onReopenConversation?:(conversation:WhatsAppConversation)=>void;onSetQueue?:(conversation:WhatsAppConversation,queue:string)=>void;onRevokeConsent?:(conversation:WhatsAppConversation)=>void;onTransfer?:(conversation:WhatsAppConversation,targetUserId:string)=>void;commandKind?:'assign'|'transfer'|'unassign'|'close'|'reopen'|'queue'|'revoke_consent';commandBusy?:boolean;commandBlocked?:boolean;onNavigate?:()=>void;generation?:number;
  drafts?: ComposerDrafts; requestId?: RequestIds;
  /** The composer started or finished a send: the inbox pauses polling and other commands meanwhile. */
  onSendingChange?: (sending: boolean) => void;
  /** mark_read succeeded: the list can refresh its unread badges. */
  onRead?: () => void;
};

export function WhatsAppMessages({ actor, clinic, conversation, onClose,onClaim,onRelease,onCloseConversation,onReopenConversation,onSetQueue,onRevokeConsent,onTransfer,commandKind,commandBusy=false,commandBlocked=false,onNavigate,generation=0,drafts,requestId,onSendingChange,onRead }: Props) {
  const region = useRef<HTMLElement>(null);
  const pageHeading=useRef<HTMLHeadingElement>(null);
  const [before,setBefore]=useState<string|null>(null);
  const [botReadGeneration,setBotReadGeneration]=useState(0);
  const [sending,setSending]=useState(false);
  const fallbackDrafts=useRef<ComposerDrafts>(), fallbackIds=useRef<RequestIds>();
  fallbackDrafts.current ??= localDrafts(); fallbackIds.current ??= localRequestIds();
  const readVersion=useRef(0),mounted=useRef(false),client=useQueryClient();
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const messageKey=['reception', actor, clinic, 'whatsapp', 'messages', conversation.id,before,generation];
  const messages = useQuery({
    queryKey: messageKey,
    // Each successful read carries a local identity, even when identical data
    // and fetching/success notifications coalesce. It never goes on the wire.
    queryFn: async ({ signal }) => ({...await whatsappApi.messages({ conversationId: conversation.id,...(before?{before}:{}) }, signal),readVersion:++readVersion.current}),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const locked=commandBlocked||sending;
  // The latest message sits at the bottom, next to the reply box: keep it in view when the
  // conversation opens and when a new message arrives (the server lists newest first).
  const thread=useRef<HTMLOListElement>(null);
  const newestMessage=messages.data?.messages[0]?.id??null;
  useEffect(()=>{const list=thread.current;if(list&&before===null)list.scrollTop=list.scrollHeight;},[newestMessage,before,conversation.id]);
  // Only the recent page refreshes by itself, and never while a command or a send runs.
  const poll=useBackgroundRefresh(messages,before===null&&!locked);
  const settled=messages.isSuccess&&messages.isFetchedAfterMount;
  // Data on screen: a settled read, or the last good read while a background refresh runs or after it failed.
  const shown=messages.data!==undefined&&messages.isFetchedAfterMount&&(messages.fetchStatus==='idle'?messages.isSuccess||poll.background:poll.background);
  // Commands act only on a successful read; a background refresh in flight does not make it stale.
  const fresh = settled && (messages.fetchStatus === 'idle' || poll.background);
  const detail=shown?messages.data:undefined;
  const live=detail?.conversation;
  const phone=live?.waId??null;
  const hasPhone=validPhone(phone);
  const nextCursor=fresh?messages.data.nextBefore:null;
  const ownerName=useOwnerName(actor,clinic,live?.assignedTo??null);
  const reportSending=useCallback((value:boolean)=>{setSending(value);onSendingChange?.(value);},[onSendingChange]);
  const retry=()=>{
    // A new generation cannot join a bot read started before this message refresh,
    // even when a fast response coalesces the parent's pending render.
    setBotReadGeneration(generation=>generation+1);
    pageHeading.current?.focus();
    poll.explicit();
    void messages.refetch();
  };
  const goTo=(cursor:string|null)=>{
    onNavigate?.();
    setBotReadGeneration(generation=>generation+1);
    poll.explicit();
    setBefore(cursor);
    pageHeading.current?.focus();
  };
  const refresh=()=>before===null?retry():goTo(null);
  useEffect(() => {
    region.current?.focus({ preventScroll: true });
    const title = region.current?.querySelector('h2')?.getBoundingClientRect();
    // Use the rendered position: this panel stacks below the list until `lg`,
    // which differs from the shared phone breakpoint at the enlarged scale.
    if (title && (title.top < 0 || title.bottom > window.innerHeight)) region.current?.scrollIntoView({ block: 'start' });
  }, []);
  // The owner reading the conversation clears its unread count (once per new inbound message).
  const markedFor=useRef<string|null>(null);
  const unreadMark=fresh&&live&&live.status==='open'&&live.assignedTo===actor&&live.unreadCount>0&&before===null?live.id+'|'+(live.lastInboundAt??''):null;
  useEffect(()=>{
    if(!unreadMark||markedFor.current===unreadMark)return;
    markedFor.current=unreadMark;
    // Idempotent and best effort: not aborted when the read state flips, only ignored after unmount.
    void markWhatsAppConversationRead(conversation.id).then(ok=>{if(ok&&mounted.current)onRead?.();});
  },[unreadMark,conversation.id,onRead]);
  // Open confirmations belong to a read: any explicit read (refresh, reconciliation, invalidation)
  // retires them, as before. A background read retires them only when the conversation changed,
  // so polling does not close a dialog every 15 s.
  const seenRead=useRef<number|null>(null),explicitRead=useRef(0);
  if(detail&&detail.readVersion!==seenRead.current){seenRead.current=detail.readVersion;if(!poll.background)explicitRead.current=detail.readVersion;}
  const snapshot=live?explicitRead.current+':'+JSON.stringify(live):'';
  const own=live?.status==='open'&&live.assignedTo===actor&&live.revision<2147483647;
  return <section ref={region} tabIndex={-1} aria-label="Conversa selecionada" className="min-w-0 scroll-mt-4 rounded-lg border bg-card p-4 space-y-4 outline-none">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className="min-w-0 font-semibold [overflow-wrap:anywhere]">{live?.profileName || conversation.profileName || 'Contato sem nome'}</h2>
        {hasPhone&&<p className="text-sm text-muted-foreground">+{phone}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Atualizar mensagens" title="Atualizar mensagens" disabled={messages.fetchStatus!=='idle'||locked} onClick={refresh}><RefreshCw aria-hidden="true" className="h-4 w-4" /></Button>
        <Button variant="outline" className="shell:hidden" onClick={onClose}>Voltar à lista</Button>
      </div>
    </div>
    {detail&&live && <>
      <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm [overflow-wrap:anywhere]">
        <span>Fila <strong className="font-medium">{live.queue}</strong></span><span aria-hidden="true">·</span>
        <span>{live.status==='closed'?'Encerrada':'Em aberto'}</span><span aria-hidden="true">·</span>
        <span>{live.assignedTo===null?'Sem responsável':live.assignedTo===actor?'Com você':ownerName?'Com '+ownerName:'Com outra pessoa'}</span><span aria-hidden="true">·</span>
        <span>{live.consented?'Lembretes autorizados':'Lembretes não autorizados'}</span>
      </p>
      {fresh&&<div className="flex flex-wrap items-center gap-2">
        {onClaim&&live.status==='open'&&live.assignedTo===null&&live.revision<2147483647&&<><Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={locked} onClick={()=>onClaim(live)}>{commandBusy&&commandKind==='assign'?'Assumindo…':'Assumir conversa'}</Button><p className="text-sm text-muted-foreground">Assuma a conversa para responder.</p></>}
        {onRelease&&own&&<Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={locked} onClick={()=>onRelease(live)}>{commandBusy&&commandKind==='unassign'?'Devolvendo…':'Devolver à fila'}</Button>}
        {onCloseConversation&&own&&<WhatsAppCloseAction key={'Close:'+snapshot} conversation={live} disabled={locked} busy={commandBusy&&commandKind==='close'} onConfirm={onCloseConversation}/>}
        {onReopenConversation&&live.status==='closed'&&(live.assignedTo===null||live.assignedTo===actor)&&live.revision<2147483647&&<WhatsAppReopenAction key={'Reopen:'+snapshot} conversation={live} disabled={locked} busy={commandBusy&&commandKind==='reopen'} onConfirm={onReopenConversation}/>}
        {onSetQueue&&own&&<WhatsAppQueueAction key={'Queue:'+snapshot} conversation={live} disabled={locked} busy={commandBusy&&commandKind==='queue'} onConfirm={onSetQueue}/>}
        {onRevokeConsent&&hasPhone&&own&&live.consented&&<WhatsAppRevokeConsentAction key={'RevokeConsent:'+snapshot} conversation={live} disabled={locked} busy={commandBusy&&commandKind==='revoke_consent'} onConfirm={onRevokeConsent}/>}
        {onTransfer&&own&&<WhatsAppTransferAction key={'Transfer:'+snapshot} actor={actor} clinic={clinic} conversation={live} disabled={locked} busy={commandBusy&&commandKind==='transfer'} onConfirm={(confirmed,targetUserId)=>{const latest=client.getQueryState(messageKey);if(mounted.current&&latest?.status==='success'&&latest.data===messages.data&&(latest.fetchStatus==='idle'||poll.background))onTransfer(confirmed,targetUserId);}}/>}
      </div>}
      <WhatsAppBotSession key={botReadGeneration} generation={botReadGeneration} actor={actor} clinic={clinic} conversationId={live.id} />
    </>}
    <h3 ref={pageHeading} tabIndex={-1} className="font-semibold outline-none">Mensagens da conversa</h3>
    {before!==null&&<p className="text-sm text-muted-foreground">Página de mensagens anteriores.</p>}
    {poll.outdated&&<p aria-live="polite" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
      <span>Não foi possível atualizar. As mensagens abaixo podem estar desatualizadas.</span>
      <button type="button" className="underline underline-offset-2" onClick={poll.tick}>Tentar agora</button>
    </p>}
    {shown ? null : messages.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão de rede para carregar as mensagens…</p> : messages.isPending || messages.fetchStatus !== 'idle' ? <p role="status" className="text-sm">Carregando mensagens…</p> : messages.isError ? <div role="alert" className="space-y-3 text-sm">
      <p>Não foi possível carregar as mensagens. Verifique seu acesso e tente novamente.</p>
      <Button variant="outline" onClick={retry}>Tentar carregar mensagens</Button>
    </div> : null}
    {detail&&<>
      {detail.messages.length === 0 && <p className="text-sm text-muted-foreground">{before===null?'Nenhuma mensagem nesta conversa.':'Nenhuma mensagem anterior a este ponto.'}</p>}
      {/* The thread scrolls by itself, so the reply box stays in view under the latest message. */}
      <ol ref={thread} aria-label="Mensagens da conversa" tabIndex={0} className="flex max-h-[min(28rem,55dvh)] flex-col gap-3 overflow-y-auto pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{detail.messages.slice().reverse().map(message => <MessageBubble key={message.id} message={message} />)}</ol>
    </>}
    {(before!==null||nextCursor!==null)&&<nav aria-label="Páginas da conversa" className="flex flex-wrap gap-2">
      {before!==null&&<Button variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={refresh}>Mensagens mais recentes</Button>}
      {nextCursor!==null&&<Button variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={()=>goTo(nextCursor)}>Mensagens anteriores</Button>}
    </nav>}
    {live&&before===null&&<WhatsAppComposer actor={actor} clinic={clinic} conversation={live} actionable={fresh} blocked={commandBlocked}
      drafts={drafts??fallbackDrafts.current} requestId={requestId??fallbackIds.current} onSendingChange={reportSending} onAfterSend={poll.tick} />}
  </section>;
}

function MessageBubble({ message }: { message: WhatsAppMessage }) {
  const out = message.direction === 'out';
  const status = out ? outboundLabels[message.status] : undefined;
  const failed = out && message.status === 'failed', unknown = out && message.status === 'unknown';
  return <li className={`min-w-0 max-w-[85%] rounded-lg border p-3 space-y-2 ${out ? 'self-end bg-primary/10' : 'self-start bg-muted/40'} ${failed ? 'border-destructive/50' : unknown ? 'border-amber-500/50' : ''}`}>
    <p className="text-xs font-medium">{out ? 'Enviada' : 'Recebida'}{message.template ? ' · modelo' : ''}</p>
    <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{message.body || (message.template ? 'Modelo ' + message.template.name : kindLabels[message.kind] || 'Mensagem sem texto')}</p>
    {message.media?.filename && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{message.media.filename}</p>}
    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      <time dateTime={message.at}>{clinicDateLabel(message.at)} · {clinicTime(message.at)}</time>
      {status && <span className={failed ? 'font-medium text-destructive' : unknown ? 'font-medium' : undefined}>{status}</span>}
    </p>
    {failed && <p className="text-xs text-destructive">Esta mensagem não foi entregue ao paciente.</p>}
    {unknown && <p className="text-xs">O WhatsApp não confirmou o envio. Confira com o paciente antes de mandar de novo.</p>}
  </li>;
}

/** Name of another person who owns the conversation, from the assignee catalogue; null when unknown. */
function useOwnerName(actor: string, clinic: string, owner: string | null) {
  const names = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'owner-names'],
    queryFn: ({ signal }) => readWhatsAppAssignees({ limit: 50 }, signal),
    enabled: owner !== null && owner !== actor,
    retry: false, staleTime: 5 * 60_000, gcTime: 5 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  if (!owner || owner === actor || !names.isSuccess) return null;
  return names.data.items.find(item => item.userId === owner)?.name ?? null;
}
