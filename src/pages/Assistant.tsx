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
import { functionErrorBody } from '@/lib/functionErrors';
import { ClinicalAnswer } from '@/components/ClinicalAnswer';
import type { ChatMessage } from '@/types/patient';

interface Msg { id: string; role: 'user' | 'assistant'; content: string; sources?:ChatMessage['sources'];coverage?:ChatMessage['coverage'] }

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
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const [requestError, setRequestError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [messages, loading]);

  const send = async (text: string, retry = false) => {
    const q = text.trim();
    if (!q || loading || !user) return;
    setInput('');
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: q };
    if (!retry) setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setFailedQuestion(null); setRequestError('');
    try {
      const { data, error } = await supabase.functions.invoke('chat-assistant', {
        body: {
          patientId: null,
          patientContext: null,
          chatHistory: (retry ? messages.slice(0, -1) : messages).filter(m=>m.role==='user'||!m.sources?.some(source=>source.type==='knowledge'||source.type==='protocol')).slice(-10).map(m => ({ type: m.role, content: m.content })),
          userMessage: q,
        },
      });
      if (error) {
        const body = await functionErrorBody(error);
        if (body?.quotaExceeded) {
          setRequestError('Limite diário atingido. Tente novamente após a renovação da cota.');
          setFailedQuestion(q);
          queryClient.invalidateQueries({ queryKey: ['usage-daily', user.id] });
          return;
        }
        throw error;
      }
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: data.message,sources:Array.isArray(data.sources)?data.sources:[],coverage:data.coverage }]);
      queryClient.invalidateQueries({ queryKey: ['usage-daily', user.id] });
    } catch {
      setRequestError('Não foi possível consultar o assistente. Sua pergunta foi mantida.');
      setFailedQuestion(q);
    } finally {
      setLoading(false);
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="h-[100dvh] bg-slate-50 flex flex-col">
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto px-3 md:px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Sparkles className="h-5 w-5 text-medical-blue shrink-0" />
          <h1 className="text-base md:text-lg font-semibold text-foreground">Assistente Cortex</h1>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        {requestError && <div role="alert" className="mx-auto w-full max-w-2xl p-3 text-sm text-destructive flex items-center gap-3">
          <p>{requestError}</p>
          {failedQuestion && <Button variant="outline" size="sm" disabled={loading} onClick={() => send(failedQuestion, true)}>Tentar novamente</Button>}
        </div>}
        {empty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-2xl mx-auto w-full">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-8">
              Como o <span className="text-medical-blue">Cortex</span> pode te ajudar?
            </h2>
            <div className="w-full relative">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(input); }}
                placeholder="Escreva o que você precisa"
                aria-label="Escreva o que você precisa"
                className="w-full h-14 pl-5 pr-14 rounded-2xl border border-border bg-white shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30"
              />
              <Button
                size="icon"
                aria-label="Enviar pergunta"
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
                  onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
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
            <div className="flex-1 overflow-y-auto scrollbar-thin" role="log" aria-label="Conversa com o assistente" aria-live="polite" aria-relevant="additions text">
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
                      {m.role==='assistant'?<ClinicalAnswer userId={user?.id??''} message={{id:m.id,type:'assistant',title:'Assistente',content:m.content,timestamp:new Date(0),sources:m.sources,coverage:m.coverage}}/>:m.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Brain className="w-4 h-4 text-primary" />
                    </div>
                    <div className="bg-white border border-border/60 rounded-2xl rounded-tl-sm px-4 py-3" role="status" aria-label="Aguardando resposta do assistente">
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
                  aria-label="Escreva o que você precisa"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') send(input); }}
                  placeholder="Escreva o que você precisa"
                  className="flex-1 h-11 px-4 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30"
                />
                <Button size="icon" aria-label="Enviar pergunta" className="rounded-xl h-11 w-11" onClick={() => send(input)} disabled={!input.trim() || loading}>
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
