// "Lotes": batches of plan guides (TISS XML), sending and the plan's statement (paid and denied).
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SupportRequest } from '@/components/SupportRequest';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import {
  BATCH_STATUS_LABELS, GUIDE_LABELS, billingCall, billingKey, brl, dateBr, dateTimeBr, downloadBase64, isStale, moneyInput, parseMoney, plural, today,
  type Batch, type BatchFile, type BillingState, type Charge, type GuideType,
} from './billingApi';
import { DIALOG_CLASS, DialogError, Field, QueryState } from './shared';
import { settleLinesFrom, settleProblems, type SettleLine } from './billingLogic';

type Refresh = (id: string) => Promise<Batch | null>;
const STALE_BATCH = 'Outra pessoa alterou este lote. A lista foi atualizada; confira e tente de novo.';

function SettleDialog({ batch, onOpenChange, scope, onDone, prefill, onRefresh }: {
  batch: Batch | null; onOpenChange: (o: boolean) => void; scope: string[]; onDone: () => void;
  /** Lines of a statement being corrected, as they were recorded before the reopen. */
  prefill?: Record<string, SettleLine> | null;
  onRefresh: Refresh;
}) {
  const q = useQuery({
    queryKey: billingKey(scope, 'batchCharges', batch?.id),
    queryFn: () => billingCall<{ charges: Charge[] }>('batchCharges', { batchId: batch!.id }),
    enabled: !!batch, staleTime: 0, retry: false,
  });
  const charges = useMemo(() => q.data?.charges ?? [], [q.data]);
  const [lines, setLines] = useState<Record<string, SettleLine>>({});
  const [date, setDate] = useState(today());
  const [initialDate, setInitialDate] = useState(date);
  const [errors, setErrors] = useState<string[]>([]);
  const [stale, setStale] = useState(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const submitting = useRef(false);
  const key = batch?.id ?? null;
  if (shownFor !== key) { const nextDate = today(); setShownFor(key); setLines({}); setErrors([]); setStale(false); setDate(nextDate); setInitialDate(nextDate); }
  const line = (c: Charge): SettleLine => lines[c.id] ?? prefill?.[c.id] ?? { paid: moneyInput(c.amount), code: '', note: '' };
  const setLine = (c: Charge, patch: Partial<SettleLine>) => { setLines((l) => ({ ...l, [c.id]: { ...line(c), ...patch } })); setErrors([]); setStale(false); };
  const settle = useMutation({
    mutationFn: (revision: number) => billingCall('settle', {
      batchId: batch!.id, revision, paymentDate: date,
      items: charges.map((c) => { const l = line(c); const paid = parseMoney(l.paid); return {
        chargeId: c.id, paid, ...(paid < c.amount ? { denialCode: l.code.trim(), denialNote: l.note.trim() || null } : {}) }; }),
    }),
    onSuccess: () => { onDone(); onOpenChange(false); setLines({}); },
    onError: (e: Error) => { setErrors([e.message]); setStale(isStale(e)); },
    onSettled: () => { submitting.current = false; },
  });
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (!batch || submitting.current) return;
    setRetrying(true);
    try {
      const fresh = await onRefresh(batch.id);
      if (!fresh || fresh.status !== 'sent') { setStale(false); setErrors(['Este lote não está mais esperando o retorno. Feche e confira a lista.']); return; }
      submitting.current = true;
      settle.mutate(fresh.revision);
    } catch (e) { setStale(false); setErrors([(e as Error).message]); } finally { setRetrying(false); }
  };
  // A prefilled correction is a draft by itself: closing would lose the recorded lines.
  const dirty = !!prefill || date !== initialDate || charges.some(c => { const l = line(c); return l.paid !== moneyInput(c.amount) || !!l.code || !!l.note; });
  const guard = useUnsavedChanges(!!batch && (dirty || settle.isPending),
    settle.isPending ? 'Aguarde a confirmação do retorno antes de sair.' : 'Há um retorno de convênio não salvo. Sair e descartar o preenchimento?', { blocking: settle.isPending });
  const changeOpen = (next: boolean) => { if (guard(next)) onOpenChange(next); };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (submitting.current || !batch || q.isFetching || q.isError || charges.length === 0) return;
    const filled = Object.fromEntries(charges.map((c) => [c.id, line(c)]));
    const problems = [...settleProblems(charges, filled), ...(date ? [] : ['Informe a data do pagamento.'])];
    setErrors(problems);
    setStale(false);
    if (!problems.length) { submitting.current = true; settle.mutate(batch.revision); }
  };
  const paidTotal = charges.reduce((a, c) => a + (parseMoney(line(c).paid) || 0), 0);
  return (
    <Dialog open={!!batch} onOpenChange={changeOpen}>
      <DialogContent className={`${DIALOG_CLASS} max-w-3xl`}>
        <DialogHeader>
          <DialogTitle>Lançar retorno</DialogTitle>
          <DialogDescription>
            Lote {batch?.number}: informe quanto o convênio pagou em cada guia. Quando pagar menos, informe o código da glosa (tabela 38 da TUSS, no demonstrativo).
            {prefill ? ' Os valores lançados antes foram mantidos: corrija só o que estiver errado.' : ''}
          </DialogDescription>
        </DialogHeader>
        <QueryState query={q}>
          <form noValidate onSubmit={submit} className="space-y-3">
            <fieldset disabled={settle.isPending} className="min-w-0 space-y-3">
            <ul className="divide-y rounded-lg border">
              {charges.map((c) => {
                const l = line(c);
                const short = parseMoney(l.paid) < c.amount;
                return (
                  <li key={c.id} className="space-y-2 p-3">
                    <p className="text-sm"><span className="font-medium">Guia {c.guideNumber}</span> · {c.patientName} · {c.description} · <span className="tabular-nums">{brl(c.amount)}</span></p>
                    <div className="grid gap-2 sm:grid-cols-[8rem_7rem_minmax(0,1fr)]">
                      <Field id={`settle-paid-${c.id}`} label="Pago (R$)">
                        <Input id={`settle-paid-${c.id}`} inputMode="decimal" value={l.paid} onChange={(e) => setLine(c, { paid: e.target.value })} />
                      </Field>
                      {short && (
                        <>
                          <Field id={`settle-code-${c.id}`} label="Código da glosa">
                            <Input id={`settle-code-${c.id}`} inputMode="numeric" maxLength={4} value={l.code} onChange={(e) => setLine(c, { code: e.target.value })} />
                          </Field>
                          <Field id={`settle-note-${c.id}`} label="Motivo (opcional)">
                            <Input id={`settle-note-${c.id}`} maxLength={300} value={l.note} onChange={(e) => setLine(c, { note: e.target.value })} />
                          </Field>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <Field id="settle-date" label="Data do pagamento"><Input id="settle-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <p className="text-sm sm:pb-2" aria-live="polite">Total pago: <strong className="tabular-nums">{brl(paidTotal)}</strong></p>
            </div>
            {stale ? <DialogError message={errors[0] ?? ''} stale onRetry={() => void retry()} retrying={retrying} /> : errors.length > 0 && (
              <ul role="alert" className="list-disc rounded-lg border border-destructive/40 bg-destructive/5 p-3 pl-7 text-sm text-destructive">
                {errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={settle.isPending || q.isFetching || charges.length === 0}>{settle.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar retorno e fechar lote</Button>
            </DialogFooter>
            </fieldset>
          </form>
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

function SentDialog({ batch, onOpenChange, onDone, onRefresh }: { batch: Batch | null; onOpenChange: (o: boolean) => void; onDone: () => void; onRefresh: Refresh }) {
  const [date, setDate] = useState(today());
  const [initialDate, setInitialDate] = useState(date);
  const [protocol, setProtocol] = useState('');
  const [error, setError] = useState<{ message: string; stale?: boolean }>({ message: '' });
  const [shownFor, setShownFor] = useState<string | null>(null);
  const submitting = useRef(false);
  const key = batch?.id ?? null;
  if (shownFor !== key) { const nextDate = today(); setShownFor(key); setDate(nextDate); setInitialDate(nextDate); setProtocol(''); setError({ message: '' }); }
  const sent = useMutation({
    mutationFn: (revision: number) => billingCall('markSent', { batchId: batch!.id, revision, sentAt: date, protocol: protocol.trim() || null }),
    onSuccess: () => { onDone(); onOpenChange(false); setProtocol(''); },
    onError: (e: Error) => setError({ message: e.message, stale: isStale(e) }),
    onSettled: () => { submitting.current = false; },
  });
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (!batch || submitting.current) return;
    setRetrying(true);
    try {
      const fresh = await onRefresh(batch.id);
      if (!fresh || fresh.status !== 'draft' || !fresh.xmlHash) { setError({ message: 'Este lote mudou: confira na lista se ele ainda precisa ser marcado como enviado.' }); return; }
      submitting.current = true;
      sent.mutate(fresh.revision);
    } catch (e) { setError({ message: (e as Error).message }); } finally { setRetrying(false); }
  };
  const guard = useUnsavedChanges(!!batch && (date !== initialDate || !!protocol || sent.isPending),
    sent.isPending ? 'Aguarde a confirmação do envio antes de sair.' : 'Há dados de envio não salvos. Sair e descartar o preenchimento?', { blocking: sent.isPending });
  const changeOpen = (next: boolean) => { if (guard(next)) onOpenChange(next); };
  return (
    <Dialog open={!!batch} onOpenChange={changeOpen}>
      <DialogContent className={`${DIALOG_CLASS} max-w-2xl`}>
        <DialogHeader>
          <DialogTitle>Marcar o lote {batch?.number} como enviado</DialogTitle>
          <DialogDescription>Depois de subir o XML no portal do convênio. As guias passam a "Enviada".</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => { e.preventDefault(); if (submitting.current || !batch) return; if (!date) { setError({ message: 'Informe a data.' }); return; } submitting.current = true; sent.mutate(batch.revision); }} className="space-y-3">
          <fieldset disabled={sent.isPending} className="min-w-0 space-y-3">
          <Field id="sent-date" label="Enviado em"><Input id="sent-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field id="sent-protocol" label="Protocolo do portal (opcional)"><Input id="sent-protocol" maxLength={40} value={protocol} onChange={(e) => setProtocol(e.target.value)} /></Field>
          <DialogError message={error.message} stale={error.stale} onRetry={() => void retry()} retrying={retrying} />
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={sent.isPending}>{sent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Marcar como enviado</Button>
          </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One confirmation with a short explanation of when to use the action. */
function Confirm({ open, title, children, action, pending, onCancel, onConfirm }: {
  open: boolean; title: string; children: React.ReactNode; action: string; pending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); onConfirm(); }} disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function BatchesTab({ scope, state }: { scope: string[]; state: BillingState }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activePayers = state.payers.filter((p) => p.active);
  const [payerId, setPayerId] = useState<string>(activePayers[0]?.id ?? '');
  const [guideType, setGuideType] = useState<GuideType>('consulta');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const creating = useRef(false);
  const open = useQuery({
    queryKey: billingKey(scope, 'openForBatch', payerId, guideType),
    queryFn: () => billingCall<{ charges: Charge[] }>('openForBatch', { payerId, guideType }),
    enabled: !!payerId, staleTime: 0, retry: false,
  });
  const batches = useQuery({ queryKey: billingKey(scope, 'batches'), queryFn: () => billingCall<{ batches: Batch[] }>('batches'), staleTime: 0, retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: billingKey(scope) });
  /** The batch as the server has it now (after a stale refusal). */
  const freshBatch = async (id: string) => {
    void refresh();
    const r = await batches.refetch();
    if (r.error) throw r.error;
    return r.data?.batches.find((b) => b.id === id) ?? null;
  };
  const fail = (title: string) => (e: Error) => {
    if (isStale(e)) { void refresh(); toast({ title, description: STALE_BATCH, variant: 'destructive' }); }
    else toast({ title, description: e.message, variant: 'destructive' });
  };
  const create = useMutation({
    mutationFn: () => billingCall<{ number: number; guides: number }>('createBatch', { payerId, guideType, chargeIds: [...selected] }),
    onSuccess: (r) => { setSelected(new Set()); toast({ title: `Lote ${r.number} criado`, description: `${plural(r.guides, 'guia', 'guias')}. Próximo passo: baixar o XML.` }); refresh(); },
    onError: fail('Não foi possível criar o lote'),
    onSettled: () => { creating.current = false; },
  });
  const guardSelection = useUnsavedChanges(selected.size > 0 || create.isPending,
    create.isPending ? 'Aguarde a criação do lote antes de sair.' : 'Há guias selecionadas para um lote. Sair e descartar a seleção?', { blocking: create.isPending });
  const xml = useMutation({
    mutationFn: (b: Batch) => billingCall<BatchFile>('batchXml', { batchId: b.id }),
    onSuccess: (f) => { downloadBase64(f.fileName, f.contentType, f.base64); refresh(); },
    onError: fail('Não foi possível gerar o XML'),
  });
  const [undoing, setUndoing] = useState<Batch | null>(null);
  const undo = useMutation({
    mutationFn: (b: Batch) => billingCall('cancelBatch', { batchId: b.id, revision: b.revision }),
    onSuccess: () => { setUndoing(null); toast({ title: 'Lote desfeito', description: 'As guias voltaram para "Em aberto".' }); refresh(); },
    onError: (e: Error) => { setUndoing(null); fail('Não foi possível desfazer o lote')(e); },
  });
  const [regenerating, setRegenerating] = useState<Batch | null>(null);
  const regenerate = useMutation({
    mutationFn: (b: Batch) => billingCall('clearBatchXml', { batchId: b.id, revision: b.revision }),
    onSuccess: () => { setRegenerating(null); toast({ title: 'Arquivo anterior descartado', description: 'Baixe o XML de novo: ele sai com os dados atuais das guias.' }); refresh(); },
    onError: (e: Error) => { setRegenerating(null); fail('Não foi possível gerar de novo')(e); },
  });
  const [unsending, setUnsending] = useState<Batch | null>(null);
  const unsend = useMutation({
    mutationFn: (b: Batch) => billingCall('unsendBatch', { batchId: b.id, revision: b.revision }),
    onSuccess: () => { setUnsending(null); toast({ title: 'Envio desfeito', description: 'O lote voltou para "Não enviado".' }); refresh(); },
    onError: (e: Error) => { setUnsending(null); fail('Não foi possível desfazer o envio')(e); },
  });
  const [reopening, setReopening] = useState<Batch | null>(null);
  const [correction, setCorrection] = useState<Record<string, SettleLine> | null>(null);
  // Reads the recorded lines first, so the statement dialog opens with them instead of zeros.
  const reopen = useMutation({
    mutationFn: async (b: Batch) => {
      const before = await billingCall<{ charges: Charge[] }>('batchCharges', { batchId: b.id });
      const r = await billingCall<{ status: 'sent'; revision: number }>('reopenBatch', { batchId: b.id, revision: b.revision });
      return { batch: { ...b, status: 'sent' as const, revision: r.revision, paidAmount: 0, deniedAmount: 0, paymentDate: null }, lines: settleLinesFrom(before.charges) };
    },
    onSuccess: ({ batch, lines }) => { setReopening(null); setCorrection(lines); setSettling(batch); refresh(); },
    onError: (e: Error) => { setReopening(null); fail('Não foi possível reabrir o retorno')(e); },
  });
  const [nfse, setNfse] = useState<{ batch: Batch; value: string } | null>(null);
  const [nfseError, setNfseError] = useState<{ message: string; stale?: boolean }>({ message: '' });
  const savingNfse = useRef(false);
  const saveNfse = useMutation({
    mutationFn: (v: { batch: Batch; value: string }) => billingCall('updateBatch', { batchId: v.batch.id, revision: v.batch.revision, nfseNumber: v.value.trim() }),
    onSuccess: () => { setNfse(null); toast({ title: 'Nota fiscal registrada no lote' }); refresh(); },
    onError: (e: Error) => setNfseError({ message: e.message, stale: isStale(e) }),
    onSettled: () => { savingNfse.current = false; },
  });
  const retryNfse = async () => {
    if (!nfse || savingNfse.current) return;
    const fresh = await freshBatch(nfse.batch.id).catch(() => null);
    if (!fresh) { setNfseError({ message: 'Não foi possível ler o lote de novo. Feche e confira a lista.' }); return; }
    const next = { batch: fresh, value: nfse.value };
    setNfse(next);
    savingNfse.current = true;
    saveNfse.mutate(next);
  };
  const guardNfse = useUnsavedChanges(!!nfse && (nfse.value !== (nfse.batch.nfseNumber ?? '') || saveNfse.isPending),
    saveNfse.isPending ? 'Aguarde a confirmação do número da nota antes de sair.' : 'O número da nota fiscal ainda não foi salvo. Sair e descartar o preenchimento?', { blocking: saveNfse.isPending });
  const changeNfseOpen = (next: boolean) => { if (!next && guardNfse(next)) setNfse(null); };
  const [sending, setSending] = useState<Batch | null>(null);
  const [settling, setSettling] = useState<Batch | null>(null);
  const charges = open.data?.charges ?? [];
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on && n.size < 100) n.add(id); else n.delete(id); return n; });
  const payerName = (id: string) => state.payers.find((p) => p.id === id)?.name ?? 'Convênio';
  const selectedTotal = charges.filter((c) => selected.has(c.id)).reduce((a, c) => a + c.amount, 0);
  const refreshInto = (set: (b: Batch) => void): Refresh => async (id) => { const b = await freshBatch(id); if (b) set(b); return b; };

  return (
    <div className="space-y-6">
      {activePayers.length === 0 ? (
        <section className="space-y-2 rounded-xl border bg-white p-4" aria-label="Montar lote">
          <h2 className="font-semibold">Montar lote</h2>
          <p className="text-sm">Nenhum convênio ativo: os lotes são montados depois que a equipe Cortex cadastrar os convênios da clínica.</p>
          <SupportRequest subject="Cadastro de convênios para faturamento" clinicName={null}>Para incluir um convênio, envie um pedido à equipe Cortex.</SupportRequest>
        </section>
      ) : (
      <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Montar lote">
        <h2 className="font-semibold">Montar lote</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="batch-payer" label="Convênio">
            <Select value={payerId} disabled={create.isPending} onValueChange={(v) => { if (v !== payerId && guardSelection(false)) { setPayerId(v); setSelected(new Set()); } }}>
              <SelectTrigger id="batch-payer" aria-label="Convênio do lote"><SelectValue /></SelectTrigger>
              <SelectContent>{activePayers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id="batch-type" label="Tipo de guia">
            <Select value={guideType} disabled={create.isPending} onValueChange={(v) => { if (v !== guideType && guardSelection(false)) { setGuideType(v as GuideType); setSelected(new Set()); } }}>
              <SelectTrigger id="batch-type" aria-label="Tipo de guia do lote"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="consulta">Consulta</SelectItem><SelectItem value="sadt">SP/SADT</SelectItem></SelectContent>
            </Select>
          </Field>
        </div>
        <QueryState query={open} empty={!open.isLoading && !open.isError && charges.length === 0
          ? <p className="text-sm text-muted-foreground">Nenhuma guia em aberto deste convênio e tipo.</p> : undefined}>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox disabled={create.isPending} aria-label="Selecionar todas as guias" checked={charges.length > 0 && charges.slice(0, 100).every((c) => selected.has(c.id))}
                onCheckedChange={(on) => setSelected(on ? new Set(charges.slice(0, 100).map((c) => c.id)) : new Set())} />
              Selecionar todas {charges.length > 100 ? '(até 100 por lote)' : ''}
            </label>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {charges.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 p-2.5 text-sm">
                    <Checkbox disabled={create.isPending} aria-label={`Incluir ${c.patientName}, ${dateBr(c.serviceDate)}`} checked={selected.has(c.id)} onCheckedChange={(on) => toggle(c.id, on === true)} />
                    <span className="min-w-0 flex-1 truncate">{dateBr(c.serviceDate)} · {c.patientName} · {c.description}</span>
                    <span className="w-28 shrink-0 text-right tabular-nums">{brl(c.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm" aria-live="polite">{plural(selected.size, 'guia', 'guias')} · <span className="tabular-nums">{brl(selectedTotal)}</span>
                {selected.size === 0 && <span className="text-muted-foreground"> · selecione ao menos uma guia</span>}</p>
              <Button onClick={() => { if (creating.current || selected.size === 0) return; creating.current = true; create.mutate(); }} disabled={selected.size === 0 || create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar lote
              </Button>
            </div>
          </div>
        </QueryState>
      </section>
      )}

      <section className="space-y-3" aria-label="Lotes">
        <h2 className="font-semibold">Lotes</h2>
        <QueryState query={batches} empty={!batches.isLoading && !batches.isError && (batches.data?.batches ?? []).length === 0
          ? <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhum lote ainda.</p> : undefined}>
          <ul className="divide-y rounded-xl border bg-white">
            {(batches.data?.batches ?? []).map((b) => (
              <li key={b.id} className="space-y-3 p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Lote {b.number} · {payerName(b.payerId)} · {GUIDE_LABELS[b.guideType]}</p>
                    <p className="text-sm text-muted-foreground">
                      Total <span className="tabular-nums">{brl(b.totalAmount)}</span>
                      {b.status === 'closed' && <> · pago <span className="tabular-nums">{brl(b.paidAmount)}</span> · glosado <span className={`tabular-nums ${b.deniedAmount > 0 ? 'text-destructive' : ''}`}>{brl(b.deniedAmount)}</span></>}
                      {b.sentAt ? ` · enviado em ${dateBr(b.sentAt)}` : ''}{b.protocol ? ` · protocolo ${b.protocol}` : ''}{b.nfseNumber ? ` · NFS-e ${b.nfseNumber}` : ''}
                    </p>
                    {b.xmlHash && b.generatedAt && (
                      <p className="text-xs text-muted-foreground">XML gerado em {dateTimeBr(b.generatedAt)}. Os próximos downloads trazem este mesmo arquivo.</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={b.status === 'closed' ? 'secondary' : 'outline'}>{BATCH_STATUS_LABELS[b.status]}</Badge>
                    {b.status !== 'draft' && b.xmlHash && (
                      <Button size="sm" variant="outline" onClick={() => xml.mutate(b)} disabled={xml.isPending} aria-label={`Baixar o XML do lote ${b.number}`}>
                        <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar XML
                      </Button>
                    )}
                    {b.status === 'sent' && <Button size="sm" onClick={() => { setCorrection(null); setSettling(b); }} aria-label={`Lançar o retorno do lote ${b.number}`}>Lançar retorno</Button>}
                    {b.status === 'sent' && !b.answered && <Button size="sm" variant="ghost" onClick={() => setUnsending(b)} aria-label={`Desfazer o envio do lote ${b.number}`}>Desfazer envio</Button>}
                    {b.status === 'closed' && <Button size="sm" variant="ghost" onClick={() => setReopening(b)} aria-label={`Corrigir o retorno do lote ${b.number}`}>Corrigir retorno</Button>}
                    {b.status !== 'draft' && (
                      <Button size="sm" variant="ghost" onClick={() => { setNfseError({ message: '' }); setNfse({ batch: b, value: b.nfseNumber ?? '' }); }} aria-label={`Nota fiscal do lote ${b.number}`}>
                        {b.nfseNumber ? 'NFS-e' : 'Registrar NFS-e'}
                      </Button>
                    )}
                  </div>
                </div>
                {b.status === 'draft' && (
                  <ol className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3" aria-label={`Etapas do envio do lote ${b.number}`}>
                    <li className="space-y-1.5">
                      <p className="font-medium">1. Baixar o XML</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant={b.xmlHash ? 'outline' : 'default'} onClick={() => xml.mutate(b)} disabled={xml.isPending} aria-label={`Baixar o XML do lote ${b.number}`}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar XML
                        </Button>
                        {b.xmlHash && <Button size="sm" variant="ghost" onClick={() => setRegenerating(b)} aria-label={`Gerar de novo o XML do lote ${b.number}`}>Gerar de novo</Button>}
                      </div>
                    </li>
                    <li className="space-y-1.5">
                      <p className="font-medium">2. Enviar no portal do convênio</p>
                      <p className="text-muted-foreground">Suba o arquivo baixado no site do convênio e anote o protocolo.</p>
                    </li>
                    <li className="space-y-1.5">
                      <p className="font-medium">3. Marcar como enviado</p>
                      <Button size="sm" variant={b.xmlHash ? 'default' : 'outline'} disabled={!b.xmlHash} onClick={() => setSending(b)} aria-label={`Marcar o lote ${b.number} como enviado`}
                        aria-describedby={b.xmlHash ? undefined : `batch-${b.id}-step3`}>Marcar como enviado</Button>
                      {!b.xmlHash && <p id={`batch-${b.id}-step3`} className="text-xs text-muted-foreground">Disponível depois de baixar o XML.</p>}
                    </li>
                    <li className="sm:col-span-3">
                      <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setUndoing(b)} aria-label={`Desfazer o lote ${b.number}`}>Desfazer lote</Button>
                    </li>
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </QueryState>
      </section>

      <SentDialog batch={sending} onOpenChange={(o) => !o && setSending(null)} onRefresh={refreshInto(setSending)}
        onDone={() => { toast({ title: 'Lote marcado como enviado', description: 'Próximo passo: quando o convênio pagar, lance o retorno.' }); refresh(); }} />
      <SettleDialog batch={settling} scope={scope} prefill={correction} onRefresh={refreshInto(setSettling)}
        onOpenChange={(o) => { if (!o) { setSettling(null); setCorrection(null); } }}
        onDone={() => { toast({ title: 'Retorno lançado e lote fechado' }); refresh(); }} />
      <Confirm open={!!reopening} title={`Corrigir o retorno do lote ${reopening?.number ?? ''}?`} action="Corrigir retorno" pending={reopen.isPending}
        onCancel={() => setReopening(null)} onConfirm={() => { if (reopening) reopen.mutate(reopening); }}>
        O retorno abre de novo com os valores e glosas já lançados, para você corrigir só o que estiver errado. O recebimento do lote é estornado no caixa (fica registrado) e volta quando você salvar.
      </Confirm>
      <Confirm open={!!regenerating} title={`Gerar de novo o XML do lote ${regenerating?.number ?? ''}?`} action="Gerar de novo" pending={regenerate.isPending}
        onCancel={() => setRegenerating(null)} onConfirm={() => { if (regenerating) regenerate.mutate(regenerating); }}>
        Use quando algum dado foi corrigido depois do download (carteirinha, código, dados do médico) e o arquivo ainda não foi enviado ao convênio. O arquivo anterior é descartado; descarte também a cópia baixada.
      </Confirm>
      <Confirm open={!!unsending} title={`Desfazer o envio do lote ${unsending?.number ?? ''}?`} action="Desfazer envio" pending={unsend.isPending}
        onCancel={() => setUnsending(null)} onConfirm={() => { if (unsending) unsend.mutate(unsending); }}>
        Use se o lote foi marcado como enviado por engano. Ele volta para “Não enviado”, as guias para “Em lote” e o arquivo gerado continua o mesmo.
      </Confirm>
      <Confirm open={!!undoing} title={`Desfazer o lote ${undoing?.number ?? ''}?`} action="Desfazer lote" pending={undo.isPending}
        onCancel={() => setUndoing(null)} onConfirm={() => { if (undoing) undo.mutate(undoing); }}>
        Use se o XML ainda não foi enviado ao convênio. As guias voltam para "Em aberto" e mantêm os números; o número deste lote não é usado de novo.
      </Confirm>
      <Dialog open={!!nfse} onOpenChange={changeNfseOpen}>
        <DialogContent className={`${DIALOG_CLASS} max-w-2xl`}>
          <DialogHeader>
            <DialogTitle>Nota fiscal do lote {nfse?.batch.number}</DialogTitle>
            <DialogDescription>Número da NFS-e emitida para este lote no Emissor Nacional. Deixe vazio para apagar.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (nfse && !savingNfse.current) { savingNfse.current = true; saveNfse.mutate(nfse); } }} className="space-y-4">
            <fieldset disabled={saveNfse.isPending} className="min-w-0 space-y-4">
            <Field id="nfse-number" label="Número da NFS-e">
              <Input id="nfse-number" value={nfse?.value ?? ''} maxLength={30} onChange={(e) => { setNfseError({ message: '' }); setNfse((v) => (v ? { ...v, value: e.target.value } : v)); }} />
            </Field>
            <DialogError message={nfseError.message} stale={nfseError.stale} onRetry={() => void retryNfse()} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeNfseOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saveNfse.isPending}>{saveNfse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
            </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
