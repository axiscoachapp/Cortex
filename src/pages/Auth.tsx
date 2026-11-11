import { useState } from 'react';
import { useNavigate, Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, ArrowRight, FileText, Users, CalendarDays } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLockup';
import { authDestination } from '@/lib/authRedirect';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../../supabase/functions/_shared/passwordPolicy';

/**
 * Sign-in and password recovery. There is no public sign-up: accounts are created by the clinic
 * admin or by the Cortex team (supabase/config.toml pins enable_signup = false).
 */
const Auth = () => {
  const navigate = useNavigate();
  const { signIn, resetPassword, updatePassword, enableAdminBypass, user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const recovering = params.get('mode') === 'recovery';
  const destination = authDestination(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  if (user && !recovering) return <Navigate to={destination} replace />;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    if (!email.trim() || !password) {
      setErrorMessage('Informe seu e-mail e sua senha.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const { error } = await signIn(email.trim(), password);
      if (error) setErrorMessage('Não foi possível entrar. Confira seu e-mail e sua senha e tente novamente.');
      else navigate(destination, { replace: true });
    } catch {
      setErrorMessage('Não foi possível conectar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryRequest = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMessage('Informe seu e-mail para receber o link de recuperação.');
      document.getElementById('login-email')?.focus();
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setNotice('');
    try {
      const { error } = await resetPassword(email.trim());
      if (error) throw error;
      setNotice('Se houver uma conta com este e-mail, você receberá um link para redefinir a senha.');
    } catch {
      setErrorMessage('Não foi possível enviar o link agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Same rule as every password chosen by its owner (supabase/functions/_shared/passwordPolicy.ts).
  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    const problem = passwordProblem(password, user?.email ?? '');
    if (problem) { setErrorMessage(problem); return; }
    if (password !== confirm) { setErrorMessage('As senhas não coincidem.'); return; }
    setLoading(true);
    setErrorMessage('');
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;
      setPassword('');
      setConfirm('');
      navigate('/', { replace: true });
    } catch {
      setErrorMessage('Não foi possível redefinir a senha. Solicite um novo link de recuperação e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const error = errorMessage && (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>
  );

  return (
    <main className="min-h-[100dvh] grid lg:grid-cols-[1.05fr_1fr] bg-background">
      <section className="hidden lg:flex flex-col justify-between border-r border-border px-14 py-12 bg-[#f3eee2]">
        <BrandLockup />
        <div className="max-w-lg py-16">
          <p className="text-xs uppercase tracking-[.22em] text-primary mb-5">Ginecologia · Obstetrícia · Urologia</p>
          <p className="font-serif text-5xl leading-[1.12] text-foreground">
            Mais atenção à consulta.
            <br />
            <span className="text-primary">Continuidade no cuidado.</span>
          </p>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground max-w-md">
            Um espaço para organizar o prontuário, revisar a documentação e acompanhar cada paciente.
          </p>
          <ul className="mt-10 space-y-5 text-sm">
            {[
              [FileText, 'Documentação revisada por você'],
              [Users, 'Pacientes privados e compartilhamento explícito'],
              [CalendarDays, 'Agenda e próximos passos no mesmo lugar'],
            ].map(([Icon, label]) => (
              <li key={String(label)} className="flex items-center gap-3">
                <span className="h-9 w-9 flex items-center justify-center bg-white/70 border border-border rounded-full">
                  {typeof Icon !== 'string' && <Icon className="h-4 w-4 text-primary" />}
                </span>
                {String(label)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">Haddad Nicola · Consultório Médico · Curitiba</p>
      </section>
      <section className="flex items-start justify-center px-4 py-6 sm:items-center sm:p-10">
        <div className="w-full max-w-sm space-y-5">
          <BrandLockup compact className="lg:hidden" />
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl">{recovering ? 'Redefinir senha' : 'Entrar no Cortex'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {recovering ? `Escolha uma senha nova, com pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` : 'Use a sua conta individual.'}
            </p>
          </div>
          {notice && <div role="status" className="rounded-lg border bg-muted p-3 text-sm">{notice}</div>}
          {recovering ? (
            <form onSubmit={handlePasswordUpdate} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required minLength={PASSWORD_MIN_LENGTH} className="h-11 bg-card" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirme a nova senha</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} required className="h-11 bg-card" />
              </div>
              {error}
              <Button className="w-full h-11" type="submit" disabled={loading || authLoading || !user}>
                {loading ? 'Salvando…' : 'Salvar nova senha'}
              </Button>
              {!authLoading && !user && (
                <p role="alert" className="text-sm">
                  Link inválido ou expirado.{' '}
                  <Link className="underline" to="/auth">Solicitar outro link</Link>
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="login-email">E-mail</Label>
                <Input id="login-email" type="email" name="email" autoComplete="email" spellCheck={false} placeholder="seu@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11 bg-card" />
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="login-password">Senha</Label>
                  <button type="button" disabled={loading} onClick={handleRecoveryRequest}
                    className="min-h-11 text-sm text-primary underline underline-offset-4 sm:min-h-0">
                    Esqueci minha senha
                  </button>
                </div>
                <div className="relative">
                  <Input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password}
                    onChange={(e) => setPassword(e.target.value)} required className="h-11 bg-card pr-12" />
                  <button type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-1 top-1 h-9 w-10 flex items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {error}
              <Button type="submit" disabled={loading} className="w-full h-11">
                {loading ? 'Aguarde…' : 'Entrar'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>
          )}
          {!recovering && (
            <p className="text-center text-xs text-muted-foreground">
              Não tem conta? As contas são criadas pelo administrador da clínica ou pela equipe Cortex.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
            <Link to="/sobre" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">Sobre o ambiente clínico</Link>
            <Link to="/aviso-de-privacidade" className="inline-flex min-h-11 items-center text-muted-foreground underline underline-offset-4">Aviso de privacidade</Link>
          </div>
          {import.meta.env.DEV && (
            <button
              className="block mx-auto text-xs text-muted-foreground"
              onClick={async () => {
                await enableAdminBypass();
                navigate('/');
              }}
            >
              Admin — pular login (dev)
            </button>
          )}
        </div>
      </section>
    </main>
  );
};
export default Auth;
