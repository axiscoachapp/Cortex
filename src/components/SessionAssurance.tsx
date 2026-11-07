import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useContext, useEffect, useRef, useState } from 'react';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { Input } from '@/components/ui/input';
import { mfaErrorMessage } from '@/lib/mfa';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

function InlineFactorVerification({ onVerified }: { onVerified: () => void }) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState<{ message: string } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { errorRef.current?.focus(); }, [error]);
  const [busy, setBusy] = useState(false);
  const factors = useQuery({
    queryKey: ['mfa-factors-inline', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp.filter((f) => f.status === 'verified');
    },
    networkMode: 'always',
  });
  const verified = factors.data ?? [];
  const selected = factorId || verified[0]?.id || '';
  const submit = async () => {
    if (busy || code.length !== 6 || !selected || factors.isError) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: selected, code });
      if (error) throw error;
      setCode('');
      onVerified();
    } catch (err) {
      setError({ message: mfaErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {verified.length > 1 && (
        <label className="block text-sm">
          Autenticador
          <select
            className="block w-full border rounded p-2 mt-2"
            value={selected}
            disabled={busy}
            onChange={(e) => { setFactorId(e.target.value); setCode(''); setError(null); }}
          >
            {verified.map((f) => (
              <option key={f.id} value={f.id}>
                {f.friendly_name || 'Aplicativo autenticador'}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm space-y-2">
        <span>Código de 6 dígitos</span>
        <Input
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          disabled={busy}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {factors.isError && <div role="alert" className="space-y-2 text-sm">
        <p>Não foi possível carregar seus autenticadores.</p>
        <Button type="button" variant="outline" onClick={() => void factors.refetch()}>Carregar autenticadores novamente</Button>
      </div>}
      <Button type="submit" disabled={busy || code.length !== 6 || !selected || factors.isError}>
        {busy ? 'Verificando…' : 'Verificar código'}
      </Button>
    </form>
  );
}

export function SessionAssurance({ children }: { children: React.ReactNode }) {
  const { user, session, signOut } = useAuth();
  const parentHidden = useContext(SessionVisibilityContext);
  const workspaceFocus = useRef<{ actor: string; element: HTMLElement } | null>(null);
  const exit = () => {
    if (confirmSessionExit()) void signOut();
  };
  const query = useQuery({
    queryKey: ['session-assurance', user?.id, session?.expires_at],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      if (!data || !['aal1', 'aal2'].includes(data.currentLevel ?? '') || !['aal1', 'aal2'].includes(data.nextLevel ?? ''))
        throw new Error('Invalid session assurance');
      return data;
    },
    staleTime: 30000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    networkMode: 'always',
  });
  const [authorizedActor, setAuthorizedActor] = useState<string | null>(null);
  const needsFactor = query.data?.nextLevel === 'aal2' && query.data.currentLevel !== 'aal2';
  const allowed = !!user && query.isSuccess && query.isFetchedAfterMount && !needsFactor;
  useEffect(() => {
    if (allowed) setAuthorizedActor(user.id);
  }, [allowed, user?.id]);
  const checking = query.isPending || !query.isFetchedAfterMount;
  const gate = checking ? (
    <p role="status" className="py-2">
      Verificando sessão…
    </p>
  ) : query.isError ? (
    <div role="alert" className="space-y-3">
      <p>Não foi possível verificar a segurança da sessão.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => query.refetch()}>Tentar novamente</Button>
        <Button variant="outline" onClick={exit}>Sair</Button>
      </div>
    </div>
  ) : (
    <div className="space-y-4">
      <p>Confirme o código do aplicativo autenticador para abrir o ambiente clínico.</p>
      {/* Verified inline: navigating away would unmount the workspace and any
          recording in progress behind this gate. */}
      <InlineFactorVerification key={user?.id} onVerified={() => void query.refetch()} />
      <Button variant="outline" onClick={exit}>
        Sair
      </Button>
      <p className="text-xs text-muted-foreground">
        Perdeu o autenticador? <Link to="/seguranca" className="underline">Gerenciar autenticadores</Link>
      </p>
    </div>
  );
  return (
    <SessionVisibilityContext.Provider value={parentHidden || !allowed}>
      {(allowed || (!!user && authorizedActor === user.id)) && <div key={user?.id} data-session-content hidden={parentHidden || !allowed}
        onFocusCapture={event => {
          if (allowed && user && event.target instanceof HTMLElement) workspaceFocus.current = { actor: user.id, element: event.target };
        }}>{children}</div>}
      {/* A top modal suspends the existing Radix focus/pointer/ARIA layer while
          keeping its document state mounted. CSS alone cannot release that layer. */}
      {!allowed && <Dialog open={!parentHidden}>
        <DialogContent role="alertdialog" data-session-locked data-session-recovery
          className="inset-0 left-0 top-0 z-[120] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-background p-6 sm:rounded-none [&>button]:hidden"
          onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = workspaceFocus.current;
            // Radix pops its closing FocusScope after this callback. Wait until
            // the previous document scope has resumed and ARIA cleanup is done.
            requestAnimationFrame(() => {
              if (target?.actor === user?.id && target.element.isConnected
                && !target.element.closest('[hidden], [inert], [aria-hidden="true"]')
                && getComputedStyle(target.element).visibility !== 'hidden') target.element.focus({ preventScroll: true });
            });
          }}>
          <div className="max-w-lg mx-auto w-full self-start space-y-4">
            <DialogTitle className="font-serif text-3xl">{needsFactor && !query.isError && !checking ? 'Verifique seu acesso' : 'Segurança da sessão'}</DialogTitle>
            <DialogDescription>Verifique a sessão para continuar com segurança. O trabalho aberto permanece preservado.</DialogDescription>
            {gate}
          </div>
        </DialogContent>
      </Dialog>}
    </SessionVisibilityContext.Provider>
  );
}
