import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandLockup } from '@/components/BrandLockup';

/**
 * Accounts created by the clinic admin start with a temporary password
 * (user_metadata.must_change_password). The doctor must choose their own
 * password before using the app, so the admin never knows it.
 */
export function PasswordChangeGate({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!user?.user_metadata?.must_change_password || done) return <>{children}</>;

  const submit = async () => {
    setError('');
    if (password.length < 10) {
      setError('Use pelo menos 10 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    setBusy(false);
    if (updateError) {
      setError(
        /same|different/i.test(updateError.message)
          ? 'Escolha uma senha diferente da senha temporária.'
          : 'Não foi possível salvar a nova senha. Tente novamente.',
      );
      return;
    }
    setDone(true);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
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
          continuar.
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
    </main>
  );
}
