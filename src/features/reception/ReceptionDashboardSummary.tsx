import type { ReactNode } from 'react';
import { clinicDateLabel, clinicTime } from './dates';
import type { WhatsAppDashboard } from './whatsappDashboard';

const number = (value: number) => value.toLocaleString('pt-BR');
/** A measured time; "—" when there is nothing to measure. */
function duration(value: number | null) {
  if (value === null) return '—';
  const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), seconds = value % 60;
  return [hours ? `${number(hours)} h` : '', minutes ? `${minutes} min` : '', seconds || (!hours && !minutes) ? `${seconds} s` : ''].filter(Boolean).join(' ');
}
const date = (iso: string) => `${clinicDateLabel(iso)} às ${clinicTime(iso)}`;
function Totals({ items }: { items: [string, string][] }) {
  return <dl className="grid sm:grid-cols-3 gap-5 border-y py-5">
    {items.map(([label, value]) => <div key={label} className="min-w-0 space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums tracking-tight [overflow-wrap:anywhere]">{value}</dd>
    </div>)}
  </dl>;
}
export function ReceptionDashboardSummary({ data, pager }: { data: WhatsAppDashboard; pager?: ReactNode }) {
  const { cohort, openNow } = data;
  return <div className="space-y-6 min-w-0">
    <section aria-labelledby="dashboard-incoming" className="rounded-xl border bg-card p-4 md:p-6 space-y-4">
      <div className="space-y-1">
        <h2 id="dashboard-incoming" className="text-lg font-semibold">Conversas no período</h2>
        <p className="text-sm text-muted-foreground">{date(data.window.from)} até {date(data.window.to)}</p>
      </div>
      <Totals items={[
        ['Conversas recebidas', number(cohort.incomingCycles)],
        ['Respondidas pela equipe', number(cohort.withHumanSend)],
        ['Sem resposta da equipe', number(cohort.withoutHumanSend)],
      ]} />
      {cohort.incomingCycles === 0 && <p className="text-sm">Nenhuma conversa recebida neste período.</p>}
      <div className="grid sm:grid-cols-2 gap-5 items-start">
        <div className="rounded-lg bg-primary/5 p-4 space-y-1 min-w-0">
          <h3 className="text-sm font-medium">Tempo até a primeira resposta (mediana)</h3>
          <p className="text-2xl font-semibold tabular-nums">{duration(cohort.medianFirstHumanSendSeconds)}</p>
        </div>
        <p className="text-sm sm:pt-4">Encerradas sem resposta da equipe: <strong className="tabular-nums">{number(cohort.closedWithoutHumanSend)}</strong></p>
      </div>
    </section>
    <section aria-labelledby="dashboard-open" className="rounded-xl border bg-card p-4 md:p-6 space-y-4">
      <h2 id="dashboard-open" className="text-lg font-semibold">Em aberto agora</h2>
      <Totals items={[
        ['Conversas em aberto', number(openNow.total)],
        ['Sem responsável', number(openNow.unassigned)],
        ['Com quem perdeu o acesso', number(openNow.assignedToIneligible)],
      ]} />
      <h3 className="text-sm font-medium">Com cada pessoa</h3>
      {openNow.owners.items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conversa em aberto com uma pessoa da equipe.</p>
        : <ul className="divide-y">
          {openNow.owners.items.map(owner => <li key={owner.userId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 items-start">
            <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
              <p className="font-medium">{owner.name}</p>
              <p className="text-xs text-muted-foreground">{owner.role === 'admin' ? 'Administração' : 'Recepção'}</p>
              {owner.ambiguous && <p className="text-xs text-muted-foreground">Nome repetido na equipe</p>}
            </div>
            <p className="text-right tabular-nums text-sm"><strong>{number(owner.openCount)}</strong><span className="block text-xs text-muted-foreground">em aberto</span></p>
          </li>)}
        </ul>}
      {pager}
    </section>
    <p className="text-sm text-muted-foreground">Em breve: confirmações, faltas e desistências.</p>
    <details className="rounded-xl border bg-card p-4 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium">Como calculamos</summary>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">
        <li>Cada conversa conta uma vez, pela última vez em que foi aberta no período. Uma conversa reaberta substitui a abertura anterior.</li>
        <li>“Respondidas pela equipe” são as conversas com ao menos uma mensagem enviada por uma pessoa e aceita pelo WhatsApp. Respostas automáticas e envios com falha ou sem confirmação não contam.</li>
        <li>O tempo até a primeira resposta vai da chegada da conversa até essa primeira mensagem, em tempo corrido (inclui noites e fins de semana). A mediana é o tempo do meio: metade das conversas foi respondida mais rápido. Não mede entrega nem leitura pelo paciente.</li>
        <li>O período vai de 00:00 do primeiro dia até o fim do último, no horário de Brasília, com no máximo 31 dias, e termina no máximo agora.</li>
        <li>“Em aberto agora” mostra todas as conversas abertas neste momento, de qualquer período, e quem é o responsável atual. Não mede produtividade de ninguém.</li>
        <li>“Com quem perdeu o acesso” são conversas cujo responsável não usa mais a caixa de conversas: assuma ou transfira essas conversas.</li>
        <li>A lista mostra até 10 pessoas por vez; os totais valem para a clínica toda.</li>
      </ul>
    </details>
    <p className="text-xs text-muted-foreground">Atualizado em {date(data.asOf)}</p>
  </div>;
}
