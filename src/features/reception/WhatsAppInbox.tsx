import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useClinicAccess } from './accessContext';
import { whatsappApi, type WhatsAppInboxFilter } from './whatsappApi';
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
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useQuery({
    queryKey: ['reception', actor, clinic, 'whatsapp', 'conversations', filter, search],
    queryFn: ({ signal }) => whatsappApi.conversations({ filter, search, limit: 50 }, signal),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = list.isSuccess && list.isFetchedAfterMount && !list.isFetching;
  const current = fresh ? list.data.conversations.find(item => item.id === selected) : undefined;
  return <div className="space-y-4">
    <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_auto]">
      <div className="space-y-2 min-w-0">
        <Label htmlFor="wa-filter">Filtrar conversas</Label>
        <select id="wa-filter" className="block h-11 w-full rounded-md border bg-card px-3 text-sm" value={filter} onChange={event => { setSelected(null); setFilter(event.target.value as WhatsAppInboxFilter); }}>
          <option value="open">Em aberto</option><option value="unassigned">Sem responsável</option><option value="mine">Minhas conversas</option><option value="closed">Encerradas</option>
        </select>
      </div>
      <form className="grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={event => { event.preventDefault(); setSelected(null); setSearch(draft.trim()); }}>
        <div className="min-w-0 space-y-2"><Label htmlFor="wa-search">Buscar conversa</Label><Input id="wa-search" type="search" maxLength={80} className="h-11" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Nome ou telefone" /></div>
        <Button type="submit" variant="outline" className="h-11">Buscar</Button>
      </form>
      <Button variant="outline" className="h-11 gap-2 md:col-span-2 xl:col-span-1" disabled={list.isFetching} onClick={() => void list.refetch()}><RefreshCw aria-hidden="true" className="h-4 w-4" />Atualizar conversas</Button>
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
      <section aria-labelledby="wa-list-heading" className="min-w-0 space-y-3">
        <h2 id="wa-list-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none">Lista de conversas</h2>
        {list.isPending || list.isFetching ? <p role="status" className="p-4 text-sm">Carregando conversas…</p> : list.isError ? <ReadFailure label="conversas" onRetry={() => void list.refetch()} /> : null}
        {fresh && <>
          {list.data.conversations.length === 0 && <p className="rounded-lg border p-6 text-sm text-muted-foreground">Nenhuma conversa neste filtro.</p>}
          <ul className="space-y-2">{list.data.conversations.map(item => <li key={item.id}>
            <button type="button" aria-label={'Abrir conversa com ' + (item.profileName || 'contato sem nome')} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} className={`w-full rounded-lg border p-4 text-left space-y-2 ${selected === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/60'}`}>
              <span className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 font-semibold text-sm [overflow-wrap:anywhere]">{item.profileName || 'Contato sem nome'}</span>{item.unreadCount > 0 && <span className="rounded bg-muted px-2 py-1 text-xs">{item.unreadCount} não lidas</span>}</span>
              <span className="block line-clamp-2 text-sm [overflow-wrap:anywhere]">{item.lastMessagePreview || 'Sem prévia de mensagem'}</span>
              <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.status === 'closed' ? 'Encerrada' : 'Em aberto'} · Fila {item.queue}</span>
              <time dateTime={item.lastMessageAt} className="block text-xs text-muted-foreground">{clinicDateLabel(item.lastMessageAt)} · {clinicTime(item.lastMessageAt)}</time>
            </button>
          </li>)}</ul>
          {list.data.nextBefore && <p className="text-xs text-muted-foreground">Exibindo até 50 conversas. Refine a busca para localizar uma conversa.</p>}
        </>}
      </section>
      {current ? <WhatsAppMessages key={current.id} actor={actor} clinic={clinic} conversation={current} onClose={() => { setSelected(null); heading.current?.focus(); }} />
        : <p className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">Selecione uma conversa para ler as mensagens.</p>}
    </div>
  </div>;
}
