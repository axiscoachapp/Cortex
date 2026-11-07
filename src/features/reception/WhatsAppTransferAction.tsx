import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { useClinicAccess } from './accessContext';
import { whatsappApi, type WhatsAppConversation } from './whatsappApi';
import { readWhatsAppAssignees, type WhatsAppAssignee, type WhatsAppAssigneePage } from './whatsappAssignees';

export type TransferActionProps = { actor: string; clinic: string; conversation: WhatsAppConversation; disabled?: boolean; busy?: boolean; onConfirm: (conversation: WhatsAppConversation, targetUserId: string) => void };
const control = 'h-auto min-h-11 max-w-full whitespace-normal';
function CancelTransfer() { return <DialogClose asChild><Button type="button" variant="outline" className={control}>Cancelar</Button></DialogClose>; }

export function WhatsAppTransferAction(props: TransferActionProps) {
  const access = useClinicAccess(), { user } = useAuth(), hidden = useSessionHidden();
  if (hidden || !access?.active || access.actorId !== props.actor || access.clinic?.id !== props.clinic || user?.id !== props.actor ||
    !(access.kind === 'reception' || (access.kind === 'clinical' && access.admin)) ||
    props.conversation.status !== 'open' || props.conversation.assignedTo !== props.actor || props.conversation.revision >= 2147483647) return null;
  // Retire the complete picker instead of retaining an invisible confirmation during another command.
  if (props.disabled) return <Button type="button" variant="outline" className={control} disabled>{props.busy ? 'Transferindo conversa…' : 'Transferir conversa'}</Button>;
  return <TransferDialog key={JSON.stringify([props.actor, props.clinic, access.kind, access.admin, props.conversation])} {...props} />;
}

function TransferDialog({ actor, clinic, conversation, onConfirm }: TransferActionProps) {
  const [open, setOpen] = useState(false), title = useRef<HTMLHeadingElement>(null);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" className={control}>Transferir conversa</Button></DialogTrigger>
    <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5 [&>button:last-child]:size-11 [&>button:last-child]:right-1 [&>button:last-child]:top-1 [&>button:last-child]:grid [&>button:last-child]:place-items-center"
      onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}>
      <DialogHeader className="min-w-0 text-left">
        <DialogTitle ref={title} tabIndex={-1} className="pr-8 outline-none">Transferir conversa</DialogTitle>
        <DialogDescription className="[overflow-wrap:anywhere]">Conversa com <strong>{conversation.profileName || 'Contato sem nome'}</strong>{conversation.waId ? ` · Número: ${conversation.waId}` : ''}. Escolha uma pessoa e confira antes de transferir.</DialogDescription>
      </DialogHeader>
      {open && <AssigneeRead actor={actor} clinic={clinic} onConfirm={target => { setOpen(false); onConfirm({ ...conversation }, target); }} />}
    </DialogContent>
  </Dialog>;
}

function AssigneeRead({ actor, clinic, onConfirm }: { actor: string; clinic: string; onConfirm: (id: string) => void }) {
  const [before, setBefore] = useState<string | null>(null), instance = useId();
  const mounted = useRef(false), version = useRef(0), submitted = useRef(false), client = useQueryClient();
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queryKey = ['reception', actor, clinic, 'whatsapp', 'assignees-choice', instance, before];
  const query = useQuery({
    queryKey, queryFn: async ({ signal }) => {
      const state = await whatsappApi.state(signal);
      if (signal.aborted || !state.serverReady || !state.connected || !state.canUseInbox) throw new Error('Catalogue unavailable');
      return { catalog: await readWhatsAppAssignees({ before, limit: 10 }, signal), version: ++version.current };
    }, retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const fresh = query.isSuccess && query.isFetchedAfterMount && query.fetchStatus === 'idle';
  const current = () => {
    const latest = client.getQueryState(queryKey);
    return mounted.current && !submitted.current && fresh && latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === query.data;
  };
  const selectable = (person: WhatsAppAssignee) => {
    const row = query.data?.catalog.items.find(item => item.userId === person.userId);
    return Boolean(current() && row && row.userId !== actor && !row.ambiguous && row.name === person.name && row.role === person.role);
  };
  const refresh = () => {
    if (!mounted.current || submitted.current || client.getQueryState(queryKey)?.fetchStatus !== 'idle') return;
    if (before !== null) setBefore(null); else void query.refetch();
  };
  return <div className="min-w-0 space-y-4">
    <Button type="button" variant="outline" className={control} disabled={query.fetchStatus !== 'idle' || query.isPending} onClick={refresh}>Atualizar atendentes</Button>
    {query.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão para consultar atendentes…</p>
      : query.fetchStatus !== 'idle' || query.isPending ? <p role="status" className="text-sm">Verificando conexão e consultando atendentes…</p>
      : query.isError ? <p role="alert" className="text-sm">Não foi possível consultar os atendentes. Use Atualizar atendentes para verificar o acesso e tentar novamente.</p> : null}
    {fresh ? <AssigneeChoice key={query.data.version} actor={actor} catalog={query.data.catalog} selectable={selectable} onConfirm={person => {
      if (!selectable(person)) return;
      submitted.current = true; onConfirm(person.userId);
    }} onPage={cursor => { if (current()) setBefore(cursor); }} before={before} /> : <DialogFooter><CancelTransfer /></DialogFooter>}
  </div>;
}

function AssigneeChoice({ actor, catalog, selectable, onConfirm, onPage, before }: {
  actor: string; catalog: WhatsAppAssigneePage; selectable: (person: WhatsAppAssignee) => boolean;
  onConfirm: (person: WhatsAppAssignee) => void; onPage: (cursor: string | null) => void; before: string | null;
}) {
  const [chosen, setChosen] = useState<WhatsAppAssignee | null>(null);
  if (chosen) return <div className="min-w-0 space-y-4">
    <p className="text-sm [overflow-wrap:anywhere]">Novo responsável: <strong>{chosen.name}</strong> · {chosen.role === 'admin' ? 'Administração' : 'Recepção'}</p>
    <p className="text-sm">A conversa continuará aberta. A fila e os vínculos serão mantidos. Confira a pessoa antes de confirmar.</p>
    <Button type="button" variant="outline" className={control} onClick={() => setChosen(null)}>Escolher outra pessoa</Button>
    <DialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:space-x-0">
      <CancelTransfer /><Button type="button" className={control} onClick={() => onConfirm(chosen)}>Confirmar transferência</Button>
    </DialogFooter>
  </div>;
  return <div className="min-w-0 space-y-4">
    <p className="text-xs text-muted-foreground">Até 10 atendentes por página. Nomes repetidos precisam de identificação pela administração; não podem ser escolhidos aqui.</p>
    {!catalog.items.length && <p role="status" className="text-sm">Nenhum atendente nesta página.</p>}
    <ul className="space-y-2">{catalog.items.map(person => <li key={person.userId}>
      <Button type="button" variant="outline" aria-label={`Selecionar ${person.name}`} disabled={person.userId === actor || person.ambiguous}
        className="h-auto min-h-11 w-full max-w-full flex-col items-start gap-1 whitespace-normal p-3 text-left [overflow-wrap:anywhere]"
        onClick={() => { if (selectable(person)) setChosen({ ...person }); }}>
        <span className="max-w-full">{person.name}</span><span className="text-xs font-normal">{person.role === 'admin' ? 'Administração' : 'Recepção'}</span>
        {person.userId === actor && <span className="text-xs font-normal">Responsável atual · você</span>}
        {person.ambiguous && <span className="text-xs font-normal">Nome repetido na equipe · escolha indisponível</span>}
      </Button>
    </li>)}</ul>
    <div className="flex flex-wrap gap-2">
      {before !== null && <Button type="button" variant="outline" className={control} onClick={() => onPage(null)}>Primeiros atendentes</Button>}
      {catalog.nextBefore && <Button type="button" variant="outline" className={control} onClick={() => onPage(catalog.nextBefore)}>Próximos atendentes</Button>}
    </div>
    <DialogFooter><CancelTransfer /></DialogFooter>
  </div>;
}
