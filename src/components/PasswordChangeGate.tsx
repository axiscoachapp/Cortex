import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandLockup } from '@/components/BrandLockup';
import { functionErrorBody } from '@/lib/functionErrors';
import {
  passwordChangePending,
  passwordProblem,
  temporaryPasswordExpired,
} from '../../supabase/functions/_shared/passwordPolicy';

const EXPIRED_MESSAGE = 'Senha temporária vencida. Peça uma nova ao administrador da clínica.';

/**
 * Accounts created by the clinic admin start with a temporary password. The server refuses
 * everything until the owner replaces it (app_metadata.must_change_password, set only by the
 * service role; the legacy user_metadata flag counts too). The change goes through the
 * change-initial-password function, never through auth.updateUser, and the session is
 * refreshed afterwards because the current token still carries the old claim.
 */
export function PasswordChangeGate({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user || !passwordChangePending(user)) return <>{children}</>;
  const isExpired = expired || temporaryPasswordExpired(user, new Date());

  const submit = async () => {
    setError('');
    const problem = passwordProblem(password, user.email ?? '');
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setBusy(true);
    try {
      const { error: invokeError } = await supabase.functions.invoke('change-initial-password', { body: { password } });
      if (invokeError) {
        const body = await functionErrorBody(invokeError);
        if (body?.code === 'temporary_password_expired') {
          setExpired(true);
          return;
        }
        setError(
          typeof body?.error === 'string' && body.code
            ? body.error
            : 'Não foi possível salvar a nova senha. Tente novamente.',
        );
        return;
      }
      // The new token no longer carries the flag; the gate closes when the session updates.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        setError('Senha salva. Entre novamente com a nova senha.');
        await signOut();
      }
    } catch {
      setError('Sem conexão com o servidor. Verifique a internet e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      {isExpired ? (
        <div className="w-full max-w-sm space-y-4">
          <BrandLockup />
          <h1 className="font-serif text-2xl">Senha temporária vencida</h1>
          <p role="alert" className="text-sm">
            {EXPIRED_MESSAGE}
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      ) : (
        <form
          className="w-full max-w-sm space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <BrandLockup />
          <h1 className="font-serif text-2xl">Defina sua senha</h1>
          <p className="text-sm text-muted-foreground">
            Sua conta foi criada pelo administrador da clínica com uma senha temporária. Escolha uma senha pessoal para
            continuar. Use pelo menos 10 caracteres, diferente da senha temporária.
          </p>
          <label className="block text-sm space-y-1.5">
            <span>Nova senha</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          <label className="block text-sm space-y-1.5">
            <span>Confirme a nova senha</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar e continuar'}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
            Sair
          </Button>
        </form>
      )}
    </main>
  );
}
