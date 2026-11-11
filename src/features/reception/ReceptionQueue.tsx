import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PageHeading } from '@/components/PageHeading';
import { Label } from '@/components/ui/label';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { kinds, statuses } from './contracts';
import { NewCaseDialog } from './NewCaseDialog';
import { ReceptionNotice } from './ReceptionNotice';
import { CaseWorkspace } from './CaseWorkspace';
import { isBelowMobileBreakpoint } from '@/hooks/use-mobile';
import WhatsAppInbox from './WhatsAppInbox';
import { conversationsLabel, useWhatsAppUnread } from './useWhatsAppUnread';
import { SegmentedControl, selectClass } from './ReceptionControls';
import { displayPhone, matchesContactSearch, useMinuteClock, waitingLabel } from './queueTime';

/** Pages of 50 read automatically while a search or the oldest-first order needs the whole queue. */
export const QUEUE_SCAN_PAGES = 6;

export default function ReceptionQueue() {
  const [params, setParams] = useSearchParams();
  const conversations = params.get('view') === 'conversations';
  // Unread WhatsApp conversations, read lightly while the person works on the case queue.
  const unread = useWhatsAppUnread(!conversations);
  return <div className="reception-area space-y-4">
    <nav aria-label="Área de atendimento">
    <SegmentedControl label="Mostrar" className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto"
      value={conversations ? 'conversations' : 'cases'}
      options={[{ value: 'cases', label: 'Atendimentos' }, { value: 'conversations', label: conversationsLabel(unread) }]}
      onChange={value => setParams(old => {
        const next = new URLSearchParams(old);
        if (value === 'conversations') next.set('view', 'conversations'); else next.delete('view');
        return next;
      })} />
    </nav>
    {conversations ? <WhatsAppInbox /> : <CaseQueue />}
  </div>;
}

function CaseQueue() {
  const access = useClinicAccess();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  // The search stays on this screen only: names and phones never go into the address.
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const now = useMinuteClock();
  const selected = params.get('case');
  const status = params.get('status') ?? 'open';
  const mine = params.get('mine') === '1';
  const doctor = params.get('doctor') || null;
  const oldest = params.get('order') === 'oldest';
  const queue = useInfiniteQuery({
    queryKey: ['reception', access?.actorId, 'queue', access?.clinic?.id, status, mine, doctor],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => receptionApi.queue(access!.clinic!.id, status, mine, doctor, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!access?.clinic,
    retry: false,
    refetchInterval: 15_000,
  });
  const detail = useQuery({
    queryKey: ['reception', access?.actorId, 'case', selected],
    queryFn: () => receptionApi.case(selected!),
    enabled: !!selected,
    retry: false,
    refetchInterval: 15_000,
  });
  // The server lists the newest cases first, 50 at a time. Searching and the oldest-first order
  // need the rest of the queue, so a few more pages are read; beyond that the person is told.
  const scanning = oldest || search.trim() !== '';
  const loadedPages = queue.data?.pages.length ?? 0;
  useEffect(() => {
    if (scanning && queue.hasNextPage && !queue.isFetchingNextPage && !queue.isError && loadedPages < QUEUE_SCAN_PAGES) void queue.fetchNextPage();
  }, [scanning, queue.hasNextPage, queue.isFetchingNextPage, queue.isError, loadedPages, queue]);
  const items = useMemo(() => {
    const all = queue.data?.pages.flatMap((page) => page.items) ?? [];
    const found = all.filter(item => matchesContactSearch(item, search));
    return oldest ? [...found].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : found;
  }, [queue.data, search, oldest]);
  const truncated = scanning && queue.hasNextPage && loadedPages >= QUEUE_SCAN_PAGES;
  const activeFilters = (status !== 'open' ? 1 : 0) + (doctor ? 1 : 0) + (mine ? 1 : 0) + (oldest ? 1 : 0);
  const workspace = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected || detail.data?.id !== selected) return;
    workspace.current?.focus({ preventScroll: true });
    // Phone layout (queue above the case): bring the selected case into view.
    if (isBelowMobileBreakpoint()) workspace.current?.scrollIntoView({ block: 'start' });
  }, [selected, detail.data?.id]);
  function change(key: string, value: string) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  const loaded = !!queue.data;
  return (
    <div className="space-y-4">
      <PageHeading title="Fila de atendimento" actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Atualizar fila" title="Atualizar fila" onClick={() => void queue.refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button className="min-h-11 gap-2" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            Novo atendimento
          </Button>
        </div>
      } />
      <div className="space-y-3 rounded-xl border bg-card p-3 md:p-4">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="queue-search">Buscar na fila</Label>
            <Input id="queue-search" type="search" className="h-11" maxLength={80} value={search} placeholder="Nome ou telefone"
              onChange={event => setSearch(event.target.value)} />
          </div>
          <Button type="button" variant="outline" className="h-11 shrink-0 gap-2 md:hidden" aria-expanded={filtersOpen} aria-controls={filtersId}
            onClick={() => setFiltersOpen(open => !open)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {activeFilters ? `Filtros (${activeFilters})` : 'Filtros'}
          </Button>
        </div>
        {/* On the phone the filters fold behind "Filtros", so the first case shows on the first screen. */}
        <div id={filtersId} className={`${filtersOpen ? 'grid' : 'hidden'} items-end gap-3 md:grid md:grid-cols-2 shell:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto_auto]`}>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="queue-status">Situação</Label>
            <select id="queue-status" value={status} onChange={(e) => change('status', e.target.value)} className={selectClass}>
              <option value="open">Em aberto</option>
              <option value="all">Todos</option>
              {Object.entries(statuses).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="queue-doctor">Médico</Label>
            <select id="queue-doctor" value={doctor ?? ''} onChange={(e) => change('doctor', e.target.value)} className={selectClass}>
              <option value="">Todos os médicos</option>
              {access?.doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <SegmentedControl label="Ordem" showLabel value={oldest ? 'oldest' : 'recent'}
            options={[{ value: 'recent', label: 'Mais recentes' }, { value: 'oldest', label: 'Mais antigos' }]}
            onChange={value => change('order', value === 'oldest' ? 'oldest' : '')} />
          <div className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox id="queue-mine" checked={mine} onCheckedChange={(checked) => change('mine', checked === true ? '1' : '')} />
            <Label htmlFor="queue-mine" className="font-normal">Só os meus</Label>
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.25fr)] gap-4 items-start">
        <section aria-label="Atendimentos da fila" className="min-w-0 space-y-2">
          <ReceptionNotice loading={queue.isPending} error={queue.error} onRetry={() => void queue.refetch()} />
          {scanning && queue.isFetchingNextPage && <p role="status" className="text-xs text-muted-foreground">Procurando no restante da fila…</p>}
          <ul className="space-y-2">
            {items.map((item) => {
              const waiting = waitingLabel(item.createdAt, now);
              return <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selected === item.id}
                  onClick={() => change('case', item.id)}
                  className={`w-full text-left rounded-xl border p-3 md:p-4 space-y-1.5 transition-colors ${selected === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/60'}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-semibold text-sm [overflow-wrap:anywhere]">{item.contactName}</span>
                    {waiting && <time dateTime={item.createdAt} title="Tempo desde a abertura" className="shrink-0 text-xs tabular-nums text-muted-foreground">{waiting}</time>}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">{item.phone ? displayPhone(item.phone) : 'Sem telefone'}</span>
                  <span className="block text-sm [overflow-wrap:anywhere]">{item.subject}</span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {kinds[item.kind]} · {item.assigneeName ? 'Com ' + item.assigneeName : 'Sem responsável'}
                    </span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{statuses[item.status]}</span>
                  </span>
                </button>
              </li>;
            })}
          </ul>
          {loaded && items.length === 0 && !(scanning && queue.isFetchingNextPage) && (
            <div className="rounded-xl border p-6 text-sm text-muted-foreground">
              {search.trim() ? 'Nenhum atendimento encontrado para esta busca.' : 'Nenhum atendimento neste filtro.'}
            </div>
          )}
          {truncated && <p className="text-xs text-muted-foreground">Mostrando os {QUEUE_SCAN_PAGES * 50} atendimentos mais recentes deste filtro. Para achar os mais antigos, escolha uma situação ou um médico.</p>}
          {queue.hasNextPage && !scanning && (
            <Button variant="outline" className="min-h-11" disabled={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()}>
              Carregar mais atendimentos
            </Button>
          )}
        </section>
        <section ref={workspace} tabIndex={-1} aria-label="Atendimento selecionado" className="min-w-0 outline-none">
          {selected ? (
            <>
              <ReceptionNotice loading={detail.isPending} error={detail.error} onRetry={() => void detail.refetch()} />
              {/* Once read, a failed background refetch keeps the workspace (dialogs,
                  drafts) mounted and marks it stale; only a definitive refusal of
                  this case removes it. */}
              {detail.data && !definitiveCaseRefusal(detail.error) && <CaseWorkspace key={detail.data.id} data={detail.data} stale={detail.isError} />}
            </>
          ) : (
            <div className="hidden rounded-xl border border-dashed bg-card p-8 text-sm text-muted-foreground md:block">
              Selecione um atendimento para ver o contato, assumir e agendar.
            </div>
          )}
        </section>
      </div>
      {creating && (
        <NewCaseDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            change('case', id);
          }}
        />
      )}
    </div>
  );
}

// The server refused this case (no longer in scope) or answered something that
// cannot be trusted: its data leaves the screen at once.
function definitiveCaseRefusal(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '42501' || code === 'INVALID_RESPONSE';
}
