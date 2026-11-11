import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export default function ReceptionQueue() {
  const [params, setParams] = useSearchParams();
  const conversations = params.get('view') === 'conversations';
  // Unread WhatsApp conversations, read lightly while the person works on the case queue.
  const unread = useWhatsAppUnread(!conversations);
  return <div className="reception-area space-y-4">
    <nav aria-label="Área de atendimento" className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-muted/60 p-1">
      {[{ label: 'Atendimentos', value: false }, { label: conversationsLabel(unread), value: true }].map(item => <Button key={String(item.value)} variant={conversations === item.value ? 'default' : 'outline'} aria-pressed={conversations === item.value} onClick={() => setParams(old => {
        const next = new URLSearchParams(old);
        if (item.value) next.set('view', 'conversations'); else next.delete('view');
        return next;
      })} className="min-h-11 rounded-lg">{item.label}</Button>)}
    </nav>
    {conversations ? <WhatsAppInbox /> : <CaseQueue />}
  </div>;
}

function CaseQueue() {
  const access = useClinicAccess();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const selected = params.get('case');
  const status = params.get('status') ?? 'open';
  const mine = params.get('mine') === '1';
  const doctor = params.get('doctor') || null;
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
  return (
    <div className="space-y-4">
      <PageHeading title="Fila de atendimento" description="Assuma uma demanda, confirme o contato e acompanhe o próximo passo." actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Atualizar fila" onClick={() => void queue.refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button className="min-h-11 gap-2" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            Novo atendimento
          </Button>
        </div>
      } />
      <div className="grid items-end gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 shell:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] shell:items-center shell:py-3">
        <div className="min-w-0 space-y-2 shell:flex shell:items-center shell:gap-3 shell:space-y-0">
          <Label htmlFor="queue-status">Situação</Label>
          <select
            id="queue-status"
            value={status}
            onChange={(e) => change('status', e.target.value)}
            className="block min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="open">Em aberto</option>
            <option value="all">Todos</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-2 shell:flex shell:items-center shell:gap-3 shell:space-y-0">
          <Label htmlFor="queue-doctor">Médico</Label>
          <select
            id="queue-doctor"
            value={doctor ?? ''}
            onChange={(e) => change('doctor', e.target.value)}
            className="block min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">Todas as agendas permitidas</option>
            {access?.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            className="h-4 w-4 shrink-0 accent-primary"
            type="checkbox"
            checked={mine}
            onChange={(e) => change('mine', e.target.checked ? '1' : '')}
          />
          Meus atendimentos
        </label>
      </div>
      <div className="grid md:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.25fr)] gap-4 items-start">
        <section aria-label="Atendimentos da fila" className="min-w-0 space-y-2">
          <ReceptionNotice loading={queue.isPending} error={queue.error} onRetry={() => void queue.refetch()} />
          {queue.data?.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected === item.id}
                onClick={() => change('case', item.id)}
                className={`w-full text-left rounded-xl border p-4 space-y-2 transition-colors ${selected === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/60'}`}
              >
                <div className="flex flex-wrap gap-2 justify-between">
                  <span className="font-semibold text-sm break-words">{item.contactName}</span>
                  <span className="text-[0.625rem] rounded bg-muted px-2 py-1">{statuses[item.status]}</span>
                </div>
                <p className="text-sm break-words">{item.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {kinds[item.kind]} · {item.assigneeName ? 'Com ' + item.assigneeName : 'Sem responsável'}
                </p>
              </button>
            ))}
          {queue.data?.pages[0].items.length === 0 && (
            <div className="rounded-xl border p-6 text-sm text-muted-foreground">Nenhum atendimento neste filtro.</div>
          )}
          {queue.hasNextPage && (
            <Button variant="outline" disabled={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()}>
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
            <div className="rounded-xl border border-dashed bg-card p-8 text-sm text-muted-foreground">
              Selecione um atendimento para ver o contato, assumir a demanda e registrar o acompanhamento.
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
