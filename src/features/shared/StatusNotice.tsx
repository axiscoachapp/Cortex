import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// One way to show the three states every reception, finance, team and settings screen shares:
// loading, a read that failed, and a page or action the person is not allowed to use.

/** "Carregando…" in a polite live region. */
export function LoadingNotice({ label = 'Carregando…', className }: { label?: string; className?: string }) {
  return (
    <p role="status" className={cn('flex items-center gap-2 p-4 text-sm text-muted-foreground', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}

/** The sentence a failed read shows when the screen has nothing more specific to say. */
export const loadErrorText = (subject = 'os dados') => `Não foi possível carregar ${subject}. Verifique a conexão e tente de novo.`;

/**
 * A read that failed: one plain sentence and "Tentar novamente". Never the raw server text; pass
 * `message` only with a sentence written for people.
 */
export function LoadErrorNotice({ subject, message, onRetry, retrying = false, className }: {
  /** What did not load, as it reads after "carregar": "o financeiro", "a agenda". */
  subject?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm', className)}>
      <p>{message ?? loadErrorText(subject)}</p>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" className="min-h-11 gap-2" disabled={retrying} onClick={onRetry}>
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/**
 * A page or section the person cannot use: its name, what they cannot do, who can grant it, and a
 * way back. The server stays the boundary; this only explains it.
 */
export function NoAccessNotice({
  title,
  message,
  grantedBy = 'o administrador da clínica',
  backTo = '/recepcao',
  backLabel = 'Voltar aos atendimentos',
  headingLevel = 1,
  className,
}: {
  title?: string;
  message: string;
  /** Who can give access, as it reads after "Quem pode liberar:". `null` hides the line. */
  grantedBy?: string | null;
  backTo?: string | null;
  backLabel?: string;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = (['h1', 'h2', 'h3'] as const)[headingLevel - 1];
  return (
    <div className={cn('space-y-4', className)}>
      {title && <Heading className={cn('font-semibold leading-tight tracking-tight', headingLevel === 1 ? 'text-2xl' : 'text-lg')}>{title}</Heading>}
      <div role="alert" className="max-w-2xl space-y-3 rounded-lg border bg-card p-4 text-sm">
        <p className="flex items-start gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{message}</span></p>
        {grantedBy && <p className="text-muted-foreground">Quem pode liberar: {grantedBy}.</p>}
        {backTo && (
          <Button asChild variant="outline" className="h-auto min-h-11 max-w-full gap-2 whitespace-normal">
            <Link to={backTo}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{backLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
