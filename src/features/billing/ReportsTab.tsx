// "Relatórios": production of the month (service date) by doctor and by plan, denials and payout.
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { billingCall, billingKey, brl, downloadText, plural, toCsv, type BillingState, type Report, type Totals } from './billingApi';
import { QueryState, STAT_GRID, Stat } from './shared';

const COLUMNS = 'sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(7.5rem,1fr))]';

function Row({ name, t, extra }: { name: string; t: Totals; extra?: string }) {
  const cell = (label: string, value: number, tone?: string) => (
    <span className={cn('flex justify-between gap-2 tabular-nums sm:block sm:text-right', tone)}>
      <span className="text-muted-foreground sm:hidden">{label}</span><span className="whitespace-nowrap">{brl(value)}</span>
    </span>
  );
  return (
    <li className={`grid gap-1 p-3 text-sm sm:items-center sm:gap-3 ${COLUMNS}`}>
      <span className="min-w-0 break-words font-medium">{name}{extra ? <span className="block text-xs font-normal text-muted-foreground">{extra}</span> : null}</span>
      {cell('Faturado', t.charged)}
      {cell('Recebido', t.paid, 'text-primary')}
      {cell('Glosado', t.denied, t.denied > 0 ? 'text-destructive' : undefined)}
      {cell('Em aberto', t.open)}
    </li>
  );
}

const Header = () => (
  <li aria-hidden className={`hidden gap-3 px-3 py-2 text-xs text-muted-foreground sm:grid ${COLUMNS}`}>
    <span /><span className="text-right">Faturado</span><span className="text-right">Recebido</span><span className="text-right">Glosado</span><span className="text-right">Em aberto</span>
  </li>
);

export function ReportsTab({ scope, state, range }: { scope: string[]; state: BillingState; range: { from: string; to: string } }) {
  const q = useQuery({ queryKey: billingKey(scope, 'report', range.from, range.to), queryFn: () => billingCall<Report>('report', range), staleTime: 0, retry: false });
  const r = q.data;
  const doctor = (id: string) => state.doctors.find((d) => d.id === id)?.name ?? 'Médico';
  const payout = (d: Report['doctors'][number]) => (d.payout !== null ? `Repasse de ${d.sharePercent}% sobre o recebido: ${brl(d.payout)}` : 'Sem percentual de repasse cadastrado');
  const exportCsv = () => {
    if (!r) return;
    const head = ['Seção', 'Nome', 'Cobranças', 'Faturado', 'Recebido', 'Glosado', 'Em aberto', 'Repasse'];
    const line = (section: string, name: string, t: Totals, extra: number | null = null) => [section, name, String(t.count), t.charged, t.paid, t.denied, t.open, extra];
    const rows = [
      head,
      line('Total', 'Período', r.totals),
      ...r.doctors.map((d) => line('Médico', doctor(d.doctorId), d, d.payout)),
      ...r.payers.map((p) => line('Convênio', p.name, p)),
      ...r.denials.map((d) => ['Glosa', `${d.code}${d.note ? ` · ${d.note}` : ''}`, String(d.count), null, null, d.amount, null, null]),
    ];
    downloadText(`relatorio-financeiro-${range.from.slice(0, 7)}.csv`, 'text/csv;charset=utf-8', toCsv(rows));
  };
  return (
    <QueryState query={q}>
      {r && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Pela data do atendimento, sem as cobranças canceladas.</p>
            <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />Exportar CSV</Button>
          </div>
          <div className={STAT_GRID}>
            <Stat label={`Faturado · ${plural(r.totals.count, 'cobrança', 'cobranças')}`} value={brl(r.totals.charged)} />
            <Stat label="Recebido" value={brl(r.totals.paid)} tone="good" />
            <Stat label="Glosado" value={brl(r.totals.denied)} tone={r.totals.denied > 0 ? 'bad' : undefined} />
            <Stat label="Em aberto" value={brl(r.totals.open)} />
          </div>
          <section className="space-y-2" aria-label="Produção por médico">
            <h2 className="font-semibold">Por médico</h2>
            {r.doctors.length === 0 ? <p className="text-sm text-muted-foreground">Sem produção no mês.</p> : (
              <ul className="divide-y rounded-xl border bg-white">
                <Header />
                {r.doctors.map((d) => <Row key={d.doctorId} name={doctor(d.doctorId)} t={d} extra={payout(d)} />)}
              </ul>
            )}
          </section>
          <section className="space-y-2" aria-label="Produção por convênio">
            <h2 className="font-semibold">Por convênio</h2>
            {r.payers.length === 0 ? <p className="text-sm text-muted-foreground">Sem produção no mês.</p> : (
              <ul className="divide-y rounded-xl border bg-white"><Header />{r.payers.map((p) => <Row key={p.payerId ?? 'particular'} name={p.name} t={p} />)}</ul>
            )}
          </section>
          <section className="space-y-2" aria-label="Glosas por código">
            <h2 className="font-semibold">Glosas por código</h2>
            {r.denials.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma glosa no mês.</p> : (
              <ul className="divide-y rounded-xl border bg-white">
                {r.denials.map((d) => (
                  <li key={d.code} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="min-w-0 break-words">
                      <span className="font-medium">{d.code}</span> · {d.note || <span className="text-muted-foreground">motivo não informado no retorno</span>} · {plural(d.count, 'guia', 'guias')}
                    </span>
                    <span className="whitespace-nowrap text-right tabular-nums text-destructive">{brl(d.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </QueryState>
  );
}
