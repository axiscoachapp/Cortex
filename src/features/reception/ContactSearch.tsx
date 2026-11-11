import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { receptionApi } from './api';
import { useClinicAccess } from './accessContext';
import { phoneProblem } from './contactPhone';
import { NewContactFields } from './NewContactFields';
import { useRequestId } from './useRequestId';
import type { ContactOption } from './NewCaseDialog';

export function ContactSearch({ onSelect, allowCreate = false }: {
  onSelect: (contact: ContactOption) => void;
  // Offer "Cadastrar … como novo contato" when nothing matches (booking from the agenda).
  allowCreate?: boolean;
}) {
  const access = useClinicAccess();
  const { user } = useAuth();
  if (!access?.active || !access.clinic || user?.id !== access.actorId || !(access.admin || access.kind === 'reception')) {
    return <p role="alert" className="text-sm">Acesso à busca de contatos indisponível.</p>;
  }
  return <ContactSearchContents key={access.actorId + ':' + access.clinic.id} actor={access.actorId} clinic={access.clinic.id} onSelect={onSelect} allowCreate={allowCreate} />;
}

const looksLikePhone = (text: string) => /^[+0-9 ().-]+$/.test(text) && text.replace(/\D/g, '').length >= 4;

function ContactSearchContents({ actor, clinic, onSelect, allowCreate }: { actor: string; clinic: string; onSelect: (contact: ContactOption) => void; allowCreate: boolean }) {
  const client = useQueryClient();
  const id = useId();
  const [search, setSearch] = useState('');
  // Typing does not start a read per keystroke; results belong to the settled text only.
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const settled = term === search.trim();
  const enabled = term.length >= 2 && term.length <= 200;
  const queryKey = ['reception', actor, 'contact-picker', clinic, term];
  const results = useQuery({
    queryKey,
    queryFn: ({ signal }) => receptionApi.contacts(clinic, term, null, signal),
    enabled,
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = enabled && settled && results.isSuccess && results.isFetchedAfterMount && results.fetchStatus === 'idle';
  const [creating, setCreating] = useState(false);
  if (creating) return <CreateContact actor={actor} clinic={clinic} initial={search.trim()} onCreated={onSelect} onBack={() => setCreating(false)} />;
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>Buscar contato por nome ou telefone</Label>
      <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={200} className="h-11 min-w-0" autoComplete="off" />
      {enabled && settled && (results.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão de rede para buscar contatos…</p>
        : results.fetchStatus !== 'idle' || results.isPending ? <p role="status" className="text-sm">Buscando contatos…</p>
        : results.isError ? <div role="alert" className="space-y-2 text-sm"><p>Não foi possível buscar contatos. Verifique a conexão e tente novamente.</p><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => void results.refetch()}>Tentar buscar contatos</Button></div> : null)}
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
      {fresh && results.data.items.length === 0 && !allowCreate && (
        <p className="text-xs text-muted-foreground">
          Nenhum contato encontrado. Cadastre um atendimento na recepção primeiro.
        </p>
      )}
      {fresh && results.data.items.length === 0 && allowCreate && <p className="text-xs text-muted-foreground">Nenhum contato encontrado.</p>}
      {fresh && allowCreate && (
        <Button type="button" variant={results.data.items.length ? 'ghost' : 'outline'} className="h-auto min-h-11 w-full justify-start whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => setCreating(true)}>
          Cadastrar “{search.trim()}” como novo contato
        </Button>
      )}
      {fresh && results.data.nextCursor && (
        <p className="text-xs text-muted-foreground">Há outros resultados; refine a pesquisa.</p>
      )}
    </div>
  );
}

function CreateContact({ actor, clinic, initial, onCreated, onBack }: {
  actor: string; clinic: string; initial: string; onCreated: (contact: ContactOption) => void; onBack: () => void;
}) {
  const client = useQueryClient();
  const request = useRequestId();
  const phoneFirst = looksLikePhone(initial);
  const [name, setName] = useState(phoneFirst ? '' : initial);
  const [phone, setPhone] = useState(phoneFirst ? initial : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const invalid = name.trim().length < 2 || !!phoneProblem(phone);
  async function create() {
    if (pending.current || invalid) return;
    pending.current = true; setBusy(true); setError(null);
    const payload = { name: name.trim(), phone: phone.trim() };
    try {
      const id = await receptionApi.createContact(clinic, payload.name, payload.phone, request(payload));
      void client.invalidateQueries({ queryKey: ['reception', actor], predicate: query => query.queryKey[2] === 'contacts' || query.queryKey[2] === 'contact-picker' });
      if (mounted.current) onCreated({ id, ...payload });
    } catch (failure) {
      if (mounted.current) setError(failure);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Novo contato</legend>
      <NewContactFields actor={actor} clinic={clinic} name={name} phone={phone} onName={setName} onPhone={setPhone} onUseExisting={onCreated} />
      {!!error && <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : 'Não foi possível cadastrar o contato. Tente novamente.'}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onBack}>Voltar à busca</Button>
        {/* A button, not a submit: the surrounding booking form must not be sent. */}
        <Button type="button" className="min-h-11" disabled={invalid} onClick={() => void create()}>
          {busy ? 'Cadastrando…' : 'Cadastrar contato'}
        </Button>
      </div>
    </fieldset>
  );
}
