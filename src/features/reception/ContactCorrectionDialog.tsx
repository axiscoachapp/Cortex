import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useToast } from '@/hooks/use-toast';
import { useClinicAccess } from './accessContext';
import { receptionApi } from './api';
import type { ContactEdit } from './contracts';
import { ReceptionNotice } from './ReceptionNotice';

export function ContactCorrectionDialog({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const access = useClinicAccess();
  const client = useQueryClient();
  const canClose = useRef(() => true);
  const [reloadCount, setReloadCount] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const snapshot = useQuery({
    queryKey: ['reception', access?.actorId, 'contact-edit', contactId],
    queryFn: () => receptionApi.contactEdit(contactId),
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && canClose.current()) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corrigir contato</DialogTitle>
          <DialogDescription>
            Atualize os dados da pessoa que entra em contato com a clínica. Um telefone pode ser compartilhado por uma
            família.
          </DialogDescription>
        </DialogHeader>
        <ReceptionNotice loading={snapshot.isPending} error={snapshot.error} onRetry={() => void snapshot.refetch()} />
        {snapshot.data && (
          <div hidden={snapshot.isError}>
            <CorrectionForm
              key={reloadCount}
              initial={snapshot.data}
              onClose={onClose}
              onReload={() => {
                if (recovering) return;
                setRecovering(true);
                void snapshot
                  .refetch()
                  .then((result) => {
                    if (!result.error) {
                      setReloadCount((value) => value + 1);
                      void client.invalidateQueries({
                        predicate: (query) =>
                          query.queryKey[0] === 'reception' &&
                          query.queryKey[1] === access?.actorId &&
                          query.queryKey[2] !== 'contact-edit',
                      });
                    }
                  })
                  .finally(() => setRecovering(false));
              }}
              recovering={recovering}
              closeCheck={canClose}
            />
          </div>
        )}
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
}: {
  initial: ContactEdit;
  onClose: () => void;
  onReload: () => void;
  closeCheck: React.MutableRefObject<() => boolean>;
  recovering: boolean;
}) {
  const [initial] = useState(loaded);
  const field = useId();
  const client = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [confirmed, setConfirmed] = useState(false);
  const dirty = name !== initial.name || phone !== initial.phone;
  const save = useMutation({
    mutationFn: () => receptionApi.updateContact(initial.id, initial.revision, name.trim(), phone),
    onSuccess: async () => {
      toast({ title: 'Contato corrigido' });
      onClose();
      await client.invalidateQueries({ queryKey: ['reception'] });
    },
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
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed && dirty && !busy) save.mutate();
      }}
    >
      <ReceptionNotice error={save.error} />
      <fieldset disabled={busy} className="space-y-4">
        <div>
          <Label htmlFor={field + 'name'}>Nome do contato</Label>
          <Input
            id={field + 'name'}
            required
            minLength={2}
            maxLength={200}
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
        <label className="flex items-start gap-2 text-xs">
          <input
            className="mt-1 accent-primary"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Conferi a identidade do contato e os novos dados.
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2 justify-end">
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-10 whitespace-normal text-left"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm('Substituir o preenchimento pelo cadastro atual do servidor?')) onReload();
          }}
        >
          {recovering ? 'Recuperando cadastro…' : 'Recuperar cadastro do servidor'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (close()) onClose();
          }}
        >
          Voltar
        </Button>
        <Button type="submit" disabled={!dirty || !confirmed || busy}>
          {save.isPending ? 'Salvando…' : 'Salvar correção'}
        </Button>
      </div>
    </form>
  );
}
