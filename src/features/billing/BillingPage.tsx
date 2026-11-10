// Presentation follows the billing role returned by the existing API.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, ClipboardList, FileStack, Receipt, Settings2, Wallet, type LucideIcon } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { WorkspaceMenu } from '@/components/WorkspaceMenu';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClinicAccess } from '@/features/reception/accessContext';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { billingCall, billingKey, monthRange, type BillingRole, type BillingState, type Price } from './billingApi';
import { BatchesTab } from './BatchesTab';
import { CashTab } from './CashTab';
import { ChargesTab, ToBillTab } from './ChargesTabs';
import { ReportsTab } from './ReportsTab';
import { SetupTab } from './SetupTab';
import { QueryState } from './shared';

type TabId = 'faturar' | 'cobrancas' | 'lotes' | 'caixa' | 'relatorios' | 'cadastros';
const TABS: Array<{ id: TabId; label: string; title: string; description: string; icon: LucideIcon; roles: BillingRole[]; monthly: boolean }> = [
  { id: 'faturar', label: 'A faturar', title: 'Atendimentos a faturar', description: 'Confira o atendimento e registre a cobrança particular ou de convênio.', icon: ClipboardList, roles: ['admin', 'reception'], monthly: true },
  { id: 'cobrancas', label: 'Cobranças', title: 'Cobranças e recebimentos', description: 'Acompanhe cada cobrança, confira o saldo e registre o pagamento recebido.', icon: Receipt, roles: ['admin', 'reception', 'doctor'], monthly: true },
  { id: 'lotes', label: 'Lotes', title: 'Lotes de convênios', description: 'Organize as guias, confira os envios e acompanhe os retornos dos convênios.', icon: FileStack, roles: ['admin'], monthly: false },
  { id: 'caixa', label: 'Caixa', title: 'Movimento de caixa', description: 'Confira os recebimentos e as despesas pelo período de pagamento.', icon: Wallet, roles: ['admin', 'reception'], monthly: true },
  { id: 'relatorios', label: 'Relatórios', title: 'Resultados do período', description: 'Consulte a produção e os valores por atendimento, profissional e convênio.', icon: BarChart3, roles: ['admin', 'doctor'], monthly: true },
  { id: 'cadastros', label: 'Cadastros', title: 'Cadastros financeiros', description: 'Consulte os dados de faturamento, os convênios e as tabelas preparados pela equipe Cortex.', icon: Settings2, roles: ['admin'], monthly: false },
];
export default function BillingPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate(), access = useClinicAccess();
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none'];
  const state = useQuery({ queryKey: billingKey(scope, 'state'), queryFn: () => billingCall<BillingState>('state'), staleTime: 0, refetchOnMount: 'always', retry: false });
  const role = state.data?.role;
  const prices = useQuery({ queryKey: billingKey(scope, 'prices'), queryFn: () => billingCall<{ prices: Price[] }>('prices'), enabled: role === 'admin' || role === 'reception', staleTime: 0, retry: false });
  const [offset, setOffset] = useState(0), [tab, setTab] = useState<TabId | null>(null);
  const range = useMemo(() => monthRange(offset), [offset]);
  const tabs = TABS.filter(item => role && item.roles.includes(role));
  const current = tabs.find(item => item.id === tab) ?? tabs[0];
  const fresh = state.data && state.isFetchedAfterMount;
  const intro = role === 'doctor' ? 'Suas cobranças e sua produção, em um só lugar.' : role === 'reception' ? 'Do atendimento ao recebimento, com cada etapa bem definida.' : 'Organize o faturamento e acompanhe os recebimentos da clínica.';
  const description = current?.id === 'cobrancas' && role === 'doctor'
    ? 'Consulte suas cobranças, os pagamentos registrados e os saldos em aberto.'
    : current?.id === 'caixa'
      ? role === 'admin' ? 'Recebimentos pela data de pagamento; despesas em aberto pelo vencimento e despesas pagas pela data do pagamento.' : 'Confira os recebimentos do período pela data de pagamento.'
      : current?.description;
  return <div className={embedded ? 'finance-workspace' : 'finance-workspace min-h-screen bg-background'}>
    {!embedded && <header className="border-b bg-card"><div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8"><Link to="/" aria-label="Haddad Nicola — Início" className="hidden min-[360px]:block"><BrandLockup compact className="[&_img]:w-16 sm:[&_img]:w-28 [&_p]:hidden" /></Link><WorkspaceMenu /></div></header>}
    <div className={embedded ? 'w-full min-w-0' : 'mx-auto w-full min-w-0 max-w-[100rem] px-4 py-6 md:px-8 md:py-8'}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-5 border-b pb-6">
        <div className="min-w-0 space-y-2">
          {!embedded && <Button variant="ghost" className="-ml-2 mb-2 h-auto min-h-11 gap-2 px-2 text-xs text-muted-foreground" onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft className="h-3.5 w-3.5" />Voltar</Button>}
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-primary">{role === 'doctor' ? 'Seu movimento' : role === 'reception' ? 'Rotina da recepção' : 'Gestão da clínica'}</p>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight"><Wallet className="h-6 w-6 text-primary" aria-hidden="true" />Financeiro</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{intro}</p>
        </div>
        {fresh && current?.monthly && <div className="min-w-0 rounded-xl border bg-card p-3">
          <p className="mb-2 text-[0.625rem] font-medium text-muted-foreground">Período de referência</p>
          <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Mês anterior" onClick={() => setOffset(value => value - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="text-xs font-semibold capitalize" aria-live="polite">{range.label}</span><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Próximo mês" onClick={() => setOffset(value => value + 1)}><ChevronRight className="h-4 w-4" /></Button>{offset !== 0 && <Button variant="outline" className="h-auto min-h-11 text-xs" onClick={() => setOffset(0)}>Mês atual</Button>}</div>
        </div>}
      </header>
      <QueryState query={state}>
        {fresh && state.data && current && <Tabs value={current.id} onValueChange={value => { if (value !== current.id && confirmSessionExit()) setTab(value as TabId); }} className="space-y-6">
          <TabsList aria-label="Seções do financeiro" className={`grid h-auto w-full gap-1.5 rounded-xl bg-muted/50 p-1.5 ${tabs.length === 2 ? 'max-w-xl grid-cols-2' : tabs.length === 3 ? 'max-w-3xl grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6'}`}>
            {tabs.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} className="min-h-12 gap-2 whitespace-normal rounded-lg px-2 py-3 text-xs data-[state=active]:bg-card data-[state=active]:text-primary"><Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />{label}</TabsTrigger>)}
          </TabsList>
          <div className="space-y-1"><h2 className="text-lg font-semibold">{current.title}</h2><p className="text-sm leading-relaxed text-muted-foreground">{description}</p></div>
          <div className="min-w-0 rounded-2xl border bg-card p-4 md:p-6">
            <TabsContent value="faturar" className="mt-0"><ToBillTab scope={scope} state={state.data} range={range} prices={prices.data?.prices ?? []} /></TabsContent>
            <TabsContent value="cobrancas" className="mt-0"><ChargesTab scope={scope} state={state.data} range={range} prices={prices.data?.prices ?? []} /></TabsContent>
            <TabsContent value="lotes" className="mt-0"><BatchesTab scope={scope} state={state.data} /></TabsContent>
            <TabsContent value="caixa" className="mt-0"><CashTab scope={scope} state={state.data} range={range} /></TabsContent>
            <TabsContent value="relatorios" className="mt-0"><ReportsTab scope={scope} state={state.data} range={range} /></TabsContent>
            <TabsContent value="cadastros" className="mt-0"><QueryState query={prices}><SetupTab scope={scope} state={state.data} prices={prices.data?.prices ?? []} /></QueryState></TabsContent>
          </div>
        </Tabs>}
        {state.data && state.isFetchedAfterMount && !current && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Sem acesso ao financeiro.</p>}
      </QueryState>
    </div>
  </div>;
}
