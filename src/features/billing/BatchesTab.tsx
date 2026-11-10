// "Lotes": batches of plan guides (TISS XML), sending and the plan's statement (paid and denied).
import { useMemo, useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import {
  BATCH_STATUS_LABELS, GUIDE_LABELS, billingCall, billingKey, brl, dateBr, downloadBase64, moneyInput, parseMoney, today,
  type Batch, type BatchFile, type BillingState, type Charge, type GuideType,
} from './billingApi';
import { DIALOG_CLASS, Field, QueryState } from './shared';
import { settleProblems, type SettleLine } from './billingLogic';


function SettleDialog({ batch, onOpenChange, scope, onDone }: { batch: Batch | null; onOpenChange: (o: boolean) => void; scope: string[]; onDone: () => void }) {
  const q = useQuery({
    queryKey: billingKey(scope, 'batchCharges', batch?.id),
    queryFn: () => billingCall<{ charges: Charge[] }>('batchCharges', { batchId: batch!.id }),
    enabled: !!batch, staleTime: 0, retry: false,
  });
  const charges = useMemo(() => q.data?.charges ?? [], [q.data]);
  const [lines, setLines] = useState<Record<string, SettleLine>>({});
  const [date, setDate] = useState(today());
  const [errors, setErrors] = useState<string[]>([]);
  const line = (c: Charge): SettleLine => lines[c.id] ?? { paid: moneyInput(c.amount), code: '', note: '' };
  const setLine = (c: Charge, patch: Partial<SettleLine>) => { setLines((l) => ({ ...l, [c.id]: { ...line(c), ...patch } })); setErrors([]); };
  const settle = useMutation({
    mutationFn: () => billingCall('settle', {
      batchId: batch!.id, revision: batch!.revision, paymentDate: date,
      items: charges.map((c) => { const l = line(c); const paid = parseMoney(l.paid); return {
        chargeId: c.id, paid, ...(paid < c.amount ? { denialCode: l.code.trim(), denialNote: l.note.trim() || null } : {}) }; }),
    }),
    onSuccess: () => { onDone(); onOpenChange(false); setLines({}); },
    onError: (e: Error) => setErrors([e.message]),
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const filled = Object.fromEntries(charges.map((c) => [c.id, line(c)]));
    const problems = [...settleProblems(charges, filled), ...(date ? [] : ['Informe a data do pagamento.'])];
    setErrors(problems);
    if (!problems.length) settle.mutate();
  };
  const paidTotal = charges.reduce((a, c) => a + (parseMoney(line(c).paid) || 0), 0);
  return (
    <Dialog open={!!batch} onOpenChange={(o) => { if (!o) { setLines({}); setErrors([]); } onOpenChange(o); }}>
      <DialogContent className={`${DIALOG_CLASS} max-w-3xl`}>
        <DialogHeader>
          <DialogTitle>Lançar o retorno do convênio</DialogTitle>
          <DialogDescription>
            Lote {batch?.number}: informe quanto o convênio pagou em cada guia. Quando pagar menos, informe o código da glosa (tabela 38 da TUSS, no demonstrativo).
          </DialogDescription>
        </DialogHeader>
        <QueryState query={q}>
          <form noValidate onSubmit={submit} className="space-y-3">
            <ul className="divide-y rounded-lg border">
              {charges.map((c) => {
                const l = line(c);
                const short = parseMoney(l.paid) < c.amount;
                return (
                  <li key={c.id} className="space-y-2 p-3">
                    <p className="text-sm"><span className="font-medium">Guia {c.guideNumber}</span> · {c.patientName} · {c.description} · {brl(c.amount)}</p>
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
            {errors.length > 0 && (
              <ul role="alert" className="list-disc rounded-lg border border-destructive/40 bg-destructive/5 p-3 pl-7 text-sm text-destructive">
                {errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={settle.isPending || charges.length === 0}>{settle.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fechar o lote</Button>
            </DialogFooter>
          </form>
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

function SentDialog({ batch, onOpenChange, onDone }: { batch: Batch | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [date, setDate] = useState(today());
  const [protocol, setProtocol] = useState('');
  const [error, setError] = useState('');
  const sent = useMutation({
    mutationFn: () => billingCall('markSent', { batchId: batch!.id, revision: batch!.revision, sentAt: date, protocol: protocol.trim() || null }),
    onSuccess: () => { onDone(); onOpenChange(false); setProtocol(''); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={!!batch} onOpenChange={onOpenChange}>
      <DialogContent className={`${DIALOG_CLASS} max-w-2xl`}>
        <DialogHeader>
          <DialogTitle>Marcar o lote {batch?.number} como enviado</DialogTitle>
          <DialogDescription>Depois de subir o XML no portal do convênio. As guias passam a "Enviada".</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => { e.preventDefault(); if (!date) { setError('Informe a data.'); return; } sent.mutate(); }} className="space-y-3">
          <Field id="sent-date" label="Enviado em"><Input id="sent-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field id="sent-protocol" label="Protocolo do portal (opcional)"><Input id="sent-protocol" maxLength={40} value={protocol} onChange={(e) => setProtocol(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={sent.isPending}>{sent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Marcar como enviado</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BatchesTab({ scope, state }: { scope: string[]; state: BillingState }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activePayers = state.payers.filter((p) => p.active);
  const [payerId, setPayerId] = useState<string>(activePayers[0]?.id ?? '');
  const [guideType, setGuideType] = useState<GuideType>('consulta');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const open = useQuery({
    queryKey: billingKey(scope, 'openForBatch', payerId, guideType),
    queryFn: () => billingCall<{ charges: Charge[] }>('openForBatch', { payerId, guideType }),
    enabled: !!payerId, staleTime: 0, retry: false,
  });
  const batches = useQuery({ queryKey: billingKey(scope, 'batches'), queryFn: () => billingCall<{ batches: Batch[] }>('batches'), staleTime: 0, retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: billingKey(scope) });
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: 'destructive' });
  const create = useMutation({
    mutationFn: () => billingCall<{ number: number; guides: number }>('createBatch', { payerId, guideType, chargeIds: [...selected] }),
    onSuccess: (r) => { setSelected(new Set()); toast({ title: `Lote ${r.number} criado`, description: `${r.guides} guia(s). Baixe o XML e suba no portal do convênio.` }); refresh(); },
    onError: fail('Não foi possível criar o lote'),
  });
  const xml = useMutation({
    mutationFn: (b: Batch) => billingCall<BatchFile>('batchXml', { batchId: b.id }),
    onSuccess: (f) => { downloadBase64(f.fileName, f.contentType, f.base64); refresh(); },
    onError: fail('Não foi possível gerar o XML'),
  });
  const [undoing, setUndoing] = useState<Batch | null>(null);
  const undo = useMutation({
    mutationFn: (b: Batch) => billingCall('cancelBatch', { batchId: b.id, revision: b.revision }),
    onSuccess: () => { setUndoing(null); toast({ title: 'Lote desfeito', description: 'As guias voltaram para "Em aberto".' }); refresh(); },
    onError: fail('Não foi possível desfazer o lote'),
  });
  const [reopening, setReopening] = useState<Batch | null>(null);
  const reopen = useMutation({
    mutationFn: (b: Batch) => billingCall('reopenBatch', { batchId: b.id, revision: b.revision }),
    onSuccess: () => { setReopening(null); toast({ title: 'Retorno reaberto', description: 'Lance de novo o que o convênio pagou em cada guia.' }); refresh(); },
    onError: fail('Não foi possível reabrir o retorno'),
  });
  const [nfse, setNfse] = useState<{ batch: Batch; value: string } | null>(null);
  const saveNfse = useMutation({
    mutationFn: (v: { batch: Batch; value: string }) => billingCall('updateBatch', { batchId: v.batch.id, revision: v.batch.revision, nfseNumber: v.value.trim() }),
    onSuccess: () => { setNfse(null); toast({ title: 'Nota fiscal registrada no lote' }); refresh(); },
    onError: fail('Não foi possível salvar a nota fiscal'),
  });
  const [sending, setSending] = useState<Batch | null>(null);
  const [settling, setSettling] = useState<Batch | null>(null);
  const charges = open.data?.charges ?? [];
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on && n.size < 100) n.add(id); else n.delete(id); return n; });
  const payerName = (id: string) => state.payers.find((p) => p.id === id)?.name ?? 'Convênio';
  const selectedTotal = charges.filter((c) => selected.has(c.id)).reduce((a, c) => a + c.amount, 0);

  if (activePayers.length === 0) {
    return <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Cadastre os convênios em Cadastros para montar lotes.</p>;
  }
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Montar lote">
        <h2 className="font-semibold">Montar lote</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field id="batch-payer" label="Convênio">
            <Select value={payerId} onValueChange={(v) => { setPayerId(v); setSelected(new Set()); }}>
              <SelectTrigger id="batch-payer" aria-label="Convênio do lote"><SelectValue /></SelectTrigger>
              <SelectContent>{activePayers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id="batch-type" label="Tipo de guia">
            <Select value={guideType} onValueChange={(v) => { setGuideType(v as GuideType); setSelected(new Set()); }}>
              <SelectTrigger id="batch-type" aria-label="Tipo de guia do lote"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="consulta">Consulta</SelectItem><SelectItem value="sadt">SP/SADT</SelectItem></SelectContent>
            </Select>
          </Field>
        </div>
        <QueryState query={open} empty={!open.isLoading && !open.isError && charges.length === 0
          ? <p className="text-sm text-muted-foreground">Nenhuma guia em aberto deste convênio e tipo.</p> : undefined}>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox aria-label="Selecionar todas as guias" checked={charges.length > 0 && charges.slice(0, 100).every((c) => selected.has(c.id))}
                onCheckedChange={(on) => setSelected(on ? new Set(charges.slice(0, 100).map((c) => c.id)) : new Set())} />
              Selecionar todas {charges.length > 100 ? '(até 100 por lote)' : ''}
            </label>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {charges.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 p-2.5 text-sm">
                    <Checkbox aria-label={`Incluir ${c.patientName}, ${dateBr(c.serviceDate)}`} checked={selected.has(c.id)} onCheckedChange={(on) => toggle(c.id, on === true)} />
                    <span className="min-w-0 flex-1 truncate">{dateBr(c.serviceDate)} · {c.patientName} · {c.description}</span>
                    <span className="tabular-nums">{brl(c.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm" aria-live="polite">{selected.size} guia(s) · {brl(selectedTotal)}</p>
              <Button onClick={() => create.mutate()} disabled={selected.size === 0 || create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar lote
              </Button>
            </div>
          </div>
        </QueryState>
      </section>

      <section className="space-y-3" aria-label="Lotes">
        <h2 className="font-semibold">Lotes</h2>
        <QueryState query={batches} empty={!batches.isLoading && !batches.isError && (batches.data?.batches ?? []).length === 0
          ? <p className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground">Nenhum lote ainda.</p> : undefined}>
          <ul className="divide-y rounded-xl border bg-white">
            {(batches.data?.batches ?? []).map((b) => (
              <li key={b.id} className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center lg:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Lote {b.number} · {payerName(b.payerId)} · {GUIDE_LABELS[b.guideType]}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    Total {brl(b.totalAmount)}{b.status === 'closed' ? ` · pago ${brl(b.paidAmount)} · glosado ${brl(b.deniedAmount)}` : ''}
                    {b.sentAt ? ` · enviado em ${dateBr(b.sentAt)}` : ''}{b.protocol ? ` · protocolo ${b.protocol}` : ''}{b.nfseNumber ? ` · NFS-e ${b.nfseNumber}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={b.status === 'closed' ? 'secondary' : 'outline'}>{BATCH_STATUS_LABELS[b.status]}</Badge>
                  {(b.status === 'draft' || b.xmlHash) && (
                    <Button size="sm" variant="outline" onClick={() => xml.mutate(b)} disabled={xml.isPending} aria-label={`Baixar o XML do lote ${b.number}`}>
                      <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar XML
                    </Button>
                  )}
                  {b.status === 'draft' && b.xmlHash && <Button size="sm" onClick={() => setSending(b)} aria-label={`Marcar o lote ${b.number} como enviado`}>Marcar como enviado</Button>}
                  {b.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => setUndoing(b)} aria-label={`Desfazer o lote ${b.number}`}>Desfazer lote</Button>}
                  {b.status === 'sent' && <Button size="sm" onClick={() => setSettling(b)} aria-label={`Lançar o retorno do lote ${b.number}`}>Lançar retorno</Button>}
                  {b.status === 'closed' && <Button size="sm" variant="ghost" onClick={() => setReopening(b)} aria-label={`Corrigir o retorno do lote ${b.number}`}>Corrigir retorno</Button>}
                  {b.status !== 'draft' && (
                    <Button size="sm" variant="ghost" onClick={() => setNfse({ batch: b, value: b.nfseNumber ?? '' })} aria-label={`Nota fiscal do lote ${b.number}`}>
                      {b.nfseNumber ? 'NFS-e' : 'Registrar NFS-e'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </QueryState>
      </section>

      <SentDialog batch={sending} onOpenChange={(o) => !o && setSending(null)} onDone={() => { toast({ title: 'Lote marcado como enviado' }); refresh(); }} />
      <SettleDialog batch={settling} scope={scope} onOpenChange={(o) => !o && setSettling(null)} onDone={() => { toast({ title: 'Retorno lançado e lote fechado' }); refresh(); }} />
      <AlertDialog open={!!reopening} onOpenChange={(o) => !o && setReopening(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Corrigir o retorno do lote {reopening?.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os valores pagos e as glosas lançados são desfeitos e o recebimento do lote é estornado no caixa (fica registrado). Depois, lance o retorno de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (reopening) reopen.mutate(reopening); }} disabled={reopen.isPending}>Reabrir retorno</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!nfse} onOpenChange={(o) => !o && setNfse(null)}>
        <DialogContent className={`${DIALOG_CLASS} max-w-2xl`}>
          <DialogHeader>
            <DialogTitle>Nota fiscal do lote {nfse?.batch.number}</DialogTitle>
            <DialogDescription>Número da NFS-e emitida para este lote no Emissor Nacional. Deixe vazio para apagar.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (nfse) saveNfse.mutate(nfse); }} className="space-y-4">
            <Field id="nfse-number" label="Número da NFS-e">
              <Input id="nfse-number" value={nfse?.value ?? ''} maxLength={30} onChange={(e) => setNfse((v) => (v ? { ...v, value: e.target.value } : v))} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setNfse(null)}>Cancelar</Button>
              <Button type="submit" disabled={saveNfse.isPending}>{saveNfse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!undoing} onOpenChange={(o) => !o && setUndoing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer o lote {undoing?.number}?</AlertDialogTitle>
            <AlertDialogDescription>Use se o XML ainda não foi enviado ao convênio. As guias voltam para "Em aberto" e mantêm os números; o número deste lote não é usado de novo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (undoing) undo.mutate(undoing); }} disabled={undo.isPending}>Desfazer lote</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
