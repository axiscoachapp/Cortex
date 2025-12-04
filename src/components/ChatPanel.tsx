import { useState } from 'react';
import { X, AlertTriangle, FileText, MessageCircle, Mic, Paperclip, Send, Copy, Check, Pencil } from 'lucide-react';
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
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [comment, setComment] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
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

  const handleRecordingToggle = () => {
    setIsRecording(!isRecording);
    setComment('');
    toast({
      title: isRecording ? 'Gravação finalizada' : 'Gravação iniciada',
      description: isRecording ? 'A consulta foi gravada com sucesso.' : 'A consulta está sendo gravada.',
    });
  };

  const handleAddComment = () => {
    if (comment.trim()) {
      toast({
        title: 'Comentário adicionado',
        description: 'O comentário foi adicionado à transcrição.',
      });
      setComment('');
    }
  };

  if (!patient) {
    return (
      <div className="flex-1 flex items-center justify-center bg-card">
        <div className="text-center text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-4 text-slate-400 opacity-50" />
          <p>Selecione um paciente para iniciar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-card h-full">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {patient.photoUrl ? (
              <img
                src={patient.photoUrl}
                alt={patient.name}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-medical-blue-light flex items-center justify-center">
                <span className="text-medical-blue font-semibold text-sm">
                  {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </span>
              </div>
            )}
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
        {/* Pre-consultation Briefing - Compact */}
        {showBriefing && (
          <div className="alert-briefing rounded-lg py-3 px-4 animate-fade-in-up">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 flex-1">
                <AlertTriangle className="w-4 h-4 text-alert-amber shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground text-xs mb-1.5">
                    {preBriefing.title}
                  </h3>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/80">
                    <span>{preBriefing.content.returnInfo}</span>
                    <span>•</span>
                    <span>{preBriefing.content.previousComplaint}</span>
                    <span>•</span>
                    <span>{preBriefing.content.pending}</span>
                    <span className="text-destructive font-medium">
                      ⚠️ {preBriefing.content.alert}
                    </span>
                  </div>
                  
                  {briefingExpanded && (
                    <div className="mt-3 pt-3 border-t border-border/30 space-y-2 text-xs text-foreground/80">
                      <div>
                        <span className="font-semibold text-foreground">Última Consulta:</span> 15/10/2024 (45 dias atrás)
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Queixa Principal:</span> Insônia persistente há 3 meses, ansiedade generalizada, dificuldade de concentração no trabalho
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Conduta Anterior:</span> Iniciado Sertralina 50mg 1x/dia. Solicitado hemograma completo e TSH
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Evolução:</span> Paciente relatou melhora parcial da ansiedade mas insônia persiste. Sem efeitos colaterais significativos
                      </div>
                    </div>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBriefingExpanded(!briefingExpanded)}
                    className="mt-2 h-7 px-2 text-xs text-medical-blue hover:text-medical-blue-dark"
                  >
                    {briefingExpanded ? 'Ver menos' : 'Ver mais detalhes'}
                  </Button>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowBriefing(false)}
                className="shrink-0 h-6 w-6 text-slate-400 hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((message, index) => (
          <div
            key={message.id}
            className={cn(
              'animate-fade-in-up relative',
              message.type === 'soap' && 'soap-note rounded-lg p-5',
              message.type === 'whatsapp' && 'whatsapp-card p-5'
            )}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            {message.type === 'soap' && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3 h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (editingId === message.id) {
                    setEditingId(null);
                    toast({
                      title: 'Alterações salvas',
                      description: 'A evolução clínica foi atualizada.',
                    });
                  } else {
                    setEditingId(message.id);
                    setEditedContent(message.content);
                  }
                }}
              >
                {editingId === message.id ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Pencil className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
            <div className="flex items-start gap-3 mb-3">
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                message.type === 'soap' && 'bg-medical-blue-light',
                message.type === 'whatsapp' && 'bg-whatsapp-green/20'
              )}>
                {message.type === 'soap' && <FileText className="w-4 h-4 text-medical-blue" />}
                {message.type === 'whatsapp' && <MessageCircle className="w-4 h-4 text-whatsapp-green" />}
              </div>
              <div className="flex-1">
                <h4 className={cn(
                  'font-semibold text-sm',
                  message.type === 'soap' ? 'text-medical-blue' : 'text-foreground'
                )}>{message.title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Gerado agora
                </p>
              </div>
            </div>
            {message.type === 'soap' && editingId === message.id ? (
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="w-full min-h-[200px] text-sm leading-relaxed bg-muted/30 border border-border rounded-lg p-3 text-foreground/90 font-['Inter'] focus:outline-none focus:ring-2 focus:ring-medical-blue/30 resize-y"
                autoFocus
              />
            ) : (
              <div className={cn(
                'text-sm leading-relaxed whitespace-pre-wrap',
                message.type === 'soap' ? 'text-foreground/90 font-[\'Inter\']' : 'text-foreground/80'
              )}>
                {(editingId === message.id ? editedContent : message.content).split(/(\*\*[^*]+\*\*)/).map((part, i) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={i}>{part.slice(2, -2)}</strong>;
                  }
                  return part;
                })}
              </div>
            )}
            {message.type === 'whatsapp' && (
              <div className="mt-4 pt-3 border-t border-whatsapp-green/20">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(message.content, message.id)}
                  className="gap-2 text-xs"
                >
                  {copiedId === message.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-success" />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copiar Texto
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input Area - Command Center Style */}
      <div className="p-4 space-y-3">
        {/* Recording Status Banner */}
        {isRecording && (
          <div className="bg-record-red/10 border border-record-red/30 rounded-lg p-3 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-record-red animate-pulse" />
              <span className="text-sm font-semibold text-record-red">Gravando consulta...</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Adicionar comentário à transcrição..."
                className="flex-1 h-9 px-3 rounded-lg bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30 transition-all placeholder:text-muted-foreground"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddComment();
                  }
                }}
              />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleAddComment}
                disabled={!comment.trim()}
              >
                Adicionar
              </Button>
            </div>
          </div>
        )}

        <div className="input-command-center p-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-foreground h-9 w-9">
              <Paperclip className="w-4 h-4" />
            </Button>
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Digite uma mensagem ou comando..."
                className="w-full h-10 px-4 rounded-xl bg-muted/50 border-0 text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30 transition-all placeholder:text-slate-400"
              />
            </div>
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-foreground h-9 w-9">
              <Send className="w-4 h-4" />
            </Button>
            <Button 
              variant={isRecording ? "destructive" : "record"} 
              size="icon-lg" 
              className="rounded-full"
              onClick={handleRecordingToggle}
            >
              <Mic className="w-5 h-5" />
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">
          {isRecording ? 'Clique no botão para finalizar a gravação' : 'Pressione o botão vermelho para gravar a consulta'}
        </p>
      </div>
    </div>
  );
}
