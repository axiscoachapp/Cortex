import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { receptionApi } from './api';
import { useClinicAccess } from './accessContext';
import { ReceptionNotice } from './ReceptionNotice';
import type { ContactOption } from './NewCaseDialog';

export function ContactSearch({ onSelect }: { onSelect: (contact: ContactOption) => void }) {
  const access = useClinicAccess();
  const id = useId();
  const [search, setSearch] = useState('');
  const results = useQuery({
    queryKey: ['reception', access?.actorId, 'contact-picker', access?.clinic?.id, search],
    queryFn: () => receptionApi.contacts(access!.clinic!.id, search),
    enabled: !!access?.clinic && search.trim().length >= 2,
    retry: false,
  });
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Buscar contato por nome ou telefone</Label>
      <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={200} />
      <ReceptionNotice loading={results.isFetching} error={results.error} onRetry={() => void results.refetch()} />
      {results.data?.items.map((contact) => (
        <button
          key={contact.id}
          type="button"
          onClick={() => onSelect(contact)}
          className="block w-full border rounded-md p-3 text-left hover:bg-muted text-sm"
        >
          <span className="font-medium">{contact.name}</span>
          <span className="block text-xs text-muted-foreground">{contact.phone || 'Sem telefone'}</span>
        </button>
      ))}
      {search.trim().length < 2 && (
        <p className="text-xs text-muted-foreground">Digite ao menos dois caracteres para localizar o contato.</p>
      )}
      {results.data?.items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhum contato encontrado. Cadastre um atendimento na recepção primeiro.
        </p>
      )}
      {results.data?.nextCursor && (
        <p className="text-xs text-muted-foreground">Há outros resultados; refine a pesquisa.</p>
      )}
    </div>
  );
}
