import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useSessionHidden, useSessionPaused } from '@/contexts/SessionVisibility';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import type { ContactEdit } from './contracts';
import { ReceptionNotice } from './ReceptionNotice';
import { LoadErrorNotice } from '@/features/shared/StatusNotice';
import { ConfirmCheck } from './ConfirmCheck';
import { FormError } from './FormError';
import { dialogLayout } from './dialogLayout';

export function ContactCorrectionDialog({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const access = useClinicAccess();
  const { user } = useAuth();
  const hidden = useSessionHidden();
  const client = useQueryClient();
  const { toast } = useToast();
  const scope = user && access?.clinic && user.id === access.actorId
    ? [user.id, access.clinic.id, access.admin, access.kind].join(':') : null;
  const origin = useRef({ scope, actor: access?.actorId, clinic: access?.clinic?.id, contactId });
  const reader = useId();
  const [queryKey] = useState(() => ['reception', origin.current.actor, 'contact-edit', origin.current.clinic, origin.current.contactId, reader]);
  const mounted = useRef(false), current = useRef(false), invalidated = useRef(false), started = useRef(false);
  const operation = useRef<'save' | 'recover' | null>(null);
  const validContext = !!scope && scope === origin.current.scope && contactId === origin.current.contactId && !!access?.active && access.admin && !hidden;
  const blocked = invalidated.current || !validContext;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    if (!validContext) invalidated.current = true;
    current.current = !blocked;
  }, [validContext, blocked]);
  const mayContinue = () => mounted.current && current.current && !invalidated.current;
  const canClose = useRef(() => true);
  const [reloadCount, setReloadCount] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [reloadError, setReloadError] = useState<unknown>(null);
  const [baseline, setBaseline] = useState<ContactEdit | null>(null);
  const readVersion = useRef(0);
  const snapshot = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const contact = await receptionApi.contactEdit(origin.current.contactId, signal);
      if (contact.id !== origin.current.contactId) throw new Error('Não foi possível conferir o contato solicitado. Tente novamente.');
      return { contact, readVersion: ++readVersion.current };
    },
    enabled: !blocked,
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const readerReady = snapshot.isSuccess && snapshot.isFetchedAfterMount && snapshot.fetchStatus === 'idle' && snapshot.data.contact.id === origin.current.contactId;
  useLayoutEffect(() => {
    if (blocked) void client.cancelQueries({ queryKey, exact: true });
  }, [blocked, client, queryKey]);
  useLayoutEffect(() => {
    if (!blocked && !baseline && readerReady) setBaseline(snapshot.data.contact);
  }, [blocked, baseline, readerReady, snapshot.data]);
  const maySubmit = () => {
    const latest = client.getQueryState(queryKey);
    return mayContinue() && readerReady && latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === snapshot.data;
  };
  const invalidateRelated = async () => {
    if (!mayContinue()) return;
    await client.invalidateQueries({
      queryKey: ['reception', origin.current.actor],
      predicate: query => typeof query.queryKey[2] === 'string' && ['contacts', 'contact-picker', 'queue', 'calendar', 'contact-links'].includes(query.queryKey[2])
        && query.queryKey[3] === origin.current.clinic,
    });
  };
  const recover = async () => {
    if (operation.current || !maySubmit()) return;
    operation.current = 'recover';
    setRecovering(true); setReloadError(null);
    try {
      const result = await snapshot.refetch();
      if (!mayContinue() || !result.isSuccess || result.fetchStatus !== 'idle') return;
      await invalidateRelated();
      const latest = client.getQueryState(queryKey);
      if (mayContinue() && latest?.status === 'success' && latest.fetchStatus === 'idle' && latest.data === result.data) {
        setBaseline(result.data.contact);
        setReloadCount(value => value + 1);
      }
    } catch {
      if (mayContinue()) setReloadError(new Error('Não foi possível recuperar o cadastro. Tente novamente.'));
    } finally {
      operation.current = null;
      if (mayContinue()) setRecovering(false);
    }
  };
  if (blocked) return <Dialog open={!hidden} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
      <DialogHeader className={dialogLayout.header}><DialogTitle>Corrigir contato</DialogTitle><DialogDescription>Fechar esta janela descarta o preenchimento.</DialogDescription></DialogHeader>
      <div className={dialogLayout.body}>
        <p role="alert" className="text-sm">Esta correção foi interrompida. Feche a janela e confira o cadastro antes de abrir outra correção.</p>
        {started.current && <p className="text-sm">Uma solicitação enviada antes da mudança pode ter sido concluída.</p>}
      </div>
      <div className={dialogLayout.footer}><div className={dialogLayout.actions}>
        <Button type="button" variant="outline" className={dialogLayout.button} onClick={onClose}>Fechar janela</Button>
      </div></div>
    </DialogContent>
  </Dialog>;
  const status = snapshot.fetchStatus === 'paused' ? <p role="status" className="text-sm">Aguardando conexão de rede para conferir o cadastro…</p>
    : snapshot.isPending || snapshot.fetchStatus === 'fetching' ? <ReceptionNotice loading />
    : (reloadError || snapshot.isError) ? <LoadErrorNotice subject="o cadastro" onRetry={() => {
      if (mayContinue()) { setReloadError(null); void snapshot.refetch(); }
    }} /> : null;
  return (
    <Dialog
      open={!hidden}
      onOpenChange={(open) => {
        if (!open && canClose.current()) onClose();
      }}
    >
      <DialogContent className={`max-w-2xl ${dialogLayout.content}`}>
        <DialogHeader className={dialogLayout.header}>
          <DialogTitle>Corrigir contato</DialogTitle>
          <DialogDescription>
            Atualize os dados da pessoa que entra em contato com a clínica. Um telefone pode ser compartilhado por uma
            família.
          </DialogDescription>
        </DialogHeader>
        {baseline ? (
            <CorrectionForm
              key={reloadCount}
              initial={baseline}
              ready={readerReady && !reloadError}
              status={status}
              readVersion={snapshot.data?.readVersion ?? 0}
              onClose={onClose}
              onReload={() => void recover()}
              mayContinue={mayContinue}
              maySubmit={maySubmit}
              beginSave={() => {
                if (operation.current || !maySubmit()) return false;
                operation.current = 'save';
                return true;
              }}
              endSave={() => { if (operation.current === 'save') operation.current = null; }}
              onStart={() => { started.current = true; }}
              onSaved={async () => {
                if (!mayContinue()) return;
                await invalidateRelated();
                if (!mayContinue()) return;
                toast({ title: 'Contato corrigido' });
                onClose();
              }}
              recovering={recovering}
              closeCheck={canClose}
            />
        ) : <>
          <div className={dialogLayout.body}>{status}</div>
          <div className={dialogLayout.footer}><div className={dialogLayout.actions}>
            <Button type="button" variant="outline" className={dialogLayout.button} onClick={onClose}>Cancelar</Button>
          </div></div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

function CorrectionForm({
  initial: loaded,
  onClose,
  onReload,
  closeCheck,
  recovering,
  mayContinue,
  beginSave,
  endSave,
  onStart,
  onSaved,
  ready,
  status,
  maySubmit,
  readVersion,
}: {
  initial: ContactEdit;
  onClose: () => void;
  onReload: () => void;
  closeCheck: React.MutableRefObject<() => boolean>;
  recovering: boolean;
  mayContinue: () => boolean;
  beginSave: () => boolean;
  endSave: () => void;
  onStart: () => void;
  onSaved: () => Promise<void>;
  ready: boolean;
  /** Loading or failed-read notice of the dialog, shown at the top of the body. */
  status: React.ReactNode;
  maySubmit: () => boolean;
  readVersion: number;
}) {
  const [initial] = useState(loaded);
  // A paused re-verification keeps the typed correction; only saving waits.
  const paused = useSessionPaused();
  const field = useId();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [confirmed, setConfirmed] = useState(false);
  const dirty = name !== initial.name || phone !== initial.phone;
  const save = useMutation({
    mutationFn: (payload: { name: string; phone: string }) => {
      if (!maySubmit()) throw new Error('Correção interrompida. Confira o cadastro antes de continuar.');
      onStart();
      return receptionApi.updateContact(initial.id, initial.revision, payload.name, payload.phone);
    },
    onSuccess: onSaved,
    onSettled: endSave,
  });
  const busy = save.isPending || recovering;
  const guard = useUnsavedChanges(
    dirty || busy,
    save.isPending
      ? 'Aguarde a confirmação da correção antes de sair.'
      : recovering
        ? 'Aguarde a recuperação do cadastro antes de sair.'
        : 'Há uma correção de contato não salva. Deseja descartar o preenchimento?',
    { blocking: busy },
  );
  // The dialog's Escape/close button follows the same guard as route and reload exits.
  const close = () => !busy && guard(false);
  useLayoutEffect(() => {
    closeCheck.current = close;
    return () => {
      closeCheck.current = () => true;
    };
  });
  useLayoutEffect(() => { setConfirmed(false); }, [ready, readVersion]);
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && confirmed && dirty && !busy && !paused && mayContinue() && beginSave()) {
          save.mutate({ name: name.trim(), phone });
        }
      }}
    >
      <div className={dialogLayout.body}>
        {status}
        {recovering && !ready && <Button type="button" variant="ghost" disabled className="h-auto min-h-11 whitespace-normal px-2">Recarregando…</Button>}
        {ready && <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div>
            <Label htmlFor={field + 'name'}>Nome do contato</Label>
            <Input
              id={field + 'name'}
              required
              minLength={2}
              maxLength={200}
              className="h-11"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setConfirmed(false);
              }}
            />
          </div>
          <div>
            <Label htmlFor={field + 'phone'}>Telefone do contato</Label>
            <Input
              id={field + 'phone'}
              type="tel"
              maxLength={40}
              className="h-11"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setConfirmed(false);
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Informe DDD em um novo número brasileiro. Deixe vazio quando o telefone for desconhecido.
            </p>
          </div>
          {/* Kept on purpose: a wrong phone sends the clinic's messages to someone else. */}
          <ConfirmCheck id={field + 'confirm'} checked={confirmed} onChange={setConfirmed}>
            Conferi a identidade do contato e os novos dados.
          </ConfirmCheck>
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-h-11 whitespace-normal px-2"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('Descartar o que você digitou e recarregar o cadastro?')) onReload();
            }}
          >
            {recovering ? 'Recarregando…' : 'Descartar e recarregar'}
          </Button>
        </fieldset>}
      </div>
      <div className={dialogLayout.footer}>
        {ready && <FormError error={save.error} />}
        {paused && <p role="status" className="text-right text-xs text-muted-foreground">Verificando acesso… O preenchimento continua preservado.</p>}
        <div className={dialogLayout.actions}>
          <Button
            type="button"
            variant="outline"
            className={dialogLayout.button}
            disabled={busy}
            onClick={() => {
              if (close()) onClose();
            }}
          >
            Cancelar
          </Button>
          {ready && <Button type="submit" className={dialogLayout.button} disabled={!dirty || !confirmed || busy || paused}>
            {save.isPending ? 'Salvando…' : 'Salvar correção'}
          </Button>}
        </div>
      </div>
    </form>
  );
}
