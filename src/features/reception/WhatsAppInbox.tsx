import { useEffect,useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from './accessContext';
import { whatsappApi, type WhatsAppInboxFilter,type WhatsAppConversation } from './whatsappApi';
import {claimWhatsAppConversation,WhatsAppClaimError} from './whatsappClaim';
import {releaseWhatsAppConversation} from './whatsappRelease';
import {closeWhatsAppConversation} from './whatsappClose';
import { WhatsAppMessages } from './WhatsAppMessages';
import { clinicDateLabel, clinicTime } from './dates';

export default function WhatsAppInbox() {
  const access = useClinicAccess(), { user } = useAuth();
  if (!access?.active || !access.clinic || user?.id !== access.actorId || !(access.admin || access.kind === 'reception')) {
    return <p role="alert" className="rounded-lg border p-4 text-sm">Acesso à caixa de conversas indisponível.</p>;
  }
  return <Inbox key={access.actorId + ':' + access.clinic.id} actor={access.actorId} clinic={access.clinic.id} />;
}

function Inbox({ actor, clinic }: { actor: string; clinic: string }) {
  const channel = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'state'],
    queryFn: ({ signal }) => whatsappApi.state(signal),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = channel.isSuccess && channel.isFetchedAfterMount && !channel.isFetching;
  return <div className="space-y-4">
    <header className="space-y-2">
      <h1 className="text-xl font-semibold">Conversas</h1>
      <p className="text-sm text-muted-foreground">Consulte as conversas recebidas pelo número da clínica.</p>
    </header>
    {channel.isFetching || channel.isPending ? <p role="status" className="p-4 text-sm">Verificando WhatsApp…</p>
      : channel.isError ? <ReadFailure label="conexão" onRetry={() => void channel.refetch()} />
      : fresh && channel.data.serverReady && channel.data.connected && channel.data.canUseInbox
        ? <ConversationList actor={actor} clinic={clinic} />
        : <div role="status" className="rounded-lg border bg-card p-6 space-y-2">
          <h2 className="font-semibold">WhatsApp indisponível</h2>
          <p className="text-sm text-muted-foreground">Peça à administração para verificar a conexão e seu acesso ao WhatsApp da clínica.</p>
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

function ConversationList({ actor, clinic }: { actor: string; clinic: string }) {
  const [filter, setFilter] = useState<WhatsAppInboxFilter>('open');
  const [draft, setDraft] = useState(''), [search, setSearch] = useState(''), [selected, setSelected] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [detailGeneration,setDetailGeneration]=useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedbackRef=useRef<HTMLDivElement>(null);
  type Operation={id:string;kind:'assign'|'unassign'|'close';controller:AbortController;checking:boolean};
  const operation=useRef<Operation|null>(null);
  const [feedback,setFeedback]=useState<{phase:'sending'|'checking'|'unresolved'|'done';message:string;error:boolean}|null>(null);
  useEffect(()=>()=>{operation.current?.controller.abort();operation.current=null;},[]);
  useEffect(()=>{if(feedback?.phase==='done'||feedback?.phase==='unresolved')feedbackRef.current?.focus();},[feedback]);
  const resetOperation=()=>{operation.current?.controller.abort();operation.current=null;setFeedback(null);};
  const list = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'conversations', filter, search, before],
    queryFn: ({ signal }) => whatsappApi.conversations({ filter, search, limit: 50, ...(before ? { before } : {}) }, signal),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = list.isSuccess && list.isFetchedAfterMount && !list.isFetching;
  const current = fresh ? list.data.conversations.find(item => item.id === selected) : undefined;
  const nextCursor = fresh ? list.data.nextBefore : null;
  const commandBusy=feedback?.phase==='sending'||feedback?.phase==='checking';
  const commandBlocked=commandBusy||feedback?.phase==='unresolved';
  const goTo=(cursor:string|null)=>{resetOperation();setSelected(null);setBefore(cursor);heading.current?.focus();};
  const refresh=()=>{resetOperation();setDetailGeneration(generation=>generation+1);if(before)goTo(null);else void list.refetch();};
  const isCurrent=(entry:Operation)=>operation.current===entry&&!entry.controller.signal.aborted;
  const reconcile=async(entry:Operation)=>{
    if(!isCurrent(entry)||entry.checking)return;
    entry.checking=true;setFeedback({phase:'checking',message:entry.kind==='close'?'Conferindo a conversa e atualizando a lista…':'Conferindo o responsável e atualizando a lista…',error:false});
    const [detail,result]=await Promise.allSettled([whatsappApi.messages({conversationId:entry.id},entry.controller.signal),list.refetch()]);
    if(!isCurrent(entry))return;
    entry.checking=false;
    if(detail.status!=='fulfilled'||result.status!=='fulfilled'||!result.value.isSuccess){
      setFeedback({phase:'unresolved',message:entry.kind==='close'?'Não foi possível conferir a conversa. Confira os dados antes de outra tentativa.':'Não foi possível conferir o responsável. Confira os dados antes de outra tentativa.',error:true});return;
    }
    operation.current=null;
    // A fast list refresh may coalesce fetching/success without unmounting the
    // detail. A new generation always fetches the authoritative visible state.
    setDetailGeneration(generation=>generation+1);
    setFeedback({phase:'done',message:entry.kind==='close'?'Dados atualizados. Confira a situação atual na conversa.':'Dados atualizados. Confira o responsável atual na conversa.',error:false});
  };
  const runCommand=async(detail:WhatsAppConversation,kind:Operation['kind'])=>{
    if(operation.current||!fresh||!current||selected!==detail.id||current.id!==detail.id||detail.status!=='open'||(kind==='assign'?detail.assignedTo!==null:detail.assignedTo!==actor)||detail.revision>=2147483647)return;
    const entry:Operation={id:detail.id,kind,controller:new AbortController(),checking:false};operation.current=entry;
    setFeedback({phase:'sending',message:kind==='assign'?'Assumindo conversa…':kind==='close'?'Encerrando conversa…':'Devolvendo conversa à fila…',error:false});
    try{
      if(kind==='assign')await claimWhatsAppConversation({conversationId:detail.id,revision:detail.revision},actor,entry.controller.signal);
      else if(kind==='close')await closeWhatsAppConversation({conversationId:detail.id,revision:detail.revision,status:detail.status,assignedTo:actor},actor,entry.controller.signal);
      else await releaseWhatsAppConversation({conversationId:detail.id,revision:detail.revision,assignedTo:actor},actor,entry.controller.signal);
    }
    catch(error){
      if(!isCurrent(entry))return;
      if(error instanceof WhatsAppClaimError&&!error.needsRefresh){operation.current=null;setFeedback({phase:'done',message:error.message,error:true});return;}
    }
    if(isCurrent(entry))await reconcile(entry);
  };
  return <div className="space-y-4">
    {feedback&&<div ref={feedbackRef} tabIndex={-1} role={feedback.error?'alert':'status'} className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm outline-none">
      <p>{feedback.message}</p>
      {feedback.phase==='unresolved'&&<Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={()=>{if(operation.current)void reconcile(operation.current);}}>{operation.current?.kind==='close'?'Conferir conversa':'Conferir responsável'}</Button>}
    </div>}
    <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_auto]">
      <div className="space-y-2 min-w-0">
        <Label htmlFor="wa-filter">Filtrar conversas</Label>
        <select id="wa-filter" className="block h-11 w-full rounded-md border bg-card px-3 text-sm" value={filter} onChange={event => { resetOperation();setSelected(null); setBefore(null); setFilter(event.target.value as WhatsAppInboxFilter); }}>
          <option value="open">Em aberto</option><option value="unassigned">Sem responsável</option><option value="mine">Minhas conversas</option><option value="closed">Encerradas</option>
        </select>
      </div>
      <form className="grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={event => { event.preventDefault();resetOperation(); setSelected(null); setBefore(null); setSearch(draft.trim()); }}>
        <div className="min-w-0 space-y-2"><Label htmlFor="wa-search">Buscar conversa</Label><Input id="wa-search" type="search" maxLength={80} className="h-11" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Nome ou telefone" /></div>
        <Button type="submit" variant="outline" className="h-11">Buscar</Button>
      </form>
      <Button variant="outline" className="h-11 gap-2 md:col-span-2 xl:col-span-1" disabled={list.isFetching||commandBusy} onClick={refresh}><RefreshCw aria-hidden="true" className="h-4 w-4" />Atualizar conversas</Button>
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
      <section aria-labelledby="wa-list-heading" className="min-w-0 space-y-3">
        <h2 id="wa-list-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none">Lista de conversas</h2>
        <p className="text-xs text-muted-foreground">Até 50 conversas por página.</p>
        {(before || nextCursor) && <nav aria-label="Páginas das conversas" className="flex flex-wrap gap-2">
          {before && <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => goTo(null)}>Conversas mais recentes</Button>}
          {nextCursor && <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => goTo(nextCursor)}>Conversas anteriores</Button>}
        </nav>}
        {list.isPending || list.isFetching ? <p role="status" className="p-4 text-sm">Carregando conversas…</p> : list.isError ? <ReadFailure label="conversas" onRetry={() => { heading.current?.focus(); void list.refetch(); }} /> : null}
        {fresh && <>
          {list.data.conversations.length === 0 && <p className="rounded-lg border p-6 text-sm text-muted-foreground">{before ? 'Nenhuma conversa anterior a este ponto neste filtro.' : 'Nenhuma conversa neste filtro.'}</p>}
          <ul className="space-y-2">{list.data.conversations.map(item => <li key={item.id}>
            <button type="button" aria-label={'Abrir conversa com ' + (item.profileName || 'contato sem nome')} aria-pressed={selected === item.id} onClick={() => {if(selected!==item.id){resetOperation();setSelected(item.id);}}} className={`w-full rounded-lg border p-4 text-left space-y-2 ${selected === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/60'}`}>
              <span className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 font-semibold text-sm [overflow-wrap:anywhere]">{item.profileName || 'Contato sem nome'}</span>{item.unreadCount > 0 && <span className="rounded bg-muted px-2 py-1 text-xs">{item.unreadCount} não lidas</span>}</span>
              <span className="block line-clamp-2 text-sm [overflow-wrap:anywhere]">{item.lastMessagePreview || 'Sem prévia de mensagem'}</span>
              <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.status === 'closed' ? 'Encerrada' : 'Em aberto'} · Fila {item.queue}</span>
              <time dateTime={item.lastMessageAt} className="block text-xs text-muted-foreground">{clinicDateLabel(item.lastMessageAt)} · {clinicTime(item.lastMessageAt)}</time>
            </button>
          </li>)}</ul>
        </>}
      </section>
      {current&&feedback?.phase!=='checking'&&feedback?.phase!=='unresolved' ? <WhatsAppMessages key={current.id+':'+detailGeneration} generation={detailGeneration} actor={actor} clinic={clinic} conversation={current} commandBusy={commandBusy} commandBlocked={commandBlocked} onClaim={detail=>void runCommand(detail,'assign')} onRelease={detail=>void runCommand(detail,'unassign')} onCloseConversation={detail=>void runCommand(detail,'close')} commandKind={operation.current?.kind} onNavigate={resetOperation} onClose={() => {resetOperation(); setSelected(null); heading.current?.focus(); }} />
        : selected&&(feedback?.phase==='checking'||feedback?.phase==='unresolved')?<div className="rounded-lg border bg-card p-6 space-y-3 text-sm"><p>{operation.current?.kind==='close'?'O detalhe será exibido após a conferência da conversa.':'O detalhe será exibido após a conferência do responsável.'}</p><Button variant="outline" onClick={()=>{resetOperation();setSelected(null);heading.current?.focus();}}>Voltar à lista</Button></div>
        : <p className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">Selecione uma conversa para ler as mensagens.</p>}
    </div>
  </div>;
}
