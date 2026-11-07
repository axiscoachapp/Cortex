import { useEffect, useRef,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { whatsappApi, type WhatsAppConversation } from './whatsappApi';
import { clinicDateLabel, clinicTime } from './dates';
import { WhatsAppBotSession } from './WhatsAppBotSession';

const kindLabels: Record<string, string> = { image: 'Imagem', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha', location: 'Localização', unsupported: 'Mensagem não disponível' };

export function WhatsAppMessages({ actor, clinic, conversation, onClose,onClaim,claimBusy=false,claimBlocked=false,onNavigate,generation=0 }: { actor: string; clinic: string; conversation: WhatsAppConversation; onClose: () => void;onClaim?:(conversation:WhatsAppConversation)=>void;claimBusy?:boolean;claimBlocked?:boolean;onNavigate?:()=>void;generation?:number }) {
  const region = useRef<HTMLElement>(null);
  const pageHeading=useRef<HTMLHeadingElement>(null);
  const [before,setBefore]=useState<string|null>(null);
  const [botReadGeneration,setBotReadGeneration]=useState(0);
  const messages = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'messages', conversation.id,before,generation],
    queryFn: ({ signal }) => whatsappApi.messages({ conversationId: conversation.id,...(before?{before}:{}) }, signal),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = messages.isSuccess && messages.isFetchedAfterMount && !messages.isFetching;
  const nextCursor=fresh?messages.data.nextBefore:null;
  const retry=()=>{
    // A new generation cannot join a bot read started before this message refresh,
    // even when a fast response coalesces the parent's pending render.
    setBotReadGeneration(generation=>generation+1);
    pageHeading.current?.focus();
    void messages.refetch();
  };
  const goTo=(cursor:string|null)=>{
    onNavigate?.();
    setBotReadGeneration(generation=>generation+1);
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
  return <section ref={region} tabIndex={-1} aria-label="Conversa selecionada" className="min-w-0 scroll-mt-4 rounded-lg border bg-card p-4 space-y-4 outline-none">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 className="min-w-0 font-semibold [overflow-wrap:anywhere]">{conversation.profileName || 'Contato sem nome'}</h2>
      <Button variant="outline" onClick={onClose}>Voltar à lista</Button>
    </div>
    <Button variant="outline" disabled={messages.isFetching||claimBusy} onClick={refresh}>Atualizar mensagens</Button>
    {fresh && <>
      <p className="text-sm [overflow-wrap:anywhere]">Fila atual: <strong>{messages.data.conversation.queue}</strong></p>
      <p className="text-sm">Responsável atual: <strong>{messages.data.conversation.assignedTo===null?'Sem responsável':messages.data.conversation.assignedTo===actor?'Você':'Outra pessoa'}</strong></p>
      {onClaim&&messages.data.conversation.status==='open'&&messages.data.conversation.assignedTo===null&&messages.data.conversation.revision<2147483647&&<Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={claimBlocked} onClick={()=>onClaim(messages.data.conversation)}>{claimBusy?'Assumindo…':'Assumir conversa'}</Button>}
      <WhatsAppBotSession key={botReadGeneration} generation={botReadGeneration} actor={actor} clinic={clinic} conversationId={messages.data.conversation.id} />
      {messages.data.conversation.optedOut && <p className="rounded-md bg-muted p-3 text-sm">Este contato pediu para não receber lembretes.</p>}
    </>}
    <h3 ref={pageHeading} tabIndex={-1} className="font-semibold outline-none">Mensagens da conversa</h3>
    {before!==null&&<p className="text-sm text-muted-foreground">Página de mensagens anteriores.</p>}
    {messages.isPending || messages.isFetching ? <p role="status" className="text-sm">Carregando mensagens…</p> : messages.isError ? <div role="alert" className="space-y-3 text-sm">
      <p>Não foi possível carregar as mensagens. Verifique seu acesso e tente novamente.</p>
      <Button variant="outline" onClick={retry}>Tentar carregar mensagens</Button>
    </div> : null}
    {fresh&&<>
      {messages.data.messages.length === 0 && <p className="text-sm text-muted-foreground">{before===null?'Nenhuma mensagem nesta conversa.':'Nenhuma mensagem anterior a este ponto.'}</p>}
      <ol aria-label="Mensagens da conversa" className="space-y-3">{messages.data.messages.slice().reverse().map(message => <li key={message.id} className={`min-w-0 rounded-lg border p-3 space-y-2 ${message.direction === 'out' ? 'bg-primary/5' : 'bg-muted/40'}`}>
        <p className="text-xs font-medium">{message.direction === 'in' ? 'Recebida' : 'Enviada'}</p>
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{message.body || kindLabels[message.kind] || 'Mensagem sem texto'}</p>
        {message.media?.filename && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{message.media.filename}</p>}
        <time dateTime={message.at} className="block text-xs text-muted-foreground">{clinicDateLabel(message.at)} · {clinicTime(message.at)}</time>
      </li>)}</ol>
      <p className="text-xs text-muted-foreground">Até 50 mensagens por página.</p>
    </>}
    {(before!==null||nextCursor!==null)&&<nav aria-label="Páginas da conversa" className="flex flex-wrap gap-2">
      {before!==null&&<Button variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={refresh}>Mensagens mais recentes</Button>}
      {nextCursor!==null&&<Button variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={()=>goTo(nextCursor)}>Mensagens anteriores</Button>}
    </nav>}
  </section>;
}
