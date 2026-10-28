import { useState } from 'react';
import { useNavigate, Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, EyeOff, ArrowRight, FileText, Users, CalendarDays } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { BrandLockup } from '@/components/BrandLockup';
import { authDestination } from '@/lib/authRedirect';

const Auth = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn, signUp, resetPassword, resendConfirmation, updatePassword, enableAdminBypass, user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const recovering = params.get('mode') === 'recovery';
  const destination = authDestination(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  if (user && !recovering) return <Navigate to={destination} replace />;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast({ title: 'Preencha todos os campos', variant: 'destructive' }); return; }
    setLoading(true);
    setErrorMessage(''); setNotice('');
    try {
      const { error } = await signIn(email.trim(), password);
      if (error) setErrorMessage('Não foi possível entrar. Confira seu email e sua senha e tente novamente.');
      else navigate(destination, { replace: true });
    } catch { setErrorMessage('Não foi possível conectar. Tente novamente.'); }
    finally { setLoading(false); }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast({ title: 'Preencha todos os campos', variant: 'destructive' }); return; }
    if (password.length < 6) { toast({ title: 'Senha deve ter mínimo 6 caracteres', variant: 'destructive' }); return; }
    setLoading(true);
    setErrorMessage(''); setNotice('');
    try {
      const { error, session } = await signUp(email.trim(), password);
      if (error) setErrorMessage('Não foi possível criar a conta. Confira os dados ou tente entrar em uma conta existente.');
      else if (session) navigate(destination, { replace: true });
      else { setAwaitingConfirmation(true); setNotice('Confirme seu email: enviamos um link de confirmação. Abra o link e depois entre na sua conta.'); setPassword(''); }
    } catch { setErrorMessage('Não foi possível conectar. Tente novamente.'); }
    finally { setLoading(false); }
  };

  const handleRecoveryRequest = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMessage('Informe seu email para receber o link de recuperação.');
      document.getElementById('login-email')?.focus();
      return;
    }
    setLoading(true); setErrorMessage(''); setNotice('');
    try {
      const { error } = await resetPassword(email.trim());
      if (error) throw error;
      setNotice('Se houver uma conta com este email, você receberá um link para redefinir a senha.');
    } catch { setErrorMessage('Não foi possível enviar o link agora. Tente novamente.'); }
    finally { setLoading(false); }
  };

  const handleResendConfirmation = async () => {
    setLoading(true); setErrorMessage('');
    try {
      const {error}=await resendConfirmation(email.trim());
      if(error) throw error;
      setNotice('Se a confirmação estiver pendente, você receberá um novo link. Confira também a pasta de spam.');
    } catch { setErrorMessage('Não foi possível reenviar agora. Aguarde um momento e tente novamente.'); }
    finally { setLoading(false); }
  };

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 6 || loading) return;
    setLoading(true); setErrorMessage('');
    try {
      const { error } = await updatePassword(password);
      if (error) throw error;
      setPassword(''); navigate('/', { replace: true });
    } catch { setErrorMessage('Não foi possível redefinir a senha. Solicite um novo link de recuperação e tente novamente.'); }
    finally { setLoading(false); }
  };


  return <main className="min-h-[100dvh] grid lg:grid-cols-[1.05fr_1fr] bg-background">
    <section className="hidden lg:flex flex-col justify-between border-r border-border px-14 py-12 bg-[#f3eee2]">
      <BrandLockup />
      <div className="max-w-lg py-16">
        <p className="text-xs uppercase tracking-[.22em] text-primary mb-5">Ginecologia · Obstetrícia · Urologia</p>
        <h1 className="font-serif text-5xl leading-[1.12] text-foreground">Mais atenção à consulta.<br/><span className="text-primary">Continuidade no cuidado.</span></h1>
        <p className="mt-6 text-base leading-relaxed text-muted-foreground max-w-md">Um espaço para organizar o prontuário, revisar a documentação e acompanhar cada paciente.</p>
        <ul className="mt-10 space-y-5 text-sm">
          {[[FileText,'Documentação revisada por você'],[Users,'Pacientes privados e compartilhamento explícito'],[CalendarDays,'Agenda e próximos passos no mesmo lugar']].map(([Icon,label])=><li key={String(label)} className="flex items-center gap-3"><span className="h-9 w-9 flex items-center justify-center bg-white/70 border border-border rounded-full">{typeof Icon!=='string' && <Icon className="h-4 w-4 text-primary"/>}</span>{String(label)}</li>)}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">Haddad Nicola · Consultório Médico · Curitiba</p>
    </section>
    <section className="flex items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-sm space-y-7">
        <BrandLockup className="lg:hidden mb-10" />
        <div><p className="text-xs uppercase tracking-[.2em] text-primary mb-3">Ambiente clínico</p><h2 className="font-serif text-3xl">{recovering?'Redefinir senha':'Bem-vindo ao Cortex'}</h2><p className="text-sm text-muted-foreground mt-3">Entre com sua conta individual para continuar.</p></div>
        {errorMessage && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>}
        {notice && <div role="status" className="rounded-lg border bg-muted p-3 text-sm">{notice}{awaitingConfirmation && <Button variant="link" disabled={loading} onClick={handleResendConfirmation}>Reenviar confirmação</Button>}</div>}
        {recovering ? <form onSubmit={handlePasswordUpdate} className="space-y-4">
          <Label htmlFor="new-password">Nova senha</Label><Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/>
          <Button className="w-full" type="submit" disabled={loading||authLoading||!user}>{loading?'Salvando…':'Salvar nova senha'}</Button>
          {!authLoading&&!user&&<p role="alert">Link inválido ou expirado. <Link className="underline" to="/auth">Solicitar outro link</Link></p>}
        </form> : <Tabs defaultValue="login"><TabsList className="grid grid-cols-2 w-full"><TabsTrigger value="login">Entrar</TabsTrigger><TabsTrigger value="signup">Criar conta</TabsTrigger></TabsList>
          {['login','signup'].map(mode=><TabsContent key={mode} value={mode} className="mt-6"><form onSubmit={mode==='login'?handleSignIn:handleSignUp} className="space-y-4">
            <div className="space-y-2"><Label htmlFor={mode+'-email'}>Email</Label><Input id={mode+'-email'} type="email" name="email" autoComplete="email" spellCheck={false} placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)} required className="h-11 bg-card"/></div>
            <div className="space-y-2"><Label htmlFor={mode+'-password'}>Senha</Label><div className="relative"><Input id={mode+'-password'} type={showPassword?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} className="h-11 bg-card pr-12"/><button type="button" aria-label={showPassword?'Ocultar senha':'Mostrar senha'} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)} className="absolute right-1 top-1 h-9 w-10 flex items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring">{showPassword?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}</button></div></div>
            {mode==='login'?<button type="button" disabled={loading} onClick={handleRecoveryRequest} className="text-sm text-primary underline underline-offset-4">Esqueci minha senha</button>:<p className="text-xs text-muted-foreground">Mínimo de 6 caracteres. Cada médico usa sua própria conta.</p>}
            <Button type="submit" disabled={loading} className="w-full h-11">{loading?'Aguarde…':mode==='login'?'Entrar':'Criar conta grátis'}<ArrowRight className="w-4 h-4 ml-2"/></Button>
          </form></TabsContent>)}
        </Tabs>}
        <Link to="/sobre" className="block text-center text-sm text-primary underline underline-offset-4">Sobre o ambiente clínico</Link>
        {import.meta.env.DEV&&<button className="block mx-auto text-xs text-muted-foreground" onClick={async()=>{await enableAdminBypass();navigate('/');}}>Admin — pular login (dev)</button>}
      </div>
    </section>
  </main>;
};
export default Auth;
