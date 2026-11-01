import { useState } from 'react';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { functionErrorMessage } from '@/lib/functionErrors';
import type { CommentProposal } from '@/types/patient';

interface Props {
  patientId: string;
  comment: string;
  proposal: CommentProposal;
  expectedRevision: number;
  /** Called with the server summary once the approved subset is applied. */
  onApplied: (summary: string) => void;
}

type Key = string;

/**
 * Physician review of changes the AI extracted from a free-text comment.
 * Nothing is written to the chart until the doctor confirms; unchecked items
 * are never applied.
 */
export function CommentProposalCard({ patientId, comment, proposal, expectedRevision, onApplied }: Props) {
  const items: Array<{ key: Key; label: string }> = [
    ...proposal.allergies.map((a, i) => ({ key: `allergy-${i}`, label: `Adicionar alergia: ${a}` })),
    ...proposal.medicationsAdd.map((m, i) => ({
      key: `med-add-${i}`,
      label: `Adicionar/alterar medicação: ${m.name}${m.dosage ? ` ${m.dosage}` : ''}`,
    })),
    ...proposal.medicationsRemove.map((m, i) => ({ key: `med-remove-${i}`, label: `Suspender medicação: ${m}` })),
    ...proposal.diagnoses.map((d, i) => ({
      key: `diag-${i}`,
      label: `Adicionar diagnóstico: ${d.code ? `${d.code} ` : ''}${d.description}`,
    })),
    ...(proposal.addendum ? [{ key: 'addendum', label: `Adendo na consulta de hoje: ${proposal.addendum}` }] : []),
    ...(proposal.longTermNote ? [{ key: 'note', label: `Anotação no prontuário: ${proposal.longTermNote}` }] : []),
  ];
  const [selected, setSelected] = useState<Set<Key>>(() => new Set(items.map((item) => item.key)));
  const [state, setState] = useState<'pending' | 'saving' | 'done' | 'dismissed'>('pending');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');

  const toggle = (key: Key) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = async () => {
    setState('saving');
    setError('');
    const approved = {
      allergies: proposal.allergies.filter((_, i) => selected.has(`allergy-${i}`)),
      medicationsAdd: proposal.medicationsAdd.filter((_, i) => selected.has(`med-add-${i}`)),
      medicationsRemove: proposal.medicationsRemove.filter((_, i) => selected.has(`med-remove-${i}`)),
      diagnoses: proposal.diagnoses.filter((_, i) => selected.has(`diag-${i}`)),
      addendum: selected.has('addendum') ? proposal.addendum : '',
      longTermNote: selected.has('note') ? proposal.longTermNote : '',
    };
    const { data, error: invokeError } = await supabase.functions.invoke('process-comment', {
      body: { patientId, comment, mode: 'apply', expectedRevision, approved },
    });
    if (invokeError || !data?.applied) {
      setError(await functionErrorMessage(invokeError, 'Não foi possível aplicar. Tente novamente.'));
      setState('pending');
      return;
    }
    const text = typeof data.summary === 'string' ? data.summary : 'Alterações aplicadas.';
    setSummary(text);
    setState('done');
    onApplied(text);
  };

  if (state === 'dismissed')
    return <p className="text-xs text-muted-foreground">Sugestões descartadas. Nada foi alterado no prontuário.</p>;
  if (state === 'done')
    return (
      <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50/60 p-3 text-sm">
        <CheckCircle2 className="w-4 h-4 text-green-700 mt-0.5 shrink-0" />
        <span>{summary}</span>
      </div>
    );

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-amber-700" />
        <p className="text-sm font-semibold">Revise antes de aplicar ao prontuário</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Sugestões extraídas pela IA do seu comentário. Desmarque o que não estiver correto; nada é salvo sem sua
        confirmação.
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key}>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(item.key)}
                onChange={() => toggle(item.key)}
                disabled={state === 'saving'}
              />
              <span>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void apply()} disabled={state === 'saving' || selected.size === 0}>
          {state === 'saving' ? 'Aplicando…' : `Aplicar selecionados (${selected.size})`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setState('dismissed')} disabled={state === 'saving'}>
          Descartar
        </Button>
      </div>
    </div>
  );
}
