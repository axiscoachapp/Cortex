import { useState } from 'react';
import { BookmarkPlus, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDocumentSnippets } from '@/hooks/useDocumentSnippets';
import { DocumentSnippet, SnippetItem, snippetItemsFrom } from '@/lib/documentSnippets';

interface PrescriptionTemplatePickerProps {
  /** Medications currently checked in the composer. */
  selected: Array<{ name: string; dosage?: string; instructions?: string }>;
  /** Fill the prescription with a template's items; the doctor edits after. */
  onApply: (items: SnippetItem[]) => void;
  disabled?: boolean;
}

/** Choose one of the doctor's approved templates, or save the selection as one. */
export function PrescriptionTemplatePicker({ selected, onApply, disabled }: PrescriptionTemplatePickerProps) {
  const { snippets, isLoading, isError, retry, saveSnippet, archiveSnippet, isSaving } = useDocumentSnippets();
  const [applied, setApplied] = useState<DocumentSnippet | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const items = snippetItemsFrom(selected);
  const busy = disabled || isSaving;

  const choose = (id: string) => {
    const snippet = snippets.find((s) => s.id === id);
    if (!snippet) return;
    setApplied(snippet);
    setStatus(`Modelo "${snippet.name}" aplicado. Revise antes de gerar.`);
    setError('');
    onApply(snippet.items);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!items || !trimmed || busy) return;
    setError('');
    try {
      await saveSnippet({ name: trimmed, items });
      setNaming(false);
      setName('');
      setStatus(`Modelo "${trimmed}" salvo.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o modelo.');
    }
  };

  const archive = async () => {
    if (!applied || busy || !window.confirm(`Arquivar o modelo "${applied.name}"? Ele deixa de aparecer na lista.`)) return;
    setError('');
    try {
      await archiveSnippet(applied);
      setStatus(`Modelo "${applied.name}" arquivado.`);
      setApplied(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível arquivar o modelo.');
    }
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <label htmlFor="prescription-template" className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
        <Library className="w-3 h-3" />
        Modelos de receita
      </label>
      <div className="flex gap-2">
        <select
          id="prescription-template"
          className="h-9 min-w-0 flex-1 rounded-md border px-2 text-sm bg-background"
          value=""
          disabled={busy || isLoading || snippets.length === 0}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">
            {isLoading ? 'Carregando modelos…' : snippets.length === 0 ? 'Nenhum modelo salvo' : 'Escolher um modelo…'}
          </option>
          {snippets.map((snippet) => (
            <option key={snippet.id} value={snippet.id}>
              {snippet.name} ({snippet.items.length} {snippet.items.length === 1 ? 'item' : 'itens'})
            </option>
          ))}
        </select>
        {!naming && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 shrink-0"
            disabled={busy || !items}
            title={items ? undefined : 'Selecione de 1 a 15 medicamentos com nome'}
            onClick={() => {
              setNaming(true);
              setStatus('');
              setError('');
            }}
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            Salvar como modelo
          </Button>
        )}
      </div>
      {naming && (
        <div className="flex gap-2">
          <Input
            aria-label="Nome do novo modelo"
            autoFocus
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="Ex.: Infecção urinária não complicada"
          />
          <Button type="button" size="sm" disabled={busy || !name.trim() || !items} onClick={() => void save()}>
            {isSaving ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isSaving} onClick={() => setNaming(false)}>
            Cancelar
          </Button>
        </div>
      )}
      {applied && !naming && (
        <button type="button" className="text-[0.6875rem] text-muted-foreground underline" disabled={busy} onClick={() => void archive()}>
          Arquivar o modelo "{applied.name}"
        </button>
      )}
      {isError && (
        <p role="alert" className="text-xs text-destructive">
          Não foi possível carregar os modelos.{' '}
          <button type="button" className="underline" onClick={() => retry()}>
            Tentar novamente
          </button>
        </p>
      )}
      {status && (
        <p role="status" className="text-[0.6875rem] text-muted-foreground">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
