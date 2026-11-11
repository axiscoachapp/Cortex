import { useEffect,useMemo,useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/PageHeading';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from './accessContext';
import { whatsappApi, type WhatsAppInboxFilter,type WhatsAppConversation } from './whatsappApi';
import {claimWhatsAppConversation,WhatsAppClaimError} from './whatsappClaim';
import {transferWhatsAppConversation} from './whatsappTransfer';
import {releaseWhatsAppConversation} from './whatsappRelease';
import {closeWhatsAppConversation} from './whatsappClose';
import {reopenWhatsAppConversation} from './whatsappReopen';
import {setWhatsAppConversationQueue} from './whatsappQueue';
import {revokeWhatsAppConsent} from './whatsappRevokeConsent';
import { WhatsAppMessages } from './WhatsAppMessages';
import WhatsAppTemplateCatalog from './WhatsAppTemplateCatalog';
import { emptyDraft, type ComposerDraft, type ComposerDrafts } from './WhatsAppComposer';
import { useBackgroundRefresh } from './useBackgroundRefresh';
import { useRequestId } from './useRequestId';
import { clinicDateLabel, clinicTime } from './dates';

export default function WhatsAppInbox() {
  const access = useClinicAccess(), { user } = useAuth();
  if (!access?.active || !access.clinic || user?.id !== access.actorId || !(access.admin || access.kind === 'reception')) {
    return <p role="alert" className="rounded-lg border p-4 text-sm">Acesso à caixa de conversas indisponível.</p>;
  }
  return <Inbox key={access.actorId + ':' + access.clinic.id} actor={access.actorId} clinic={access.clinic.id} />;
}

function Inbox({ actor, clinic }: { actor: string; clinic: string }) {
  const channelReadVersion=useRef(0);
  // Typed replies and the send request id belong to this actor and clinic only (the component is keyed by both).
  const draftMap=useRef(new Map<string,ComposerDraft>());
  const drafts=useMemo<ComposerDrafts>(()=>({get:id=>draftMap.current.get(id)??emptyDraft,set:(id,draft)=>{draftMap.current.set(id,draft);}}),[]);
  const requestId=useRequestId();
  const channel = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'state'],
    queryFn: async ({ signal }) => ({...await whatsappApi.state(signal),readVersion:++channelReadVersion.current}),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = channel.isSuccess && channel.isFetchedAfterMount && channel.fetchStatus === 'idle';
  return <div className="space-y-4">
    <PageHeading title="Conversas" description="Acompanhe e responda as conversas do WhatsApp da clínica." />
    {channel.fetchStatus === 'paused' ? <p role="status" className="p-4 text-sm">Aguardando conexão de rede para verificar o WhatsApp…</p>
      : channel.fetchStatus !== 'idle' || channel.isPending ? <p role="status" className="p-4 text-sm">Verificando WhatsApp…</p>
      : channel.isError ? <ReadFailure label="conexão" onRetry={() => void channel.refetch()} />
      : fresh && channel.data.serverReady && channel.data.connected && channel.data.canUseInbox
        ? <><WhatsAppTemplateCatalog actor={actor} clinic={clinic} /><ConversationList key={channel.data.readVersion} actor={actor} clinic={clinic} channelVersion={channel.data.readVersion} drafts={drafts} requestId={requestId} /></>
        : <div role="status" className="rounded-lg border bg-card p-6 space-y-2">
          <h2 className="font-semibold">WhatsApp indisponível</h2>
          <p className="text-sm text-muted-foreground">{fresh && !channel.data.canUseInbox ? 'Sua conta não tem acesso às conversas do WhatsApp desta clínica. Avise o administrador da clínica.'
            : fresh && channel.data.canManage ? 'O WhatsApp da clínica ainda não está conectado. A conexão é feita pela equipe Cortex.'
            : 'O WhatsApp da clínica ainda não está conectado. Avise o administrador da clínica.'}</p>
          <Button variant="outline" onClick={() => void channel.refetch()}>Verificar novamente</Button>
        </div>}
  </div>;
}

function ReadFailure({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3 text-sm">
    <p>Não foi possível carregar {label}. Verifique seu acesso e tente novamente.</p>
    <Button variant="outline" onClick={onRetry}>Tentar carregar {label}</Button>
  </div>;
}

function ConversationList({ actor, clinic, channelVersion, drafts, requestId }: { actor: string; clinic: string; channelVersion:number; drafts:ComposerDrafts; requestId:ReturnType<typeof useRequestId> }) {
  const [filter, setFilter] = useState<WhatsAppInboxFilter>('open');
  const [draft, setDraft] = useState(''), [search, setSearch] = useState('');
  // The open conversation is identified by id and keeps its own read: leaving the filtered list
  // (after assuming, closing, or a background refresh) does not close it. The list summary only
  // provides the name shown before the first read.
  const [selected, setSelected] = useState<WhatsAppConversation | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [detailGeneration,setDetailGeneration]=useState(0);
  const [sending,setSending]=useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const listReadVersion=useRef(0);
  const feedbackRef=useRef<HTMLDivElement>(null);
  type Operation={id:string;kind:'assign'|'transfer'|'unassign'|'close'|'reopen'|'queue'|'revoke_consent';controller:AbortController;checking:boolean};
  const operation=useRef<Operation|null>(null);
  const [feedback,setFeedback]=useState<{phase:'sending'|'checking'|'unresolved'|'done';message:string;error:boolean}|null>(null);
  useEffect(()=>()=>{operation.current?.controller.abort();operation.current=null;},[]);
  useEffect(()=>{if(feedback?.phase==='done'||feedback?.phase==='unresolved')feedbackRef.current?.focus();},[feedback]);
  const resetOperation=()=>{operation.current?.controller.abort();operation.current=null;setFeedback(null);};
  const client=useQueryClient();
  const listKey=['reception', actor, clinic, 'whatsapp', 'conversations', filter, search, before];
  const list = useQuery({
    queryKey: listKey,
    queryFn: async ({ signal }) => ({...await whatsappApi.conversations({ filter, search, limit: 50, ...(before ? { before } : {}) }, signal),readVersion:++listReadVersion.current}),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const commandBusy=feedback?.phase==='sending'||feedback?.phase==='checking';
  const commandBlocked=commandBusy||feedback?.phase==='unresolved';
  // Only the first page refreshes by itself, and never while a command or a send runs.
  const poll=useBackgroundRefresh(list,before===null&&!commandBlocked&&!sending);
  // Rows on screen: a settled read, or the last good read while a background refresh runs or after it failed.
  const shown=list.data!==undefined&&list.isFetchedAfterMount&&(list.fetchStatus==='idle'?list.isSuccess||poll.background:poll.background);
  const fresh = list.isSuccess && list.isFetchedAfterMount && list.fetchStatus === 'idle';
  const rows=shown?list.data.conversations:[];
  const nextCursor = fresh ? list.data.nextBefore : null;
  const selectedId=selected?.id??null;
  const goTo=(cursor:string|null)=>{resetOperation();setSelected(null);poll.explicit();setBefore(cursor);heading.current?.focus();};
  const refresh=()=>{resetOperation();setDetailGeneration(generation=>generation+1);if(before)goTo(null);else{poll.explicit();void list.refetch();}};
  // mark_read cleared a badge: refresh the rows without blanking them (the tick is stable).
  const onRead=poll.tick;
  const isCurrent=(entry:Operation)=>operation.current===entry&&!entry.controller.signal.aborted;
  const reconcile=async(entry:Operation)=>{
    if(!isCurrent(entry)||entry.checking)return;
    entry.checking=true;setFeedback({phase:'checking',message:entry.kind==='revoke_consent'?'Conferindo a autorização e atualizando a lista…':entry.kind==='queue'?'Conferindo a fila e atualizando a lista…':(entry.kind==='close'||entry.kind==='reopen')?'Conferindo a conversa e atualizando a lista…':'Conferindo o responsável e atualizando a lista…',error:false});
    poll.explicit();
    const [detail,result]=await Promise.allSettled([whatsappApi.messages({conversationId:entry.id},entry.controller.signal),list.refetch()]);
    if(!isCurrent(entry))return;
    entry.checking=false;
    if(detail.status!=='fulfilled'||result.status!=='fulfilled'||!result.value.isSuccess){
      setFeedback({phase:'unresolved',message:entry.kind==='revoke_consent'?'Não foi possível conferir a autorização. Confira os dados antes de outra tentativa.':entry.kind==='queue'?'Não foi possível conferir a fila. Confira os dados antes de outra tentativa.':(entry.kind==='close'||entry.kind==='reopen')?'Não foi possível conferir a conversa. Confira os dados antes de outra tentativa.':'Não foi possível conferir o responsável. Confira os dados antes de outra tentativa.',error:true});return;
    }
    operation.current=null;
    // A fast list refresh may coalesce fetching/success without unmounting the
    // detail. A new generation always fetches the authoritative visible state.
    setDetailGeneration(generation=>generation+1);
    setFeedback({phase:'done',message:entry.kind==='revoke_consent'?'Dados atualizados. Confira a autorização atual na conversa.':entry.kind==='queue'?'Dados atualizados. Confira a fila atual na conversa.':(entry.kind==='close'||entry.kind==='reopen')?'Dados atualizados. Confira a situação atual na conversa.':'Dados atualizados. Confira o responsável atual na conversa.',error:false});
  };
  const runCommand=async(detail:WhatsAppConversation,kind:Operation['kind'],options:{queue?:string;targetUserId?:string}={})=>{
    if(kind==='transfer'){
      const channel=client.getQueryState<{serverReady:boolean;connected:boolean;canUseInbox:boolean;readVersion:number}>(['reception',actor,clinic,'whatsapp','state']);
      if(channel?.status!=='success'||channel.fetchStatus!=='idle'||!channel.data?.serverReady||!channel.data.connected||!channel.data.canUseInbox||channel.data.readVersion!==channelVersion||!options.targetUserId)return;}
    const own=detail.assignedTo===actor,unassigned=detail.assignedTo===null;
    const phone=detail.waId,revocable=detail.consented&&typeof phone==='string'&&phone.length>=7&&phone.length<=15&&!/[^0-9]/.test(phone);
    const eligible=kind==='reopen'?detail.status==='closed'&&(own||unassigned):detail.status==='open'&&(kind==='assign'?unassigned:own)&&(kind!=='revoke_consent'||revocable);
    // `detail` is the open conversation's own successful read (the detail checks it before calling).
    if(operation.current||sending||selectedId!==detail.id||!eligible||detail.revision>=2147483647)return;
    const entry:Operation={id:detail.id,kind,controller:new AbortController(),checking:false};operation.current=entry;
    setFeedback({phase:'sending',message:kind==='transfer'?'Transferindo conversa…':kind==='revoke_consent'?'Retirando autorização…':kind==='queue'?'Mudando fila…':kind==='assign'?'Assumindo conversa…':kind==='close'?'Encerrando conversa…':kind==='reopen'?'Reabrindo conversa…':'Devolvendo conversa à fila…',error:false});
    try{
      if(kind==='assign')await claimWhatsAppConversation({conversationId:detail.id,revision:detail.revision},actor,entry.controller.signal);
      else if(kind==='transfer')await transferWhatsAppConversation({conversationId:detail.id,revision:detail.revision,status:'open',assignedTo:actor,targetUserId:options.targetUserId??''},actor,entry.controller.signal);
      else if(kind==='close')await closeWhatsAppConversation({conversationId:detail.id,revision:detail.revision,status:'open',assignedTo:actor},actor,entry.controller.signal);
      else if(kind==='reopen')await reopenWhatsAppConversation({conversationId:detail.id,revision:detail.revision,status:'closed',assignedTo:detail.assignedTo},actor,entry.controller.signal);
      else if(kind==='queue')await setWhatsAppConversationQueue({conversationId:detail.id,revision:detail.revision,status:'open',assignedTo:actor,currentQueue:detail.queue,queue:options.queue??''},actor,entry.controller.signal);
      else if(kind==='revoke_consent')await revokeWhatsAppConsent({conversationId:detail.id,revision:detail.revision,status:'open',assignedTo:actor,consented:true},actor,entry.controller.signal);
      else await releaseWhatsAppConversation({conversationId:detail.id,revision:detail.revision,assignedTo:actor},actor,entry.controller.signal);
    }
    catch(error){
      if(!isCurrent(entry))return;
      if(error instanceof WhatsAppClaimError&&!error.needsRefresh){operation.current=null;setFeedback({phase:'done',message:error.message,error:true});return;}
    }
    if(isCurrent(entry))await reconcile(entry);
  };
  const close=()=>{resetOperation(); setSelected(null); heading.current?.focus(); };
  return <div className="space-y-4">
    {feedback&&<div ref={feedbackRef} tabIndex={-1} role={feedback.error?'alert':'status'} className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm outline-none">
      <p>{feedback.message}</p>
      {feedback.phase==='unresolved'&&<Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={()=>{if(operation.current)void reconcile(operation.current);}}>{(operation.current?.kind==='close'||operation.current?.kind==='reopen'||operation.current?.kind==='queue'||operation.current?.kind==='revoke_consent')?'Conferir conversa':'Conferir responsável'}</Button>}
    </div>}
    <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
      <div className="space-y-2 min-w-0">
        <Label htmlFor="wa-filter">Filtrar conversas</Label>
        <select id="wa-filter" className="block h-11 w-full rounded-md border bg-card px-3 text-sm" value={filter} onChange={event => { resetOperation();setSelected(null); poll.explicit(); setBefore(null); setFilter(event.target.value as WhatsAppInboxFilter); }}>
          <option value="open">Em aberto</option><option value="unassigned">Sem responsável</option><option value="mine">Minhas conversas</option><option value="closed">Encerradas</option>
        </select>
      </div>
      <form className="grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={event => { event.preventDefault();resetOperation(); setSelected(null); poll.explicit(); setBefore(null); setSearch(draft.trim()); }}>
        <div className="min-w-0 space-y-2"><Label htmlFor="wa-search">Buscar conversa</Label><Input id="wa-search" type="search" maxLength={80} className="h-11" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Nome ou telefone" /></div>
        <Button type="submit" variant="outline" className="h-11">Buscar</Button>
      </form>
      <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Atualizar conversas" title="Atualizar conversas" disabled={list.fetchStatus!=='idle'||commandBusy||sending} onClick={refresh}><RefreshCw aria-hidden="true" className="h-4 w-4" /></Button>
    </div>
    <div className="grid items-start gap-4 shell:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
      <section aria-labelledby="wa-list-heading" className="min-w-0 space-y-3">
        <h2 id="wa-list-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none">Lista de conversas</h2>
        {(before || nextCursor) && <nav aria-label="Páginas das conversas" className="flex flex-wrap gap-2">
          {before && <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => goTo(null)}>Conversas mais recentes</Button>}
          {nextCursor && <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => goTo(nextCursor)}>Conversas anteriores</Button>}
        </nav>}
        {poll.outdated&&<p aria-live="polite" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <span>Não foi possível atualizar. A lista pode estar desatualizada.</span>
          <button type="button" className="underline underline-offset-2" onClick={poll.tick}>Tentar agora</button>
        </p>}
        {shown ? null : list.fetchStatus === 'paused' ? <p role="status" className="p-4 text-sm">Aguardando conexão de rede para carregar as conversas…</p> : list.isPending || list.fetchStatus !== 'idle' ? <p role="status" className="p-4 text-sm">Carregando conversas…</p> : list.isError ? <ReadFailure label="conversas" onRetry={() => { heading.current?.focus(); poll.explicit(); void list.refetch(); }} /> : null}
        {shown && <>
          {rows.length === 0 && <p className="rounded-lg border p-6 text-sm text-muted-foreground">{before ? 'Nenhuma conversa anterior a este ponto neste filtro.' : 'Nenhuma conversa neste filtro.'}</p>}
          <ul className="space-y-2">{rows.map(item => <li key={item.id}>
            <button type="button" aria-label={'Abrir conversa com ' + (item.profileName || 'contato sem nome')} aria-pressed={selectedId === item.id} onClick={() => {if(selectedId!==item.id){resetOperation();setSelected(item);}}} className={`w-full rounded-lg border p-4 text-left space-y-2 ${selectedId === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/60'}`}>
              <span className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 font-semibold text-sm [overflow-wrap:anywhere]">{item.profileName || 'Contato sem nome'}</span>{item.unreadCount > 0 && <span className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">{item.unreadCount} não lidas</span>}</span>
              <span className="line-clamp-2 text-sm [overflow-wrap:anywhere]">{item.lastMessagePreview || 'Sem prévia de mensagem'}</span>
              <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.status === 'closed' ? 'Encerrada' : 'Em aberto'} · Fila {item.queue}{item.assignedTo === actor ? ' · Com você' : item.assignedTo === null ? ' · Sem responsável' : ''}</span>
              <time dateTime={item.lastMessageAt} className="block text-xs text-muted-foreground">{clinicDateLabel(item.lastMessageAt)} · {clinicTime(item.lastMessageAt)}</time>
            </button>
          </li>)}</ul>
        </>}
      </section>
      {selected&&feedback?.phase!=='checking'&&feedback?.phase!=='unresolved' ? <WhatsAppMessages key={selected.id+':'+detailGeneration} generation={detailGeneration} actor={actor} clinic={clinic} conversation={selected} commandBusy={commandBusy} commandBlocked={commandBlocked} onClaim={detail=>void runCommand(detail,'assign')} onRelease={detail=>void runCommand(detail,'unassign')} onCloseConversation={detail=>void runCommand(detail,'close')} onReopenConversation={detail=>void runCommand(detail,'reopen')} onSetQueue={(detail,queue)=>void runCommand(detail,'queue',{queue})} onTransfer={(detail,targetUserId)=>void runCommand(detail,'transfer',{targetUserId})} onRevokeConsent={detail=>void runCommand(detail,'revoke_consent')} commandKind={operation.current?.kind} onNavigate={resetOperation} onClose={close}
          drafts={drafts} requestId={requestId} onSendingChange={setSending} onRead={onRead} />
        : selected&&(feedback?.phase==='checking'||feedback?.phase==='unresolved')?<div className="rounded-lg border bg-card p-6 space-y-3 text-sm"><p>{(operation.current?.kind==='close'||operation.current?.kind==='reopen'||operation.current?.kind==='queue'||operation.current?.kind==='revoke_consent')?'O detalhe será exibido após a conferência da conversa.':'O detalhe será exibido após a conferência do responsável.'}</p><Button variant="outline" onClick={close}>Voltar à lista</Button></div>
        : <p className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">Selecione uma conversa para ler as mensagens.</p>}
    </div>
  </div>;
}
