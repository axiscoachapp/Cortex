// "Caixa": money received in the month by method; for the admin, expenses and the balance.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import {
  EXPENSE_CATEGORIES, METHOD_LABELS, PAYMENT_METHODS, billingCall, billingKey, brl, dateBr, moneyInput, parseMoney, today,
  type BillingState, type Expense, type Payment, type PaymentMethod,
} from './billingApi';
import { DIALOG_CLASS, Field, QueryState, Stat } from './shared';

const NOT_PAID = '__open__';

function ExpenseDialog({ open, expense, onOpenChange, onSaved }: { open: boolean; expense: Expense | null; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const init = () => ({
    description: expense?.description ?? '', category: expense?.category ?? 'outros', amount: expense ? moneyInput(expense.amount) : '',
    dueOn: expense?.dueOn ?? today(), paidOn: expense?.paidOn ?? '', method: (expense?.method ?? NOT_PAID) as PaymentMethod | typeof NOT_PAID, notes: expense?.notes ?? '',
  });
  const [form, setForm] = useState(init);
  const [initial, setInitial] = useState(form);
  const submitting = useRef(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const k = open ? expense?.id ?? 'new' : null;
  if (k !== key) { const next = init(); setKey(k); setForm(next); setInitial(next); setError(''); }
  const set = (patch: Partial<ReturnType<typeof init>>) => { setForm((f) => ({ ...f, ...patch })); setError(''); };
  const save = useMutation({
    mutationFn: () => billingCall('saveExpense', {
      ...(expense ? { id: expense.id, revision: expense.revision } : {}), description: form.description.trim(), category: form.category,
      amount: parseMoney(form.amount), dueOn: form.dueOn, paidOn: form.method === NOT_PAID ? null : form.paidOn || today(),
      method: form.method === NOT_PAID ? null : form.method, notes: form.notes.trim(),
    }),
    onSuccess: () => { onSaved(); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
    onSettled: () => { submitting.current = false; },
  });
  const guard = useUnsavedChanges(open && (JSON.stringify(form) !== JSON.stringify(initial) || save.isPending),
    save.isPending ? 'Aguarde a confirmação da despesa antes de sair.' : 'Há uma despesa não salva. Sair e descartar o preenchimento?', { blocking: save.isPending });
  const changeOpen = (next: boolean) => { if (guard(next)) onOpenChange(next); };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (submitting.current) return;
    const n = parseMoney(form.amount);
    const problem = form.description.trim().length < 2 ? 'Descreva a despesa.' : !Number.isFinite(n) || n <= 0 ? 'Informe o valor.' : !form.dueOn ? 'Informe o vencimento.' : '';
    if (problem) { setError(problem); return; }
    submitting.current = true;
    save.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={`${DIALOG_CLASS} max-w-2xl`}>
        <DialogHeader>
          <DialogTitle>{expense ? 'Editar despesa' : 'Nova despesa'}</DialogTitle>
          <DialogDescription>Contas a pagar da clínica. Marque a forma de pagamento quando pagar.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-3">
          <fieldset disabled={save.isPending} className="min-w-0 space-y-3">
          <Field id="exp-description" label="Descrição"><Input id="exp-description" maxLength={150} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="exp-category" label="Categoria">
              <Select value={form.category} onValueChange={(v) => set({ category: v })}>
                <SelectTrigger id="exp-category" aria-label="Categoria"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(EXPENSE_CATEGORIES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="exp-amount" label="Valor (R$)"><Input id="exp-amount" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
            <Field id="exp-due" label="Vencimento"><Input id="exp-due" type="date" value={form.dueOn} onChange={(e) => set({ dueOn: e.target.value })} /></Field>
            <Field id="exp-method" label="Paga com">
              <Select value={form.method} onValueChange={(v) => set({ method: v as PaymentMethod, paidOn: v === NOT_PAID ? '' : form.paidOn || today() })}>
                <SelectTrigger id="exp-method" aria-label="Forma de pagamento da despesa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_PAID}>Ainda não paga</SelectItem>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {form.method !== NOT_PAID && (
              <Field id="exp-paid" label="Paga em"><Input id="exp-paid" type="date" value={form.paidOn} onChange={(e) => set({ paidOn: e.target.value })} /></Field>
            )}
          </div>
          <Field id="exp-notes" label="Observações"><Input id="exp-notes" maxLength={300} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
          </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CashTab({ scope, state, range }: { scope: string[]; state: BillingState; range: { from: string; to: string } }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: billingKey(scope, 'cash', range.from, range.to),
    queryFn: () => billingCall<{ payments: Payment[]; expenses: Expense[] }>('cash', range),
    staleTime: 0, retry: false,
  });
  const [editing, setEditing] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null });
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: billingKey(scope, 'cash') });
  const remove = useMutation({
    mutationFn: (e: Expense) => billingCall('deleteExpense', { id: e.id }),
    onSuccess: () => { setDeleting(null); toast({ title: 'Despesa excluída' }); void refresh(); },
    onError: (e: Error) => toast({ title: 'Não foi possível excluir', description: e.message, variant: 'destructive' }),
  });
  const reverse = useMutation({
    mutationFn: (p: Payment) => billingCall('cancelPayment', { paymentId: p.id }),
    onSuccess: () => {
      setReversing(null);
      toast({ title: 'Pagamento estornado', description: 'A cobrança voltou a ficar em aberto pelo valor estornado.' });
      void refresh();
      void queryClient.invalidateQueries({ queryKey: billingKey(scope, 'charges') });
    },
    onError: (e: Error) => toast({ title: 'Não foi possível estornar', description: e.message, variant: 'destructive' }),
  });
  const admin = state.role === 'admin';
  const payments = q.data?.payments ?? [];
  const expenses = q.data?.expenses ?? [];
  const received = payments.reduce((a, p) => a + p.amount, 0);
  // Paid expenses count by payment date and open ones by due date, both inside the month.
  const inMonth = (d: string | null) => !!d && d >= range.from && d <= range.to;
  const paidExpenses = expenses.filter((e) => inMonth(e.paidOn)).reduce((a, e) => a + e.amount, 0);
  const openExpenses = expenses.filter((e) => !e.paidOn && inMonth(e.dueOn)).reduce((a, e) => a + e.amount, 0);
  const byMethod = Object.entries(payments.reduce<Record<string, number>>((m, p) => ({ ...m, [p.method]: (m[p.method] ?? 0) + p.amount }), {}));

  return (
    <QueryState query={q}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Recebido no mês" value={brl(received)} tone="good" />
          {admin && <Stat label="Despesas pagas" value={brl(paidExpenses)} />}
          {admin && <Stat label="Saldo" value={brl(received - paidExpenses)} tone={received - paidExpenses < 0 ? 'bad' : 'good'} />}
          {admin && <Stat label="Despesas a pagar" value={brl(openExpenses)} />}
        </div>
        <section className="space-y-2" aria-label="Recebimentos por forma de pagamento">
          <h2 className="font-semibold">Recebimentos</h2>
          {byMethod.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {byMethod.map(([m, v]) => <Badge key={m} variant="secondary" className="tabular-nums">{METHOD_LABELS[m as PaymentMethod]}: {brl(v)}</Badge>)}
            </div>
          )}
          {payments.length === 0 ? <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhum recebimento neste mês.</p> : (
            <ul className="divide-y rounded-xl border bg-white">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="w-24 shrink-0 tabular-nums">{dateBr(p.receivedOn)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.batchId ? 'Pagamento de lote do convênio' : `${p.patientName ?? 'Particular'}${p.description ? ` · ${p.description}` : ''}`}{p.notes ? ` · ${p.notes}` : ''}
                  </span>
                  <span className="hidden sm:inline text-muted-foreground">{METHOD_LABELS[p.method]}</span>
                  <span className="font-medium tabular-nums">{brl(p.amount)}</span>
                  {admin && p.chargeId && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Estornar pagamento de ${brl(p.amount)} de ${p.patientName ?? 'paciente'}`}
                      onClick={() => setReversing(p)}>
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {admin && (
          <section className="space-y-2" aria-label="Despesas">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Despesas</h2>
              <Button size="sm" variant="outline" onClick={() => setEditing({ open: true, expense: null })}><Plus className="mr-1.5 h-4 w-4" /> Nova despesa</Button>
            </div>
            {expenses.length === 0 ? <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhuma despesa com vencimento ou pagamento neste mês.</p> : (
              <ul className="divide-y rounded-xl border bg-white">
                {expenses.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{e.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {EXPENSE_CATEGORIES[e.category] ?? e.category} · vence {dateBr(e.dueOn)}{e.paidOn ? ` · paga em ${dateBr(e.paidOn)} (${METHOD_LABELS[e.method!]})` : ''}
                      </p>
                    </div>
                    <span className="font-medium tabular-nums">{brl(e.amount)}</span>
                    <Badge variant={e.paidOn ? 'secondary' : 'outline'}>{e.paidOn ? 'Paga' : 'A pagar'}</Badge>
                    <Button size="icon" variant="ghost" aria-label={`Editar ${e.description}`} onClick={() => setEditing({ open: true, expense: e })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Excluir ${e.description}`} onClick={() => setDeleting(e)}><Trash2 className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <ExpenseDialog open={editing.open} expense={editing.expense} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))}
          onSaved={() => { toast({ title: 'Despesa salva' }); void refresh(); }} />
        <AlertDialog open={!!reversing} onOpenChange={(o) => !o && setReversing(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Estornar este pagamento?</AlertDialogTitle>
              <AlertDialogDescription>
                {reversing ? `${reversing.patientName ?? 'Particular'} · ${brl(reversing.amount)} em ${dateBr(reversing.receivedOn)}. O valor volta a ficar em aberto na cobrança; o registro do pagamento fica marcado como estornado.` : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); if (reversing) reverse.mutate(reversing); }} disabled={reverse.isPending}>
                {reverse.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Estornar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir esta despesa?</AlertDialogTitle>
              <AlertDialogDescription>{deleting ? `${deleting.description} · ${brl(deleting.amount)}. Não dá para desfazer.` : ''}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction onClick={(ev) => { ev.preventDefault(); if (deleting) remove.mutate(deleting); }} disabled={remove.isPending}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </QueryState>
  );
}
