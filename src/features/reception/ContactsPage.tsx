import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import { NewCaseDialog, type ContactOption } from './NewCaseDialog';
import { ReceptionNotice } from './ReceptionNotice';

export default function ContactsPage() {
  const access = useClinicAccess();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ContactOption>();
  const contacts = useInfiniteQuery({
    queryKey: ['reception', access?.actorId, 'contacts', access?.clinic?.id, search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => receptionApi.contacts(access!.clinic!.id, search, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!access?.clinic,
    retry: false,
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 justify-between items-start">
        <div>
          <h1 className="text-xl font-semibold">Contatos da recepção</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Cadastro administrativo. Os prontuários permanecem separados por médico.
          </p>
        </div>
        <Button
          className="gap-2"
          onClick={() => {
            setSelected(undefined);
            setCreating(true);
          }}
        >
          <Plus className="w-4 h-4" />
          Novo atendimento
        </Button>
      </div>
      <Input
        aria-label="Buscar contatos"
        placeholder="Nome ou telefone"
        maxLength={200}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xl"
      />
      <ReceptionNotice loading={contacts.isPending} error={contacts.error} onRetry={() => void contacts.refetch()} />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {contacts.data?.pages
          .flatMap((page) => page.items)
          .map((contact) => (
            <article key={contact.id} className="rounded-xl border bg-card p-4 space-y-2 min-w-0">
              <h2 className="font-medium break-words">{contact.name}</h2>
              <p className="text-sm text-muted-foreground break-words">{contact.phone || 'Sem telefone cadastrado'}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelected(contact);
                  setCreating(true);
                }}
              >
                Abrir atendimento
              </Button>
            </article>
          ))}
      </div>
      {contacts.data?.pages[0].items.length === 0 && (
        <p className="p-6 text-sm text-muted-foreground border rounded-xl">Nenhum contato encontrado neste filtro.</p>
      )}
      {contacts.hasNextPage && (
        <Button variant="outline" disabled={contacts.isFetchingNextPage} onClick={() => void contacts.fetchNextPage()}>
          Carregar mais contatos
        </Button>
      )}
      {creating && (
        <NewCaseDialog
          contact={selected}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate('/recepcao?case=' + id);
          }}
        />
      )}
    </div>
  );
}
