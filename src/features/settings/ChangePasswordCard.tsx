import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { functionErrorBody } from '@/lib/functionErrors';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../../../supabase/functions/_shared/passwordPolicy';

/**
 * "Alterar senha" on /seguranca. The server (change-password) proves the current password and
 * applies the same rule as here (passwordPolicy.ts); this check only answers sooner.
 */
export function ChangePasswordCard() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<{ field: 'current' | 'password' | 'confirm' | null; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Settings links here as /seguranca#alterar-senha.
  useEffect(() => { if (window.location.hash === '#alterar-senha') document.getElementById('alterar-senha')?.scrollIntoView?.({ block: 'start' }); }, []);

  const fail = (field: 'current' | 'password' | 'confirm' | null, text: string) => {
    setError({ field, text });
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setDone(false);
    if (!current) return fail('current', 'Informe a senha atual.');
    const problem = passwordProblem(password, user?.email ?? '');
    if (problem) return fail('password', problem);
    if (password === current) return fail('password', 'Escolha uma senha diferente da atual.');
    if (password !== confirm) return fail('confirm', 'As senhas não coincidem.');
    setError(null);
    setBusy(true);
    try {
      const { error: invokeError } = await supabase.functions.invoke('change-password', { body: { currentPassword: current, password } });
      if (invokeError) {
        const body = await functionErrorBody(invokeError);
        const text = typeof body?.error === 'string' && body.code ? body.error : 'Não foi possível trocar a senha agora. Tente novamente.';
        return fail(body?.code === 'wrong_password' || body?.code === 'current_required' ? 'current' : body?.code === 'weak_password' || body?.code === 'same_as_current' ? 'password' : null, text);
      }
      setCurrent('');
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch {
      fail(null, 'Sem conexão com o servidor. Verifique a internet e tente novamente.');
    } finally {
      setBusy(false);
    }
  };
  const invalid = (field: 'current' | 'password' | 'confirm') => error?.field === field;
  const described = (field: 'current' | 'password' | 'confirm') => (invalid(field) ? 'change-password-error' : undefined);

  return (
    <section id="alterar-senha" className="scroll-mt-24 rounded-xl border bg-card p-4 space-y-4 md:p-6" aria-labelledby="change-password-heading">
      <div className="space-y-1">
        <h2 id="change-password-heading" className="flex items-center gap-2 text-base font-semibold"><KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />Alterar senha</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Use pelo menos {PASSWORD_MIN_LENGTH} caracteres, misturando palavras, números ou símbolos. Ao trocar, as outras sessões abertas (em outros aparelhos) são encerradas.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="current-password">Senha atual</Label>
          <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)}
            aria-invalid={invalid('current')} aria-describedby={described('current')} className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">Nova senha</Label>
          <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
            aria-invalid={invalid('password')} aria-describedby={described('password')} className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-new-password">Confirme a nova senha</Label>
          <Input id="confirm-new-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={invalid('confirm')} aria-describedby={described('confirm')} className="h-11" />
        </div>
        <div className="space-y-3 md:col-span-3">
          {error && <p id="change-password-error" ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive focus:outline-none">{error.text}</p>}
          <p role="status" className="text-sm text-success">{done ? 'Senha alterada. As outras sessões foram encerradas.' : ''}</p>
          <Button type="submit" className="min-h-11" disabled={busy}>{busy ? 'Salvando…' : 'Alterar senha'}</Button>
        </div>
      </form>
    </section>
  );
}
