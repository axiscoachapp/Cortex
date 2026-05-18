import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain, Mic, FileText, Sparkles, MessagesSquare, Eye, EyeOff, ArrowRight, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const features = [
  { icon: Mic,           label: 'Transcrição em tempo real',     gradient: 'from-blue-500 to-indigo-600' },
  { icon: FileText,      label: 'Evolução SOAP automática',      gradient: 'from-cyan-500 to-blue-600' },
  { icon: Sparkles,      label: 'Resumo pré-consulta inteligente', gradient: 'from-violet-500 to-purple-600' },
  { icon: MessagesSquare, label: 'Pergunte ao histórico do paciente', gradient: 'from-fuchsia-500 to-pink-600' },
];

const Auth = () => {
  const navigate = useNavigate();
  const { signIn, signUp, enableAdminBypass, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate('/');
    return null;
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Preencha todos os campos'); return; }
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) { toast.error(error.message); } else { navigate('/'); }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Preencha todos os campos'); return; }
    if (password.length < 6) { toast.error('Senha deve ter mínimo 6 caracteres'); return; }
    setLoading(true);
    const { error } = await signUp(email, password);
    setLoading(false);
    if (error) {
      toast.error(error.message.includes('already registered') ? 'Email já cadastrado' : error.message);
    } else { navigate('/'); }
  };

  return (
    <div className="min-h-screen flex bg-background overflow-hidden">

      {/* ─── LEFT — branded panel ───────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] relative overflow-hidden">
        {/* Dark navy base */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, #0b1a3a 0%, #102a5a 50%, #0a1228 100%)',
          }}
        />

        {/* Animated radial blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-[-15%] left-[-10%] w-[520px] h-[520px] rounded-full opacity-50 blur-3xl animate-blob"
            style={{ background: 'radial-gradient(circle, hsl(210 90% 65% / 0.6), transparent 60%)' }}
          />
          <div
            className="absolute top-[30%] right-[-15%] w-[480px] h-[480px] rounded-full opacity-40 blur-3xl animate-blob-slow"
            style={{ background: 'radial-gradient(circle, hsl(265 85% 70% / 0.5), transparent 60%)', animationDelay: '3s' }}
          />
          <div
            className="absolute bottom-[-20%] left-[20%] w-[420px] h-[420px] rounded-full opacity-35 blur-3xl animate-blob"
            style={{ background: 'radial-gradient(circle, hsl(180 80% 60% / 0.45), transparent 60%)', animationDelay: '6s' }}
          />
        </div>

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-10 xl:p-14 w-full text-white">
          {/* Logo lockup */}
          <Link to="/sobre" className="flex items-center gap-2.5 group w-fit">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-medical group-hover:scale-105 transition-transform"
              style={{ background: 'linear-gradient(135deg, #60a5fa, #1e40af)' }}
            >
              <Brain className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">Cortex</span>
          </Link>

          {/* Hero copy */}
          <div className="space-y-7 max-w-lg">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs font-semibold text-blue-200 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-blue-300 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-300" />
              </span>
              Powered by Gemini 2.5 Flash
            </div>

            <h1 className="text-4xl xl:text-5xl font-bold tracking-tight leading-[1.1]">
              A consulta termina.{' '}
              <span
                className="bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient-shift"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, hsl(210 90% 70%), hsl(265 85% 75%), hsl(180 80% 65%), hsl(210 90% 70%))',
                }}
              >
                O prontuário já está pronto.
              </span>
            </h1>

            <p className="text-base xl:text-lg text-blue-100/70 leading-relaxed">
              Grave. A IA escreve a evolução SOAP, prepara a mensagem do paciente e responde sobre o histórico — em segundos.
            </p>

            {/* Feature glass cards */}
            <ul className="space-y-2.5 pt-2">
              {features.map(({ icon: Icon, label, gradient }, i) => (
                <li
                  key={label}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.05] border border-white/10 backdrop-blur hover:bg-white/[0.08] hover:border-white/20 transition-colors"
                  style={{ animation: `fade-in-up 0.5s ease-out ${i * 80}ms both` }}
                >
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br shadow-lg',
                    gradient,
                  )}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm text-white/90 font-medium">{label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer line */}
          <div className="flex items-center justify-between text-[11px] text-white/40">
            <span>© 2026 Cortex · Assistente médico com IA</span>
            <Link to="/sobre" className="hover:text-white/70 transition-colors inline-flex items-center gap-1 group">
              Conheça mais
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>
      </div>

      {/* ─── RIGHT — form panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-background p-6 sm:p-8 relative">
        {/* Subtle accent blob behind the form (mobile + desktop) */}
        <div
          className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: 'radial-gradient(circle, hsl(210 90% 65%), transparent 60%)' }}
        />
        <div
          className="absolute bottom-[-15%] left-[-5%] w-[320px] h-[320px] rounded-full opacity-15 blur-3xl pointer-events-none lg:hidden"
          style={{ background: 'radial-gradient(circle, hsl(265 85% 70%), transparent 60%)' }}
        />

        <div className="w-full max-w-sm space-y-7 relative">
          {/* Mobile branded header */}
          <div className="lg:hidden">
            <Link to="/sobre" className="flex items-center gap-2.5 w-fit">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shadow-medical"
                style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
              >
                <Brain className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight block leading-none">Cortex</span>
                <span className="text-[10px] text-muted-foreground">Assistente médico com IA</span>
              </div>
            </Link>
          </div>

          {/* Headline */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Bem-vindo de volta
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Entre na sua conta para continuar
            </p>
          </div>

          {/* Auth card */}
          <div className="rounded-2xl bg-card border border-border/60 shadow-card-hover p-5 sm:p-6 space-y-5">
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-10 bg-muted/60 p-1 rounded-lg">
                <TabsTrigger value="login"  className="rounded-md text-sm data-[state=active]:bg-card data-[state=active]:shadow-sm">Entrar</TabsTrigger>
                <TabsTrigger value="signup" className="rounded-md text-sm data-[state=active]:bg-card data-[state=active]:shadow-sm">Criar conta</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-5">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email" className="text-xs font-medium text-foreground/80">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="h-10 rounded-lg bg-background"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="login-password" className="text-xs font-medium text-foreground/80">Senha</Label>
                    <div className="relative">
                      <Input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        className="h-10 rounded-lg bg-background pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-10 mt-2 rounded-lg shadow-medical hover:scale-[1.01] transition-transform text-sm font-semibold"
                    style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
                    disabled={loading}
                  >
                    {loading ? 'Entrando...' : (
                      <>
                        Entrar
                        <ArrowRight className="w-4 h-4 ml-1.5" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-5">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email" className="text-xs font-medium text-foreground/80">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="h-10 rounded-lg bg-background"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password" className="text-xs font-medium text-foreground/80">Senha</Label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        className="h-10 rounded-lg bg-background pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground pt-0.5">Mínimo de 6 caracteres</p>
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-10 mt-2 rounded-lg shadow-medical hover:scale-[1.01] transition-transform text-sm font-semibold"
                    style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
                    disabled={loading}
                  >
                    {loading ? 'Criando conta...' : (
                      <>
                        Criar conta grátis
                        <ArrowRight className="w-4 h-4 ml-1.5" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {/* Trust chips */}
            <div className="flex items-center justify-center gap-4 pt-1 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Check className="w-3 h-3 text-success" />
                Sem cartão
              </span>
              <span className="inline-flex items-center gap-1">
                <Check className="w-3 h-3 text-success" />
                LGPD
              </span>
              <span className="inline-flex items-center gap-1">
                <Check className="w-3 h-3 text-success" />
                Em português
              </span>
            </div>
          </div>

          {/* Footer links */}
          <div className="space-y-2 text-center">
            <Link
              to="/sobre"
              className="inline-flex items-center gap-1.5 text-sm text-medical-blue-dark hover:text-medical-blue font-medium transition-all hover:gap-2 group"
            >
              Conheça o Cortex
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>

            {import.meta.env.DEV && (
              <button
                type="button"
                onClick={async () => { await enableAdminBypass(); navigate('/'); }}
                className="block mx-auto text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors py-1"
              >
                Admin — pular login (dev)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
