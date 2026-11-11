import { useEffect, useRef } from 'react';



/**
 * A dialog's submit error, rendered directly above its footer buttons. Each new
 * error is scrolled into view and focused, so it is never hidden under the header
 * or below the fold of a scrolled body.
 */
export function FormError({ error, message }: { error: unknown; message?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error || !box.current) return;
    box.current.scrollIntoView?.({ block: 'nearest' });
    box.current.focus({ preventScroll: true });
  }, [error]);
  if (!error) return null;
  const text = message ?? (error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.');
  return (
    <div ref={box} role="alert" tabIndex={-1} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-destructive/40">
      {text}
    </div>
  );
}
