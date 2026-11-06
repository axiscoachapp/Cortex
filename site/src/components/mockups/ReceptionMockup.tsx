import { CalendarDays, Lock, Search, ShieldCheck } from 'lucide-react';
import { Icon, cx } from '../ui';
import { Avatar, MockupFrame } from './MockupFrame';

type Status = 'Na fila' | 'Em atendimento' | 'Aguardando paciente';

const statusTone: Record<Status, string> = {
  'Na fila': 'bg-signal-50 text-signal-700 ring-signal/50',
  'Em atendimento': 'bg-teal-50 text-teal-800 ring-teal-100',
  'Aguardando paciente': 'bg-[#eaf1fa] text-info ring-[#cfe0f3]',
};

const queue: Array<{ name: string; subject: string; status: Status; assignee: string | null; time: string }> = [
  { name: 'Marina Exemplo', subject: 'Primeira consulta', status: 'Na fila', assignee: null, time: '09:12' },
  { name: 'Carlos Exemplo', subject: 'Remarcar retorno', status: 'Em atendimento', assignee: 'LE', time: '09:05' },
  { name: 'Paciente Exemplo', subject: 'Confirmar horário', status: 'Aguardando paciente', assignee: 'RE', time: '08:47' },
  { name: 'João Exemplo', subject: 'Informações', status: 'Em atendimento', assignee: 'RE', time: '08:30' },
];

const agenda: Array<{ time: string; who: string | null; kind?: string; highlight?: boolean }> = [
  { time: '14:00', who: 'Carlos Exemplo', kind: 'Retorno' },
  { time: '14:30', who: 'Paciente Exemplo', kind: 'Retorno', highlight: true },
  { time: '15:00', who: null },
  { time: '15:30', who: 'Marina Exemplo', kind: 'Primeira consulta' },
];

export function ReceptionMockup({ className }: { className?: string }) {
  return (
    <MockupFrame
      className={className}
      title="Clínica Exemplo · Recepção"
      description="Ilustração da tela da recepção do Cortex, com dados fictícios: uma fila de atendimentos com status Na fila, Em atendimento e Aguardando paciente, a pessoa da recepção responsável por cada um e, ao lado, a agenda do dia da Dra. Ana Exemplo, com a indicação de que a recepção pode agendar e remarcar por autorização da médica e não vê o conteúdo clínico."
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-1 text-[12px] font-bold">
          <span className="rounded-full bg-ink px-2.5 py-1 text-white">
            Fila <span className="ml-0.5 text-teal-300">4</span>
          </span>
          <span className="rounded-full px-2.5 py-1 text-muted">Contatos</span>
          <span className="hidden rounded-full px-2.5 py-1 text-muted sm:inline">Agenda</span>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11px] text-muted ring-1 ring-inset ring-line sm:inline-flex">
          <Icon icon={Search} size={13} /> Buscar contato
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Queue */}
        <ul className="divide-y divide-line border-b border-line sm:border-b-0 sm:border-r">
          {queue.map((item, i) => (
            <li key={item.name} className={cx('flex items-center gap-3 px-4 py-3', i === 0 && 'bg-signal-50/40')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[12.5px] font-bold">{item.name}</p>
                  <span className="tabular text-[10.5px] text-muted">{item.time}</span>
                </div>
                <p className="truncate text-[11.5px] text-muted">{item.subject}</p>
              </div>
              <span
                className={cx(
                  'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ring-inset',
                  statusTone[item.status],
                )}
              >
                {item.status}
              </span>
              {item.assignee ? (
                <Avatar initials={item.assignee} size="sm" tone={item.assignee === 'LE' ? 'ink' : 'teal'} />
              ) : (
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted/50 text-[10px] text-muted">
                  +
                </span>
              )}
            </li>
          ))}
        </ul>

        {/* Mini agenda */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[12px] font-bold">
              <Icon icon={CalendarDays} size={15} className="text-teal-700" />
              Dra. Ana Exemplo
            </p>
            <span className="tabular text-[11px] font-semibold text-muted">qui, 12/11</span>
          </div>
          <ol className="mt-3 space-y-1.5">
            {agenda.map((slot) => (
              <li key={slot.time} className="flex items-stretch gap-2.5">
                <span className="tabular w-9 shrink-0 pt-1.5 text-[11px] font-semibold text-muted">{slot.time}</span>
                {slot.who ? (
                  <span
                    className={cx(
                      'flex-1 rounded-lg border-l-[3px] px-2.5 py-1.5',
                      slot.highlight ? 'border-signal bg-signal-50' : 'border-teal-700 bg-teal-50',
                    )}
                  >
                    <span className="block truncate text-[11.5px] font-bold leading-tight">{slot.who}</span>
                    <span className="block truncate text-[10.5px] leading-tight text-muted">{slot.kind}</span>
                  </span>
                ) : (
                  <span className="flex-1 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[11px] text-muted">
                    Livre
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-3 space-y-1.5 rounded-lg bg-bg p-2.5 ring-1 ring-inset ring-line">
            <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-ink/80">
              <Icon icon={ShieldCheck} size={13} className="mt-px shrink-0 text-teal-700" />
              Recepção pode agendar e remarcar: autorizado pela médica
            </p>
            <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-ink/80">
              <Icon icon={Lock} size={13} className="mt-px shrink-0 text-teal-700" />
              Conteúdo clínico não aparece para a recepção
            </p>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}
