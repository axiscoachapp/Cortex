import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { afterConfirmedSaveOrDiscard, pendingExit, runExitGuards } from '@/hooks/useUnsavedChanges';
import { dialogLayout } from '@/lib/dialogLayout';
import { cn } from '@/lib/utils';

/**
 * "Sair da conta?" — the only way to sign out from the navigation. It always asks;
 * an operation that must finish (a recording being saved) keeps "Sair" disabled,
 * and unsaved text is named before it is discarded.
 */
export function SignOutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(pendingExit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (open) { setState(pendingExit()); setError(''); } }, [open]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const confirm = async () => {
    const now = pendingExit();
    if (now.locked) { setState(now); return; }
    if (!runExitGuards()) { onOpenChange(false); return; }
    setBusy(true); setError('');
    try {
      await signOut();
      onOpenChange(false);
      afterConfirmedSaveOrDiscard(() => navigate('/auth', { replace: true }));
    } catch {
      setError('Não foi possível sair da conta. A sessão continua aberta; verifique sua conexão e tente de novo.');
    } finally { setBusy(false); }
  };
  return <AlertDialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <AlertDialogContent className="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>Sair da conta?</AlertDialogTitle>
        <AlertDialogDescription>
          {state.locked ?? (state.unsaved ? 'Há alterações não salvas nesta tela. Se sair agora, elas serão descartadas.' : 'Para voltar, entre de novo com seu e-mail e senha.')}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-3">
        {error && <p ref={errorRef} role="alert" tabIndex={-1} className={dialogLayout.error}>{error}</p>}
        <div className={dialogLayout.actions}>
          <Button type="button" variant="outline" className={dialogLayout.button} onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button type="button" className={dialogLayout.button} onClick={() => void confirm()} disabled={busy || !!state.locked}>{busy ? 'Saindo…' : 'Sair'}</Button>
        </div>
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}

/** The labelled "Sair" entry of the sidebar footer. */
export function SignOutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="ghost" className={cn('workspace-nav-item h-auto w-full justify-start font-normal', className)} onClick={() => setOpen(true)}>
      <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />Sair
    </Button>
    <SignOutDialog open={open} onOpenChange={setOpen} />
  </>;
}
