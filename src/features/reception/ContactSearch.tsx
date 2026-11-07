import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { receptionApi } from './api';
import { useClinicAccess } from './accessContext';
import type { ContactOption } from './NewCaseDialog';

export function ContactSearch({ onSelect }: { onSelect: (contact: ContactOption) => void }) {
  const access = useClinicAccess();
  const { user } = useAuth();
  if (!access?.active || !access.clinic || user?.id !== access.actorId || !(access.admin || access.kind === 'reception')) {
    return <p role="alert" className="text-sm">Acesso à busca de contatos indisponível.</p>;
  }
  return <ContactSearchContents key={access.actorId + ':' + access.clinic.id} actor={access.actorId} clinic={access.clinic.id} onSelect={onSelect} />;
}

function ContactSearchContents({ actor, clinic, onSelect }: { actor: string; clinic: string; onSelect: (contact: ContactOption) => void }) {
  const client = useQueryClient();
  const id = useId();
  const [search, setSearch] = useState('');
  const enabled = search.trim().length >= 2 && search.length <= 200;
  const queryKey = ['reception', actor, 'contact-picker', clinic, search];
  const results = useQuery({
    queryKey,
    queryFn: ({ signal }) => receptionApi.contacts(clinic, search, null, signal),
    enabled,
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = enabled && results.isSuccess && results.isFetchedAfterMount && results.fetchStatus === 'idle';
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>Buscar contato por nome ou telefone</Label>
      <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={200} className="h-11 min-w-0" />
      {enabled && (results.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão de rede para buscar contatos…</p>
        : results.fetchStatus !== 'idle' || results.isPending ? <p role="status" className="text-sm">Buscando contatos…</p>
        : results.isError ? <div role="alert" className="space-y-2 text-sm"><p>Não foi possível buscar contatos. Verifique o acesso e tente novamente.</p><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => void results.refetch()}>Tentar buscar contatos</Button></div> : null)}
      {fresh && results.data.items.map((contact) => (
        <button
          key={contact.id}
          type="button"
          aria-label={'Selecionar contato ' + contact.name + ' · ' + (contact.phone || 'Sem telefone')}
          onClick={() => {
            const latest = client.getQueryState(queryKey);
            if (latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === results.data) onSelect(contact);
          }}
          className="block min-h-11 w-full min-w-0 rounded-md border p-3 text-left text-sm hover:bg-muted [overflow-wrap:anywhere]"
        >
          <span className="font-medium">{contact.name}</span>
          <span className="block text-xs text-muted-foreground">{contact.phone || 'Sem telefone'}</span>
        </button>
      ))}
      {search.trim().length < 2 && (
        <p className="text-xs text-muted-foreground">Digite ao menos dois caracteres para localizar o contato.</p>
      )}
      {fresh && results.data.items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhum contato encontrado. Cadastre um atendimento na recepção primeiro.
        </p>
      )}
      {fresh && results.data.nextCursor && (
        <p className="text-xs text-muted-foreground">Há outros resultados; refine a pesquisa.</p>
      )}
    </div>
  );
}
