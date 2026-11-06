import { FileText, Mic, Sparkles } from 'lucide-react';
import { Icon, cx } from '../ui';
import { Avatar, MockupFrame } from './MockupFrame';

const bars = [
  'h-3 [animation-delay:0ms]',
  'h-5 [animation-delay:120ms]',
  'h-7 [animation-delay:240ms]',
  'h-4 [animation-delay:360ms]',
  'h-6 [animation-delay:480ms]',
  'h-8 [animation-delay:600ms]',
  'h-5 [animation-delay:720ms]',
  'h-3 [animation-delay:840ms]',
  'h-6 [animation-delay:960ms]',
  'h-4 [animation-delay:1080ms]',
  'h-7 [animation-delay:1200ms]',
  'h-3 [animation-delay:1320ms]',
];

const transcript = [
  { who: 'Dra. Ana', text: 'E a pressão, como ficou desde a última consulta?' },
  { who: 'Paciente', text: 'Medi em casa quase todo dia. Ficou entre 13 por 8 e 14 por 9.' },
  { who: 'Dra. Ana', text: 'Alguma dor no peito ou falta de ar?' },
  { who: 'Paciente', text: 'Não, nada disso.' },
];

const soap = [
  { k: 'S', text: 'Retorno. Medidas domiciliares entre 130×80 e 140×90 mmHg. Nega dor torácica e dispneia.' },
  { k: 'O', text: 'PA 138×86 mmHg, FC 72 bpm. Ausculta cardíaca sem alterações.' },
  { k: 'A', text: 'Hipertensão arterial em acompanhamento, controle parcial.' },
  { k: 'P', text: 'Manter medicação. Pedir hemograma, glicemia e creatinina. Retorno em 3 meses.' },
];

export function ConsultationMockup({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <MockupFrame
      className={className}
      title="Clínica Exemplo · Consulta"
      description="Ilustração da tela de consulta do Cortex, com dados fictícios: a gravação da consulta da Paciente Exemplo com a Dra. Ana Exemplo está em andamento, trechos da transcrição aparecem à esquerda e, à direita, a IA mostra um rascunho da evolução no formato SOAP, marcado como rascunho para revisão, com o botão Revisar e salvar."
    >
      {/* Patient header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar initials="PE" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold leading-tight">Paciente Exemplo</p>
            <p className="truncate text-[11px] leading-tight text-muted">54 anos · Retorno · Cardiologia</p>
          </div>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-[11px] font-semibold leading-tight">Dra. Ana Exemplo</p>
          <p className="tabular text-[11px] leading-tight text-muted">qui, 12/11/2026 · 14:30</p>
        </div>
      </div>

      <div className={cx('grid grid-cols-1 gap-0 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]')}>
        {/* Recording + transcript */}
        <div className="border-b border-line bg-[#fbfcfc] p-4 sm:border-b-0 sm:border-r">
          <div className="flex items-center justify-between rounded-[10px] bg-surface px-3 py-2.5 ring-1 ring-inset ring-line">
            <div className="flex items-center gap-2">
              <span className="rec-dot inline-block h-2.5 w-2.5 rounded-full bg-danger" />
              <span className="text-[12px] font-bold">Gravando</span>
              <span className="tabular text-[12px] font-semibold text-muted">08:42</span>
            </div>
            <Icon icon={Mic} size={16} className="text-teal-700" />
          </div>
          <div className="mt-3 flex h-8 items-end justify-center gap-[3px]">
            {bars.map((b, i) => (
              <span key={i} className={cx('wave-bar w-[3px] rounded-full bg-teal-600/70', b)} />
            ))}
          </div>

          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Transcrição</p>
          <ul className="mt-2 space-y-2">
            {transcript.slice(0, compact ? 2 : 4).map((line, i) => (
              <li key={i} className={cx('text-[12px] leading-[1.45]', i > 1 && 'hidden sm:block')}>
                <span className={cx('font-bold', line.who === 'Paciente' ? 'text-ink' : 'text-teal-700')}>
                  {line.who}:
                </span>{' '}
                <span className="text-ink/80">{line.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* AI draft */}
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12px] font-bold">
              <Icon icon={Sparkles} size={15} className="text-teal-700" />
              Evolução
            </p>
            <span className="rounded-full bg-signal-50 px-2 py-0.5 text-[10.5px] font-bold text-signal-700 ring-1 ring-inset ring-signal/50">
              Rascunho — revise antes de salvar
            </span>
          </div>
          <dl className="mt-3 space-y-2">
            {soap.map((s) => (
              <div key={s.k} className="flex gap-2.5">
                <dt className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-teal-50 text-[10px] font-extrabold text-teal-800 ring-1 ring-inset ring-teal-100">
                  {s.k}
                </dt>
                <dd className="text-[12px] leading-[1.45] text-ink/85">{s.text}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <p className="flex items-center gap-1.5 text-[10.5px] leading-tight text-muted">
              <Icon icon={FileText} size={13} />
              Gerado por IA a partir da gravação
            </p>
            <span className="inline-flex shrink-0 items-center rounded-full bg-teal-700 px-3 py-1.5 text-[11.5px] font-bold text-white">
              Revisar e salvar
            </span>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}
