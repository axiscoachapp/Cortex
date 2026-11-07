// "Relatórios": production of the month (service date) by doctor and by plan, denials and payout.
import { useQuery } from '@tanstack/react-query';
import { billingCall, billingKey, brl, type BillingState, type Report, type Totals } from './billingApi';
import { QueryState, Stat } from './shared';

function Row({ name, t, extra }: { name: string; t: Totals; extra?: string }) {
  return (
    <li className="grid gap-1 p-3 text-sm sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] sm:items-center sm:gap-3">
      <span className="min-w-0 truncate font-medium">{name}{extra ? <span className="block text-xs font-normal text-muted-foreground">{extra}</span> : null}</span>
      <span className="tabular-nums"><span className="text-muted-foreground sm:hidden">Faturado: </span>{brl(t.charged)}</span>
      <span className="tabular-nums text-primary"><span className="text-muted-foreground sm:hidden">Recebido: </span>{brl(t.paid)}</span>
      <span className="tabular-nums text-destructive"><span className="text-muted-foreground sm:hidden">Glosado: </span>{brl(t.denied)}</span>
      <span className="tabular-nums"><span className="text-muted-foreground sm:hidden">Em aberto: </span>{brl(t.open)}</span>
    </li>
  );
}

const Header = () => (
  <li aria-hidden className="hidden gap-3 px-3 py-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
    <span /><span>Faturado</span><span>Recebido</span><span>Glosado</span><span>Em aberto</span>
  </li>
);

export function ReportsTab({ scope, state, range }: { scope: string[]; state: BillingState; range: { from: string; to: string } }) {
  const q = useQuery({ queryKey: billingKey(scope, 'report', range.from, range.to), queryFn: () => billingCall<Report>('report', range), staleTime: 0, retry: false });
  const r = q.data;
  const doctor = (id: string) => state.doctors.find((d) => d.id === id)?.name ?? 'Médico';
  return (
    <QueryState query={q}>
      {r && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">Pela data do atendimento, sem as cobranças canceladas.</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label={`Faturado (${r.totals.count})`} value={brl(r.totals.charged)} />
            <Stat label="Recebido" value={brl(r.totals.paid)} tone="good" />
            <Stat label="Glosado" value={brl(r.totals.denied)} tone={r.totals.denied > 0 ? 'bad' : undefined} />
            <Stat label="Em aberto" value={brl(r.totals.open)} />
          </div>
          <section className="space-y-2" aria-label="Produção por médico">
            <h2 className="font-semibold">Por médico</h2>
            {r.doctors.length === 0 ? <p className="text-sm text-muted-foreground">Sem produção no mês.</p> : (
              <ul className="divide-y rounded-xl border bg-white">
                <Header />
                {r.doctors.map((d) => (
                  <Row key={d.doctorId} name={doctor(d.doctorId)} t={d}
                    extra={d.payout !== null ? `Repasse de ${d.sharePercent}% sobre o recebido: ${brl(d.payout)}` : 'Sem percentual de repasse cadastrado'} />
                ))}
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
                    <span>Código {d.code} · {d.count} guia(s)</span><span className="tabular-nums text-destructive">{brl(d.amount)}</span>
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
