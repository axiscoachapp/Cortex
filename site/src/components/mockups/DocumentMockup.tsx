import { Check, Plus, Search } from 'lucide-react';
import { Icon, cx } from '../ui';
import { MockupFrame } from './MockupFrame';

const tabs = ['Receita', 'Controle especial', 'Pedido de exames', 'Atestado'];

export function DocumentMockup({ className }: { className?: string }) {
  return (
    <MockupFrame
      className={className}
      title="Clínica Exemplo · Documentos"
      description="Ilustração do editor de documentos do Cortex, com dados fictícios: um pedido de exames para a Paciente Exemplo, com a busca na tabela TUSS mostrando o código 40304361, Hemograma com contagem de plaquetas, a lista de exames solicitados e a indicação clínica em texto livre."
    >
      <div className="flex gap-1 overflow-hidden border-b border-line px-3 pt-2.5">
        {tabs.map((t) => (
          <span
            key={t}
            className={cx(
              'whitespace-nowrap rounded-t-lg px-2.5 pb-2 pt-1 text-[11.5px] font-bold',
              t === 'Pedido de exames' ? 'border-b-2 border-teal-700 text-teal-800' : 'text-muted',
              (t === 'Controle especial' || t === 'Atestado') && 'hidden sm:inline',
            )}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-[13px] font-bold">Pedido de exames · Paciente Exemplo</p>
          <p className="text-[11px] text-muted">Dra. Ana Exemplo</p>
        </div>

        {/* TUSS search */}
        <div>
          <p className="text-[11px] font-bold text-ink/80">Buscar exame (tabela TUSS)</p>
          <div className="mt-1.5 rounded-[10px] ring-2 ring-teal-700/25">
            <div className="flex items-center gap-2 rounded-t-[10px] border border-teal-700 bg-surface px-3 py-2">
              <Icon icon={Search} size={14} className="text-muted" />
              <span className="text-[12px]">hemograma</span>
              <span className="h-3.5 w-px bg-ink motion-safe:animate-pulse" />
            </div>
            <ul className="rounded-b-[10px] border border-t-0 border-line bg-surface">
              <li className="flex items-center gap-3 bg-teal-50 px-3 py-2">
                <span className="tabular rounded bg-surface px-1.5 py-0.5 text-[10.5px] font-bold text-teal-800 ring-1 ring-inset ring-teal-100">
                  40304361
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                  Hemograma com contagem de plaquetas
                </span>
                <Icon icon={Plus} size={15} className="shrink-0 text-teal-700" />
              </li>
              <li className="px-3 py-1.5 text-[10.5px] text-muted">Busque pelo nome ou pelo começo do código</li>
            </ul>
          </div>
        </div>

        {/* Requested exams */}
        <div>
          <p className="text-[11px] font-bold text-ink/80">Exames solicitados</p>
          <ul className="mt-1.5 divide-y divide-line rounded-[10px] border border-line">
            <li className="flex items-center gap-2 px-3 py-2 text-[12px]">
              <Icon icon={Check} size={14} className="shrink-0 text-teal-700" />
              <span className="min-w-0 truncate">
                Hemograma com contagem de plaquetas <span className="tabular text-muted">(TUSS 40304361)</span>
              </span>
            </li>
            <li className="flex items-center gap-2 px-3 py-2 text-[12px]">
              <Icon icon={Check} size={14} className="shrink-0 text-teal-700" />
              Glicemia de jejum
            </li>
            <li className="flex items-center gap-2 px-3 py-2 text-[12px]">
              <Icon icon={Check} size={14} className="shrink-0 text-teal-700" />
              Creatinina
            </li>
          </ul>
        </div>

        {/* Clinical indication (free text in the app) */}
        <div>
          <p className="text-[11px] font-bold text-ink/80">Indicação clínica</p>
          <div className="mt-1.5 rounded-[10px] border border-line px-3 py-2">
            <span className="block min-w-0 truncate text-[12px]">Acompanhamento de hipertensão</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="truncate text-[10.5px] text-muted">Modelo: Retorno de hipertensão</span>
          <div className="flex gap-2">
            <span className="rounded-full px-3 py-1.5 text-[11.5px] font-bold text-ink ring-1 ring-inset ring-line">
              Pré-visualizar
            </span>
            <span className="rounded-full bg-teal-700 px-3 py-1.5 text-[11.5px] font-bold text-white">Gerar pedido</span>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}
