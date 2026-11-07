import { clinicDateLabel, clinicTime } from './dates';
import type { WhatsAppDashboard } from './whatsappDashboard';

const number = (value: number) => value.toLocaleString('pt-BR');
function duration(value: number | null) {
  if (value === null) return 'Sem amostra';
  const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), seconds = value % 60;
  return [hours ? `${number(hours)} h` : '', minutes ? `${minutes} min` : '', seconds || (!hours && !minutes) ? `${seconds} s` : ''].filter(Boolean).join(' ');
}
const date = (iso: string) => `${clinicDateLabel(iso)} às ${clinicTime(iso)}`;
function Totals({ items }: { items: [string, number][] }) {
  return <dl className="grid md:grid-cols-3 gap-5 border-y py-5">
    {items.map(([label, value]) => <div key={label} className="min-w-0 space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums tracking-tight [overflow-wrap:anywhere]">{number(value)}</dd>
    </div>)}
  </dl>;
}
export function ReceptionDashboardSummary({ data }: { data: WhatsAppDashboard }) {
  const { cohort, openNow } = data;
  return <div className="space-y-6 min-w-0">
    <p className="text-xs text-muted-foreground">Atualizado em {date(data.asOf)} · São Paulo</p>
    <section aria-labelledby="dashboard-incoming" className="rounded-xl border bg-card p-4 md:p-6 space-y-4">
      <div className="space-y-2">
        <h2 id="dashboard-incoming" className="text-lg font-semibold">Entradas no período</h2>
        <p className="text-sm">{date(data.window.from)} até {date(data.window.to)}</p>
        <p className="text-xs text-muted-foreground">Considera somente a última abertura de cada conversa. Uma reabertura substitui o ciclo anterior nesta leitura; este painel não reúne todo o histórico.</p>
      </div>
      <Totals items={[["Entradas", cohort.incomingCycles], ["Com envio humano", cohort.withHumanSend], ["Sem envio humano", cohort.withoutHumanSend]]} />
      {cohort.incomingCycles === 0 && <p className="text-sm">Nenhuma entrada no período, considerando a última abertura de cada conversa.</p>}
      <div className="grid lg:grid-cols-[1fr_2fr] gap-5 items-start">
        <div className="rounded-lg bg-primary/5 p-4 space-y-2 min-w-0">
          <h3 className="text-sm font-medium">Primeiro envio humano · tempo corrido</h3>
          <p className="text-2xl font-semibold tabular-nums">{duration(cohort.medianFirstHumanSendSeconds)}</p>
          <p className="text-xs text-muted-foreground">Mediana das conversas com envio humano confirmado.</p>
        </div>
        <div className="space-y-3 text-sm">
          <p>Da entrada registrada até o registro do primeiro envio humano que recebeu confirmação de envio. Exclui respostas automáticas e envios pendentes, incertos ou com falha.</p>
          <p className="text-xs text-muted-foreground">Tempo corrido, sem descontar horários de fechamento. Não mede entrega nem leitura pelo destinatário.</p>
          <p>Encerradas sem envio humano: <strong className="tabular-nums">{number(cohort.closedWithoutHumanSend)}</strong></p>
        </div>
      </div>
    </section>
    <section aria-labelledby="dashboard-open" className="rounded-xl border bg-card p-4 md:p-6 space-y-4">
      <div className="space-y-2">
        <h2 id="dashboard-open" className="text-lg font-semibold">Em aberto agora</h2>
        <p className="text-xs text-muted-foreground">Todas as conversas em aberto da clínica, independentemente do período acima. A distribuição mostra o responsável atual e não identifica quem respondeu nem mede produtividade.</p>
      </div>
      <Totals items={[["Conversas em aberto", openNow.total], ["Sem responsável", openNow.unassigned], ["Responsável sem acesso elegível", openNow.assignedToIneligible]]} />
      <h3 className="text-sm font-medium">Distribuição por responsável atual</h3>
      {openNow.owners.items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conversa em aberto atribuída a uma pessoa elegível nesta página.</p>
        : <ul className="divide-y">
          {openNow.owners.items.map(owner => <li key={owner.userId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-4 items-start">
            <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
              <p className="font-medium">{owner.name}</p>
              <p className="text-xs text-muted-foreground">{owner.role === 'admin' ? 'Administração' : 'Recepção'}</p>
              {owner.ambiguous && <p className="text-xs text-muted-foreground">Nome repetido na equipe</p>}
            </div>
            <p className="text-right tabular-nums text-sm"><strong>{number(owner.openCount)}</strong><span className="block text-xs text-muted-foreground">em aberto</span></p>
          </li>)}
        </ul>}
    </section>
    <section aria-labelledby="dashboard-unavailable" className="border-t pt-5 space-y-4">
      <h2 id="dashboard-unavailable" className="text-base font-semibold">Indicadores ainda indisponíveis</h2>
      <dl className="grid lg:grid-cols-3 gap-5 text-sm">
        {[
          ['Abandono', 'Depende de um evento explícito de abandono. Encerrar sem envio humano não comprova abandono.'],
          ['Confirmações', 'Depende de uma fonte da agenda com escopo autorizado. Uma resposta no WhatsApp não confirma um agendamento.'],
          ['Faltas', 'Depende de uma fonte da agenda com escopo autorizado. Ausência de resposta não comprova falta.'],
        ].map(([label, reason]) => <div key={label} className="space-y-1"><dt className="font-medium">{label}</dt><dd className="space-y-2"><p>Não disponível</p><p className="text-xs text-muted-foreground">{reason}</p></dd></div>)}
      </dl>
    </section>
  </div>;
}
