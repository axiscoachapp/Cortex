import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { whatsappApi, type WhatsAppConversation } from './whatsappApi';
import { clinicDateLabel, clinicTime } from './dates';

const kindLabels: Record<string, string> = { image: 'Imagem', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha', location: 'Localização', unsupported: 'Mensagem não disponível' };

export function WhatsAppMessages({ actor, clinic, conversation, onClose }: { actor: string; clinic: string; conversation: WhatsAppConversation; onClose: () => void }) {
  const region = useRef<HTMLElement>(null);
  const messages = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'messages', conversation.id],
    queryFn: ({ signal }) => whatsappApi.messages({ conversationId: conversation.id }, signal),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = messages.isSuccess && messages.isFetchedAfterMount && !messages.isFetching;
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
    <Button variant="outline" disabled={messages.isFetching} onClick={() => void messages.refetch()}>Atualizar mensagens</Button>
    {messages.isPending || messages.isFetching ? <p role="status" className="text-sm">Carregando mensagens…</p> : messages.isError ? <div role="alert" className="space-y-3 text-sm">
      <p>Não foi possível carregar as mensagens. Verifique seu acesso e tente novamente.</p>
      <Button variant="outline" onClick={() => void messages.refetch()}>Tentar carregar mensagens</Button>
    </div> : null}
    {fresh && <>
      {messages.data.conversation.optedOut && <p className="rounded-md bg-muted p-3 text-sm">Este contato pediu para não receber lembretes.</p>}
      {messages.data.messages.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem nesta conversa.</p>}
      <ol aria-label="Mensagens da conversa" className="space-y-3">{messages.data.messages.slice().reverse().map(message => <li key={message.id} className={`min-w-0 rounded-lg border p-3 space-y-2 ${message.direction === 'out' ? 'bg-primary/5' : 'bg-muted/40'}`}>
        <p className="text-xs font-medium">{message.direction === 'in' ? 'Recebida' : 'Enviada'}</p>
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{message.body || kindLabels[message.kind] || 'Mensagem sem texto'}</p>
        {message.media?.filename && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{message.media.filename}</p>}
        <time dateTime={message.at} className="block text-xs text-muted-foreground">{clinicDateLabel(message.at)} · {clinicTime(message.at)}</time>
      </li>)}</ol>
      {messages.data.nextBefore && <p className="text-xs text-muted-foreground">Exibindo as 50 mensagens mais recentes.</p>}
    </>}
  </section>;
}
