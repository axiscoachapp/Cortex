import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Send, Loader2, Brain, Stethoscope, Pill, FileText, Users, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Msg { id: string; role: 'user' | 'assistant'; content: string }

const CHIPS = [
  { label: 'Suporte clínico', icon: Stethoscope, prompt: 'Preciso de apoio para o raciocínio clínico de um caso: ' },
  { label: 'Medicações',      icon: Pill,        prompt: 'Tenho uma dúvida sobre medicação/interação: ' },
  { label: 'Documentos',      icon: FileText,    prompt: 'Como eu gero e assino um documento no Cortex? ' },
  { label: 'Pacientes',       icon: Users,       prompt: 'Sobre a gestão de pacientes: ' },
];

export default function AssistantPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading || !user) return;
    setInput('');
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: q };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('chat-assistant', {
        body: {
          patientId: null,
          patientContext: null,
          chatHistory: messages.slice(-10).map(m => ({ type: m.role, content: m.content })),
          userMessage: q,
        },
      });
      if (error) {
        const body = (error as any)?.context?.json ? await (error as any).context.json().catch(() => null) : null;
        if (body?.quotaExceeded) {
          toast({ title: 'Limite diário atingido', description: body.error, variant: 'destructive' });
          return;
        }
        throw error;
      }
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: data.message }]);
      queryClient.invalidateQueries({ queryKey: ['usage-daily', user.id] });
    } catch {
      toast({ title: 'Erro ao consultar o assistente', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-3 md:px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Sparkles className="h-5 w-5 text-medical-blue shrink-0" />
          <h1 className="text-base md:text-lg font-semibold text-foreground">Assistente Cortex</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {empty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-2xl mx-auto w-full">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-8">
              Como o <span className="text-medical-blue">Cortex</span> pode te ajudar?
            </h2>
            <div className="w-full relative">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(input); }}
                placeholder="Escreva o que você precisa"
                className="w-full h-14 pl-5 pr-14 rounded-2xl border border-border bg-white shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30"
                autoFocus
              />
              <Button
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl h-10 w-10"
                onClick={() => send(input)}
                disabled={!input.trim()}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">O assistente pode cometer erros. Sempre confira as respostas.</p>
            <div className="flex flex-wrap gap-2 justify-center mt-6">
              {CHIPS.map(({ label, icon: Icon, prompt }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setInput(prompt); }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-border bg-white text-xs font-medium text-foreground/80 hover:border-medical-blue/40 hover:bg-medical-blue-light/30 transition-all"
                >
                  <Icon className="w-3.5 h-3.5 text-medical-blue" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <div className="container mx-auto px-3 md:px-4 py-6 max-w-2xl space-y-4">
                {messages.map(m => (
                  <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'items-start gap-3')}>
                    {m.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Brain className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[85%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-medical-blue text-white rounded-2xl rounded-tr-sm'
                        : 'bg-white border border-border/60 rounded-2xl rounded-tl-sm text-foreground/90',
                    )}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Brain className="w-4 h-4 text-primary" />
                    </div>
                    <div className="bg-white border border-border/60 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex gap-1">
                        {[0, 150, 300].map(d => (
                          <div key={d} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </div>
            <div className="border-t border-border/50 bg-background/95 backdrop-blur-sm">
              <div className="container mx-auto px-3 md:px-4 py-3 max-w-2xl flex items-center gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') send(input); }}
                  placeholder="Escreva o que você precisa"
                  className="flex-1 h-11 px-4 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30"
                />
                <Button size="icon" className="rounded-xl h-11 w-11" onClick={() => send(input)} disabled={!input.trim() || loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
