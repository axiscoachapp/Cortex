import { CalendarClock, CheckCircle2, CircleDashed, Database, FileText, Paperclip, Pill, TriangleAlert } from 'lucide-react';
import { Icon, cx } from '../ui';
import { Avatar, MockupFrame } from './MockupFrame';

/** Small floating card: a reception request waiting for the doctor's decision. */
export function DelegationCard({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('w-full max-w-[320px] rounded-card border border-line bg-surface p-4 shadow-mock', className)}>
      <div className="flex items-center gap-2">
        <Avatar initials="LE" tone="ink" size="sm" />
        <p className="text-[12px] font-bold leading-tight">Pedido da recepção</p>
        <span className="ml-auto rounded-full bg-signal-50 px-2 py-0.5 text-[10px] font-bold text-signal-700 ring-1 ring-inset ring-signal/50">
          Aguardando você
        </span>
      </div>
      <p className="mt-2.5 text-[12px] leading-snug text-ink/85">
        <strong>Luana Exemplo</strong> pede para agendar e remarcar consultas na sua agenda.
      </p>
      <div className="mt-3 flex gap-2">
        <span className="flex-1 rounded-full py-1.5 text-center text-[11.5px] font-bold text-ink ring-1 ring-inset ring-line">
          Recusar
        </span>
        <span className="flex-1 rounded-full bg-teal-700 py-1.5 text-center text-[11.5px] font-bold text-white">Autorizar</span>
      </div>
    </div>
  );
}

const migrationRows: Array<{ label: string; status: 'ok' | 'checking' | 'waiting' }> = [
  { label: 'Pacientes e contatos', status: 'ok' },
  { label: 'Consultas e evoluções', status: 'ok' },
  { label: 'Alergias e medicações em uso', status: 'checking' },
  { label: 'Arquivos anexados', status: 'waiting' },
];

export function MigrationMockup({ className }: { className?: string }) {
  return (
    <MockupFrame
      className={className}
      title="Clínica Exemplo · Ensaio de migração"
      description="Ilustração de um ensaio de migração com dados fictícios: o histórico vindo do sistema anterior aparece separado por partes, cada uma com a situação da conferência feita pela equipe da clínica: conferido, em conferência ou aguardando."
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[13px] font-bold">
            <Icon icon={Database} size={16} className="text-teal-700" />
            Ensaio completo
          </p>
          <span className="rounded-full bg-bg px-2.5 py-0.5 text-[10.5px] font-semibold text-muted ring-1 ring-inset ring-line">
            Origem: sistema anterior
          </span>
        </div>
        <ul className="mt-4 space-y-2">
          {migrationRows.map((row) => (
            <li key={row.label} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5">
              <Icon
                icon={row.status === 'ok' ? CheckCircle2 : CircleDashed}
                size={17}
                className={row.status === 'ok' ? 'text-success' : row.status === 'checking' ? 'text-signal-700' : 'text-muted'}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{row.label}</span>
              <span
                className={cx(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ring-inset',
                  row.status === 'ok' && 'bg-[#e7f4ec] text-success ring-[#c9e6d4]',
                  row.status === 'checking' && 'bg-signal-50 text-signal-700 ring-signal/50',
                  row.status === 'waiting' && 'bg-bg text-muted ring-line',
                )}
              >
                {row.status === 'ok' ? 'Conferido' : row.status === 'checking' ? 'Em conferência' : 'Aguardando'}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-[10px] bg-teal-50 px-3 py-2.5 ring-1 ring-inset ring-teal-100">
          <p className="text-[11.5px] font-semibold text-teal-800">Virada liberada depois da conferência</p>
          <span className="h-2 w-24 overflow-hidden rounded-full bg-white">
            <span className="block h-full w-3/5 rounded-full bg-teal-700" />
          </span>
        </div>
      </div>
    </MockupFrame>
  );
}

const timeline = [
  { date: '12/11/2026', title: 'Consulta de retorno', by: 'Dra. Ana Exemplo', icon: FileText },
  { date: '03/09/2026', title: 'Exames anexados (PDF)', by: 'Dra. Ana Exemplo', icon: Paperclip },
  { date: '15/08/2026', title: 'Primeira consulta', by: 'Dra. Ana Exemplo', icon: FileText },
];

export function TimelineMockup({ className }: { className?: string }) {
  return (
    <MockupFrame
      className={className}
      title="Clínica Exemplo · Prontuário"
      description="Ilustração do prontuário com dados fictícios: a linha do tempo da Paciente Exemplo, com consultas e arquivos em ordem de data, e os quadros de alergias e medicações em uso."
    >
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="border-b border-line p-4 sm:border-b-0 sm:border-r">
          <p className="text-[13px] font-bold">Linha do tempo · Paciente Exemplo</p>
          <ol className="relative mt-4 space-y-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-line">
            {timeline.map((t) => (
              <li key={t.date} className="relative flex gap-3">
                <span className="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100">
                  <Icon icon={t.icon} size={14} />
                </span>
                <div className="min-w-0">
                  <p className="tabular text-[10.5px] font-semibold text-muted">{t.date}</p>
                  <p className="truncate text-[12.5px] font-bold">{t.title}</p>
                  <p className="truncate text-[11px] text-muted">{t.by}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded-[10px] border border-[#f1d4d0] bg-[#fdf3f2] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-danger">
              <Icon icon={TriangleAlert} size={13} /> Alergias
            </p>
            <p className="mt-1 text-[12px] font-semibold">Dipirona</p>
          </div>
          <div className="rounded-[10px] border border-line p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-teal-800">
              <Icon icon={Pill} size={13} /> Medicações em uso
            </p>
            <p className="mt-1 text-[12px] font-semibold">Losartana 50 mg</p>
            <p className="text-[11px] text-muted">1 comprimido ao dia</p>
          </div>
          <div className="rounded-[10px] border border-line p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-teal-800">
              <Icon icon={CalendarClock} size={13} /> Próximo retorno
            </p>
            <p className="tabular mt-1 text-[12px] font-semibold">fev/2027</p>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

/** Co-branding: the clinic's brand comes first; Cortex only as "com Cortex". */
export function CoBrandingIllustration({ className }: { className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <p className="sr-only">
        Ilustração da co-marca, com dados fictícios: a tela de entrada mostra o logotipo da Clínica Exemplo e, no rodapé, a
        indicação "com Cortex"; o pedido de exames impresso leva só a identidade da clínica e da Dra. Ana Exemplo.
      </p>
      <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#6b3fa0] text-[12px] font-extrabold text-white">
              CE
            </span>
            <span className="text-[14px] font-extrabold tracking-tight">Clínica Exemplo</span>
          </div>
          <div className="mt-5 space-y-2.5">
            <span className="block h-9 rounded-lg border border-line bg-bg" />
            <span className="block h-9 rounded-lg border border-line bg-bg" />
            <span className="block h-9 rounded-full bg-[#6b3fa0]" />
          </div>
          <p className="mt-5 text-center text-[11px] text-muted">com Cortex</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#6b3fa0] text-[10px] font-extrabold text-white">
                CE
              </span>
              <span className="text-[12px] font-extrabold">Clínica Exemplo</span>
            </div>
            <span className="text-[10px] font-semibold text-muted">Pedido de exames</span>
          </div>
          <div className="mt-3 space-y-1.5">
            <span className="block h-2 w-4/5 rounded-full bg-line" />
            <span className="block h-2 w-3/5 rounded-full bg-line" />
            <span className="block h-2 w-2/3 rounded-full bg-line" />
          </div>
          <div className="mt-8 border-t border-dashed border-line pt-2 text-center">
            <p className="text-[11px] font-bold">Dra. Ana Exemplo</p>
            <p className="text-[10px] text-muted">Cardiologia</p>
          </div>
        </div>
      </div>
    </div>
  );
}
