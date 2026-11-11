import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { displayPhone } from './queueTime';
import type { ContactOption } from './NewCaseDialog';
import { LoadErrorNotice, NoAccessNotice } from '@/features/shared/StatusNotice';

/** Typing pauses this long before the directory is read again. */
export const CONTACT_SEARCH_DEBOUNCE_MS = 300;

type Actions = {
  onOpen: (contact: ContactOption) => void;
  onEdit: (id: string) => void;
  onLinks: (contact: ContactOption) => void;
  onBook?: (contact: ContactOption) => void;
};

export function ContactDirectory(actions: Actions) {
  const access = useClinicAccess();
  const { user } = useAuth();
  const hidden = useSessionHidden();
  if (hidden) return null;
  if (!access?.active || !access.clinic || user?.id !== access.actorId || !(access.admin || access.kind === 'reception')) {
    return <NoAccessNotice message="Sua conta não tem acesso aos contatos desta clínica." backTo={null} />;
  }
  return <DirectoryContents key={[access.actorId, access.clinic.id, access.admin, access.kind].join(':')}
    actor={access.actorId} clinic={access.clinic.id} canEdit={access.admin} canViewLinks={access.admin && access.kind === 'clinical'} {...actions} />;
}

function DirectoryContents({ actor, clinic, canEdit, canViewLinks, onOpen, onEdit, onLinks, onBook }: Actions & {
  actor: string; clinic: string; canEdit: boolean; canViewLinks: boolean;
}) {
  const client = useQueryClient();
  const field = useId();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  // Same search as the conversations: name, or phone digits; spaces at the ends are ignored.
  useEffect(() => {
    const next = draft.trim();
    if (next === search) return;
    const timer = window.setTimeout(() => setSearch(next), CONTACT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, search]);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Each mounted reader starts a new page chain, even before the old cache is collected.
  const queryKey = ['reception', actor, 'contacts', clinic, search, field];
  const contacts = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => receptionApi.contacts(clinic, search, pageParam, signal),
    getNextPageParam: last => last.nextCursor,
    // While a new search loads, the previous results stay on screen (without actions).
    placeholderData: keepPreviousData,
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = contacts.isSuccess && !contacts.isPlaceholderData && contacts.isFetchedAfterMount && contacts.fetchStatus === 'idle';
  const previous = contacts.isPlaceholderData && contacts.fetchStatus === 'fetching';
  const reading = contacts.fetchStatus !== 'idle' || contacts.isPending;
  const withSnapshot = (action: () => void) => {
    const latest = client.getQueryState(queryKey);
    if (mounted.current && fresh && latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === contacts.data) action();
  };
  const rows = (fresh || previous) && contacts.data ? contacts.data.pages.flatMap(page => page.items) : [];
  return <section aria-label="Diretório de contatos" className="space-y-4 min-w-0">
    <form role="search" className="flex items-end gap-3" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); }}>
      <div className="min-w-0 flex-1 max-w-xl space-y-2">
        <Label htmlFor={field}>Buscar contatos</Label>
        <Input id={field} type="text" placeholder="Nome ou telefone" maxLength={200} value={draft}
          onChange={event => setDraft(event.target.value)} className="h-11" />
      </div>
      <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Atualizar contatos" title="Atualizar contatos" disabled={reading}
        onClick={() => void contacts.refetch()}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
    </form>
    {!canEdit && <p className="text-sm text-muted-foreground">Para corrigir o nome ou o telefone de um contato, peça ao administrador da clínica.</p>}
    {contacts.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão de rede para carregar contatos…</p>
      : reading ? <p role="status" className="text-sm">{previous ? 'Buscando contatos…' : 'Carregando contatos…'}</p>
      : contacts.isError ? <LoadErrorNotice subject="os contatos" onRetry={() => void contacts.refetch()} /> : null}
    {rows.length > 0 && <ul aria-busy={previous} className={`divide-y rounded-xl border bg-card ${previous ? 'opacity-60' : ''}`}>
      {rows.map(contact => <li key={contact.id}>
        <article className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-4 [overflow-wrap:anywhere]">
          <div className="min-w-0">
            <h2 className="text-base font-medium">{contact.name}</h2>
            <p className="text-sm text-muted-foreground tabular-nums">{contact.phone ? displayPhone(contact.phone) : 'Sem telefone cadastrado'}</p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            {onBook && <Button type="button" className="h-auto min-h-11 whitespace-normal" disabled={!fresh}
              aria-label={`Agendar para ${contact.name}`} onClick={() => withSnapshot(() => onBook(contact))}>Agendar</Button>}
            <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={!fresh}
              onClick={() => withSnapshot(() => onOpen(contact))}>Novo atendimento para este contato</Button>
            {canEdit && <Button type="button" variant="ghost" className="h-auto min-h-11 whitespace-normal" disabled={!fresh}
              onClick={() => withSnapshot(() => onEdit(contact.id))}>Corrigir contato</Button>}
            {canViewLinks && <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!fresh}
              onClick={() => withSnapshot(() => onLinks(contact))}>Ver pacientes ligados</Button>}
          </div>
        </article>
      </li>)}
    </ul>}
    {fresh && <>
      {contacts.data.pages.every(page => page.items.length === 0) && <p className="p-6 text-sm text-muted-foreground border rounded-xl">{search ? 'Nenhum contato encontrado para esta busca.' : 'Nenhum contato cadastrado ainda.'}</p>}
      {contacts.hasNextPage && <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal"
        onClick={() => withSnapshot(() => { void contacts.fetchNextPage(); })}>Carregar mais contatos</Button>}
    </>}
  </section>;
}
