import { Sparkles, AlertTriangle, CircleHelp, MessageSquarePlus, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CopilotState {
  resumo: string[];
  alertas: string[];
  nao_explorado: string[];
  sugestoes: string[];
}

interface LiveCopilotCardProps {
  state: CopilotState | null;
  /** True between a chunk closing and the refreshed state arriving. */
  isRefreshing: boolean;
  /** Seconds since the last successful refresh (null before the first). */
  secondsSinceUpdate: number | null;
  onDismissSuggestion: (text: string) => void;
}

export function LiveCopilotCard({
  state,
  isRefreshing,
  secondsSinceUpdate,
  onDismissSuggestion,
}: LiveCopilotCardProps) {
  const hasContent = !!state && (
    state.resumo.length > 0 || state.alertas.length > 0 ||
    state.nao_explorado.length > 0 || state.sugestoes.length > 0
  );

  return (
    <div className="rounded-lg border border-violet-200/70 bg-violet-50/50 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-violet-200/50 bg-violet-100/40">
        <div className="w-5 h-5 rounded-md bg-violet-200/70 flex items-center justify-center shrink-0">
          <Sparkles className="w-3 h-3 text-violet-700" />
        </div>
        <span className="text-xs font-semibold text-violet-800 flex-1">Copiloto ao vivo</span>
        <span className="text-[10px] text-violet-600/70 font-medium flex items-center gap-1">
          {isRefreshing ? (
            <><Loader2 className="w-2.5 h-2.5 animate-spin" />analisando…</>
          ) : secondsSinceUpdate === null ? (
            'aguardando…'
          ) : (
            `atualizado há ${secondsSinceUpdate}s`
          )}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-3">
        {!hasContent ? (
          <p className="text-[11px] text-violet-700/60 leading-relaxed py-1">
            O copiloto resume a consulta e sugere perguntas a cada ~30&nbsp;segundos.
            A evolução clínica final continua sendo gerada da gravação completa.
          </p>
        ) : (
          <>
            {/* Alerts — highest priority */}
            {state!.alertas.length > 0 && (
              <Section icon={AlertTriangle} tone="red" label="Alertas">
                {state!.alertas.map((a, i) => (
                  <li key={i} className="text-[11px] text-red-800/90 flex items-start gap-1.5 leading-snug">
                    <span className="mt-1 w-1 h-1 rounded-full bg-red-400 shrink-0" />
                    {a}
                  </li>
                ))}
              </Section>
            )}

            {/* Rolling summary */}
            {state!.resumo.length > 0 && (
              <Section icon={Sparkles} tone="violet" label="Resumo até agora">
                {state!.resumo.map((r, i) => (
                  <li key={i} className="text-[11px] text-violet-900/85 flex items-start gap-1.5 leading-snug">
                    <span className="mt-1 w-1 h-1 rounded-full bg-violet-400 shrink-0" />
                    {r}
                  </li>
                ))}
              </Section>
            )}

            {/* Unexplored topics */}
            {state!.nao_explorado.length > 0 && (
              <Section icon={CircleHelp} tone="amber" label="Não explorado">
                {state!.nao_explorado.map((n, i) => (
                  <li key={i} className="text-[11px] text-amber-800/90 flex items-start gap-1.5 leading-snug">
                    <span className="mt-1 w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                    {n}
                  </li>
                ))}
              </Section>
            )}

            {/* Suggested questions — dismissable */}
            {state!.sugestoes.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <MessageSquarePlus className="w-3 h-3 text-violet-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600">
                    Sugestões de perguntas
                  </span>
                </div>
                <div className="space-y-1">
                  {state!.sugestoes.map((s, i) => (
                    <div
                      key={i}
                      className="group flex items-start gap-2 rounded-md bg-white/70 border border-violet-200/60 px-2.5 py-1.5"
                    >
                      <span className="flex-1 text-[11px] text-violet-900/85 leading-snug">"{s}"</span>
                      <button
                        type="button"
                        onClick={() => onDismissSuggestion(s)}
                        title="Descartar sugestão"
                        className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-violet-400/60 hover:text-violet-700 hover:bg-violet-100 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const toneStyles = {
  red:    'text-red-600',
  violet: 'text-violet-600',
  amber:  'text-amber-600',
};

function Section({
  icon: Icon,
  tone,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof toneStyles;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('w-3 h-3', toneStyles[tone])} />
        <span className={cn('text-[10px] font-bold uppercase tracking-wider', toneStyles[tone])}>{label}</span>
      </div>
      <ul className="space-y-0.5 pl-0.5">{children}</ul>
    </div>
  );
}
