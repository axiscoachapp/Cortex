// "A faturar" (attended appointments without a charge) and "Cobranças" (charges of the month).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  CONSULTATION_TYPES, METHOD_LABELS, PAYMENT_METHODS, STATUS_LABELS, billingCall, billingKey, brl, dateBr, dateTimeBr, localDate, moneyInput, parseMoney, today,
  type BillingState, type Charge, type ChargeStatus, type PaymentMethod, type Price, type ToBillItem,
} from './billingApi';
import { ChargeDialog, type ChargeSeed } from './ChargeDialog';
import { DIALOG_CLASS, Field, QueryState, StatusBadge } from './shared';
import { seedFrom } from './billingLogic';

interface TabProps { scope: string[]; state: BillingState; range: { from: string; to: string }; prices: Price[] }


const doctorName = (state: BillingState, id: string) => state.doctors.find((d) => d.id === id)?.name ?? 'Médico';
const payerName = (state: BillingState, id: string | null) => (id ? state.payers.find((p) => p.id === id)?.name ?? 'Convênio' : 'Particular');

export function ToBillTab({ scope, state, range, prices }: TabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: billingKey(scope, 'toBill', range.from, range.to),
    queryFn: () => billingCall<{ items: ToBillItem[] }>('toBill', range),
    staleTime: 0, retry: false,
  });
  const [seed, setSeed] = useState<ChargeSeed | null>(null);
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  const start = (s: ChargeSeed | null) => { setSeed(s); setOpen(true); };
  return (
    <section className="space-y-3" aria-label="Atendimentos a faturar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Consultas atendidas no mês que ainda não têm cobrança.</p>
        <Button size="sm" variant="outline" onClick={() => start(null)}><Plus className="mr-1.5 h-4 w-4" /> Nova cobrança avulsa</Button>
      </div>
      <QueryState query={q} empty={!q.isLoading && !q.isError && items.length === 0
        ? <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhum atendimento a faturar neste mês.</p> : undefined}>
        <ul className="divide-y rounded-xl border bg-white">
          {items.map((i) => {
            const s = seedFrom(i, state);
            return (
              <li key={i.appointmentId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.patientName || 'Sem contato vinculado'}</p>
                  {i.attendance === 'checked_in' && (
                    <p className="text-xs font-medium text-[#8a5a00]">Só a chegada foi registrada; confira se a consulta aconteceu antes de cobrar.</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {dateTimeBr(i.start)} · {doctorName(state, i.doctorId)} · {CONSULTATION_TYPES.find((t) => t.value === i.consultationType)?.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.payerId ? `${payerName(state, s.payerId)} · carteirinha ${s.cardNumber || '—'}` : 'Particular ou convênio a definir'}</p>
                </div>
                <Button size="sm" onClick={() => start(s)} aria-label={`Cobrar o atendimento de ${i.patientName || 'paciente'}`}>Cobrar</Button>
              </li>
            );
          })}
        </ul>
      </QueryState>
      <ChargeDialog open={open} onOpenChange={setOpen} state={state} prices={prices} seed={seed}
        onSaved={() => {
          toast({ title: 'Cobrança registrada' });
          void queryClient.invalidateQueries({ queryKey: billingKey(scope) });
        }} />
    </section>
  );
}

function PaymentDialog({ charge, onOpenChange, onPaid }: { charge: Charge | null; onOpenChange: (o: boolean) => void; onPaid: () => void }) {
  const remaining = charge ? Math.round((charge.amount - charge.paidAmount) * 100) / 100 : 0;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (charge && shownFor !== charge.id) {
    setShownFor(charge.id);
    setAmount(moneyInput(remaining)); setMethod('pix'); setDate(today()); setNotes(''); setError('');
  }
  const pay = useMutation({
    mutationFn: () => billingCall('pay', { chargeId: charge!.id, revision: charge!.revision, amount: parseMoney(amount), method, receivedOn: date, notes: notes.trim() }),
    onSuccess: () => { onPaid(); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const n = parseMoney(amount);
    if (!Number.isFinite(n) || n <= 0 || n > remaining) { setError(`Informe um valor de até ${brl(remaining)}.`); return; }
    if (!date) { setError('Informe a data.'); return; }
    pay.mutate();
  };
  return (
    <Dialog open={!!charge} onOpenChange={(o) => { if (!o) setShownFor(null); onOpenChange(o); }}>
      <DialogContent className={`${DIALOG_CLASS} max-w-md`}>
        <DialogHeader>
          <DialogTitle>Receber pagamento</DialogTitle>
          <DialogDescription>{charge ? `${charge.patientName} · ${charge.description} · falta ${brl(remaining)}` : ''}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pay-amount" label="Valor (R$)"><Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} /></Field>
            <Field id="pay-method" label="Forma de pagamento">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="pay-method" aria-label="Forma de pagamento"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="pay-date" label="Recebido em"><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field id="pay-notes" label="Observação"><Input id="pay-notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={pay.isPending}>{pay.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registrar pagamento</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ALL = '__all__';

export function ChargesTab({ scope, state, range }: TabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<string>(ALL);
  const [payer, setPayer] = useState<string>(ALL);
  const q = useQuery({
    queryKey: billingKey(scope, 'charges', range.from, range.to, status, payer),
    queryFn: () => billingCall<{ charges: Charge[] }>('charges', { ...range, ...(status !== ALL ? { status } : {}), ...(payer !== ALL && payer !== 'particular' ? { payerId: payer } : {}) }),
    staleTime: 0, retry: false,
  });
  const charges = (q.data?.charges ?? []).filter((c) => payer !== 'particular' || c.payerId === null);
  const [paying, setPaying] = useState<Charge | null>(null);
  const [cancelling, setCancelling] = useState<Charge | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: billingKey(scope) });
  const cancel = useMutation({
    mutationFn: (c: Charge) => billingCall('cancelCharge', { id: c.id, revision: c.revision }),
    onSuccess: () => { setCancelling(null); toast({ title: 'Cobrança cancelada' }); refresh(); },
    onError: (e: Error) => toast({ title: 'Não foi possível cancelar', description: e.message, variant: 'destructive' }),
  });
  const canAct = state.role !== 'doctor';
  const total = charges.filter((c) => c.status !== 'cancelled').reduce((a, c) => a + c.amount, 0);
  return (
    <section className="space-y-3" aria-label="Cobranças do mês">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field id="charges-status" label="Situação">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="charges-status" aria-label="Filtrar por situação"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {(Object.keys(STATUS_LABELS) as ChargeStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field id="charges-payer" label="Convênio">
          <Select value={payer} onValueChange={setPayer}>
            <SelectTrigger id="charges-payer" aria-label="Filtrar por convênio"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              <SelectItem value="particular">Particular</SelectItem>
              {state.payers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-sm text-muted-foreground sm:pb-2" aria-live="polite">{charges.length} cobrança(s) · {brl(total)}</p>
      </div>
      <QueryState query={q} empty={!q.isLoading && !q.isError && charges.length === 0
        ? <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhuma cobrança com estes filtros.</p> : undefined}>
        <ul className="divide-y rounded-xl border bg-white">
          {charges.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.patientName}</p>
                <p className="text-sm text-muted-foreground">
                  {dateBr(c.serviceDate)} · {c.procedureCode} {c.description}{c.quantity > 1 ? ` × ${c.quantity}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {payerName(state, c.payerId)}{c.guideNumber ? ` · guia ${c.guideNumber}` : ''} · {doctorName(state, c.doctorId)}
                  {c.denialCode ? ` · glosa ${c.denialCode}${c.denialNote ? `: ${c.denialNote}` : ''}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-right">
                  <p className="font-medium tabular-nums">{brl(c.amount)}</p>
                  {c.paidAmount > 0 && <p className="text-xs text-muted-foreground tabular-nums">pago {brl(c.paidAmount)}</p>}
                </div>
                <StatusBadge status={c.status} />
                {canAct && c.guideType === 'particular' && (c.status === 'open' || c.status === 'partial') && (
                  <Button size="sm" onClick={() => setPaying(c)} aria-label={`Receber de ${c.patientName}`}>Receber</Button>
                )}
                {canAct && c.status === 'open' && c.paidAmount === 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(c)} aria-label={`Cancelar a cobrança de ${c.patientName}`}>Cancelar</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
      <PaymentDialog charge={paying} onOpenChange={(o) => !o && setPaying(null)} onPaid={() => { toast({ title: 'Pagamento registrado' }); refresh(); }} />
      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta cobrança?</AlertDialogTitle>
            <AlertDialogDescription>{cancelling ? `${cancelling.patientName} · ${cancelling.description} · ${brl(cancelling.amount)}. O atendimento volta para "A faturar".` : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (cancelling) cancel.mutate(cancelling); }} disabled={cancel.isPending}>Cancelar cobrança</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
