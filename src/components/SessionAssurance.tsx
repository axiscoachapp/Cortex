import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { SessionVisibilityContext } from '@/contexts/SessionVisibility';
import { confirmSessionExit } from '@/hooks/useUnsavedChanges';
import { Input } from '@/components/ui/input';
import { mfaErrorMessage } from '@/lib/mfa';

function InlineFactorVerification({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const factors = useQuery({
    queryKey: ['mfa-factors-inline'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp.filter((f) => f.status === 'verified');
    },
  });
  const verified = factors.data ?? [];
  const selected = factorId || verified[0]?.id || '';
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: selected, code });
      if (error) throw error;
      setCode('');
      onVerified();
    } catch (err) {
      setError(mfaErrorMessage(err));
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
            onChange={(e) => setFactorId(e.target.value)}
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
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || code.length !== 6 || !selected}>
        {busy ? 'Verificando…' : 'Verificar código'}
      </Button>
    </form>
  );
}

export function SessionAssurance({ children }: { children: React.ReactNode }) {
  const { user, session, signOut } = useAuth();
  const exit = () => {
    if (confirmSessionExit()) void signOut();
  };
  const query = useQuery({
    queryKey: ['session-assurance', user?.id, session?.expires_at],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return data;
    },
    staleTime: 30000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
  const [previouslyAuthorized, setPreviouslyAuthorized] = useState(false);
  const needsFactor = query.data?.nextLevel === 'aal2' && query.data.currentLevel !== 'aal2';
  const allowed = !!query.data && !query.isError && !needsFactor;
  useEffect(() => {
    if (allowed) setPreviouslyAuthorized(true);
  }, [allowed]);
  const gate = query.isLoading ? (
    <p role="status" className="p-6">
      Verificando sessão…
    </p>
  ) : query.isError ? (
    <div role="alert" className="p-6 space-y-3">
      <p>Não foi possível verificar a segurança da sessão. O trabalho já aberto permanece preservado.</p>
      <Button onClick={() => query.refetch()}>Tentar novamente</Button>
      <Button variant="outline" onClick={exit}>
        Sair
      </Button>
    </div>
  ) : (
    <main className="max-w-lg mx-auto p-8 space-y-4">
      <h1 className="font-serif text-3xl">Verifique seu acesso</h1>
      <p>Confirme o código do aplicativo autenticador para abrir o ambiente clínico.</p>
      {/* Verified inline: navigating away would unmount the workspace and any
          recording in progress behind this gate. */}
      <InlineFactorVerification onVerified={() => void query.refetch()} />
      <Button variant="outline" onClick={exit}>
        Sair
      </Button>
      <p className="text-xs text-muted-foreground">
        Perdeu o autenticador? <Link to="/seguranca" className="underline">Gerenciar autenticadores</Link>
      </p>
    </main>
  );
  return (
    <SessionVisibilityContext.Provider value={!allowed}>
      {(allowed || previouslyAuthorized) && <div data-session-content hidden={!allowed}>{children}</div>}
      {!allowed && (
        <div data-session-locked="true" className="fixed inset-0 z-[100] bg-background overflow-y-auto">
          {gate}
        </div>
      )}
    </SessionVisibilityContext.Provider>
  );
}
