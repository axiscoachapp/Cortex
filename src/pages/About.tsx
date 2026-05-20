import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain, Mic, FileText, Sparkles, CalendarDays, MessageCircle,
  ShieldCheck, Clock, Zap, ArrowRight, Check, Play, ChevronDown,
  Stethoscope, Users, Lock, Cpu, Activity, Heart, MessagesSquare, Search,
  Paperclip, StickyNote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ─── scroll reveal hook ──────────────────────────────────────────────── */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <Tag
      ref={ref as never}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-all duration-700 ease-out will-change-transform',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/* ─── typewriter for the mock SOAP preview ────────────────────────────── */
function useTypewriter(text: string, speed = 18, startDelay = 600) {
  const [out, setOut] = useState('');
  useEffect(() => {
    let i = 0;
    let raf = 0;
    const start = window.setTimeout(() => {
      const tick = () => {
        if (i <= text.length) {
          setOut(text.slice(0, i));
          i += 1;
          raf = window.setTimeout(tick, speed) as unknown as number;
        }
      };
      tick();
    }, startDelay);
    return () => { window.clearTimeout(start); window.clearTimeout(raf); };
  }, [text, speed, startDelay]);
  return out;
}

/* ─── data ────────────────────────────────────────────────────────────── */
const stats = [
  { value: '15h', label: 'economizadas por semana' },
  { value: '< 30s', label: 'do áudio ao SOAP pronto' },
  { value: '100%', label: 'em conformidade com LGPD' },
  { value: '4.9★', label: 'satisfação dos médicos' },
];

const features = [
  {
    icon: Mic,
    title: 'Transcrição em tempo real',
    desc: 'Grave consultas de até 30 min com identificação automática de quem está falando.',
    gradient: 'from-blue-500 to-indigo-600',
  },
  {
    icon: FileText,
    title: 'Evolução SOAP automática',
    desc: 'A IA estrutura subjetivo, objetivo, avaliação e plano. Você só revisa o que importa.',
    gradient: 'from-cyan-500 to-blue-600',
  },
  {
    icon: Sparkles,
    title: 'Resumo pré-consulta',
    desc: 'Briefing pronto antes do paciente entrar: queixa anterior, conduta, pendências, alertas.',
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    icon: MessagesSquare,
    title: 'Pergunte ao histórico',
    desc: '“O que conversamos na última?” A IA responde com base no prontuário inteiro.',
    gradient: 'from-fuchsia-500 to-pink-600',
  },
  {
    icon: MessageCircle,
    title: 'Mensagem ao paciente',
    desc: 'WhatsApp gerado com orientações, próximos passos e prescrição em linguagem clara.',
    gradient: 'from-emerald-500 to-teal-600',
  },
  {
    icon: StickyNote,
    title: 'Anotações em segundos',
    desc: 'Comentários no chat viram notas no prontuário — e contexto para a próxima consulta.',
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    icon: Paperclip,
    title: 'Arquivos & exames',
    desc: 'Anexe PDFs, fotos e resultados. Tudo organizado no dossiê de cada paciente.',
    gradient: 'from-sky-500 to-cyan-600',
  },
  {
    icon: ShieldCheck,
    title: 'Privacidade por padrão',
    desc: 'Criptografia, isolamento por usuário e LGPD. Seu paciente não vira material de treino.',
    gradient: 'from-rose-500 to-red-600',
  },
];

const steps = [
  {
    n: '01',
    icon: Mic,
    title: 'Aperte gravar',
    desc: 'Comece a consulta normalmente. O Cortex captura tudo em segundo plano, com pausa quando precisar.',
  },
  {
    n: '02',
    icon: Cpu,
    title: 'A IA processa',
    desc: 'Transcrição, separação de falantes e geração da evolução SOAP — tudo em menos de 30 segundos.',
  },
  {
    n: '03',
    icon: Check,
    title: 'Você revisa e aprova',
    desc: 'Edite, ajuste e salve. A mensagem para o paciente já vem pronta para enviar pelo WhatsApp.',
  },
];

const pillars = [
  { icon: Clock, title: 'Devolva 3 horas por dia',  desc: 'Sem digitação manual, sem perder o paciente do olhar.' },
  { icon: Activity, title: 'Decisões mais rápidas', desc: 'Pré-consulta inteligente para retornos sem releitura.' },
  { icon: Heart,    title: 'Foco no que importa',   desc: 'Mais tempo de escuta. Menos tempo de teclado.' },
  { icon: Lock,     title: 'Soberania dos dados',   desc: 'Hospedagem regional, RLS em todas as tabelas.' },
];

/* ─── component ───────────────────────────────────────────────────────── */
const About = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const typed = useTypewriter(
    'S: Paciente refere cefaleia frontal há 3 dias, pulsátil, intensidade 7/10…\nO: PA 128/82 · FC 76 · Tax 36.4 · Estado geral preservado.\nA: Cefaleia tensional vs. enxaqueca sem aura.\nP: Sumatriptano 50mg s/n · retorno em 7 dias.',
    14, 800,
  );

  return (
    <div className="min-h-screen bg-background text-foreground antialiased overflow-x-hidden">

      {/* ─── NAV ─────────────────────────────────────────────────────── */}
      <header
        className={cn(
          'fixed top-0 inset-x-0 z-50 transition-all duration-300',
          scrolled
            ? 'bg-background/75 backdrop-blur-xl border-b border-border/60'
            : 'bg-transparent',
        )}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-medical group-hover:scale-105 transition-transform"
              style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%) 0%, hsl(220 70% 38%) 100%)' }}
            >
              <Brain className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">Cortex</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Recursos</a>
            <a href="#how"      className="hover:text-foreground transition-colors">Como funciona</a>
            <a href="#why"      className="hover:text-foreground transition-colors">Por que Cortex</a>
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 hidden sm:inline-block">
              Entrar
            </Link>
            <Link to="/auth">
              <Button
                className="rounded-full px-5 shadow-medical"
                style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
              >
                Começar agora
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ─── HERO ────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-24 lg:pt-44 lg:pb-32 overflow-hidden">
        {/* animated blobs */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-5%] w-[480px] h-[480px] rounded-full opacity-40 blur-3xl animate-blob"
            style={{ background: 'radial-gradient(circle, hsl(210 90% 65% / 0.55), transparent 60%)' }}/>
          <div className="absolute top-[20%] right-[-10%] w-[520px] h-[520px] rounded-full opacity-35 blur-3xl animate-blob-slow"
            style={{ background: 'radial-gradient(circle, hsl(265 85% 70% / 0.45), transparent 60%)', animationDelay: '3s' }}/>
          <div className="absolute bottom-[-15%] left-[25%] w-[420px] h-[420px] rounded-full opacity-30 blur-3xl animate-blob"
            style={{ background: 'radial-gradient(circle, hsl(180 80% 60% / 0.45), transparent 60%)', animationDelay: '6s' }}/>
        </div>

        {/* grid overlay */}
        <div
          className="absolute inset-0 -z-10 opacity-[0.025] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <Reveal>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-medical-blue-light border border-medical-blue/20 text-xs font-semibold text-medical-blue-dark mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-medical-blue opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-medical-blue" />
                </span>
                Novo · Powered by Gemini 2.0 Flash
              </div>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="text-5xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
                A consulta termina.{' '}
                <span
                  className="block bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient-shift"
                  style={{
                    backgroundImage:
                      'linear-gradient(90deg, hsl(210 80% 55%), hsl(265 80% 65%), hsl(180 75% 50%), hsl(210 80% 55%))',
                  }}
                >
                  O prontuário já está pronto.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={180}>
              <p className="mt-6 text-lg lg:text-xl text-muted-foreground leading-relaxed max-w-xl">
                Cortex é o copiloto clínico que grava, transcreve e estrutura a evolução SOAP enquanto você cuida do paciente. Devolva horas do seu dia — sem mudar como atende.
              </p>
            </Reveal>

            <Reveal delay={280}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link to="/auth">
                  <Button
                    size="lg"
                    className="rounded-full h-12 px-7 text-base shadow-card-hover hover:scale-[1.02] transition-transform"
                    style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
                  >
                    Começar grátis
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
                <a
                  href="#how"
                  className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-border/80 hover:border-foreground/30 text-sm font-medium hover:bg-muted/40 transition-all"
                >
                  <Play className="w-4 h-4" />
                  Ver como funciona
                </a>
              </div>
            </Reveal>

            <Reveal delay={400}>
              <div className="mt-10 flex items-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-success" />
                  Sem cartão de crédito
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-success" />
                  LGPD compliant
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-success" />
                  Em português
                </div>
              </div>
            </Reveal>
          </div>

          {/* product preview */}
          <Reveal delay={200}>
            <div className="relative animate-float">
              {/* gradient frame */}
              <div className="absolute -inset-px rounded-3xl opacity-70 blur-xl"
                style={{ background: 'linear-gradient(135deg, hsl(210 80% 55%), hsl(265 80% 65%))' }} />
              <div className="relative bg-card/95 backdrop-blur-xl border border-border/60 rounded-3xl shadow-2xl overflow-hidden">
                {/* window chrome */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/30">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground">cortex.app — consulta · Maria S., 42 anos</span>
                  <span className="w-10" />
                </div>

                {/* recording bar */}
                <div className="px-5 py-4 flex items-center gap-3 border-b border-border/40 bg-gradient-to-r from-red-50/50 to-transparent dark:from-red-950/20">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-record-red flex items-center justify-center shadow-lg shadow-record-red/30 animate-pulse-record">
                      <Mic className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-semibold">Gravando consulta</div>
                    <div className="text-[10px] text-muted-foreground">12:34 · transcrição ao vivo</div>
                  </div>
                  {/* waveform */}
                  <div className="flex items-end gap-[3px] h-6">
                    {[8, 14, 22, 18, 26, 12, 20, 16, 24, 10, 18, 14].map((h, i) => (
                      <span key={i}
                        className="w-[3px] rounded-full bg-record-red/70"
                        style={{
                          height: `${h}px`,
                          animation: `pulse-record 1.2s ease-in-out ${i * 80}ms infinite`,
                        }} />
                    ))}
                  </div>
                </div>

                {/* SOAP card being typed */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-medical-blue-dark">
                    <div className="w-5 h-5 rounded-md bg-medical-blue-light flex items-center justify-center">
                      <Sparkles className="w-3 h-3 text-medical-blue" />
                    </div>
                    Evolução SOAP gerada
                    <span className="ml-auto text-[10px] font-normal text-muted-foreground">há 2s</span>
                  </div>

                  <div className="bg-soap-card border-l-4 border-l-medical-blue rounded-r-lg p-3 font-mono text-[11px] leading-relaxed text-foreground/85 min-h-[140px] whitespace-pre-wrap">
                    {typed}
                    <span className="inline-block w-[7px] h-[12px] bg-medical-blue ml-0.5 align-middle animate-type-cursor" />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button className="flex-1 h-8 rounded-lg text-[11px] font-medium bg-medical-blue text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5">
                      <Check className="w-3 h-3" /> Aprovar
                    </button>
                    <button className="h-8 px-3 rounded-lg text-[11px] font-medium border border-border bg-card hover:bg-muted/40">
                      Editar
                    </button>
                    <button className="h-8 px-3 rounded-lg text-[11px] font-medium border border-whatsapp-green/40 bg-whatsapp-light text-whatsapp-green flex items-center gap-1.5">
                      <MessageCircle className="w-3 h-3" /> WhatsApp
                    </button>
                  </div>
                </div>
              </div>

              {/* floating chip — pre-briefing */}
              <div className="absolute -left-6 lg:-left-10 top-20 hidden md:flex bg-card/95 backdrop-blur-xl border border-border/60 rounded-2xl shadow-xl p-3 pr-4 items-center gap-2.5 animate-float" style={{ animationDelay: '-2s' }}>
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-[11px]">
                  <div className="font-semibold">Pré-consulta pronta</div>
                  <div className="text-muted-foreground">3 pendências do retorno</div>
                </div>
              </div>

              {/* floating chip — calendar */}
              <div className="absolute -right-4 lg:-right-8 bottom-12 hidden md:flex bg-card/95 backdrop-blur-xl border border-border/60 rounded-2xl shadow-xl p-3 pr-4 items-center gap-2.5 animate-float" style={{ animationDelay: '-4s' }}>
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <CalendarDays className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-[11px]">
                  <div className="font-semibold">Sincronizado</div>
                  <div className="text-muted-foreground">Google Calendar</div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* scroll cue */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 text-muted-foreground/50 animate-float hidden lg:block">
          <ChevronDown className="w-5 h-5" />
        </div>
      </section>

      {/* ─── STATS ───────────────────────────────────────────────────── */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 80}>
              <div className="text-center md:text-left">
                <div
                  className="text-3xl lg:text-4xl font-bold bg-clip-text text-transparent"
                  style={{ backgroundImage: 'linear-gradient(135deg, hsl(210 75% 45%), hsl(265 75% 60%))' }}
                >
                  {s.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── FEATURES ────────────────────────────────────────────────── */}
      <section id="features" className="py-24 lg:py-32 relative">
        <div className="max-w-7xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <div className="inline-block px-3 py-1 rounded-full bg-medical-blue-light text-xs font-semibold text-medical-blue-dark mb-4">
                Recursos
              </div>
              <h2 className="text-4xl lg:text-5xl font-bold tracking-tight">
                Tudo que falta no seu prontuário
              </h2>
              <p className="mt-4 text-muted-foreground text-lg">
                Pensado por dentro, para o jeito como o médico realmente trabalha.
              </p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 60}>
                <div className="group relative h-full p-5 lg:p-6 rounded-2xl border border-border/60 bg-card hover:shadow-card-hover hover:border-foreground/15 hover:-translate-y-1 transition-all duration-300 overflow-hidden">
                  {/* subtle gradient corner */}
                  <div
                    className={cn(
                      'absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-0 group-hover:opacity-25 blur-2xl transition-opacity duration-500 bg-gradient-to-br',
                      f.gradient,
                    )}
                  />
                  <div
                    className={cn(
                      'relative w-11 h-11 rounded-xl flex items-center justify-center text-white mb-4 shadow-lg bg-gradient-to-br',
                      f.gradient,
                    )}
                  >
                    <f.icon className="w-5 h-5" />
                  </div>
                  <h3 className="relative text-lg font-semibold mb-1.5">{f.title}</h3>
                  <p className="relative text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRE-CONSULTATION SHOWCASE ───────────────────────────────── */}
      <section className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-1/4 left-[-10%] w-[420px] h-[420px] rounded-full opacity-30 blur-3xl animate-blob"
            style={{ background: 'radial-gradient(circle, hsl(265 90% 70% / 0.55), transparent 60%)' }}/>
          <div className="absolute bottom-0 right-[-5%] w-[380px] h-[380px] rounded-full opacity-25 blur-3xl animate-blob-slow"
            style={{ background: 'radial-gradient(circle, hsl(210 90% 65% / 0.5), transparent 60%)', animationDelay: '4s' }}/>
        </div>

        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <Reveal>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-fuchsia-50 dark:bg-fuchsia-950/30 border border-fuchsia-200 dark:border-fuchsia-900/50 text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-400 mb-4">
              <MessagesSquare className="w-3.5 h-3.5" />
              Pré-consulta inteligente
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]">
              Converse com o{' '}
              <span
                className="bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient-shift"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, hsl(290 75% 55%), hsl(210 80% 55%), hsl(265 80% 65%), hsl(290 75% 55%))',
                }}
              >
                histórico do paciente.
              </span>
            </h2>
            <p className="mt-5 text-lg text-muted-foreground leading-relaxed max-w-xl">
              Antes do paciente sentar, o Cortex já organizou tudo: queixa da última consulta, conduta, exames pendentes, alertas. E você pode <strong className="text-foreground">perguntar qualquer coisa</strong>, em linguagem natural, ao prontuário inteiro.
            </p>

            <div className="mt-7 space-y-3">
              {[
                { icon: Search, text: '"Qual a evolução da pressão arterial nos últimos 6 meses?"' },
                { icon: Search, text: '"Tem alguma interação com o medicamento que vou prescrever?"' },
                { icon: Search, text: '"O que ficou pendente da consulta anterior?"' },
              ].map((q, i) => (
                <Reveal key={i} delay={120 + i * 80}>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/60 hover:border-fuchsia-300 dark:hover:border-fuchsia-800 transition-colors">
                    <div className="w-7 h-7 rounded-lg bg-fuchsia-100 dark:bg-fuchsia-950/50 flex items-center justify-center shrink-0">
                      <q.icon className="w-3.5 h-3.5 text-fuchsia-600 dark:text-fuchsia-400" />
                    </div>
                    <span className="text-sm text-foreground/85 italic">{q.text}</span>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={400}>
              <div className="mt-7 inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="w-4 h-4 text-success" />
                Acesso ao prontuário completo · sem reler nada
              </div>
            </Reveal>
          </Reveal>

          {/* Right: mock chat */}
          <Reveal delay={150}>
            <div className="relative">
              <div className="absolute -inset-px rounded-3xl opacity-60 blur-xl"
                style={{ background: 'linear-gradient(135deg, hsl(290 80% 60%), hsl(210 80% 55%))' }} />
              <div className="relative bg-card/95 backdrop-blur-xl border border-border/60 rounded-3xl shadow-2xl overflow-hidden">

                {/* header */}
                <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 bg-muted/30">
                  <div className="w-8 h-8 rounded-lg bg-medical-blue-light flex items-center justify-center">
                    <span className="text-medical-blue font-semibold text-xs">MS</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-semibold">Maria S., 42 anos</div>
                    <div className="text-[10px] text-muted-foreground">12 consultas · última há 45 dias</div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-medical-blue-light text-medical-blue-dark font-semibold">Histórico ativo</span>
                </div>

                {/* messages */}
                <div className="p-5 space-y-4 min-h-[340px]">
                  {/* doctor question */}
                  <div className="flex justify-end animate-fade-in-up">
                    <div className="max-w-[80%] bg-medical-blue text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm shadow-sm">
                      O que conversamos na última consulta?
                    </div>
                  </div>

                  {/* AI response */}
                  <div className="flex items-start gap-2.5 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center shrink-0">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-3">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-1">Assistente Clínico</p>
                      <p className="text-sm leading-relaxed text-foreground/85">
                        Em <strong>02 abr</strong>, queixa de cefaleia frontal há 5 dias. Você prescreveu sumatriptano 50mg s/n e solicitou MRI cerebral. Conduta: retorno em 45 dias com o exame.
                      </p>
                      <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
                        <FileText className="w-3 h-3" /> 3 consultas analisadas
                      </div>
                    </div>
                  </div>

                  {/* second doctor question */}
                  <div className="flex justify-end animate-fade-in-up" style={{ animationDelay: '500ms' }}>
                    <div className="max-w-[80%] bg-medical-blue text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm shadow-sm">
                      Ela trouxe o MRI?
                    </div>
                  </div>

                  {/* AI typing */}
                  <div className="flex items-start gap-2.5 animate-fade-in-up" style={{ animationDelay: '700ms' }}>
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center shrink-0">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex gap-1 items-center h-4">
                        {[0, 150, 300].map(d => (
                          <div key={d} className="w-1.5 h-1.5 rounded-full bg-fuchsia-500/60"
                            style={{ animation: `pulse-record 1.2s ease-in-out ${d}ms infinite` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* input dock */}
                <div className="border-t border-border/40 p-3 bg-background/50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="inline-flex p-0.5 rounded-lg bg-muted/60 border border-border/40 text-[10px]">
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-medical-blue text-white font-semibold">
                        <MessagesSquare className="w-3 h-3" /> Pergunta
                      </span>
                      <span className="flex items-center gap-1 px-2 py-1 text-muted-foreground">
                        <FileText className="w-3 h-3" /> Comentário
                      </span>
                    </div>
                  </div>
                  <div className="h-9 rounded-xl bg-muted/40 flex items-center px-3 text-xs text-muted-foreground/70">
                    Pergunte ao assistente…
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── HOW IT WORKS ────────────────────────────────────────────── */}
      <section id="how" className="py-24 lg:py-32 bg-muted/30 border-y border-border/40 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="max-w-7xl mx-auto px-6 relative">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <div className="inline-block px-3 py-1 rounded-full bg-medical-blue-light text-xs font-semibold text-medical-blue-dark mb-4">
                Em três passos
              </div>
              <h2 className="text-4xl lg:text-5xl font-bold tracking-tight">Da escuta à evolução</h2>
              <p className="mt-4 text-muted-foreground text-lg">
                Sem aprender ferramenta nova. A consulta segue exatamente como sempre foi.
              </p>
            </div>
          </Reveal>

          <div className="relative grid md:grid-cols-3 gap-6 lg:gap-10">
            {/* connector line on desktop */}
            <div
              className="hidden md:block absolute top-12 left-[15%] right-[15%] h-px"
              style={{
                background: 'linear-gradient(90deg, transparent, hsl(var(--border)) 20%, hsl(var(--border)) 80%, transparent)',
              }}
            />
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 120}>
                <div className="relative bg-card border border-border/60 rounded-2xl p-7 hover:shadow-card-hover transition-all hover:-translate-y-1 duration-300">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-medical relative z-10"
                      style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
                    >
                      <s.icon className="w-5 h-5" />
                    </div>
                    <span className="text-3xl font-bold text-muted-foreground/30">{s.n}</span>
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── WHY CORTEX (pillars) ────────────────────────────────────── */}
      <section id="why" className="py-24 lg:py-32">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-5 gap-16 items-center">
          <Reveal className="lg:col-span-2">
            <div className="inline-block px-3 py-1 rounded-full bg-medical-blue-light text-xs font-semibold text-medical-blue-dark mb-4">
              Por que Cortex
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
              Construído por quem entende{' '}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, hsl(210 75% 45%), hsl(265 75% 60%))' }}
              >
                a rotina clínica
              </span>
            </h2>
            <p className="mt-5 text-muted-foreground text-lg leading-relaxed">
              Cortex não é mais uma ferramenta genérica adaptada para saúde. Cada interação, cada atalho, cada modelo foi desenhado em conjunto com médicos em atendimento.
            </p>
            <Link to="/auth" className="inline-flex items-center gap-2 mt-8 text-medical-blue-dark font-semibold hover:gap-3 transition-all">
              Experimente sem compromisso <ArrowRight className="w-4 h-4" />
            </Link>
          </Reveal>

          <div className="lg:col-span-3 grid sm:grid-cols-2 gap-4">
            {pillars.map((p, i) => (
              <Reveal key={p.title} delay={i * 80}>
                <div className="h-full p-6 rounded-2xl bg-gradient-to-br from-card to-muted/30 border border-border/60 hover:border-medical-blue/30 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-medical-blue-light flex items-center justify-center text-medical-blue-dark mb-4">
                    <p.icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold mb-1.5">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── QUOTE ───────────────────────────────────────────────────── */}
      <section className="py-20 bg-muted/30 border-y border-border/40">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <Reveal>
            <Stethoscope className="w-10 h-10 mx-auto text-medical-blue mb-6 opacity-80" />
            <blockquote className="text-2xl lg:text-3xl font-medium leading-snug tracking-tight">
              “Antes eu ficava até as 21h escrevendo prontuário. Com Cortex, saio do consultório com tudo pronto. É o tipo de software que parece óbvio depois que existe.”
            </blockquote>
            <div className="mt-6 text-sm text-muted-foreground">
              Dra. Helena R. · Clínica Geral · São Paulo
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── CTA ─────────────────────────────────────────────────────── */}
      <section className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div
            className="absolute inset-0 opacity-90"
            style={{
              background:
                'radial-gradient(ellipse at top, hsl(210 80% 55% / 0.18), transparent 60%), radial-gradient(ellipse at bottom right, hsl(265 80% 60% / 0.18), transparent 55%)',
            }}
          />
        </div>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border/60 text-xs font-semibold mb-6">
              <Zap className="w-3.5 h-3.5 text-medical-blue" />
              Pronto em 2 minutos
            </div>
            <h2 className="text-4xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              O próximo paciente entra.<br />
              <span
                className="bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient-shift"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, hsl(210 80% 55%), hsl(265 80% 65%), hsl(180 75% 50%), hsl(210 80% 55%))',
                }}
              >
                Comece agora.
              </span>
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
              Crie sua conta gratuita e grave sua primeira consulta hoje. Sem instalar nada.
            </p>
            <div className="mt-9 flex flex-wrap justify-center items-center gap-3">
              <Link to="/auth">
                <Button
                  size="lg"
                  className="rounded-full h-12 px-8 text-base shadow-card-hover hover:scale-[1.02] transition-transform"
                  style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
                >
                  Criar conta grátis
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-border/80 hover:border-foreground/30 text-sm font-medium hover:bg-muted/40 transition-all"
              >
                Já tenho conta
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────────── */}
      <footer className="border-t border-border/40 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, hsl(210 70% 50%), hsl(220 70% 38%))' }}
            >
              <Brain className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold">Cortex</span>
            <span className="text-xs text-muted-foreground ml-2">© 2026 · Assistente médico com IA</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <Link to="/auth" className="hover:text-foreground transition-colors">Entrar</Link>
            <a href="#features" className="hover:text-foreground transition-colors">Recursos</a>
            <a href="#how" className="hover:text-foreground transition-colors">Como funciona</a>
            <span className="inline-flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> LGPD compliant
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default About;
