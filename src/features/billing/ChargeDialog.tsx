// New charge, from an attended appointment or on its own (private or by health plan).
import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import {
  CONSULTATION_TYPES, billingCall, brl, moneyInput, parseMoney, today, type BillingState, type Charge, type GuideType, type Price,
} from './billingApi';
import { DIALOG_CLASS, Field } from './shared';

export interface ChargeSeed {
  appointmentId?: string;
  doctorId?: string;
  patientName?: string;
  serviceDate?: string;
  consultationType?: '1' | '2' | '3' | '4';
  payerId?: string | null;
  cardNumber?: string;
  cardValidUntil?: string | null;
}

const PARTICULAR = '__particular__';
const MANUAL = '__manual__';
const TABLES = [['22', '22 · TUSS procedimentos'], ['00', '00 · Tabela própria'], ['98', '98 · Pacotes'], ['18', '18 · Diárias e taxas'],
  ['19', '19 · Materiais'], ['20', '20 · Medicamentos'], ['90', '90 · Brasíndice/Simpro']] as const;

interface Form {
  patientName: string; doctorId: string; serviceDate: string; payerId: string; cardNumber: string; cardValidUntil: string; newborn: boolean;
  priceId: string; guideType: GuideType; tableCode: string; procedureCode: string; description: string; quantity: string; unitAmount: string;
  consultationType: '1' | '2' | '3' | '4'; authorizationNumber: string; authorizationPassword: string; authorizationDate: string;
  authorizationValidUntil: string; notes: string;
}

const blank = (seed: ChargeSeed | null, doctors: BillingState['doctors']): Form => ({
  patientName: seed?.patientName ?? '', doctorId: seed?.doctorId ?? (doctors.length === 1 ? doctors[0].id : ''), serviceDate: seed?.serviceDate ?? today(),
  payerId: seed?.payerId ?? PARTICULAR, cardNumber: seed?.cardNumber ?? '', cardValidUntil: seed?.cardValidUntil ?? '', newborn: false,
  priceId: MANUAL, guideType: 'consulta', tableCode: '22', procedureCode: '', description: '', quantity: '1', unitAmount: '',
  consultationType: seed?.consultationType ?? '1', authorizationNumber: '', authorizationPassword: '', authorizationDate: '', authorizationValidUntil: '', notes: '',
});

export function ChargeDialog({ open, onOpenChange, state, prices, seed, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; state: BillingState; prices: Price[]; seed: ChargeSeed | null; onSaved: (c: Charge) => void;
}) {
  const [form, setForm] = useState<Form>(() => blank(seed, state.doctors));
  const [initial, setInitial] = useState(form);
  const [wasOpen, setWasOpen] = useState(false);
  const [error, setError] = useState('');
  // Refreshing billing metadata must not replace a draft in the same opening.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { const next = blank(seed, state.doctors); setForm(next); setInitial(next); setError(''); }
  }
  const submitting = useRef(false);
  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setError(''); };
  const payer = form.payerId === PARTICULAR ? null : state.payers.find((p) => p.id === form.payerId) ?? null;
  const priceList = useMemo(() => prices.filter((p) => p.active && (p.payerId ?? PARTICULAR) === form.payerId), [prices, form.payerId]);
  const guideType: GuideType | 'particular' = payer ? form.guideType : 'particular';
  const unit = parseMoney(form.unitAmount);
  const quantity = Number(form.quantity);
  const total = Number.isFinite(unit) && Number.isInteger(quantity) ? Math.round(unit * quantity * 100) / 100 : NaN;

  // Changing the plan never keeps the previous plan's price: the same procedure code is looked up in the
  // new table, and without a match the value is cleared for the person to fill in.
  const changePayer = (payerId: string) => {
    const same = prices.find((x) => x.active && (x.payerId ?? PARTICULAR) === payerId && x.procedureCode === form.procedureCode && x.tableCode === form.tableCode);
    if (same) set({ payerId, priceId: same.id, description: same.description, guideType: same.guideType, unitAmount: moneyInput(same.amount),
      quantity: same.guideType === 'consulta' ? '1' : form.quantity });
    else set({ payerId, priceId: MANUAL, unitAmount: '' });
  };
  const pickPrice = (id: string) => {
    const p = prices.find((x) => x.id === id);
    if (!p) { set({ priceId: MANUAL }); return; }
    set({ priceId: id, tableCode: p.tableCode, procedureCode: p.procedureCode, description: p.description, guideType: p.guideType,
      unitAmount: moneyInput(p.amount), quantity: p.guideType === 'consulta' ? '1' : form.quantity });
  };

  const save = useMutation({
    mutationFn: () => billingCall<Charge>('createCharge', {
      ...(seed?.appointmentId ? { appointmentId: seed.appointmentId } : { doctorId: form.doctorId }),
      patientName: form.patientName.trim(), payerId: payer?.id ?? null, ...(payer ? {
        cardNumber: form.cardNumber.trim(), cardValidUntil: form.cardValidUntil || null, newborn: form.newborn, guideType: form.guideType,
      } : {}),
      tableCode: form.tableCode, procedureCode: form.procedureCode.trim(), description: form.description.trim(), quantity, unitAmount: unit,
      serviceDate: form.serviceDate, ...(guideType === 'consulta' ? { consultationType: form.consultationType } : {}),
      ...(guideType === 'sadt' ? {
        authorizationNumber: form.authorizationNumber.trim() || null, authorizationPassword: form.authorizationPassword.trim() || null,
        authorizationDate: form.authorizationDate || null, authorizationValidUntil: form.authorizationValidUntil || null,
      } : {}),
      notes: form.notes.trim(), saveCoverage: true,
    }),
    onSuccess: (c) => { onSaved(c); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
    onSettled: () => { submitting.current = false; },
  });
  const guard = useUnsavedChanges(open && (JSON.stringify(form) !== JSON.stringify(initial) || save.isPending),
    save.isPending ? 'Aguarde a confirmação da cobrança antes de sair.' : 'Há uma cobrança não salva. Sair e descartar o preenchimento?', { blocking: save.isPending });
  const changeOpen = (next: boolean) => { if (guard(next)) onOpenChange(next); };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (submitting.current) return;
    const problem = !form.patientName.trim() ? 'Informe o paciente.'
      : !seed?.appointmentId && !form.doctorId ? 'Escolha o médico.'
      : !form.serviceDate ? 'Informe a data do atendimento.'
      : payer && !form.cardNumber.trim() ? 'Informe o número da carteirinha.'
      : !form.procedureCode.trim() || form.description.trim().length < 2 ? 'Escolha um procedimento da tabela ou informe código e descrição.'
      : !Number.isFinite(unit) ? 'Informe o valor.'
      : !Number.isInteger(quantity) || quantity < 1 || quantity > 99 ? 'Quantidade de 1 a 99.'
      : guideType === 'consulta' && quantity !== 1 ? 'A guia de consulta tem um procedimento.'
      : guideType === 'sadt' && (form.authorizationNumber || form.authorizationPassword) && !form.authorizationDate ? 'Informe a data da autorização junto com a senha.'
      : '';
    if (problem) { setError(problem); return; }
    submitting.current = true;
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={`${DIALOG_CLASS} max-w-2xl`}>
        <DialogHeader>
          <DialogTitle>Nova cobrança</DialogTitle>
          <DialogDescription>{seed?.appointmentId ? 'Do atendimento da agenda. O convênio e a carteirinha ficam guardados para a próxima vez.' : 'Cobrança avulsa, sem agendamento.'}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-4">
          <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="charge-patient" label="Paciente">
              <Input id="charge-patient" value={form.patientName} maxLength={200} onChange={(e) => set({ patientName: e.target.value })} />
            </Field>
            <Field id="charge-doctor" label="Médico">
              <Select value={form.doctorId} onValueChange={(v) => set({ doctorId: v })} disabled={!!seed?.appointmentId}>
                <SelectTrigger id="charge-doctor" aria-label="Médico"><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{state.doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="charge-date" label="Data do atendimento">
              <Input id="charge-date" type="date" value={form.serviceDate} onChange={(e) => set({ serviceDate: e.target.value })} />
            </Field>
            <Field id="charge-payer" label="Convênio">
              <Select value={form.payerId} onValueChange={changePayer}>
                <SelectTrigger id="charge-payer" aria-label="Convênio"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PARTICULAR}>Particular</SelectItem>
                  {state.payers.filter((p) => p.active || p.id === form.payerId).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {payer && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field id="charge-card" label="Número da carteirinha">
                <Input id="charge-card" value={form.cardNumber} maxLength={30} inputMode="numeric" onChange={(e) => set({ cardNumber: e.target.value })} />
              </Field>
              <Field id="charge-card-valid" label="Validade">
                <Input id="charge-card-valid" type="date" value={form.cardValidUntil} onChange={(e) => set({ cardValidUntil: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch checked={form.newborn} onCheckedChange={(v) => set({ newborn: v })} aria-label="Atendimento de recém-nascido na carteirinha da mãe" />
                Recém-nascido atendido na carteirinha da mãe
              </label>
            </div>
          )}

          <Field id="charge-price" label="Procedimento" hint={priceList.length === 0 ? 'Sem preços cadastrados para esta opção. Solicite a tabela à equipe Cortex ou preencha o procedimento abaixo.' : undefined}>
            <Select value={form.priceId} onValueChange={pickPrice}>
              <SelectTrigger id="charge-price" aria-label="Procedimento da tabela de preços"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={MANUAL}>Outro procedimento (preencher)</SelectItem>
                {priceList.map((p) => <SelectItem key={p.id} value={p.id}>{p.procedureCode} · {p.description} · {brl(p.amount)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            {payer && (
              <Field id="charge-guide" label="Guia">
                <Select value={form.guideType} onValueChange={(v) => set({ guideType: v as GuideType, quantity: v === 'consulta' ? '1' : form.quantity })}>
                  <SelectTrigger id="charge-guide" aria-label="Tipo de guia"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="consulta">Consulta</SelectItem><SelectItem value="sadt">SP/SADT (exames e procedimentos)</SelectItem></SelectContent>
                </Select>
              </Field>
            )}
            <Field id="charge-table" label="Tabela">
              <Select value={form.tableCode} onValueChange={(v) => set({ tableCode: v })}>
                <SelectTrigger id="charge-table" aria-label="Tabela TUSS"><SelectValue /></SelectTrigger>
                <SelectContent>{TABLES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id="charge-code" label="Código">
              <Input id="charge-code" value={form.procedureCode} maxLength={10} inputMode="numeric" onChange={(e) => set({ procedureCode: e.target.value, priceId: MANUAL })} />
            </Field>
          </div>
          <Field id="charge-description" label="Descrição">
            <Input id="charge-description" value={form.description} maxLength={150} onChange={(e) => set({ description: e.target.value, priceId: MANUAL })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="charge-quantity" label="Quantidade">
              <Input id="charge-quantity" type="number" min={1} max={99} inputMode="numeric" value={form.quantity} disabled={guideType === 'consulta'}
                onChange={(e) => set({ quantity: e.target.value })} />
            </Field>
            <Field id="charge-unit" label="Valor unitário (R$)">
              <Input id="charge-unit" inputMode="decimal" value={form.unitAmount} onChange={(e) => set({ unitAmount: e.target.value })} placeholder="0,00" />
            </Field>
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-medium">Total</p>
              <p className="flex h-10 items-center text-lg font-semibold tabular-nums" aria-live="polite">{Number.isFinite(total) ? brl(total) : '—'}</p>
            </div>
          </div>

          {guideType === 'consulta' && (
            <Field id="charge-ctype" label="Tipo de consulta">
              <Select value={form.consultationType} onValueChange={(v) => set({ consultationType: v as Form['consultationType'] })}>
                <SelectTrigger id="charge-ctype" aria-label="Tipo de consulta"><SelectValue /></SelectTrigger>
                <SelectContent>{CONSULTATION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {guideType === 'sadt' && (
            <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Autorização do convênio</legend>
              <Field id="charge-auth-number" label="Número da guia na operadora">
                <Input id="charge-auth-number" value={form.authorizationNumber} maxLength={20} onChange={(e) => set({ authorizationNumber: e.target.value })} />
              </Field>
              <Field id="charge-auth-password" label="Senha">
                <Input id="charge-auth-password" value={form.authorizationPassword} maxLength={20} autoComplete="off" onChange={(e) => set({ authorizationPassword: e.target.value })} />
              </Field>
              <Field id="charge-auth-date" label="Data da autorização">
                <Input id="charge-auth-date" type="date" value={form.authorizationDate} onChange={(e) => set({ authorizationDate: e.target.value })} />
              </Field>
              <Field id="charge-auth-valid" label="Validade da senha">
                <Input id="charge-auth-valid" type="date" value={form.authorizationValidUntil} onChange={(e) => set({ authorizationValidUntil: e.target.value })} />
              </Field>
            </fieldset>
          )}
          <Field id="charge-notes" label="Observações">
            <Textarea id="charge-notes" rows={2} maxLength={500} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar cobrança</Button>
          </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
