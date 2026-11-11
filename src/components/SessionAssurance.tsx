import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useContext, useEffect, useRef, useState } from 'react';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { SessionPausedContext, SessionVisibilityContext } from '@/contexts/SessionVisibility';
import { useGraceExpired, VERIFICATION_RETRIES, VERIFICATION_RETRY_DELAY_MS } from '@/hooks/useVerificationGrace';
import { sessionIdOf } from '@/lib/sessionIdentity';
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
  const parentPaused = useContext(SessionPausedContext);
  const workspaceFocus = useRef<{ actor: string; element: HTMLElement } | null>(null);
  const exit = () => {
    if (confirmSessionExit()) void signOut();
  };
  // Identity = user + auth session. A token refresh (new expires_at, same
  // session) is not a change of identity and keeps the verified result.
  const sessionId = sessionIdOf(session?.access_token);
  const identity = user ? user.id + ':' + (sessionId ?? '') : null;
  const [verifiedIdentity, setVerifiedIdentity] = useState<string | null>(null);
  const retryable = useRef({ identity, verifiedIdentity });
  retryable.current = { identity, verifiedIdentity };
  const query = useQuery({
    queryKey: ['session-assurance', user?.id, sessionId],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      if (!data || !['aal1', 'aal2'].includes(data.currentLevel ?? '') || !['aal1', 'aal2'].includes(data.nextLevel ?? ''))
        throw new Error('Invalid session assurance');
      return data;
    },
    // Retry a transport failure quickly, only for an identity already verified here.
    retry: (count, error) => count < VERIFICATION_RETRIES && isAuthRetryableFetchError(error)
      && !!retryable.current.identity && retryable.current.verifiedIdentity === retryable.current.identity,
    retryDelay: VERIFICATION_RETRY_DELAY_MS,
    // Keep trying while a transport failure is inside its grace period.
    refetchInterval: current => current.state.status === 'error' && isAuthRetryableFetchError(current.state.error) ? 10_000 : false,
    staleTime: 30000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    networkMode: 'always',
  });
  const refetchAssurance = query.refetch;
  const expiry = session?.expires_at;
  const seen = useRef({ expiry, identity });
  useEffect(() => {
    const previous = seen.current;
    seen.current = { expiry, identity };
    // Same identity, new token: re-verify in the background without hiding.
    if (identity && previous.identity === identity && previous.expiry !== expiry) void refetchAssurance();
  }, [expiry, identity, refetchAssurance]);
  const [authorizedActor, setAuthorizedActor] = useState<string | null>(null);
  const needsFactor = query.data?.nextLevel === 'aal2' && query.data.currentLevel !== 'aal2';
  const verifiedNow = !!user && query.isSuccess && query.isFetchedAfterMount && !needsFactor;
  const transportFailure = query.isError && isAuthRetryableFetchError(query.error);
  const definitiveFailure = (query.isError && !transportFailure) || (query.isSuccess && needsFactor);
  useEffect(() => {
    if (verifiedNow) setVerifiedIdentity(identity);
    // A definitive refusal ends the grace for good: a later transport error must not revive it.
    else if (definitiveFailure) setVerifiedIdentity(null);
  }, [verifiedNow, definitiveFailure, identity]);
  const failing = transportFailure && !!identity && verifiedIdentity === identity && !!query.data && !needsFactor;
  const expired = useGraceExpired(failing, identity);
  const allowed = !!user && (verifiedNow || (failing && !expired));
  const paused = allowed && (query.isError || query.failureCount > 0);
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
      <SessionPausedContext.Provider value={parentPaused || paused}>
      {(allowed || (!!user && authorizedActor === user.id)) && <div key={user?.id} data-session-content hidden={parentHidden || !allowed}
        onFocusCapture={event => {
          if (allowed && user && event.target instanceof HTMLElement) workspaceFocus.current = { actor: user.id, element: event.target };
        }}>{children}</div>}
      {/* Fixed, so it never shifts the workspace layout or steals focus. */}
      {allowed && query.isError && !parentHidden && (
        <div role="status" aria-label="Estado da verificação da sessão" data-session-grace
          className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-md rounded-lg border border-border bg-muted p-3 text-sm shadow-md">
          <p>Não foi possível atualizar a verificação da sessão. O trabalho aberto permanece disponível.</p>
          <Button className="mt-2 h-auto min-h-9 max-w-full whitespace-normal" size="sm" variant="outline" disabled={query.isFetching}
            onClick={() => void query.refetch()}>Verificar sessão novamente</Button>
        </div>
      )}
      </SessionPausedContext.Provider>
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
