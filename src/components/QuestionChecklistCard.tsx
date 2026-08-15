import { useState } from 'react';
import { ListChecks, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuestionChecklistCardProps {
  questions: string[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function QuestionChecklistCard({ questions, isLoading, onRefresh }: QuestionChecklistCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  // Nothing to show and not loading — render nothing (keeps the header clean).
  if (!isLoading && questions.length === 0) return null;

  const doneCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="rounded-lg border border-medical-blue/20 bg-medical-blue-light/25 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-5 h-5 rounded-md bg-medical-blue-light flex items-center justify-center shrink-0">
          <ListChecks className="w-3 h-3 text-medical-blue" />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex-1 flex items-center gap-2 text-left"
        >
          <span className="text-xs font-semibold text-medical-blue">Roteiro de perguntas</span>
          {questions.length > 0 && (
            <span className="text-[10px] text-medical-blue/60 font-medium">
              {doneCount}/{questions.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          title="Gerar novamente"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-medical-blue/50 hover:text-medical-blue hover:bg-medical-blue-light transition-colors disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-medical-blue/50 hover:text-medical-blue"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5">
          {isLoading && questions.length === 0 ? (
            <p className="text-[11px] text-medical-blue/60 py-1 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Preparando roteiro com base no histórico e na queixa…
            </p>
          ) : (
            <ul className="space-y-1">
              {questions.map((q, i) => (
                <li key={i}>
                  <label className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={!!checked[i]}
                      onChange={(e) => setChecked(prev => ({ ...prev, [i]: e.target.checked }))}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-medical-blue/40 text-medical-blue focus:ring-medical-blue/30 cursor-pointer"
                    />
                    <span className={cn(
                      'text-[11px] leading-snug transition-colors',
                      checked[i] ? 'text-muted-foreground/50 line-through' : 'text-foreground/80',
                    )}>
                      {q}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
