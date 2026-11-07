import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import type { ContactOption } from './NewCaseDialog';

type Actions = {
  onOpen: (contact: ContactOption) => void;
  onEdit: (id: string) => void;
  onLinks: (contact: ContactOption) => void;
};

export function ContactDirectory(actions: Actions) {
  const access = useClinicAccess();
  const { user } = useAuth();
  const hidden = useSessionHidden();
  if (hidden) return null;
  if (!access?.active || !access.clinic || user?.id !== access.actorId || !(access.admin || access.kind === 'reception')) {
    return <p role="alert" className="text-sm">Acesso ao diretório de contatos indisponível.</p>;
  }
  return <DirectoryContents key={[access.actorId, access.clinic.id, access.admin, access.kind].join(':')}
    actor={access.actorId} clinic={access.clinic.id} canEdit={access.admin} canViewLinks={access.admin && access.kind === 'clinical'} {...actions} />;
}

function DirectoryContents({ actor, clinic, canEdit, canViewLinks, onOpen, onEdit, onLinks }: Actions & {
  actor: string; clinic: string; canEdit: boolean; canViewLinks: boolean;
}) {
  const client = useQueryClient();
  const field = useId();
  const [search, setSearch] = useState('');
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Each mounted reader starts a new page chain, even before the old cache is collected.
  const queryKey = ['reception', actor, 'contacts', clinic, search, field];
  const contacts = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => receptionApi.contacts(clinic, search, pageParam, signal),
    getNextPageParam: last => last.nextCursor,
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = contacts.isSuccess && contacts.isFetchedAfterMount && contacts.fetchStatus === 'idle';
  const reading = contacts.fetchStatus !== 'idle' || contacts.isPending;
  const withSnapshot = (action: () => void) => {
    const latest = client.getQueryState(queryKey);
    if (mounted.current && fresh && latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === contacts.data) action();
  };
  return <section aria-label="Diretório de contatos" className="space-y-4 min-w-0">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-64 max-w-xl space-y-2">
        <Label htmlFor={field}>Buscar contatos</Label>
        <Input id={field} placeholder="Nome ou telefone" maxLength={200} value={search}
          onChange={event => setSearch(event.target.value)} className="h-11" />
      </div>
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={reading}
        onClick={() => void contacts.refetch()}>Atualizar contatos</Button>
    </div>
    {contacts.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão de rede para carregar contatos…</p>
      : reading ? <p role="status" className="text-sm">Carregando contatos…</p>
      : contacts.isError ? <div role="alert" className="rounded-lg border p-4 space-y-3 text-sm">
        <p>Não foi possível carregar contatos. Verifique o acesso e tente novamente.</p>
        <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal"
          onClick={() => void contacts.refetch()}>Tentar carregar contatos</Button>
      </div> : null}
    {fresh && <>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {contacts.data.pages.flatMap(page => page.items).map(contact => <article key={contact.id} className="rounded-xl border bg-card p-4 space-y-2 min-w-0 [overflow-wrap:anywhere]">
          <h2 className="font-medium">{contact.name}</h2>
          <p className="text-sm text-muted-foreground">{contact.phone || 'Sem telefone cadastrado'}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 whitespace-normal"
              onClick={() => withSnapshot(() => onOpen(contact))}>Abrir atendimento</Button>
            {canEdit && <Button type="button" size="sm" variant="ghost" className="h-auto min-h-11 whitespace-normal"
              onClick={() => withSnapshot(() => onEdit(contact.id))}>Corrigir contato</Button>}
            {canViewLinks && <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal"
              onClick={() => withSnapshot(() => onLinks(contact))}>Consultar vínculos</Button>}
          </div>
        </article>)}
      </div>
      {contacts.data.pages.every(page => page.items.length === 0) && <p className="p-6 text-sm text-muted-foreground border rounded-xl">Nenhum contato encontrado neste filtro.</p>}
      {contacts.hasNextPage && <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal"
        onClick={() => withSnapshot(() => { void contacts.fetchNextPage(); })}>Carregar mais contatos</Button>}
    </>}
  </section>;
}
