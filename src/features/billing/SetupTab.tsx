// Billing registrations are prepared by Cortex and reviewed by the clinic.
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GUIDE_LABELS, brl, type BillingState, type Price } from './billingApi';
import { Field } from './shared';

export function SetupTab({ state, prices }: { scope: string[]; state: BillingState; prices: Price[] }) {
  const [priceFilter, setPriceFilter] = useState('__all__');
  const payerName = (id: string | null) => id ? state.payers.find(p => p.id === id)?.name ?? 'Convênio' : 'Particular';
  const visiblePrices = prices.filter(p => priceFilter === '__all__' || (p.payerId ?? '__particular__') === priceFilter);
  return <div className="space-y-6">
    <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">
      A equipe Cortex prepara os dados de faturamento, os convênios e as tabelas de preços com o responsável da clínica.
      Confira os dados abaixo e solicite correções à equipe de implantação. Cobranças, pagamentos e despesas continuam nas seções de rotina.
    </div>

    <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Dados da clínica para o faturamento">
      <h2 className="font-semibold">Dados da clínica</h2>
      {state.settings ? <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-muted-foreground">Razão social</dt><dd className="break-words">{state.settings.legalName || 'Não informada'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">CNPJ</dt><dd>{state.settings.cnpj || 'Não informado'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">CNES</dt><dd>{state.settings.cnes}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Próxima guia</dt><dd className="tabular-nums">{state.settings.nextGuideNumber}</dd></div>
      </dl> : <p className="text-sm text-muted-foreground">Dados de faturamento ainda não informados. Solicite a preparação à equipe Cortex.</p>}
    </section>

    <section className="space-y-3" aria-label="Convênios cadastrados">
      <h2 className="font-semibold">Convênios</h2>
      {state.payers.length === 0 ? <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">Nenhum convênio cadastrado. Solicite o cadastro à equipe Cortex.</p> : <ul className="divide-y rounded-xl border bg-white">
        {state.payers.map(p => <li key={p.id} className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-words font-medium">{p.name}</h3><Badge variant={p.active ? 'secondary' : 'outline'}>{p.active ? 'Ativo' : 'Inativo'}</Badge></div>
          <p className="break-words text-muted-foreground">ANS {p.ansRegistry} · código do prestador {p.providerCode} · TISS {p.tissVersion}</p>
          <p className="text-xs text-muted-foreground">Envio: {p.submissionDays === null ? 'prazo não informado' : `${p.submissionDays} dias`} · Pagamento: {p.paymentDays === null ? 'prazo não informado' : `${p.paymentDays} dias`}</p>
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
      {visiblePrices.length === 0 ? <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">Nenhum preço cadastrado para esta seleção. Solicite a tabela à equipe Cortex.</p> : <ul className="divide-y rounded-xl border bg-white">
        {visiblePrices.map(p => <li key={p.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{p.description}</p><p className="break-words text-xs text-muted-foreground">{payerName(p.payerId)} · tabela {p.tableCode} · código {p.procedureCode} · {GUIDE_LABELS[p.guideType]}</p></div>
          <span className="font-medium tabular-nums">{brl(p.amount)}</span><Badge variant={p.active ? 'secondary' : 'outline'}>{p.active ? 'Ativo' : 'Inativo'}</Badge>
        </li>)}
      </ul>}
    </section>

    <section className="space-y-3" aria-label="Dados dos médicos para o faturamento">
      <h2 className="font-semibold">Dados dos médicos</h2>
      {state.doctors.length === 0 ? <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">Nenhum médico disponível neste escopo.</p> : <ul className="divide-y rounded-xl border bg-white">
        {state.doctors.map(d => {
          const p = state.professionals.find(professional => professional.userId === d.id);
          return <li key={d.id} className="space-y-2 p-4 text-sm">
            <h3 className="break-words font-medium">{d.name}</h3>
            {p ? <><p className="break-words text-muted-foreground">Nome na guia: {p.tissName}</p><p className="text-xs text-muted-foreground">Conselho {p.council} · número {p.councilNumber} · UF (código IBGE) {p.councilUf} · CBO {p.cbo}</p><p className="text-xs text-muted-foreground">{p.sharePercent === null ? 'Percentual de repasse não informado.' : `Repasse: ${p.sharePercent}% do recebido.`}</p></> : <p className="text-muted-foreground">Cadastro de faturamento ainda não informado. Solicite a preparação à equipe Cortex.</p>}
          </li>;
        })}
      </ul>}
    </section>
  </div>;
}
