// "Cadastros" (admin): clinic billing data, health plans, price table and the doctors' TISS identity.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { UF_IBGE } from '../../../supabase/functions/_shared/billingHandlers';
import {
  GUIDE_LABELS, billingCall, billingKey, brl, moneyInput, parseMoney, type BillingState, type Doctor, type GuideType, type Payer, type Price, type Professional,
} from './billingApi';
import { DIALOG_CLASS, Field } from './shared';

const PARTICULAR = '__particular__';
const CBOS = [['225250', 'Ginecologista e obstetra'], ['225285', 'Urologista'], ['225125', 'Clínico geral'], ['225170', 'Generalista']] as const;
const OTHER_CBO = '__other__';

function useSave<T>(scope: string[], action: string, onDone: () => void, title: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => billingCall<T>(action, body),
    onSuccess: () => { setError(''); toast({ title }); void queryClient.invalidateQueries({ queryKey: billingKey(scope) }); onDone(); },
    onError: (e: Error) => setError(e.message),
  });
  return { ...m, error, setError };
}

function Footer({ pending, onCancel, label = 'Salvar' }: { pending: boolean; onCancel: () => void; label?: string }) {
  return (
    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
      <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
      <Button type="submit" disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{label}</Button>
    </DialogFooter>
  );
}

function ClinicData({ scope, state }: { scope: string[]; state: BillingState }) {
  const s = state.settings;
  const [form, setForm] = useState({ legalName: s?.legalName ?? '', cnpj: s?.cnpj ?? '', cnes: s?.cnes ?? '9999999' });
  const save = useSave(scope, 'saveSettings', () => {}, 'Dados da clínica salvos');
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Dados da clínica para o faturamento">
      <h2 className="font-semibold">Dados da clínica</h2>
      <form noValidate className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!/^[0-9]{7}$/.test(form.cnes)) { save.setError('O CNES tem 7 dígitos.'); return; }
        save.mutate({ revision: s?.revision ?? 0, legalName: form.legalName.trim(), cnpj: form.cnpj.trim() || null, cnes: form.cnes });
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="set-legal" label="Razão social" className="sm:col-span-3"><Input id="set-legal" maxLength={120} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></Field>
          <Field id="set-cnpj" label="CNPJ"><Input id="set-cnpj" inputMode="numeric" maxLength={18} value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} /></Field>
          <Field id="set-cnes" label="CNES" hint="Use 9999999 se a clínica não tiver.">
            <Input id="set-cnes" inputMode="numeric" maxLength={7} value={form.cnes} aria-describedby="set-cnes-hint" onChange={(e) => setForm({ ...form, cnes: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium">Próxima guia</p>
            <p className="flex h-10 items-center tabular-nums">{s?.nextGuideNumber ?? 1}</p>
          </div>
        </div>
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
        <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar dados</Button>
      </form>
    </section>
  );
}

function PayerDialog({ scope, payer, open, onOpenChange }: { scope: string[]; payer: Payer | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const init = () => ({
    name: payer?.name ?? '', ansRegistry: payer?.ansRegistry ?? '', providerCode: payer?.providerCode ?? '', tissVersion: payer?.tissVersion ?? '4.03.00',
    hashEncoding: payer?.hashEncoding ?? 'latin1', zipRequired: payer?.zipRequired ?? false, submissionDays: payer?.submissionDays?.toString() ?? '',
    paymentDays: payer?.paymentDays?.toString() ?? '', active: payer?.active ?? true, notes: payer?.notes ?? '',
  });
  const [form, setForm] = useState(init);
  const [key, setKey] = useState<string | null>(null);
  const k = open ? payer?.id ?? 'new' : null;
  const save = useSave(scope, 'savePayer', () => onOpenChange(false), 'Convênio salvo');
  if (k !== key) { setKey(k); setForm(init()); save.setError(''); }
  const set = (patch: Partial<ReturnType<typeof init>>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${DIALOG_CLASS} max-w-xl`}>
        <DialogHeader>
          <DialogTitle>{payer ? 'Editar convênio' : 'Novo convênio'}</DialogTitle>
          <DialogDescription>Os dados vêm do contrato ou do portal do convênio.</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const problem = form.name.trim().length < 2 ? 'Informe o nome.' : !/^[0-9]{6}$/.test(form.ansRegistry) ? 'O registro ANS tem 6 dígitos.'
            : !/^[0-9A-Za-z]{1,20}$/.test(form.providerCode) ? 'Informe o código do prestador na operadora (letras e números).' : '';
          if (problem) { save.setError(problem); return; }
          save.mutate({ ...(payer ? { id: payer.id, revision: payer.revision } : {}), name: form.name.trim(), ansRegistry: form.ansRegistry, providerCode: form.providerCode,
            tissVersion: form.tissVersion, hashEncoding: form.hashEncoding, zipRequired: form.zipRequired, submissionDays: form.submissionDays || null,
            paymentDays: form.paymentDays || null, active: form.active, notes: form.notes.trim() });
        }}>
          <Field id="payer-name" label="Nome"><Input id="payer-name" maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="payer-ans" label="Registro ANS"><Input id="payer-ans" inputMode="numeric" maxLength={6} value={form.ansRegistry} onChange={(e) => set({ ansRegistry: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="payer-code" label="Código do prestador na operadora"><Input id="payer-code" maxLength={20} value={form.providerCode} onChange={(e) => set({ providerCode: e.target.value.trim() })} /></Field>
            <Field id="payer-version" label="Versão TISS">
              <Select value={form.tissVersion} onValueChange={(v) => set({ tissVersion: v })}>
                <SelectTrigger id="payer-version" aria-label="Versão TISS"><SelectValue /></SelectTrigger>
                <SelectContent>{['4.03.00', '4.02.00', '4.01.00'].map((v) => <SelectItem key={v} value={v}>{v}{v === '4.03.00' ? ' (vigente)' : ''}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="payer-hash" label="Codificação do hash" hint="Mude só se o portal recusar o hash de lotes com acentos.">
              <Select value={form.hashEncoding} onValueChange={(v) => set({ hashEncoding: v as 'latin1' | 'utf8' })}>
                <SelectTrigger id="payer-hash" aria-label="Codificação do hash" aria-describedby="payer-hash-hint"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="latin1">ISO-8859-1 (padrão TISS)</SelectItem><SelectItem value="utf8">UTF-8</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field id="payer-submission" label="Prazo de envio (dias)"><Input id="payer-submission" type="number" min={1} max={365} value={form.submissionDays} onChange={(e) => set({ submissionDays: e.target.value })} /></Field>
            <Field id="payer-payment" label="Prazo de pagamento (dias)"><Input id="payer-payment" type="number" min={1} max={365} value={form.paymentDays} onChange={(e) => set({ paymentDays: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={form.zipRequired} onCheckedChange={(v) => set({ zipRequired: v })} aria-label="O portal exige o XML em .zip" /> O portal exige o XML em .zip</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={form.active} onCheckedChange={(v) => set({ active: v })} aria-label="Convênio ativo" /> Ativo</label>
          <Field id="payer-notes" label="Observações"><Textarea id="payer-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
          <Footer pending={save.isPending} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({ scope, state, price, open, onOpenChange }: { scope: string[]; state: BillingState; price: Price | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const init = () => ({
    payerId: price?.payerId ?? PARTICULAR, tableCode: price?.tableCode ?? '22', procedureCode: price?.procedureCode ?? '', description: price?.description ?? '',
    guideType: (price?.guideType ?? 'consulta') as GuideType, amount: price ? moneyInput(price.amount) : '', active: price?.active ?? true,
  });
  const [form, setForm] = useState(init);
  const [key, setKey] = useState<string | null>(null);
  const k = open ? price?.id ?? 'new' : null;
  const save = useSave(scope, 'savePrice', () => onOpenChange(false), 'Preço salvo');
  if (k !== key) { setKey(k); setForm(init()); save.setError(''); }
  const set = (patch: Partial<ReturnType<typeof init>>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${DIALOG_CLASS} max-w-xl`}>
        <DialogHeader>
          <DialogTitle>{price ? 'Editar preço' : 'Novo preço'}</DialogTitle>
          <DialogDescription>Valor de um procedimento (código TUSS) para um convênio ou para particular.</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const amount = parseMoney(form.amount);
          const problem = !/^[0-9A-Za-z]{1,10}$/.test(form.procedureCode) ? 'Informe o código do procedimento.' : form.description.trim().length < 2 ? 'Informe a descrição.'
            : !Number.isFinite(amount) ? 'Informe o valor.' : '';
          if (problem) { save.setError(problem); return; }
          save.mutate({ ...(price ? { id: price.id, revision: price.revision } : {}), payerId: form.payerId === PARTICULAR ? null : form.payerId, tableCode: form.tableCode,
            procedureCode: form.procedureCode, description: form.description.trim(), guideType: form.guideType, amount, active: form.active });
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="price-payer" label="Convênio">
              <Select value={form.payerId} onValueChange={(v) => set({ payerId: v })}>
                <SelectTrigger id="price-payer" aria-label="Convênio do preço"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PARTICULAR}>Particular</SelectItem>
                  {state.payers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field id="price-guide" label="Guia">
              <Select value={form.guideType} onValueChange={(v) => set({ guideType: v as GuideType })}>
                <SelectTrigger id="price-guide" aria-label="Tipo de guia do preço"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="consulta">Consulta</SelectItem><SelectItem value="sadt">SP/SADT</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field id="price-table" label="Tabela"><Input id="price-table" inputMode="numeric" maxLength={2} value={form.tableCode} onChange={(e) => set({ tableCode: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="price-code" label="Código TUSS"><Input id="price-code" inputMode="numeric" maxLength={10} value={form.procedureCode} onChange={(e) => set({ procedureCode: e.target.value.trim() })} /></Field>
          </div>
          <Field id="price-description" label="Descrição"><Input id="price-description" maxLength={150} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
            <Field id="price-amount" label="Valor (R$)"><Input id="price-amount" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
            <label className="flex h-10 items-center gap-2 text-sm"><Switch checked={form.active} onCheckedChange={(v) => set({ active: v })} aria-label="Preço ativo" /> Ativo</label>
          </div>
          {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
          <Footer pending={save.isPending} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProfessionalDialog({ scope, doctor, current, onOpenChange }: { scope: string[]; doctor: Doctor | null; current: Professional | null; onOpenChange: (o: boolean) => void }) {
  const init = () => ({
    tissName: current?.tissName ?? doctor?.name.toUpperCase() ?? '', council: current?.council ?? '06', councilNumber: current?.councilNumber ?? (doctor?.crm ?? '').replace(/\D/g, ''),
    councilUf: current?.councilUf ?? UF_IBGE[(doctor?.crmUf ?? 'PR').toUpperCase()] ?? '41', cbo: current?.cbo ?? '', sharePercent: current?.sharePercent?.toString() ?? '',
  });
  const [form, setForm] = useState(init);
  const [key, setKey] = useState<string | null>(null);
  const k = doctor?.id ?? null;
  const save = useSave(scope, 'saveProfessional', () => onOpenChange(false), 'Dados do médico salvos');
  if (k !== key) { setKey(k); setForm(init()); save.setError(''); }
  const set = (patch: Partial<ReturnType<typeof init>>) => setForm((f) => ({ ...f, ...patch }));
  const known = CBOS.some(([c]) => c === form.cbo);
  const [otherCbo, setOtherCbo] = useState(false);
  return (
    <Dialog open={!!doctor} onOpenChange={onOpenChange}>
      <DialogContent className={`${DIALOG_CLASS} max-w-2xl`}>
        <DialogHeader>
          <DialogTitle>Dados de faturamento de {doctor?.name}</DialogTitle>
          <DialogDescription>Vão em cada guia: nome, conselho, número, UF e CBO.</DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const problem = form.tissName.trim().length < 2 ? 'Informe o nome.' : !/^[0-9]{1,15}$/.test(form.councilNumber) ? 'Informe o número do CRM (só números).'
            : !/^[0-9]{6}$/.test(form.cbo) ? 'Informe o CBO (6 dígitos).' : '';
          if (problem) { save.setError(problem); return; }
          save.mutate({ userId: doctor!.id, ...(current ? { revision: current.revision } : {}), tissName: form.tissName.trim(), council: form.council,
            councilNumber: form.councilNumber, councilUf: form.councilUf, cbo: form.cbo, sharePercent: form.sharePercent.trim() === '' ? null : form.sharePercent.replace(',', '.') });
        }}>
          <Field id="pro-name" label="Nome na guia"><Input id="pro-name" maxLength={70} value={form.tissName} onChange={(e) => set({ tissName: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="pro-council" label="Conselho"><Input id="pro-council" inputMode="numeric" maxLength={2} value={form.council} onChange={(e) => set({ council: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="pro-number" label="Número (CRM)"><Input id="pro-number" inputMode="numeric" maxLength={15} value={form.councilNumber} onChange={(e) => set({ councilNumber: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="pro-uf" label="UF (código IBGE)">
              <Select value={form.councilUf} onValueChange={(v) => set({ councilUf: v })}>
                <SelectTrigger id="pro-uf" aria-label="UF do conselho"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(UF_IBGE).sort(([a], [b]) => a.localeCompare(b)).map(([uf, code]) => <SelectItem key={uf} value={code}>{uf} ({code})</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pro-cbo" label="CBO">
              <Select value={known && !otherCbo ? form.cbo : OTHER_CBO} onValueChange={(v) => { if (v === OTHER_CBO) { setOtherCbo(true); set({ cbo: '' }); } else { setOtherCbo(false); set({ cbo: v }); } }}>
                <SelectTrigger id="pro-cbo" aria-label="CBO"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>
                  {CBOS.map(([c, l]) => <SelectItem key={c} value={c}>{c} {l}</SelectItem>)}
                  <SelectItem value={OTHER_CBO}>Outro código</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {(!known || otherCbo) && (
              <Field id="pro-cbo-other" label="Código CBO"><Input id="pro-cbo-other" inputMode="numeric" maxLength={6} value={form.cbo} onChange={(e) => set({ cbo: e.target.value.replace(/\D/g, '') })} /></Field>
            )}
            <Field id="pro-share" label="Repasse (% do recebido)" hint="Opcional. Usado no relatório de repasse.">
              <Input id="pro-share" inputMode="decimal" maxLength={6} value={form.sharePercent} aria-describedby="pro-share-hint" onChange={(e) => set({ sharePercent: e.target.value })} />
            </Field>
          </div>
          {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
          <Footer pending={save.isPending} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SetupTab({ scope, state, prices }: { scope: string[]; state: BillingState; prices: Price[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [payer, setPayer] = useState<{ open: boolean; payer: Payer | null }>({ open: false, payer: null });
  const [price, setPrice] = useState<{ open: boolean; price: Price | null }>({ open: false, price: null });
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [priceFilter, setPriceFilter] = useState<string>('__all__');
  const removePrice = useMutation({
    mutationFn: (id: string) => billingCall('deletePrice', { id }),
    onSuccess: () => { toast({ title: 'Preço excluído' }); void queryClient.invalidateQueries({ queryKey: billingKey(scope) }); },
    onError: (e: Error) => toast({ title: 'Não foi possível excluir', description: e.message, variant: 'destructive' }),
  });
  const payerName = (id: string | null) => (id ? state.payers.find((p) => p.id === id)?.name ?? 'Convênio' : 'Particular');
  const shownPrices = prices.filter((p) => priceFilter === '__all__' || (p.payerId ?? PARTICULAR) === priceFilter);
  return (
    <div className="space-y-6">
      <ClinicData key={state.settings?.revision ?? 0} scope={scope} state={state} />

      <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Convênios">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Convênios</h2>
          <Button size="sm" variant="outline" onClick={() => setPayer({ open: true, payer: null })}><Plus className="mr-1.5 h-4 w-4" /> Convênio</Button>
        </div>
        {state.payers.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum convênio cadastrado.</p> : (
          <ul className="divide-y rounded-lg border">
            {state.payers.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">ANS {p.ansRegistry} · prestador {p.providerCode} · TISS {p.tissVersion}{p.zipRequired ? ' · .zip' : ''}</p>
                </div>
                {!p.active && <Badge variant="outline">Inativo</Badge>}
                <Button size="icon" variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => setPayer({ open: true, payer: p })}><Pencil className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Tabela de preços">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">Tabela de preços</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={priceFilter} onValueChange={setPriceFilter}>
              <SelectTrigger className="w-48" aria-label="Filtrar preços por convênio"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os convênios</SelectItem>
                <SelectItem value={PARTICULAR}>Particular</SelectItem>
                {state.payers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => setPrice({ open: true, price: null })}><Plus className="mr-1.5 h-4 w-4" /> Preço</Button>
          </div>
        </div>
        {shownPrices.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum preço cadastrado.</p> : (
          <ul className="divide-y rounded-lg border">
            {shownPrices.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.procedureCode} · {p.description}</p>
                  <p className="text-xs text-muted-foreground">{payerName(p.payerId)} · {GUIDE_LABELS[p.guideType]} · tabela {p.tableCode}{p.active ? '' : ' · inativo'}</p>
                </div>
                <span className="font-medium tabular-nums">{brl(p.amount)}</span>
                <Button size="icon" variant="ghost" aria-label={`Editar o preço ${p.procedureCode}`} onClick={() => setPrice({ open: true, price: p })}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Excluir o preço ${p.procedureCode}`} disabled={removePrice.isPending} onClick={() => removePrice.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Médicos no faturamento">
        <h2 className="font-semibold">Médicos</h2>
        <p className="text-sm text-muted-foreground">Sem estes dados o XML do lote não é gerado.</p>
        <ul className="divide-y rounded-lg border">
          {state.doctors.map((d) => {
            const p = state.professionals.find((x) => x.userId === d.id) ?? null;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{p ? `CRM ${p.councilNumber} · CBO ${p.cbo}${p.sharePercent !== null ? ` · repasse ${p.sharePercent}%` : ''}` : 'Dados de faturamento pendentes'}</p>
                </div>
                {!p && <Badge className="bg-[#F2B23E]/20 text-[#0E2A33] hover:bg-[#F2B23E]/20">Pendente</Badge>}
                <Button size="sm" variant="outline" onClick={() => setDoctor(d)} aria-label={`Editar os dados de faturamento de ${d.name}`}>{p ? 'Editar' : 'Preencher'}</Button>
              </li>
            );
          })}
        </ul>
      </section>

      <PayerDialog scope={scope} payer={payer.payer} open={payer.open} onOpenChange={(o) => setPayer((s) => ({ ...s, open: o }))} />
      <PriceDialog scope={scope} state={state} price={price.price} open={price.open} onOpenChange={(o) => setPrice((s) => ({ ...s, open: o }))} />
      <ProfessionalDialog scope={scope} doctor={doctor} current={doctor ? state.professionals.find((x) => x.userId === doctor.id) ?? null : null}
        onOpenChange={(o) => !o && setDoctor(null)} />
    </div>
  );
}
