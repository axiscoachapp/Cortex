// Presentation follows the billing role returned by the existing API.
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronLeft, ChevronRight, ClipboardList, FileStack, Receipt, Settings2, Wallet, type LucideIcon } from 'lucide-react';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { PageHeading } from '@/components/PageHeading';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClinicAccess } from '@/features/reception/accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { billingCall, billingKey, monthRange, type Batch, type BillingRole, type BillingState, type Price, type ToBillAnswer } from './billingApi';
import { BatchesTab } from './BatchesTab';
import { CashTab } from './CashTab';
import { ChargesTab, ToBillTab } from './ChargesTabs';
import { ReportsTab } from './ReportsTab';
import { SetupTab } from './SetupTab';
import { NoAccessNotice } from '@/features/shared/StatusNotice';
import { QueryState } from './shared';

type TabId = 'faturar' | 'cobrancas' | 'lotes' | 'caixa' | 'relatorios' | 'cadastros';
/** Tabs of the daily sequence (numbered); the others are reference and sit apart. */
const FLOW: TabId[] = ['faturar', 'cobrancas', 'lotes', 'caixa'];
const TABS: Array<{ id: TabId; label: string; title: string; description: string; icon: LucideIcon; roles: BillingRole[]; monthly: boolean }> = [
  { id: 'faturar', label: 'A faturar', title: 'Atendimentos a faturar', description: 'Confira o atendimento e registre a cobrança particular ou de convênio.', icon: ClipboardList, roles: ['admin', 'reception'], monthly: true },
  { id: 'cobrancas', label: 'Cobranças', title: 'Cobranças e recebimentos', description: 'Acompanhe cada cobrança, confira o saldo e registre o pagamento recebido.', icon: Receipt, roles: ['admin', 'reception', 'doctor'], monthly: true },
  { id: 'lotes', label: 'Lotes', title: 'Lotes de convênios', description: 'Organize as guias, confira os envios e acompanhe os retornos dos convênios.', icon: FileStack, roles: ['admin'], monthly: false },
  { id: 'caixa', label: 'Caixa', title: 'Movimento de caixa', description: 'Confira os recebimentos e as despesas pelo período de pagamento.', icon: Wallet, roles: ['admin', 'reception'], monthly: true },
  { id: 'relatorios', label: 'Relatórios', title: 'Resultados do período', description: 'Consulte a produção e os valores por atendimento, profissional e convênio.', icon: BarChart3, roles: ['admin', 'doctor'], monthly: true },
  { id: 'cadastros', label: 'Cadastros', title: 'Cadastros financeiros', description: 'Consulte os dados de faturamento, os convênios e as tabelas preparados pela equipe Cortex.', icon: Settings2, roles: ['admin'], monthly: false },
];
export default function BillingPage({ embedded = false }: { embedded?: boolean }) {
  const access = useClinicAccess();
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none'];
  const state = useQuery({ queryKey: billingKey(scope, 'state'), queryFn: () => billingCall<BillingState>('state'), staleTime: 0, refetchOnMount: 'always', retry: false });
  const role = state.data?.role;
  const prices = useQuery({ queryKey: billingKey(scope, 'prices'), queryFn: () => billingCall<{ prices: Price[] }>('prices'), enabled: role === 'admin' || role === 'reception', staleTime: 0, retry: false });
  const [offset, setOffset] = useState(0), [tab, setTab] = useState<TabId | null>(null);
  const range = useMemo(() => monthRange(offset), [offset]);
  const tabs = TABS.filter(item => role && item.roles.includes(role));
  const current = tabs.find(item => item.id === tab) ?? tabs[0];
  // Counts on the tabs: what is waiting in "A faturar" this month and the batches still to send.
  const staffRole = role === 'admin' || role === 'reception';
  const toBill = useQuery({ queryKey: billingKey(scope, 'toBill', range.from, range.to), queryFn: () => billingCall<ToBillAnswer>('toBill', range),
    enabled: staffRole && !!state.isFetchedAfterMount, staleTime: 0, retry: false });
  const batches = useQuery({ queryKey: billingKey(scope, 'batches'), queryFn: () => billingCall<{ batches: Batch[] }>('batches'),
    enabled: role === 'admin' && !!state.isFetchedAfterMount, staleTime: 0, retry: false });
  const flow = staffRole ? tabs.filter(item => FLOW.includes(item.id)) : [];
  const reference = tabs.filter(item => !flow.includes(item));
  const toBillCount = toBill.data?.items.length ?? 0;
  const drafts = (batches.data?.batches ?? []).filter(b => b.status === 'draft').length;
  const tabLabel = (id: TabId, label: string) => {
    const n = flow.findIndex(item => item.id === id);
    const count = id === 'faturar' && toBillCount > 0 ? ` (${toBillCount})` : id === 'lotes' && drafts > 0 ? ` (${drafts} a enviar)` : '';
    return n < 0 ? label : `${n + 1} ${label}${count}`;
  };
  const nextStep: Partial<Record<TabId, string>> = {
    faturar: 'Próximo passo: clique em “Cobrar” em cada atendimento. A cobrança passa para Cobranças.',
    cobrancas: role === 'admin' ? 'Próximo passo: receba as particulares aqui. As de convênio seguem para Lotes.'
      : role === 'reception' ? 'Próximo passo: receba as particulares aqui. As de convênio a administração envia em lotes.' : undefined,
    lotes: 'Próximo passo: monte o lote, baixe o XML, envie no portal do convênio e marque como enviado. Quando o convênio pagar, lance o retorno.',
    caixa: 'Próximo passo: confira o que entrou e o que saiu no mês.',
  };
  const fresh = state.data && state.isFetchedAfterMount;
  const intro = role === 'doctor' ? 'Suas cobranças e sua produção, em um só lugar.' : role === 'reception' ? 'Do atendimento ao recebimento, com cada etapa bem definida.' : 'Organize o faturamento e acompanhe os recebimentos da clínica.';
  const description = current?.id === 'cobrancas' && role === 'doctor'
    ? 'Consulte suas cobranças, os pagamentos registrados e os saldos em aberto.'
    : current?.id === 'caixa'
      ? role === 'admin' ? 'Entradas e saídas do mês.' : 'Confira os recebimentos do período pela data de pagamento.'
      : current?.description;
  const content = <div className="finance-workspace min-w-0 space-y-6">
      <PageHeading title="Financeiro" description={intro} actions={
        fresh && current?.monthly && <div className="min-w-0 rounded-xl border bg-card p-3">
          <p className="mb-2 text-[0.625rem] font-medium text-muted-foreground">Período de referência</p>
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1"><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Mês anterior" onClick={() => setOffset(value => value - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-0 text-center text-xs font-semibold" aria-live="polite">{range.label}</span><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Próximo mês" onClick={() => setOffset(value => value + 1)}><ChevronRight className="h-4 w-4" /></Button>{offset !== 0 && <Button variant="outline" className="col-span-3 h-auto min-h-11 justify-self-center text-xs" onClick={() => setOffset(0)}>Mês atual</Button>}</div>
        </div>
      } />
      <QueryState query={state} forbiddenMessage="Sua conta não tem acesso ao financeiro desta clínica.">
        {fresh && state.data && current && <Tabs value={current.id} onValueChange={value => { if (value !== current.id && confirmSessionExit()) setTab(value as TabId); }} className="space-y-6">
          <TabsList aria-label="Seções do financeiro" className={`flex h-auto w-full flex-wrap items-stretch gap-1.5 rounded-xl bg-muted/50 p-1.5 ${tabs.length <= 3 ? 'max-w-3xl' : ''}`}>
            {[...flow, ...reference].map(({ id, label, icon: Icon }, index) => <Fragment key={id}>
              {index === flow.length && flow.length > 0 && <span role="none" className="basis-full border-t border-border/70 sm:mx-1 sm:basis-auto sm:border-l sm:border-t-0" />}
              <TabsTrigger value={id} className={`min-h-12 min-w-0 grow basis-[calc(50%-0.375rem)] gap-2 whitespace-normal rounded-lg px-2 py-3 text-xs data-[state=active]:bg-card data-[state=active]:text-primary ${flow.length && index >= flow.length ? 'sm:grow-0 sm:basis-auto sm:px-4' : 'sm:basis-0'}`}>
                <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />{tabLabel(id, label)}
              </TabsTrigger>
            </Fragment>)}
          </TabsList>
          <div className="space-y-1"><h2 className="text-lg font-semibold">{current.title}</h2><p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            {current.id === 'caixa' && role === 'admin' && <details className="text-sm text-muted-foreground">
              <summary className="inline-flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">Como o mês é contado</summary>
              <p className="pb-1">Recebimentos entram pela data do pagamento. Despesas pagas, pela data em que foram pagas; despesas em aberto, pelo vencimento.</p>
            </details>}
            {nextStep[current.id] && <p className="text-sm font-medium text-foreground">{nextStep[current.id]}</p>}</div>
          <div className="min-w-0 rounded-2xl border bg-card p-4 md:p-6">
            <TabsContent value="faturar" className="mt-0"><ToBillTab scope={scope} state={state.data} range={range} prices={prices.data?.prices ?? []} onGoToMonth={setOffset} /></TabsContent>
            <TabsContent value="cobrancas" className="mt-0"><ChargesTab scope={scope} state={state.data} range={range} prices={prices.data?.prices ?? []} /></TabsContent>
            <TabsContent value="lotes" className="mt-0"><BatchesTab scope={scope} state={state.data} /></TabsContent>
            <TabsContent value="caixa" className="mt-0"><CashTab scope={scope} state={state.data} range={range} /></TabsContent>
            <TabsContent value="relatorios" className="mt-0"><ReportsTab scope={scope} state={state.data} range={range} /></TabsContent>
            <TabsContent value="cadastros" className="mt-0"><QueryState query={prices} subject="os cadastros"><SetupTab scope={scope} state={state.data} prices={prices.data?.prices ?? []} /></QueryState></TabsContent>
          </div>
        </Tabs>}
        {state.data && state.isFetchedAfterMount && !current && <NoAccessNotice message="Sua conta não tem acesso ao financeiro desta clínica." backTo={null} />}
      </QueryState>
  </div>;
  return embedded ? content : <WorkspaceShell section="Financeiro">{content}</WorkspaceShell>;
}
