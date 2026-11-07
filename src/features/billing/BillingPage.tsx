// "Financeiro": health-plan billing (TISS) and basic finance. Tabs by role: the admin sees all;
// the reception bills, receives and sees the cash; each doctor sees own charges and production.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useClinicAccess } from '@/features/reception/accessContext';
import { billingCall, billingKey, monthRange, type BillingRole, type BillingState, type Price } from './billingApi';
import { BatchesTab } from './BatchesTab';
import { CashTab } from './CashTab';
import { ChargesTab, ToBillTab } from './ChargesTabs';
import { ReportsTab } from './ReportsTab';
import { SetupTab } from './SetupTab';
import { QueryState } from './shared';

type TabId = 'faturar' | 'cobrancas' | 'lotes' | 'caixa' | 'relatorios' | 'cadastros';
const TABS: Array<{ id: TabId; label: string; roles: BillingRole[]; monthly: boolean }> = [
  { id: 'faturar', label: 'A faturar', roles: ['admin', 'reception'], monthly: true },
  { id: 'cobrancas', label: 'Cobranças', roles: ['admin', 'reception', 'doctor'], monthly: true },
  { id: 'lotes', label: 'Lotes', roles: ['admin'], monthly: false },
  { id: 'caixa', label: 'Caixa', roles: ['admin', 'reception'], monthly: true },
  { id: 'relatorios', label: 'Relatórios', roles: ['admin', 'doctor'], monthly: true },
  { id: 'cadastros', label: 'Cadastros', roles: ['admin'], monthly: false },
];

/** `embedded`: inside the reception layout (/recepcao/...), without its own page frame and back button. */
export default function BillingPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const access = useClinicAccess();
  const scope = [access?.clinic?.id ?? 'none', access?.actorId ?? 'none'];
  const state = useQuery({ queryKey: billingKey(scope, 'state'), queryFn: () => billingCall<BillingState>('state'), staleTime: 0, refetchOnMount: 'always', retry: false });
  const role = state.data?.role;
  const prices = useQuery({
    queryKey: billingKey(scope, 'prices'), queryFn: () => billingCall<{ prices: Price[] }>('prices'),
    enabled: role === 'admin' || role === 'reception', staleTime: 0, retry: false,
  });
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => monthRange(offset), [offset]);
  const tabs = TABS.filter((t) => role && t.roles.includes(role));
  const [tab, setTab] = useState<TabId | null>(null);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const fresh = state.data && state.isFetchedAfterMount;

  return (
    <div className={embedded ? '' : 'min-h-screen bg-[#F6F8F7]'}>
      <div className={embedded ? 'w-full max-w-5xl' : 'mx-auto w-full max-w-5xl px-4 py-5 sm:py-8'}>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {!embedded && <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>}
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold"><Wallet className="h-5 w-5 text-primary" aria-hidden /> Financeiro</h1>
            <p className="text-sm text-muted-foreground">Faturamento de convênios (TISS), particulares, caixa e relatórios.</p>
          </div>
        </div>

        <QueryState query={state}>
          {fresh && state.data && current && (
            <Tabs value={current.id} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
              <div className="-mx-4 overflow-x-auto px-4 pb-1">
                <TabsList className="h-auto w-max justify-start">
                  {tabs.map((t) => <TabsTrigger key={t.id} value={t.id} className="px-3">{t.label}</TabsTrigger>)}
                </TabsList>
              </div>
              {current.monthly && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => setOffset((o) => o - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => setOffset((o) => o + 1)}><ChevronRight className="h-4 w-4" /></Button>
                  <span className="ml-2 text-sm font-medium" aria-live="polite">{range.label}</span>
                  {offset !== 0 && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOffset(0)}>Mês atual</Button>}
                </div>
              )}
              <TabsContent value="faturar" className="mt-0">
                <ToBillTab scope={scope} state={state.data} range={range} prices={prices.data?.prices ?? []} />
              </TabsContent>
              <TabsContent value="cobrancas" className="mt-0">
                <ChargesTab scope={scope} state={state.data} range={range} prices={prices.data?.prices ?? []} />
              </TabsContent>
              <TabsContent value="lotes" className="mt-0"><BatchesTab scope={scope} state={state.data} /></TabsContent>
              <TabsContent value="caixa" className="mt-0"><CashTab scope={scope} state={state.data} range={range} /></TabsContent>
              <TabsContent value="relatorios" className="mt-0"><ReportsTab scope={scope} state={state.data} range={range} /></TabsContent>
              <TabsContent value="cadastros" className="mt-0"><SetupTab scope={scope} state={state.data} prices={prices.data?.prices ?? []} /></TabsContent>
            </Tabs>
          )}
          {state.data && state.isFetchedAfterMount && !current && <p className="text-sm text-muted-foreground">Sem acesso ao financeiro.</p>}
        </QueryState>
      </div>
    </div>
  );
}
