import { useState } from 'react';
import { X, AlertTriangle, FileText, MessageCircle, Mic, Paperclip, Send, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Patient, ChatMessage } from '@/types/patient';
import { preBriefing } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface ChatPanelProps {
  patient: Patient | null;
  messages: ChatMessage[];
}

export function ChatPanel({ patient, messages }: ChatPanelProps) {
  const [showBriefing, setShowBriefing] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCopy = async (text: string, messageId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(messageId);
    toast({
      title: 'Texto copiado!',
      description: 'A mensagem foi copiada para a área de transferência.',
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!patient) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Selecione um paciente para iniciar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-medical-blue-light flex items-center justify-center">
              <span className="text-medical-blue font-semibold text-sm">
                {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </span>
            </div>
            <div>
              <h1 className="font-semibold text-foreground">{patient.name}</h1>
              <Badge variant="atendimento" className="mt-1">
                Em atendimento
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
        {/* Pre-consultation Briefing */}
        {showBriefing && (
          <div className="alert-briefing rounded-xl p-4 border animate-fade-in-up">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-alert-amber/20 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-alert-amber" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm mb-2">
                    {preBriefing.title}
                  </h3>
                  <ul className="space-y-1 text-sm text-foreground/80">
                    <li>• {preBriefing.content.returnInfo}</li>
                    <li>• {preBriefing.content.previousComplaint}</li>
                    <li>• {preBriefing.content.pending}</li>
                    <li className="text-destructive font-medium">
                      ⚠️ {preBriefing.content.alert}
                    </li>
                  </ul>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowBriefing(false)}
                className="shrink-0 h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((message, index) => (
          <div
            key={message.id}
            className={cn(
              'rounded-xl p-5 animate-fade-in-up',
              message.type === 'soap' && 'soap-note bg-card shadow-sm',
              message.type === 'whatsapp' && 'whatsapp-card bg-card shadow-sm'
            )}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                message.type === 'soap' && 'bg-medical-blue-light',
                message.type === 'whatsapp' && 'bg-whatsapp-light'
              )}>
                {message.type === 'soap' && <FileText className="w-4 h-4 text-medical-blue" />}
                {message.type === 'whatsapp' && <MessageCircle className="w-4 h-4 text-whatsapp-green" />}
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-foreground text-sm">{message.title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Gerado agora
                </p>
              </div>
            </div>
            <div className="prose prose-sm max-w-none text-foreground/90 whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </div>
            {message.type === 'whatsapp' && (
              <div className="mt-4 pt-3 border-t border-border/50">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(message.content, message.id)}
                  className="gap-2"
                >
                  {copiedId === message.id ? (
                    <>
                      <Check className="w-4 h-4 text-success" />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copiar Texto
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Paperclip className="w-5 h-5" />
          </Button>
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Digite uma mensagem ou comando..."
              className="w-full h-12 px-4 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30 focus:border-medical-blue transition-all"
            />
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Send className="w-5 h-5" />
          </Button>
          <Button variant="record" size="icon-lg" className="rounded-full animate-pulse-record">
            <Mic className="w-6 h-6" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Pressione o botão vermelho para gravar a consulta
        </p>
      </div>
    </div>
  );
}
