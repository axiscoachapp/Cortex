import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dialogLayout } from './dialogLayout';
import { FormError } from './FormError';
import { delegationApi, type WithdrawalReview } from './delegationApi';
import { ReceptionNotice } from './ReceptionNotice';
import { useRequestId } from './useRequestId';

type Props = { actorId: string; clinicId: string; staffId: string; doctorId: string; requestId: string; doctorName: string; disabled: boolean; onRevoked: () => Promise<unknown> };
export function WithdrawDelegation(props: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [review, setReview] = useState<WithdrawalReview | null>(null), [error, setError] = useState<unknown>(null);
  const mounted = useRef(true), pending = useRef(false);
  const operation = useRequestId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function inspect() {
    if (pending.current || props.disabled) return;
    pending.current = true; setBusy(true); setOpen(true); setReview(null); setError(null);
    try {
      const current = await delegationApi.withdrawal(props.requestId);
      if (!mounted.current) return;
      if (current.id !== props.requestId || current.clinicId !== props.clinicId || current.staffId !== props.staffId || current.doctorId !== props.doctorId)
        throw new Error('Os dados não correspondem ao acesso escolhido. Atualize a lista.');
      setReview(current);
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function revoke() {
    if (!review || pending.current || props.disabled) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await delegationApi.change({ requestId: review.id, revision: review.revision, action: 'revoke', operationId: operation({ actorId: props.actorId, requestId: review.id, revision: review.revision, action: 'revoke' }) });
      if (!mounted.current) return;
      if (result.id !== review.id || result.state !== 'revoked') throw new Error('Não foi possível confirmar a revogação. Atualize a lista e tente de novo.');
      operation.reset(); setOpen(false); setReview(null);
      await props.onRevoked();
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure);
      if (failure && typeof failure === 'object' && 'code' in failure && ['40001', '42501'].includes(String(failure.code))) {
        setOpen(false); setReview(null); await props.onRevoked();
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <>
    <Button size="sm" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={props.disabled || busy} onClick={() => void inspect()}>Revogar aprovação de {props.doctorName}</Button>
    {!open && <ReceptionNotice error={error} />}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className={`max-w-lg ${dialogLayout.content}`}>
        <DialogHeader className={dialogLayout.header}><DialogTitle>Revogar aprovação de {props.doctorName}?</DialogTitle><DialogDescription>Confira os dados antes de retirar este acesso. Os prontuários continuam privados.</DialogDescription></DialogHeader>
        <div className={dialogLayout.body}>
          {busy && !review && <ReceptionNotice loading />}
          {review && <dl className="space-y-2 break-words text-sm"><div><dt className="text-muted-foreground">Clínica</dt><dd>{review.clinicName}</dd></div><div><dt className="text-muted-foreground">Recepção</dt><dd>{review.staffName}</dd></div><div><dt className="text-muted-foreground">Médico</dt><dd>{review.doctorName}</dd></div></dl>}
          <p className="text-sm">A conta perderá este acesso à agenda e à fila. O histórico é mantido; um novo acesso precisa de outro pedido e da aprovação do médico.</p>
        </div>
        <div className={dialogLayout.footer}>
          <FormError error={error} />
          <div className={dialogLayout.actions}><Button variant="outline" className={dialogLayout.button} disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button className={dialogLayout.button} disabled={!review || busy || props.disabled} onClick={() => void revoke()}>Confirmar revogação</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
