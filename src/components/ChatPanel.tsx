import { useState, useRef, useEffect } from 'react';
import {
  X, AlertTriangle, FileText, MessageCircle, Mic, Paperclip, Send,
  Copy, Check, Pencil, Pause, Play, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Patient, ChatMessage } from '@/types/patient';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ConsultationReviewModal } from '@/components/ConsultationReviewModal';

interface PreBriefing {
  returnInfo: string;
  previousComplaint: string;
  pending: string;
  alert: string;
  details?: {
    lastConsultationDate?: string;
    mainComplaint?: string;
    previousConduct?: string;
    evolution?: string;
  };
}

interface ChatPanelProps {
  patient: Patient | null;
  messages: ChatMessage[];
  onMessagesChange: (msgs: ChatMessage[]) => void;
  chiefComplaint: string;
  preBriefing: PreBriefing | null;
  briefingLoading: boolean;
  userId: string;
}

export function ChatPanel({
  patient,
  messages,
  onMessagesChange,
  chiefComplaint,
  preBriefing,
  briefingLoading,
  userId,
}: ChatPanelProps) {
  const [showBriefing, setShowBriefing] = useState(true);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [comment, setComment] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [currentConsultationId, setCurrentConsultationId] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [reviewData, setReviewData] = useState<{
    transcription: string;
    soapDraft: string;
    whatsappDraft: string;
  } | null>(null);
  const [isGeneratingFinal, setIsGeneratingFinal] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();

  useEffect(() => {
    setShowBriefing(true);
    setBriefingExpanded(false);
  }, [patient?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setRecordingSeconds(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleCopy = async (text: string, messageId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(messageId);
    toast({ title: 'Texto copiado!', description: 'Copiado para a área de transferência.' });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopTimer();
        streamRef.current?.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await processConsultation(audioBlob, mimeType);
      };

      recorder.start(500);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingSeconds(0);
      startTimer();

      toast({ title: 'Gravação iniciada', description: 'A consulta está sendo gravada.' });
    } catch {
      toast({
        title: 'Erro ao iniciar gravação',
        description: 'Verifique se o microfone está disponível e permitido.',
        variant: 'destructive',
      });
    }
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setIsPaused(false);
    stopTimer();
  };

  const handlePauseToggle = () => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      startTimer();
      toast({ title: 'Gravação retomada' });
    } else {
      mediaRecorderRef.current.pause();
      stopTimer();
      toast({ title: 'Gravação pausada' });
    }
    setIsPaused(prev => !prev);
  };

  const handleAddComment = () => {
    if (!comment.trim()) return;
    toast({ title: 'Comentário adicionado', description: 'Será incluído no contexto da consulta.' });
    setComment('');
  };

  const processConsultation = async (audioBlob: Blob, mimeType: string) => {
    if (!patient) return;
    setIsProcessing(true);

    try {
      const base64 = await blobToBase64(audioBlob);

      const { data, error } = await supabase.functions.invoke('process-consultation', {
        body: {
          patientId: patient.id,
          userId,
          chiefComplaint,
          audioBase64: base64,
          audioMimeType: mimeType,
          patientContext: {
            name: patient.name,
            age: patient.age,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
          },
        },
      });

      if (error) throw error;

      setReviewData({
        transcription: data.transcription ?? '',
        soapDraft: data.soapNote ?? '',
        whatsappDraft: data.whatsappMessage ?? '',
      });
    } catch (err: any) {
      toast({
        title: 'Erro ao processar consulta',
        description: err.message || 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;
    const msg: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      title: 'Você',
      content: inputValue.trim(),
      timestamp: new Date(),
    };
    onMessagesChange([...messages, msg]);
    setInputValue('');
  };

  const handleSaveEdit = async (messageId: string) => {
    if (currentConsultationId) {
      await supabase
        .from('consultations')
        .update({ soap_note: editedContent })
        .eq('id', currentConsultationId);
    }
    onMessagesChange(messages.map(m =>
      m.id === messageId ? { ...m, content: editedContent } : m
    ));
    setEditingId(null);
    toast({ title: 'Alterações salvas', description: 'A evolução clínica foi atualizada.' });
  };

  const pushToChat = (soapNote: string, whatsappMessage: string) => {
    const now = new Date();
    onMessagesChange([...messages,
      {
        id: `soap-${now.getTime()}`,
        type: 'soap',
        title: 'Evolução Clínica',
        content: soapNote,
        timestamp: now,
      },
      {
        id: `wa-${now.getTime()}`,
        type: 'whatsapp',
        title: 'Sugestão de Mensagem (WhatsApp)',
        content: whatsappMessage,
        timestamp: now,
      },
    ]);
  };

  // Phase 2: generate final SOAP (with doctor comments) → save to DB → show in chat
  const handleReviewConfirm = async (comments: string) => {
    if (!reviewData || !patient) return;
    setIsGeneratingFinal(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-consultation', {
        body: {
          patientId: patient.id,
          userId,
          chiefComplaint,
          transcription: reviewData.transcription,
          doctorComments: comments,
          patientContext: {
            name: patient.name,
            age: patient.age,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
          },
        },
      });

      if (error) throw error;

      setCurrentConsultationId(data.consultationId ?? null);
      pushToChat(data.soapNote, data.whatsappMessage);
      setReviewData(null);
      toast({ title: 'Consulta salva!', description: 'Evolução clínica gerada com sucesso.' });
    } catch {
      toast({ title: 'Erro ao gerar evolução', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      setIsGeneratingFinal(false);
    }
  };

  const handleReviewCancel = () => setReviewData(null);

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

  const activeBriefing = preBriefing;

  return (
    <div className="flex-1 flex flex-col bg-card h-full">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          {patient.photoUrl ? (
            <img src={patient.photoUrl} alt={patient.name} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-medical-blue-light flex items-center justify-center">
              <span className="text-medical-blue font-semibold text-sm">
                {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </span>
            </div>
          )}
          <div>
            <h1 className="font-semibold text-foreground">{patient.name}</h1>
            <Badge variant="atendimento" className="mt-1">Em atendimento</Badge>
          </div>
        </div>
      </header>

      {/* Chat Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">

        {/* Pre-consultation Briefing */}
        {showBriefing && (
          <div className="alert-briefing rounded-lg py-3 px-4 animate-fade-in-up">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 flex-1">
                <AlertTriangle className="w-4 h-4 text-alert-amber shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground text-xs mb-1.5">Resumo Pré-Consulta</h3>

                  {briefingLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Gerando resumo com IA...
                    </div>
                  ) : activeBriefing ? (
                    <>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/80">
                        <span>{activeBriefing.returnInfo}</span>
                        <span>•</span>
                        <span>{activeBriefing.previousComplaint}</span>
                        {activeBriefing.pending && (
                          <>
                            <span>•</span>
                            <span>{activeBriefing.pending}</span>
                          </>
                        )}
                        {activeBriefing.alert && (
                          <span className="text-destructive font-medium">
                            ⚠️ {activeBriefing.alert}
                          </span>
                        )}
                      </div>

                      {briefingExpanded && activeBriefing.details && (
                        <div className="mt-3 pt-3 border-t border-border/30 space-y-2 text-xs text-foreground/80">
                          {activeBriefing.details.lastConsultationDate && (
                            <div>
                              <span className="font-semibold text-foreground">Última Consulta:</span>{' '}
                              {activeBriefing.details.lastConsultationDate}
                            </div>
                          )}
                          {activeBriefing.details.mainComplaint && (
                            <div>
                              <span className="font-semibold text-foreground">Queixa Principal:</span>{' '}
                              {activeBriefing.details.mainComplaint}
                            </div>
                          )}
                          {activeBriefing.details.previousConduct && (
                            <div>
                              <span className="font-semibold text-foreground">Conduta Anterior:</span>{' '}
                              {activeBriefing.details.previousConduct}
                            </div>
                          )}
                          {activeBriefing.details.evolution && (
                            <div>
                              <span className="font-semibold text-foreground">Evolução:</span>{' '}
                              {activeBriefing.details.evolution}
                            </div>
                          )}
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
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Primeira consulta com este paciente.</p>
                  )}
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
              message.type === 'whatsapp' && 'whatsapp-card p-5',
              message.type === 'user' && 'flex justify-end',
            )}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {message.type === 'user' ? (
              <div className="max-w-[75%] bg-medical-blue text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 text-sm">
                {message.content}
              </div>
            ) : (
              <>
                {message.type === 'soap' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-3 h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (editingId === message.id) {
                        handleSaveEdit(message.id);
                      } else {
                        setEditingId(message.id);
                        setEditedContent(message.content);
                      }
                    }}
                  >
                    {editingId === message.id
                      ? <Check className="w-3.5 h-3.5 text-success" />
                      : <Pencil className="w-3.5 h-3.5" />}
                  </Button>
                )}

                <div className="flex items-start gap-3 mb-3">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    message.type === 'soap' && 'bg-medical-blue-light',
                    message.type === 'whatsapp' && 'bg-whatsapp-green/20',
                  )}>
                    {message.type === 'soap' && <FileText className="w-4 h-4 text-medical-blue" />}
                    {message.type === 'whatsapp' && <MessageCircle className="w-4 h-4 text-whatsapp-green" />}
                  </div>
                  <div className="flex-1">
                    <h4 className={cn(
                      'font-semibold text-sm',
                      message.type === 'soap' ? 'text-medical-blue' : 'text-foreground',
                    )}>{message.title}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {message.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>

                {message.type === 'soap' && editingId === message.id ? (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full min-h-[200px] text-sm leading-relaxed bg-muted/30 border border-border rounded-lg p-3 text-foreground/90 focus:outline-none focus:ring-2 focus:ring-medical-blue/30 resize-y"
                    autoFocus
                  />
                ) : (
                  <div className={cn(
                    'text-sm leading-relaxed whitespace-pre-wrap',
                    message.type === 'soap' ? 'text-foreground/90' : 'text-foreground/80',
                  )}>
                    {message.content.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                      part.startsWith('**') && part.endsWith('**')
                        ? <strong key={i}>{part.slice(2, -2)}</strong>
                        : part
                    )}
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
                      {copiedId === message.id
                        ? <><Check className="w-3.5 h-3.5 text-success" />Copiado!</>
                        : <><Copy className="w-3.5 h-3.5" />Copiar Texto</>}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {/* Processing spinner */}
        {isProcessing && (
          <div className="soap-note rounded-lg p-5 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-medical-blue-light flex items-center justify-center">
                <Loader2 className="w-4 h-4 text-medical-blue animate-spin" />
              </div>
              <div>
                <p className="font-semibold text-sm text-medical-blue">Processando consulta com IA...</p>
                <p className="text-xs text-muted-foreground">Transcrevendo e gerando evolução clínica</p>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 space-y-3">
        {/* Recording Status Banner */}
        {isRecording && (
          <div className={cn(
            'border rounded-lg p-3 animate-fade-in',
            isPaused ? 'bg-amber-500/10 border-amber-500/30' : 'bg-record-red/10 border-record-red/30',
          )}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  isPaused ? 'bg-amber-500' : 'bg-record-red animate-pulse',
                )} />
                <span className={cn(
                  'text-sm font-semibold',
                  isPaused ? 'text-amber-500' : 'text-record-red',
                )}>
                  {isPaused ? 'Gravação pausada' : `Gravando... ${formatTimer(recordingSeconds)}`}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePauseToggle}
                className={cn(
                  'h-8 gap-1.5',
                  isPaused ? 'text-amber-500 hover:text-amber-600' : 'text-record-red hover:text-record-red/80',
                )}
              >
                {isPaused
                  ? <><Play className="w-4 h-4" />Retomar</>
                  : <><Pause className="w-4 h-4" />Pausar</>}
              </Button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Adicionar comentário à transcrição..."
                className="flex-1 h-9 px-3 rounded-lg bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30 placeholder:text-muted-foreground"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }}
              />
              <Button variant="outline" size="sm" onClick={handleAddComment} disabled={!comment.trim()}>
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
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                placeholder="Digite uma mensagem ou comentário..."
                className="w-full h-10 px-4 rounded-xl bg-muted/50 border-0 text-sm focus:outline-none focus:ring-2 focus:ring-medical-blue/30 transition-all placeholder:text-slate-400"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-foreground h-9 w-9"
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
            <Button
              variant={isRecording ? 'destructive' : 'record'}
              size="icon-lg"
              className="rounded-full"
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              disabled={isProcessing}
            >
              {isProcessing
                ? <Loader2 className="w-5 h-5 animate-spin" />
                : <Mic className="w-5 h-5" />}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">
          {isProcessing
            ? 'Processando consulta, aguarde...'
            : isRecording
            ? 'Clique no botão para finalizar e processar a gravação'
            : 'Pressione o botão vermelho para gravar a consulta'}
        </p>
      </div>

      <ConsultationReviewModal
        open={!!reviewData}
        patientName={patient?.name ?? ''}
        transcription={reviewData?.transcription ?? ''}
        soapDraft={reviewData?.soapDraft ?? ''}
        onConfirm={handleReviewConfirm}
        onCancel={handleReviewCancel}
        isGenerating={isGeneratingFinal}
      />
    </div>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
