// "A faturar" (attended appointments without a charge) and "Cobranças" (charges of the month).
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dialogLayout } from '@/lib/dialogLayout';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import {
  CONSULTATION_TYPES, METHOD_LABELS, PAYMENT_METHODS, STATUS_LABELS, billingCall, billingKey, brl, dateBr, dateTimeBr, isStale, localDate, moneyInput, monthLabel,
  monthOffset, parseMoney, plural, procedureLabel, today,
  type BillingState, type Charge, type ChargeStatus, type PaymentMethod, type Price, type ToBillAnswer,
} from './billingApi';
import { ChargeDialog, type ChargeSeed } from './ChargeDialog';
import { DialogError, FINANCE_DIALOG, Field, QueryState, StatusBadge } from './shared';
import { seedFrom } from './billingLogic';

interface TabProps { scope: string[]; state: BillingState; range: { from: string; to: string }; prices: Price[] }

const doctorName = (state: BillingState, id: string) => state.doctors.find((d) => d.id === id)?.name ?? 'Médico';
const payerName = (state: BillingState, id: string | null) => (id ? state.payers.find((p) => p.id === id)?.name ?? 'Convênio' : 'Particular');

export function ToBillTab({ scope, state, range, prices, onGoToMonth }: TabProps & { onGoToMonth?: (offset: number) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: billingKey(scope, 'toBill', range.from, range.to),
    queryFn: () => billingCall<ToBillAnswer>('toBill', range),
    staleTime: 0, retry: false,
  });
  const [seed, setSeed] = useState<ChargeSeed | null>(null);
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  const earlier = q.data?.earlier ?? [];
  const earlierCount = earlier.reduce((a, m) => a + m.count, 0);
  const start = (s: ChargeSeed | null) => { setSeed(s); setOpen(true); };
  return (
    <section className="space-y-3" aria-label="Atendimentos a faturar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Consultas atendidas no mês que ainda não têm cobrança.</p>
        <Button size="sm" variant="outline" onClick={() => start(null)}><Plus className="mr-1.5 h-4 w-4" /> Nova cobrança avulsa</Button>
      </div>
      {earlierCount > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-[#F2B23E]/60 bg-[#F2B23E]/10 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
          <p className="font-medium">{plural(earlierCount, 'atendimento', 'atendimentos')} de meses anteriores sem cobrança</p>
          <div className="flex flex-wrap gap-2">
            {earlier.map((m) => (
              <Button key={m.month} size="sm" variant="outline" onClick={() => onGoToMonth?.(monthOffset(m.month))}
                aria-label={`Ver ${plural(m.count, 'atendimento', 'atendimentos')} sem cobrança de ${monthLabel(m.month)}`}>
                {monthLabel(m.month)} ({m.count})
              </Button>
            ))}
          </div>
        </div>
      )}
      <QueryState query={q} empty={!q.isLoading && !q.isError && items.length === 0
        ? (
          <div className="space-y-2 rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Nenhum atendimento a faturar neste mês.</p>
            <p>Aparecem aqui as consultas da agenda da clínica marcadas como realizadas ou com chegada registrada, ainda sem cobrança.
              Para cobrar algo que não está na agenda da clínica, use “Nova cobrança avulsa”.</p>
          </div>
        ) : undefined}>
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
                <Button size="sm" onClick={() => start(s)} aria-label={`Cobrar atendimento de ${i.patientName || 'paciente'}`}>Cobrar atendimento</Button>
              </li>
            );
          })}
        </ul>
      </QueryState>
      <ChargeDialog open={open} onOpenChange={setOpen} state={state} prices={prices} seed={seed}
        onSaved={(c) => {
          toast({ title: 'Cobrança registrada', description: c.payerId
            ? (state.role === 'admin' ? 'Próximo passo: incluir a guia em um lote, em Lotes.' : 'A administração inclui a guia no lote do convênio.')
            : 'Próximo passo: receber o pagamento, em Cobranças.' });
          void queryClient.invalidateQueries({ queryKey: billingKey(scope) });
        }} />
    </section>
  );
}

function PaymentDialog({ charge, onOpenChange, onPaid, onRefresh }: {
  charge: Charge | null; onOpenChange: (o: boolean) => void; onPaid: () => void; onRefresh: (id: string) => Promise<Charge | null>;
}) {
  const remaining = charge ? Math.round((charge.amount - charge.paidAmount) * 100) / 100 : 0;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<{ message: string; stale?: boolean }>({ message: '' });
  const [initial, setInitial] = useState({ amount: '', method: 'pix', date, notes: '' });
  const submitting = useRef(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (charge && shownFor !== charge.id) {
    setShownFor(charge.id);
    setAmount(moneyInput(remaining)); setMethod('pix'); setDate(today()); setNotes(''); setError({ message: '' });
    setInitial({ amount: moneyInput(remaining), method: 'pix', date: today(), notes: '' });
  }
  if (!charge && shownFor !== null) setShownFor(null);
  const pay = useMutation({
    mutationFn: (revision: number) => billingCall('pay', { chargeId: charge!.id, revision, amount: parseMoney(amount), method, receivedOn: date, notes: notes.trim() }),
    onSuccess: () => { onPaid(); onOpenChange(false); },
    onError: (e: Error) => setError({ message: e.message, stale: isStale(e) }),
    onSettled: () => { submitting.current = false; },
  });
  const [retrying, setRetrying] = useState(false);
  // Someone else changed the charge first: read it again and send what was typed with the new revision.
  const retry = async () => {
    if (!charge || submitting.current) return;
    setRetrying(true);
    try {
      const fresh = await onRefresh(charge.id);
      const left = fresh ? Math.round((fresh.amount - fresh.paidAmount) * 100) / 100 : 0;
      const n = parseMoney(amount);
      if (!fresh || (fresh.status !== 'open' && fresh.status !== 'partial')) { setError({ message: 'Esta cobrança não está mais em aberto. Feche e confira a lista.' }); return; }
      if (!(n > 0 && n <= left)) { setError({ message: `O saldo mudou: agora faltam ${brl(left)}. Ajuste o valor e registre de novo.` }); return; }
      submitting.current = true;
      pay.mutate(fresh.revision);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally { setRetrying(false); }
  };
  const dirty = amount !== initial.amount || method !== initial.method || date !== initial.date || notes !== initial.notes;
  const guard = useUnsavedChanges(!!charge && (dirty || pay.isPending),
    pay.isPending ? 'Aguarde a confirmação do pagamento antes de sair.' : 'Há um pagamento não registrado. Sair e descartar o preenchimento?', { blocking: pay.isPending });
  const changeOpen = (next: boolean) => { if (guard(next)) onOpenChange(next); };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (submitting.current || !charge) return;
    const n = parseMoney(amount);
    if (!Number.isFinite(n) || n <= 0 || n > remaining) { setError({ message: `Informe um valor de até ${brl(remaining)}.` }); return; }
    if (!date) { setError({ message: 'Informe a data.' }); return; }
    submitting.current = true;
    pay.mutate(charge.revision);
  };
  return (
    <Dialog open={!!charge} onOpenChange={changeOpen}>
      <DialogContent className={`max-w-2xl ${dialogLayout.content} ${FINANCE_DIALOG}`}>
        <DialogHeader className={dialogLayout.header}>
          <DialogTitle>Receber pagamento</DialogTitle>
          <DialogDescription>{charge ? `${charge.patientName} · ${charge.description} · falta ${brl(remaining)}` : ''}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className={dialogLayout.body}><fieldset disabled={pay.isPending} className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pay-amount" label="Valor (R$)"><Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError({ message: '' }); }} /></Field>
            <Field id="pay-method" label="Forma de pagamento">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="pay-method" aria-label="Forma de pagamento"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="pay-date" label="Recebido em"><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field id="pay-notes" label="Observação (opcional)"><Input id="pay-notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          </fieldset></div>
          <div className={dialogLayout.footer}>
            <DialogError message={error.message} stale={error.stale} onRetry={() => void retry()} retrying={retrying} />
            <div className={dialogLayout.actions}>
              <Button type="button" variant="outline" className={dialogLayout.button} disabled={pay.isPending} onClick={() => changeOpen(false)}>Cancelar</Button>
              <Button type="submit" className={dialogLayout.button} disabled={pay.isPending}>{pay.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registrar pagamento</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ALL = '__all__';

export function ChargesTab({ scope, state, range, prices }: TabProps) {
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
  const [editing, setEditing] = useState<Charge | null>(null);
  const [cancelling, setCancelling] = useState<Charge | null>(null);
  const [representing, setRepresenting] = useState<Charge | null>(null);
  const [writingOff, setWritingOff] = useState<{ charge: Charge; note: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: billingKey(scope) });
  /** The charge as the server has it now (after a stale refusal). */
  const fresh = async (id: string) => {
    void queryClient.invalidateQueries({ queryKey: billingKey(scope) });
    const r = await q.refetch();
    if (r.error) throw r.error;
    return r.data?.charges.find((c) => c.id === id) ?? null;
  };
  const staleToast = (title: string) => (e: Error) => {
    if (isStale(e)) { void refresh(); toast({ title, description: 'Outra pessoa alterou esta cobrança. A lista foi atualizada; confira e tente de novo.', variant: 'destructive' }); }
    else toast({ title, description: e.message, variant: 'destructive' });
  };
  const cancel = useMutation({
    mutationFn: (c: Charge) => billingCall('cancelCharge', { id: c.id, revision: c.revision }),
    onSuccess: () => { setCancelling(null); toast({ title: 'Cobrança cancelada' }); refresh(); },
    onError: (e: Error) => { setCancelling(null); staleToast('Não foi possível cancelar')(e); },
  });
  const represent = useMutation({
    mutationFn: (c: Charge) => billingCall('representCharge', { id: c.id, revision: c.revision }),
    onSuccess: () => { setRepresenting(null); toast({ title: 'Guia de volta para "Em aberto"', description: 'Próximo passo: incluí-la em um novo lote, em Lotes. O número da guia foi mantido.' }); refresh(); },
    onError: (e: Error) => { setRepresenting(null); staleToast('Não foi possível reapresentar')(e); },
  });
  const writeOff = useMutation({
    mutationFn: (v: { charge: Charge; note: string }) => billingCall('writeOffCharge', { id: v.charge.id, revision: v.charge.revision, note: v.note.trim() }),
    onSuccess: () => { setWritingOff(null); toast({ title: 'Baixa registrada', description: 'A glosa continua nos relatórios.' }); refresh(); },
    onError: (e: Error) => { setWritingOff(null); staleToast('Não foi possível dar baixa')(e); },
  });
  const canAct = state.role !== 'doctor';
  const admin = state.role === 'admin';
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
        <p className="text-sm text-muted-foreground sm:pb-2" aria-live="polite">{plural(charges.length, 'cobrança', 'cobranças')} · <span className="tabular-nums">{brl(total)}</span></p>
      </div>
      <QueryState query={q} empty={!q.isLoading && !q.isError && charges.length === 0
        ? <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhuma cobrança com estes filtros.</p> : undefined}>
        <ul className="divide-y rounded-xl border bg-white">
          {charges.map((c) => {
            const code = procedureLabel(c.tableCode, c.procedureCode);
            const editable = canAct && c.status === 'open' && c.paidAmount === 0;
            const denied = admin && c.status === 'denied' && !c.writtenOffAt && !!c.payerId;
            return (
              <li key={c.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_9rem] sm:items-center sm:gap-x-4 xl:grid-cols-[minmax(0,1fr)_8.5rem_9rem_minmax(7rem,auto)]">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.patientName}</p>
                  <p className="text-sm">
                    {dateBr(c.serviceDate)} · {c.description}{c.quantity > 1 ? ` × ${c.quantity}` : ''}
                    {code && <span className="text-muted-foreground"> · {code}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {payerName(state, c.payerId)}{c.guideNumber ? ` · guia ${c.guideNumber}` : ''} · {doctorName(state, c.doctorId)}
                  </p>
                  {c.deniedAmount > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      Glosa <span className="tabular-nums">{brl(c.deniedAmount)}</span>{c.denialCode ? ` · ${c.denialCode}` : ''}{c.denialNote ? ` ${c.denialNote}` : ''}
                      {c.writtenOffAt ? <span className="font-normal text-muted-foreground"> · baixa em {dateBr(localDate(c.writtenOffAt))}</span> : null}
                    </p>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-2 sm:block sm:text-right">
                  <p className="font-medium tabular-nums">{brl(c.amount)}</p>
                  {c.paidAmount > 0 && <p className="text-xs text-muted-foreground tabular-nums">pago {brl(c.paidAmount)}</p>}
                </div>
                <div><StatusBadge status={c.status} /></div>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-3 sm:justify-end xl:col-span-1">
                  {canAct && c.guideType === 'particular' && (c.status === 'open' || c.status === 'partial') && (
                    <Button size="sm" onClick={() => setPaying(c)} aria-label={`Receber pagamento de ${c.patientName}`}>Receber pagamento</Button>
                  )}
                  {editable && <Button size="sm" variant="outline" onClick={() => setEditing(c)} aria-label={`Corrigir cobrança de ${c.patientName}`}>Corrigir cobrança</Button>}
                  {editable && <Button size="sm" variant="ghost" onClick={() => setCancelling(c)} aria-label={`Cancelar cobrança de ${c.patientName}`}>Cancelar cobrança</Button>}
                  {denied && <Button size="sm" variant="outline" onClick={() => setRepresenting(c)} aria-label={`Reapresentar a guia ${c.guideNumber} de ${c.patientName}`}>Reapresentar</Button>}
                  {denied && <Button size="sm" variant="ghost" onClick={() => setWritingOff({ charge: c, note: '' })} aria-label={`Dar baixa na glosa da guia ${c.guideNumber} de ${c.patientName}`}>Dar baixa</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      </QueryState>
      <PaymentDialog charge={paying} onOpenChange={(o) => !o && setPaying(null)} onPaid={() => { toast({ title: 'Pagamento registrado' }); refresh(); }}
        onRefresh={async (id) => { const c = await fresh(id); if (c) setPaying(c); return c; }} />
      <ChargeDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} state={state} prices={prices} seed={null} editing={editing}
        onRefreshEditing={async () => { const c = editing ? await fresh(editing.id) : null; if (c) setEditing(c); return c; }}
        onSaved={() => { toast({ title: 'Cobrança corrigida' }); refresh(); }} />
      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar cobrança?</AlertDialogTitle>
            <AlertDialogDescription>{cancelling ? `${cancelling.patientName} · ${cancelling.description} · ${brl(cancelling.amount)}. O atendimento volta para "A faturar".` : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter cobrança</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (cancelling) cancel.mutate(cancelling); }} disabled={cancel.isPending}>Cancelar cobrança</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!representing} onOpenChange={(o) => !o && setRepresenting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reapresentar a guia {representing?.guideNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              {representing ? `${representing.patientName} · ${representing.description} · ${brl(representing.amount)}. ` : ''}
              Use quando o convênio aceita a guia de novo depois de corrigida. Ela volta para “Em aberto” com o mesmo número e entra no próximo lote. Se precisar, corrija a carteirinha ou o código antes de montar o lote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (representing) represent.mutate(representing); }} disabled={represent.isPending}>Reapresentar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!writingOff} onOpenChange={(o) => !o && setWritingOff(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dar baixa na glosa da guia {writingOff?.charge.guideNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              {writingOff ? `${writingOff.charge.patientName} · glosa de ${brl(writingOff.charge.deniedAmount)}. ` : ''}
              Use quando a clínica desiste de receber este valor. A guia sai da lista de pendências e a glosa continua nos relatórios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field id="write-off-note" label="Motivo (opcional)">
            <Input id="write-off-note" maxLength={300} value={writingOff?.note ?? ''} onChange={(e) => setWritingOff((v) => (v ? { ...v, note: e.target.value } : v))} />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (writingOff) writeOff.mutate(writingOff); }} disabled={writeOff.isPending}>Dar baixa</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
