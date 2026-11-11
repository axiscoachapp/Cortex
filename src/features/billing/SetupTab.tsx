// Billing registrations are prepared by the Cortex team and only reviewed by the clinic here.
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SupportRequest } from '@/components/SupportRequest';
import { useClinicAccess } from '@/features/reception/accessContext';
import { GUIDE_LABELS, brl, councilLabel, procedureLabel, type BillingState, type Price } from './billingApi';
import { Field } from './shared';

const MISSING = 'Não informado';

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{children}</dd></div>;
}

export function SetupTab({ state, prices }: { scope: string[]; state: BillingState; prices: Price[] }) {
  const access = useClinicAccess();
  const [priceFilter, setPriceFilter] = useState('__all__');
  const payerName = (id: string | null) => id ? state.payers.find(p => p.id === id)?.name ?? 'Convênio' : 'Particular';
  const visiblePrices = prices.filter(p => priceFilter === '__all__' || (p.payerId ?? '__particular__') === priceFilter);
  const days = (n: number | null) => (n === null ? MISSING : `${n} dias`);
  const settings = state.settings;
  return <div className="space-y-6">
    <div className="rounded-xl border bg-muted/30 p-4">
      <SupportRequest subject="Cadastros do financeiro (dados da clínica, convênios, preços ou médicos)" clinicName={access?.clinic?.name}>
        A equipe Cortex prepara estes cadastros com a clínica. Confira os dados abaixo; para corrigir ou incluir algo, envie um pedido.
      </SupportRequest>
    </div>

    <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Dados da clínica para o faturamento">
      <h2 className="font-semibold">Dados da clínica</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Item label="Razão social" wide>{settings?.legalName || MISSING}</Item>
        <Item label="CNPJ">{settings?.cnpj || MISSING}</Item>
        <Item label="CNES">{settings && settings.cnes !== '9999999' ? settings.cnes : `${MISSING} (sem CNES)`}</Item>
        <Item label="Número da próxima guia"><span className="tabular-nums">{settings?.nextGuideNumber ?? 1}</span></Item>
      </dl>
    </section>

    <section className="space-y-3" aria-label="Convênios cadastrados">
      <h2 className="font-semibold">Convênios</h2>
      {state.payers.length === 0 ? <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">Nenhum convênio cadastrado.</p> : <ul className="divide-y rounded-xl border bg-white">
        {state.payers.map(p => <li key={p.id} className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-words font-medium">{p.name}</h3><Badge variant={p.active ? 'secondary' : 'outline'}>{p.active ? 'Ativo' : 'Inativo'}</Badge></div>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <Item label="Registro ANS">{p.ansRegistry || MISSING}</Item>
            <Item label="Código da clínica no convênio">{p.providerCode || MISSING}</Item>
            <Item label="Versão TISS">{p.tissVersion || MISSING}</Item>
            <Item label="Prazo de envio">{days(p.submissionDays)}</Item>
            <Item label="Prazo de pagamento">{days(p.paymentDays)}</Item>
            <Item label="Arquivo">{p.zipRequired ? 'XML compactado (ZIP)' : 'XML'}</Item>
          </dl>
          {p.notes && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{p.notes}</p>}
        </li>)}
      </ul>}
    </section>

    <section className="space-y-3" aria-label="Tabela de preços">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-semibold">Tabela de preços</h2>
        <Field id="setup-price-filter" label="Convênio da tabela">
          <Select value={priceFilter} onValueChange={setPriceFilter}>
            <SelectTrigger id="setup-price-filter" aria-label="Filtrar tabela de preços por convênio"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">Todos</SelectItem><SelectItem value="__particular__">Particular</SelectItem>{state.payers.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      {visiblePrices.length === 0 ? <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">Nenhum preço cadastrado para esta seleção.</p> : <ul className="divide-y rounded-xl border bg-white">
        {visiblePrices.map(p => {
          const code = procedureLabel(p.tableCode, p.procedureCode);
          return <li key={p.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_8.5rem_auto] sm:items-center sm:gap-4">
            <div className="min-w-0"><p className="break-words font-medium">{p.description}</p><p className="break-words text-xs text-muted-foreground">{payerName(p.payerId)}{code ? ` · ${code}` : ''} · {GUIDE_LABELS[p.guideType]}</p></div>
            <span className="font-medium tabular-nums sm:text-right">{brl(p.amount)}</span><Badge className="w-fit" variant={p.active ? 'secondary' : 'outline'}>{p.active ? 'Ativo' : 'Inativo'}</Badge>
          </li>;
        })}
      </ul>}
    </section>

    <section className="space-y-3" aria-label="Dados dos médicos para o faturamento">
      <h2 className="font-semibold">Dados dos médicos</h2>
      {state.doctors.length === 0 ? <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">Nenhum médico disponível.</p> : <ul className="divide-y rounded-xl border bg-white">
        {state.doctors.map(d => {
          const p = state.professionals.find(professional => professional.userId === d.id);
          return <li key={d.id} className="space-y-2 p-4 text-sm">
            <h3 className="break-words font-medium">{d.name}</h3>
            {p ? <dl className="grid gap-2 sm:grid-cols-3">
              <Item label="Nome na guia">{p.tissName || MISSING}</Item>
              <Item label="Registro">{!p.councilNumber && !p.cbo ? MISSING : `${p.councilNumber ? `${councilLabel(p.council, p.councilUf)} ${p.councilNumber}` : `Registro ${MISSING.toLowerCase()}`} · CBO ${p.cbo || MISSING.toLowerCase()}`}</Item>
              <Item label="Repasse">{p.sharePercent === null ? MISSING : `${p.sharePercent}% do recebido`}</Item>
            </dl> : <p className="text-muted-foreground">Dados de faturamento: {MISSING.toLowerCase()}. Sem eles, o XML dos lotes deste médico não é gerado.</p>}
          </li>;
        })}
      </ul>}
    </section>
  </div>;
}
