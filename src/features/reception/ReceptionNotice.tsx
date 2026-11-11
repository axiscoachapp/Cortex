import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Loading and error states of the reception screens: one boxed notice, with a retry when it helps. */
export function ReceptionNotice({
  error,
  loading,
  onRetry,
}: {
  error?: unknown;
  loading?: boolean;
  onRetry?: () => void;
}) {
  if (loading)
    return (
      <p role="status" className="flex gap-2 items-center p-4 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando…
      </p>
    );
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2 text-sm">
      <p>{error instanceof Error ? error.message : 'Não foi possível carregar os dados.'}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="min-h-11" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/** A page the person cannot use: its name, one sentence saying why, and a way back. */
export function ReceptionAccessNotice({
  title,
  message,
  backTo = '/recepcao',
  backLabel = 'Voltar aos atendimentos',
  headingLevel = 1,
}: {
  title: string;
  message: string;
  backTo?: string;
  backLabel?: string;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div className="space-y-4">
      <Heading className="text-2xl font-semibold leading-tight tracking-tight">{title}</Heading>
      <div role="alert" className="max-w-2xl space-y-3 rounded-lg border bg-card p-4 text-sm">
        <p>{message}</p>
        <Button asChild variant="outline" className="h-auto min-h-11 max-w-full gap-2 whitespace-normal">
          <Link to={backTo}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{backLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
