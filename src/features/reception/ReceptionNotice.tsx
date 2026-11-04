import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
        <Button size="sm" variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
