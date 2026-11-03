import { useState } from 'react';
import { ListChecks, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuestionChecklistCardProps {
  questions: string[];
  isLoading: boolean;
  onRefresh: () => void;
  error?: string;
}

export function QuestionChecklistCard({ questions, isLoading, onRefresh, error }: QuestionChecklistCardProps) {
  const [expanded, setExpanded] = useState(true);
  const signature = JSON.stringify(questions);
  const [selection, setSelection] = useState<{ signature: string; checked: Record<number, boolean> }>({ signature, checked: {} });
  const checked = selection.signature === signature ? selection.checked : {};
  const doneCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="rounded-lg border border-medical-blue/20 bg-medical-blue-light/25 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-5 h-5 rounded-md bg-medical-blue-light flex items-center justify-center shrink-0">
          <ListChecks className="w-3 h-3 text-medical-blue" />
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Roteiro de perguntas${questions.length ? ` ${doneCount}/${questions.length}` : ''}`}
          onClick={() => setExpanded(e => !e)}
          className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 text-left"
        >
          <span className="text-xs font-semibold text-medical-blue">Roteiro de perguntas</span>
          {questions.length > 0 && (
            <span className="text-[0.625rem] text-medical-blue/60 font-medium">
              {doneCount}/{questions.length}
            </span>
          )}
        </button>
        {questions.length > 0 && <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          title="Gerar novamente"
          aria-label="Gerar novo roteiro com IA"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-medical-blue/50 hover:text-medical-blue hover:bg-medical-blue-light transition-colors disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>}
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-label={expanded ? 'Recolher roteiro' : 'Expandir roteiro'}
          aria-expanded={expanded}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-medical-blue/50 hover:text-medical-blue"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5">
          {error && <p role="alert" className="text-xs text-destructive mb-2">{error}</p>}
          {isLoading && questions.length === 0 ? (
            <p className="text-[0.6875rem] text-medical-blue/60 py-1 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Preparando roteiro com base no histórico e na queixa…
            </p>
          ) : questions.length === 0 ? (
            <div className="space-y-2 py-1">
              <p className="text-xs leading-relaxed text-muted-foreground">Gere sugestões a partir do histórico e da queixa quando precisar.</p>
              <button type="button" onClick={onRefresh} className="text-xs font-medium text-medical-blue underline underline-offset-4">Gerar roteiro com IA</button>
            </div>
          ) : (
            <ul className="space-y-1">
              {questions.map((q, i) => (
                <li key={i}>
                  <label className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 py-0.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={!!checked[i]}
                      onChange={(e) => setSelection({ signature, checked: { ...checked, [i]: e.target.checked } })}
                      className="m-0 mt-[0.1875rem] h-3.5 w-3.5 rounded border-medical-blue/40 accent-medical-blue focus-visible:outline-medical-blue cursor-pointer"
                    />
                    <span className={cn(
                      'min-w-0 break-words text-xs leading-5 transition-colors',
                      checked[i] ? 'text-muted-foreground line-through' : 'text-foreground/80',
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
