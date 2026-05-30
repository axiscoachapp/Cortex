import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X, AlertTriangle, FileText, MessageCircle, Mic, Paperclip, Send,
  Copy, Check, Pencil, Pause, Play, Loader2, Download, StopCircle, Brain,
  HelpCircle, StickyNote, ClipboardList, Share2,
} from 'lucide-react';
import { useRecording } from '@/hooks/useRecording';
import { useUserSettings } from '@/hooks/useUserSettings';
import { SoapNoteView } from '@/components/SoapNoteView';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Patient, ChatMessage } from '@/types/patient';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ConsultationReviewModal } from '@/components/ConsultationReviewModal';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import { printSoap } from '@/lib/printDoc';
import { UsageMeter, UsageOverBanner } from '@/components/UsageMeter';

export interface PreBriefing {
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
  /** Called after a consultation is successfully saved so the parent can
   *  invalidate any stale pre-briefing cache entries for this patient. */
  onConsultationSaved?: (patientId: string) => void;
}

export function ChatPanel({
  patient,
  messages,
  onMessagesChange,
  chiefComplaint,
  preBriefing,
  briefingLoading,
  userId,
  onConsultationSaved,
}: ChatPanelProps) {
  const [showBriefing, setShowBriefing] = useState(true);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [currentConsultationId, setCurrentConsultationId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<{
    transcription: string;
    soapDraft: string;
    whatsappDraft: string;
    clarifications: string[];
    transcriptionQuality: 'good' | 'partial' | 'poor';
    differentialDiagnoses: string[];
    drugInteractionAlerts: string[];
  } | null>(null);
  const [isGeneratingFinal, setIsGeneratingFinal] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [inputMode, setInputMode] = useState<'question' | 'comment'>('question');
  const [savingNote, setSavingNote] = useState(false);
  const [consultationComments, setConsultationComments] = useState<string[]>([]);
  const [documentModal, setDocumentModal] = useState<{
    type: 'patient_summary' | 'referral';
    content: string;
    isLoading: boolean;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const consultationCommentsRef = useRef<string[]>([]);

  const recording = useRecording({
    onStop: processConsultation,
    consultationCommentsRef,
    onCommentsReset: () => {
      consultationCommentsRef.current = [];
      setConsultationComments([]);
    },
  });

  const { isRecording, isPaused, stopConfirming, recordingSeconds, audioLevel } = recording;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { specialty } = useUserSettings();

  useEffect(() => {
    setShowBriefing(true);
    setBriefingExpanded(false);
    consultationCommentsRef.current = [];
    setConsultationComments([]);
    recording.cancelStop();
  }, [patient?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleStartRecording  = () => recording.start();
  const handleStopRecording   = () => recording.stop();
  const handleConfirmStop     = () => recording.confirmStop();
  const handleCancelStop      = () => recording.cancelStop();
  const handlePauseToggle     = () => recording.pauseToggle();

  const handleCopy = async (text: string, messageId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(messageId);
    toast({ title: 'Texto copiado!', description: 'Copiado para a área de transferência.' });
    setTimeout(() => setCopiedId(null), 2000);
  };


  const addTranscriptionComment = (text: string) => {
    consultationCommentsRef.current = [...consultationCommentsRef.current, text];
    setConsultationComments([...consultationCommentsRef.current]);
    toast({ title: 'Comentário adicionado', description: 'Será incluído no contexto da consulta.' });
  };

  const appendPatientNote = async (text: string) => {
    if (!patient) return;
    setSavingNote(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-comment', {
        body: { patientId: patient.id, userId, comment: text },
      });
      if (error) {
        const body = (error as any)?.context && typeof (error as any).context.json === 'function'
          ? await (error as any).context.json().catch(() => null)
          : null;
        if (body?.quotaExceeded) {
          toast({
            title: 'Limite diário atingido',
            description: body.error ?? 'Aguarde o reset diário ou solicite aumento.',
            variant: 'destructive',
          });
          queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
          return;
        }
        throw error;
      }

      const summary: string = data?.summary ?? 'Comentário processado.';
      const appliedAddendum: boolean = !!data?.appliedAddendum;

      onMessagesChange([...messages, {
        id: `note-${Date.now()}`,
        type: 'assistant',
        title: appliedAddendum ? 'Adendo na consulta de hoje' : 'Comentário processado',
        content: `📝 ${text}\n\n→ ${summary}`,
        timestamp: new Date(),
      }]);

      // Refresh everything the comment could have touched
      queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['patient-clinical-notes', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['patient-consultations', patient.id] });
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });

      toast({ title: 'Comentário processado', description: summary });
    } catch (err: any) {
      toast({
        title: 'Erro ao processar comentário',
        description: err.message ?? 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSavingNote(false);
    }
  };

  const patientContext = patient ? {
    name: patient.name,
    age: patient.age,
    diagnoses: patient.diagnoses,
    medications: patient.medications,
    allergies: patient.allergies,
  } : {};

  // Shared save logic — called from auto-confirm path (saveDirect) or review modal (with comments)
  const submitFinalSoap = async (
    transcription: string,
    doctorComments: string,
    directSoapNote?: string,
    directWhatsappMessage?: string,
  ) => {
    if (!patient) return;
    const body = directSoapNote != null
      ? {
          patientId: patient.id, userId, chiefComplaint, transcription, patientContext,
          saveDirect: true,
          soapNote: directSoapNote,
          whatsappMessage: directWhatsappMessage ?? '',
          userSpecialty: specialty,
        }
      : {
          patientId: patient.id, userId, chiefComplaint, transcription, doctorComments, patientContext,
          userSpecialty: specialty,
        };
    const { data, error } = await supabase.functions.invoke('finalize-consultation', { body });
    if (error) throw error;
    setCurrentConsultationId(data.consultationId ?? null);
    pushToChat(data.soapNote, data.whatsappMessage);
    setReviewData(null);
    // Clear the stale pre-briefing cache for this patient now that a new
    // consultation has been saved — the parent will regenerate on next select.
    if (patient?.id) onConsultationSaved?.(patient.id);
    toast({ title: 'Consulta salva!', description: 'Evolução clínica gerada com sucesso.' });
  };

  /** Upload with up to 3 attempts and exponential backoff. */
  const uploadAudioWithRetry = async (
    blob: Blob,
    path: string,
    mimeType: string,
    maxAttempts = 3,
  ): Promise<void> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { error } = await supabase.storage
        .from('audio-recordings')
        .upload(path, blob, { contentType: mimeType });
      if (!error) return;
      if (attempt === maxAttempts) throw error;
      // Exponential backoff: 1 s, 2 s
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  };

  /** Offer the physician a local download so the recording isn't lost. */
  const offerLocalDownload = (blob: Blob, mimeType: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consulta-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const processConsultation = async (audioBlob: Blob, mimeType: string, comments: string[]) => {
    if (!patient) return;
    setIsProcessing(true);

    try {
      const storagePath = `consultations/${userId}/${Date.now()}.webm`;
      try {
        await uploadAudioWithRetry(audioBlob, storagePath, mimeType);
      } catch (uploadError) {
        // Upload failed after retries — offer the recording as a local download
        // so it isn't permanently lost, then surface a clear error.
        offerLocalDownload(audioBlob, mimeType);
        toast({
          title: 'Erro ao enviar gravação',
          description: 'Não foi possível enviar o áudio. O arquivo foi salvo localmente no seu dispositivo.',
          variant: 'destructive',
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('transcribe-consultation', {
        body: {
          patientId: patient.id,
          userId,
          chiefComplaint,
          audioStoragePath: storagePath,
          audioMimeType: mimeType,
          consultationComments: comments,
          patientContext,
          userSpecialty: specialty,
        },
      });
      if (error) {
        const body = (error as any)?.context && typeof (error as any).context.json === 'function'
          ? await (error as any).context.json().catch(() => null)
          : null;
        if (body?.quotaExceeded) {
          toast({
            title: 'Limite diário atingido',
            description: body.error ?? 'Aguarde o reset diário ou solicite aumento do limite.',
            variant: 'destructive',
          });
          queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
          return;
        }
        throw error;
      }

      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
      const quality = data.transcriptionQuality ?? 'good';
      const clarifications: string[]        = Array.isArray(data.clarifications)         ? data.clarifications         : [];
      const differentialDiagnoses: string[] = Array.isArray(data.differentialDiagnoses)  ? data.differentialDiagnoses  : [];
      const drugInteractionAlerts: string[] = Array.isArray(data.drugInteractionAlerts)  ? data.drugInteractionAlerts  : [];

      if (quality === 'good' && clarifications.length === 0 && differentialDiagnoses.length === 0 && drugInteractionAlerts.length === 0) {
        await submitFinalSoap(data.transcription ?? '', '', data.soapNote ?? '', data.whatsappMessage ?? '');
      } else {
        setReviewData({
          transcription: data.transcription ?? '',
          soapDraft: data.soapNote ?? '',
          whatsappDraft: data.whatsappMessage ?? '',
          clarifications,
          transcriptionQuality: quality,
          differentialDiagnoses,
          drugInteractionAlerts,
        });
      }
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



  const handleSendMessage = async () => {
    if (!inputValue.trim() || isChatLoading) return;
    const text = inputValue.trim();
    setInputValue('');

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      title: 'Você',
      content: text,
      timestamp: new Date(),
    };
    const withUser = [...messages, userMsg];
    onMessagesChange(withUser);
    setIsChatLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('chat-assistant', {
        body: {
          patientId: patient?.id ?? null,
          userId,
          patientContext: patient ? {
            name: patient.name,
            age: patient.age,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
            socialAnamnesis: patient.socialAnamnesis,
            medicalHistory: patient.medicalHistory,
          } : null,
          chatHistory: messages
            .filter(m => m.type === 'user' || m.type === 'assistant')
            .slice(-10)
            .map(m => ({ type: m.type, content: m.content })),
          userMessage: text,
        },
      });
      if (error) {
        // supabase-js wraps non-2xx as FunctionsHttpError; the JSON body lives on err.context
        const body = (error as any)?.context && typeof (error as any).context.json === 'function'
          ? await (error as any).context.json().catch(() => null)
          : null;
        if (body?.quotaExceeded) {
          toast({
            title: 'Limite diário atingido',
            description: body.error ?? 'Aguarde o reset diário ou solicite aumento.',
            variant: 'destructive',
          });
          queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
          return;
        }
        throw error;
      }
      onMessagesChange([...withUser, {
        id: `assistant-${Date.now()}`,
        type: 'assistant',
        title: 'Assistente Clínico',
        content: data.message,
        timestamp: new Date(),
      }]);
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
    } catch {
      toast({ title: 'Erro ao consultar IA', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSubmit = async () => {
    const text = inputValue.trim();
    if (!text) return;

    if (inputMode === 'question') {
      await handleSendMessage();
      return;
    }

    // comment mode
    setInputValue('');
    if (isRecording) {
      addTranscriptionComment(text);
    } else {
      await appendPatientNote(text);
    }
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
      await submitFinalSoap(reviewData.transcription, comments);
    } catch {
      toast({ title: 'Erro ao gerar evolução', description: 'Tente novamente.', variant: 'destructive' });
    } finally {
      setIsGeneratingFinal(false);
    }
  };

  const handleReviewCancel = () => setReviewData(null);

  const handleSendWhatsapp = (message: string) => {
    const raw = patient?.phone?.replace(/\D/g, '') ?? '';
    if (!raw) {
      toast({
        title: 'Telefone não cadastrado',
        description: 'Adicione o telefone do paciente no perfil para enviar via WhatsApp.',
        variant: 'destructive',
      });
      return;
    }
    const number = raw.startsWith('55') ? raw : `55${raw}`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handlePrintSOAP = (soapNote: string) => {
    if (!patient) return;
    printSoap(soapNote, patient, chiefComplaint);
  };

  const handleGenerateDocument = async (type: 'patient_summary' | 'referral', soapNote: string) => {
    if (!patient) return;
    setDocumentModal({ type, content: '', isLoading: true });
    try {
      const { data, error } = await supabase.functions.invoke('generate-document', {
        body: {
          type,
          userId,
          soapNote,
          chiefComplaint,
          patientContext,
          ...(type === 'referral' ? {} : {}),
        },
      });
      if (error) throw error;
      setDocumentModal({ type, content: data.document ?? '', isLoading: false });
    } catch (err: any) {
      setDocumentModal(null);
      toast({
        title: 'Erro ao gerar documento',
        description: err.message ?? 'Tente novamente.',
        variant: 'destructive',
      });
    }
  };

  if (!patient) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-card">
        <div className="text-center space-y-3 px-8">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto">
            <Mic className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-foreground/70">Nenhuma consulta ativa</p>
          <p className="text-xs text-muted-foreground/60">Selecione um paciente ou inicie uma nova consulta</p>
        </div>
      </div>
    );
  }

  const activeBriefing = preBriefing;

  return (
    <div className="flex-1 flex flex-col bg-card h-full">
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 md:px-6 py-3 md:py-4 border-b border-border/50 bg-card/95 backdrop-blur-sm">
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
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-6 py-4 md:py-6 space-y-4">

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
                  ) : activeBriefing?.returnInfo ? (
                    <>
                      <div className="space-y-1.5 text-xs text-foreground/80">
                        <div className="flex items-start gap-1.5">
                          <span className="shrink-0 font-medium text-foreground/50 w-1.5 h-1.5 mt-1.5 rounded-full bg-amber-400 inline-block" />
                          <span>{activeBriefing.returnInfo}</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="shrink-0 font-medium text-foreground/50 w-1.5 h-1.5 mt-1.5 rounded-full bg-amber-400 inline-block" />
                          <span>{activeBriefing.previousComplaint}</span>
                        </div>
                        {activeBriefing.pending && (
                          <div className="flex items-start gap-1.5">
                            <span className="shrink-0 w-1.5 h-1.5 mt-1.5 rounded-full bg-amber-400 inline-block" />
                            <span>{activeBriefing.pending}</span>
                          </div>
                        )}
                        {activeBriefing.alert && (
                          <div className="flex items-start gap-1.5 mt-1 pt-1.5 border-t border-destructive/20">
                            <span className="shrink-0 text-destructive mt-0.5">⚠️</span>
                            <span className="text-destructive font-medium leading-snug">{activeBriefing.alert}</span>
                          </div>
                        )}
                      </div>

                      {briefingExpanded && activeBriefing.details && (
                        <div className="mt-3 pt-3 border-t border-border/30 space-y-2 text-xs text-foreground/80">
                          {activeBriefing.details.lastConsultationDate && (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-foreground/60 uppercase tracking-wide text-[10px]">Última Consulta</span>
                              <span>{activeBriefing.details.lastConsultationDate}</span>
                            </div>
                          )}
                          {activeBriefing.details.mainComplaint && (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-foreground/60 uppercase tracking-wide text-[10px]">Queixa Principal</span>
                              <span>{activeBriefing.details.mainComplaint}</span>
                            </div>
                          )}
                          {activeBriefing.details.previousConduct && (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-foreground/60 uppercase tracking-wide text-[10px]">Conduta Anterior</span>
                              <span>{activeBriefing.details.previousConduct}</span>
                            </div>
                          )}
                          {activeBriefing.details.evolution && (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-foreground/60 uppercase tracking-wide text-[10px]">Evolução</span>
                              <span>{activeBriefing.details.evolution}</span>
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
                className="shrink-0 h-8 w-8 text-slate-400 hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Messages */}
        {(() => {
          const lastSoapIdx = messages.reduce((acc, m, i) => m.type === 'soap' ? i : acc, -1);
          return messages.map((message, index) => (
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
              <div className="max-w-[88%] md:max-w-[75%] bg-medical-blue text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 text-sm">
                {message.content}
              </div>
            ) : message.type === 'assistant' ? (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Brain className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 max-w-[88%] md:max-w-[85%] rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1">{message.title}</p>
                  <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ) : (
              <>
                {message.type === 'soap' && (
                  <div className="absolute top-3 right-3 flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground/50 hover:text-muted-foreground"
                      onClick={() => handlePrintSOAP(message.content)}
                      title="Exportar PDF"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                  </div>
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
                    className="w-full min-h-[120px] md:min-h-[200px] text-sm leading-relaxed bg-muted/30 border border-border rounded-lg p-3 text-foreground/90 focus:outline-none focus:ring-2 focus:ring-medical-blue/30 resize-y"
                    autoFocus
                  />
                ) : message.type === 'soap' ? (
                  <>
                    <SoapNoteView text={message.content} />
                    {currentConsultationId && index === lastSoapIdx && (
                      <div className="mt-3 pt-3 border-t border-border/30 flex gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs"
                          onClick={() => handleGenerateDocument('patient_summary', message.content)}
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          Resumo para Paciente
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs"
                          onClick={() => handleGenerateDocument('referral', message.content)}
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          Gerar Encaminhamento
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
                    {message.content}
                  </div>
                )}

                {message.type === 'whatsapp' && (
                  <div className="mt-4 pt-3 border-t border-whatsapp-green/20 flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(message.content, message.id)}
                      className="gap-2 text-xs"
                    >
                      {copiedId === message.id
                        ? <><Check className="w-3.5 h-3.5 text-success" />Copiado!</>
                        : <><Copy className="w-3.5 h-3.5" />Copiar</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSendWhatsapp(message.content)}
                      title={patient?.phone ? `Enviar para ${patient.phone}` : 'Telefone não cadastrado no perfil'}
                      className={cn(
                        'gap-2 text-xs',
                        patient?.phone
                          ? 'text-whatsapp-green border-whatsapp-green/30 hover:bg-whatsapp-green/10 hover:text-whatsapp-green'
                          : 'text-muted-foreground/60',
                      )}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Enviar via WhatsApp
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ));
        })()}

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

        {/* Chat AI typing indicator */}
        {isChatLoading && (
          <div className="flex items-start gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3">
              <div className="flex gap-1 items-center h-4">
                {[0, 150, 300].map(delay => (
                  <div key={delay} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
                    style={{ animationDelay: `${delay}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-3 md:px-4 py-3 space-y-2 md:space-y-3 border-t border-border/30">
        <UsageOverBanner />
        {/* Recording Status Banner */}
        {isRecording && (
          <div className={cn(
            'border rounded-lg p-3 animate-fade-in',
            stopConfirming ? 'bg-amber-500/10 border-amber-500/40' :
            isPaused ? 'bg-amber-500/10 border-amber-500/30' : 'bg-record-red/10 border-record-red/30',
          )}>
            {stopConfirming ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-700 flex items-center gap-1.5">
                    <StopCircle className="w-4 h-4" />
                    Finalizar consulta?
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatTimer(recordingSeconds)} gravados</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelStop} className="h-9 flex-1 sm:flex-none">
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirmStop}
                    className="h-9 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-0 flex-1 sm:flex-none"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    Finalizar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {isPaused ? (
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                    ) : (
                      <div className="flex gap-[2px] items-end h-4">
                        {[0.5, 0.8, 1.0, 0.7, 0.9, 0.6].map((mult, i) => (
                          <div key={i} className="w-1 rounded-full bg-record-red transition-all duration-100"
                            style={{ height: `${Math.max(20, audioLevel * mult * 100)}%` }} />
                        ))}
                      </div>
                    )}
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
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Use o modo <span className="font-semibold text-foreground/80">Comentário</span> abaixo para adicionar notas que ajudarão a IA a transcrever melhor.
                </p>
                {consultationComments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {consultationComments.map((c, i) => (
                      <div key={i} className="text-xs text-muted-foreground bg-background/60 rounded px-2 py-1">
                        💬 {c}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="input-command-center p-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 mb-2.5">
            <div className="inline-flex p-0.5 rounded-lg bg-muted/60 border border-border/40">
              <button
                type="button"
                onClick={() => setInputMode('question')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  inputMode === 'question'
                    ? 'bg-medical-blue text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                Pergunta
              </button>
              <button
                type="button"
                onClick={() => setInputMode('comment')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  inputMode === 'comment'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <StickyNote className="w-3.5 h-3.5" />
                Comentário
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground/70 ml-2 hidden md:inline flex-1 min-w-0 truncate">
              {inputMode === 'question'
                ? 'pergunte sobre o histórico, conduta, interações…'
                : isRecording
                ? 'será incluído no contexto da transcrição'
                : 'atualiza perfil, adendo da consulta de hoje ou anotação'}
            </span>
            <UsageMeter variant="inline" className="ml-auto shrink-0" />
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost" size="icon"
              className="text-slate-400 hover:text-foreground h-9 w-9"
              title="Arquivos do paciente"
              onClick={() => toast({ title: 'Arquivos', description: 'Use "Perfil Completo & Arquivos" no painel direito para gerenciar anexos.' })}
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            <div className="flex-1 relative">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder={
                  inputMode === 'question'
                    ? 'Pergunte ao assistente — o que conversamos na última consulta?'
                    : isRecording
                    ? 'Comentário para a transcrição — ex: "paciente referiu dor irradiando"'
                    : 'Comentário — ex: "alérgico a penicilina", "iniciar Losartana 50mg", "solicitar hemograma"'
                }
                className={cn(
                  'w-full h-10 px-4 rounded-xl border-0 text-sm focus:outline-none focus:ring-2 transition-all placeholder:text-slate-400',
                  inputMode === 'question'
                    ? 'bg-muted/50 focus:ring-medical-blue/30'
                    : 'bg-amber-50 dark:bg-amber-950/20 focus:ring-amber-500/30',
                )}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9',
                inputMode === 'question'
                  ? 'text-slate-400 hover:text-medical-blue'
                  : 'text-slate-400 hover:text-amber-600',
              )}
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isChatLoading || savingNote}
              title={inputMode === 'question' ? 'Enviar pergunta' : 'Adicionar comentário'}
            >
              {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
        <p className="text-xs text-muted-foreground text-center">
          {isProcessing
            ? 'Processando consulta, aguarde...'
            : isChatLoading
            ? 'Assistente clínico pensando...'
            : isRecording
            ? 'Clique no botão vermelho para finalizar · use Comentário para guiar a IA'
            : 'Grave com o botão vermelho · Pergunta consulta a IA · Comentário vira anotação'}
        </p>
      </div>

      <ConsultationReviewModal
        open={!!reviewData}
        patientName={patient?.name ?? ''}
        transcription={reviewData?.transcription ?? ''}
        soapDraft={reviewData?.soapDraft ?? ''}
        clarifications={reviewData?.clarifications ?? []}
        transcriptionQuality={reviewData?.transcriptionQuality ?? 'good'}
        differentialDiagnoses={reviewData?.differentialDiagnoses ?? []}
        drugInteractionAlerts={reviewData?.drugInteractionAlerts ?? []}
        onConfirm={handleReviewConfirm}
        onCancel={handleReviewCancel}
        isGenerating={isGeneratingFinal}
      />

      <DocumentPreviewModal
        open={!!documentModal}
        onClose={() => setDocumentModal(null)}
        type={documentModal?.type ?? 'patient_summary'}
        content={documentModal?.content ?? ''}
        isLoading={documentModal?.isLoading ?? false}
        patientName={patient?.name ?? ''}
      />
    </div>
  );
}
