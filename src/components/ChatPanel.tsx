import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X, AlertTriangle, FileText, MessageCircle, Mic, Paperclip, Send,
  Copy, Check, Pencil, Pause, Play, Loader2, Download, StopCircle, Brain,
  HelpCircle, StickyNote, ClipboardList, Share2, MonitorSpeaker,
} from 'lucide-react';
import { useRecording, ConsultationMode } from '@/hooks/useRecording';
import { RecordingModeDialog } from '@/components/RecordingModeDialog';
import { LiveCopilotCard, CopilotState } from '@/components/LiveCopilotCard';
import { QuestionChecklistCard } from '@/components/QuestionChecklistCard';
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
import { ProfileUpdateCard, MergedProfile } from '@/components/ProfileUpdateCard';
import { ProfileUpdates } from '@/types/patient';
import { printSoap } from '@/lib/printDoc';
import { UsageMeter, UsageOverBanner } from '@/components/UsageMeter';

/** Thrown after an error was already surfaced to the user (e.g. quota toast)
 *  so upstream catch blocks skip their generic error toast. */
class HandledError extends Error {}

/** Encode an audio Blob as base64 for inline transport to the copilot function. */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

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
  /** Accepts a functional updater so concurrent async writers (transcription
   *  finishing while the doctor chats) never clobber each other's messages. */
  onMessagesChange: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
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

  const [copilotState, setCopilotState] = useState<CopilotState | null>(null);
  const [copilotRefreshing, setCopilotRefreshing] = useState(false);
  const [copilotLastUpdateAt, setCopilotLastUpdateAt] = useState<number | null>(null);
  const [copilotNow, setCopilotNow] = useState<number>(() => Date.now());
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);

  // Pre-consult question checklist (from history + chief complaint).
  const [checklistQuestions, setChecklistQuestions] = useState<string[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const checklistCacheRef = useRef<Map<string, string[]>>(new Map());

  // Document attachment from the chat (upload + AI review).
  const [attachingFile, setAttachingFile] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const consultationCommentsRef = useRef<string[]>([]);
  // Tracks the currently displayed patient so async work started for a
  // previous patient (transcription takes 30s+) never writes into this chat.
  const activePatientIdRef = useRef<string | null>(patient?.id ?? null);

  // ── Live-copilot plumbing (refs avoid stale closures inside recorder cbs) ────
  const copilotPendingRef  = useRef<Array<{ mimeType: string; data: string }>>([]);
  const copilotBusyRef     = useRef(false);
  const copilotStateRef    = useRef<CopilotState | null>(null);
  const copilotDismissRef  = useRef<string[]>([]);
  const copilotDisabledRef = useRef(false);   // set on quota/repeated failure
  // Fire a refresh once this many ~30s chunks are queued → ~60s suggestion cadence.
  const COPILOT_CHUNKS_PER_REFRESH = 2;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { specialty, liveCopilotEnabled } = useUserSettings();

  const recording = useRecording({
    onStop: processConsultation,
    consultationCommentsRef,
    onCommentsReset: () => {
      consultationCommentsRef.current = [];
      setConsultationComments([]);
    },
    // Only feed the live copilot when the doctor has it enabled — this also
    // stops the second (chunk) MediaRecorder from running for nothing.
    onLiveChunk: liveCopilotEnabled ? handleLiveChunk : undefined,
  });

  const { isRecording, isPaused, stopConfirming, recordingSeconds, audioLevel } = recording;
  const [modeDialogOpen, setModeDialogOpen] = useState(false);

  useEffect(() => {
    activePatientIdRef.current = patient?.id ?? null;
    setShowBriefing(true);
    setBriefingExpanded(false);
    consultationCommentsRef.current = [];
    setConsultationComments([]);
    setCurrentConsultationId(null);
    setReviewData(null);
    resetCopilot();
    if (recording.isRecording) {
      // Never let a recording started for patient A be processed under
      // patient B — that would write a consultation into the wrong chart.
      recording.discard();
      toast({
        title: 'Gravação descartada',
        description: 'A gravação em andamento foi descartada ao trocar de paciente.',
        variant: 'destructive',
      });
    } else {
      recording.cancelStop();
    }
  }, [patient?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Clicking record asks presencial vs. online first — online additionally
  // captures the computer/tab audio so the patient's side is recorded too.
  const handleStartRecording  = () => setModeDialogOpen(true);
  const handleModeSelected    = (mode: ConsultationMode) => { resetCopilot(); recording.start(mode); };
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
        if (await handleQuotaError(error)) return;
        throw error;
      }

      const summary: string = data?.summary ?? 'Comentário processado.';
      const appliedAddendum: boolean = !!data?.appliedAddendum;

      onMessagesChange(prev => [...prev, {
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

  // ── Live copilot ────────────────────────────────────────────────────────────
  // Declared as hoisted functions so handleLiveChunk can be referenced by the
  // useRecording() call above before this point (same reason as processConsultation).

  function resetCopilot() {
    copilotPendingRef.current = [];
    copilotBusyRef.current = false;
    copilotStateRef.current = null;
    copilotDismissRef.current = [];
    copilotDisabledRef.current = false;
    setCopilotState(null);
    setCopilotRefreshing(false);
    setCopilotLastUpdateAt(null);
    setDismissedSuggestions([]);
  }

  async function runCopilotRefresh() {
    if (copilotBusyRef.current || copilotDisabledRef.current || !patient) return;
    const chunks = copilotPendingRef.current;
    if (chunks.length === 0) return;
    copilotPendingRef.current = [];
    copilotBusyRef.current = true;
    const requestedPatientId = patient.id;
    setCopilotRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('live-copilot', {
        body: {
          audioChunks: chunks,
          prevState: copilotStateRef.current,
          dismissed: copilotDismissRef.current,
          patientContext,
          chiefComplaint,
        },
      });
      // Any failure (quota, network, function error) silently disables the
      // copilot for the rest of this consult — it must never nag mid-consult.
      if (error) { copilotDisabledRef.current = true; return; }
      // Stale guard: patient switched or recording ended during the call.
      if (activePatientIdRef.current !== requestedPatientId) return;
      const next: CopilotState = {
        resumo:        Array.isArray(data?.resumo)        ? data.resumo        : [],
        alertas:       Array.isArray(data?.alertas)       ? data.alertas       : [],
        nao_explorado: Array.isArray(data?.nao_explorado) ? data.nao_explorado : [],
        sugestoes:     Array.isArray(data?.sugestoes)     ? data.sugestoes     : [],
      };
      copilotStateRef.current = next;
      setCopilotState(next);
      setCopilotLastUpdateAt(Date.now());
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
    } catch {
      copilotDisabledRef.current = true;
    } finally {
      copilotBusyRef.current = false;
      setCopilotRefreshing(false);
      // Drain any chunks that queued while we were busy.
      if (!copilotDisabledRef.current && copilotPendingRef.current.length >= COPILOT_CHUNKS_PER_REFRESH) {
        void runCopilotRefresh();
      }
    }
  }

  async function handleLiveChunk(blob: Blob, mimeType: string) {
    if (copilotDisabledRef.current || !patient) return;
    try {
      const data = await blobToBase64(blob);
      copilotPendingRef.current.push({ mimeType, data });
      // Cap backlog if calls are lagging — keep the most recent windows.
      if (copilotPendingRef.current.length > 4) {
        copilotPendingRef.current = copilotPendingRef.current.slice(-4);
      }
      if (!copilotBusyRef.current && copilotPendingRef.current.length >= COPILOT_CHUNKS_PER_REFRESH) {
        void runCopilotRefresh();
      }
    } catch {
      /* base64 failure — skip this chunk */
    }
  }

  const handleDismissSuggestion = (text: string) => {
    copilotDismissRef.current = [...copilotDismissRef.current, text].slice(-12);
    setDismissedSuggestions(copilotDismissRef.current);
    setCopilotState(prev => {
      if (!prev) return prev;
      const next = { ...prev, sugestoes: prev.sugestoes.filter(s => s !== text) };
      copilotStateRef.current = next;
      return next;
    });
  };

  // Tick a clock while recording so "atualizado há Xs" stays live.
  useEffect(() => {
    if (!isRecording || copilotLastUpdateAt === null) return;
    const id = setInterval(() => setCopilotNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRecording, copilotLastUpdateAt]);

  const copilotSecondsSince = copilotLastUpdateAt === null
    ? null
    : Math.max(0, Math.floor((copilotNow - copilotLastUpdateAt) / 1000));

  // ── Pre-consult question checklist ──────────────────────────────────────────
  async function runChecklist(force = false) {
    if (!patient) return;
    const requestedId = patient.id;
    const cached = checklistCacheRef.current.get(requestedId);
    if (cached && !force) {
      setChecklistQuestions(cached);
      setChecklistLoading(false);
      return;
    }
    setChecklistLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-questions', {
        body: {
          chiefComplaint,
          patientContext: {
            name: patient.name,
            age: patient.age,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
            medicalHistory: patient.medicalHistory,
            socialAnamnesis: patient.socialAnamnesis,
          },
        },
      });
      if (error) return;                                   // non-critical helper — stay silent
      if (activePatientIdRef.current !== requestedId) return;
      const qs: string[] = Array.isArray(data?.questions) ? data.questions : [];
      checklistCacheRef.current.set(requestedId, qs);
      setChecklistQuestions(qs);
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
    } catch {
      /* non-critical */
    } finally {
      if (activePatientIdRef.current === requestedId) setChecklistLoading(false);
    }
  }

  // Generate the checklist when a patient's consult opens (cached per patient).
  useEffect(() => {
    setChecklistQuestions([]);
    setChecklistLoading(false);
    if (patient) runChecklist(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  // ── Attach document from chat: upload → AI review → connect to record ───────
  const handleAttachSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !patient) return;
    if (file.size > 15 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Máximo de 15 MB para análise.', variant: 'destructive' });
      return;
    }
    setAttachingFile(true);
    const forPatientId = patient.id;
    try {
      // Same storage convention as PatientFiles (Perfil → Documentos).
      const safeName = file.name.replace(/[^\w.\-]/g, '_').slice(0, 80);
      const storagePath = `patients/${userId}/${forPatientId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('patient-files')
        .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      const { data: row, error: dbErr } = await supabase.from('patient_files').insert({
        patient_id: forPatientId,
        user_id: userId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        tag: file.type?.startsWith('image/') ? 'Imagem' : 'PDF',
      }).select('id').single();
      if (dbErr) {
        await supabase.storage.from('patient-files').remove([storagePath]).catch(() => {});
        throw dbErr;
      }
      queryClient.invalidateQueries({ queryKey: ['patient-files', forPatientId] });

      // AI review — the file is saved either way; analysis failure is not fatal.
      const { data, error } = await supabase.functions.invoke('analyze-document', {
        body: { fileId: row.id },
      });
      if (error) {
        if (!(await handleQuotaError(error))) {
          toast({ title: 'Documento anexado', description: 'Envio concluído, mas a análise automática falhou.' });
        }
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
      queryClient.invalidateQueries({ queryKey: ['patient-files', forPatientId] });
      queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail', forPatientId] });
      if (activePatientIdRef.current !== forPatientId) return;

      const findings = Array.isArray(data?.keyFindings) && data.keyFindings.length > 0
        ? `\n\n${data.keyFindings.map((f: string) => `• ${f}`).join('\n')}`
        : '';
      onMessagesChange(prev => [...prev, {
        id: `doc-${Date.now()}`,
        type: 'assistant',
        title: `Documento analisado — ${data?.documentType ?? 'Documento'}`,
        content: `📎 ${file.name}\n\n${data?.summary ?? ''}${findings}`,
        timestamp: new Date(),
      }]);
      toast({ title: 'Documento anexado e analisado', description: data?.profileNote || undefined });
    } catch (err: any) {
      toast({ title: 'Erro ao anexar documento', description: err?.message ?? 'Tente novamente.', variant: 'destructive' });
    } finally {
      setAttachingFile(false);
    }
  };

  /** supabase-js wraps non-2xx as FunctionsHttpError with the JSON body on
   *  err.context. Returns true when the error was a quota 429 (and toasts). */
  const handleQuotaError = async (error: unknown): Promise<boolean> => {
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
      return true;
    }
    return false;
  };

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
    if (error) {
      if (await handleQuotaError(error)) throw new HandledError();
      throw error;
    }
    // Clear the stale pre-briefing cache for this patient now that a new
    // consultation has been saved — the parent will regenerate on next select.
    onConsultationSaved?.(patient.id);
    // First visit seeded the Anamnese Social / Histórico Médico — refresh the
    // profile views so the new bullets appear without a reselect.
    if (data.historyFilled) {
      queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail', patient.id] });
    }
    // The doctor may have switched patients during the 30s+ processing window.
    // The note was saved to the correct chart (closure `patient`); just don't
    // inject it into the chat of whoever is displayed now.
    if (activePatientIdRef.current !== patient.id) return;
    setCurrentConsultationId(data.consultationId ?? null);
    pushToChat(data.soapNote, data.whatsappMessage, data.profileUpdates, data.consultationId ?? undefined);
    setReviewData(null);
    toast({
      title: 'Consulta salva!',
      description: data.historyFilled
        ? 'Evolução gerada. Anamnese e histórico preenchidos a partir da 1ª consulta.'
        : 'Evolução clínica gerada com sucesso.',
    });
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

  // NOTE: declared as a hoisted `function` (not a `const` arrow) so it can be
  // referenced by the useRecording() call above before this line executes.
  // A const arrow here causes a temporal-dead-zone ReferenceError at render.
  async function processConsultation(audioBlob: Blob, mimeType: string, comments: string[]) {
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
        if (await handleQuotaError(error)) return;
        throw error;
      }

      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
      const quality = data.transcriptionQuality ?? 'good';
      const clarifications: string[]        = Array.isArray(data.clarifications)         ? data.clarifications         : [];
      const differentialDiagnoses: string[] = Array.isArray(data.differentialDiagnoses)  ? data.differentialDiagnoses  : [];
      const drugInteractionAlerts: string[] = Array.isArray(data.drugInteractionAlerts)  ? data.drugInteractionAlerts  : [];

      if (quality === 'good' && clarifications.length === 0 && differentialDiagnoses.length === 0 && drugInteractionAlerts.length === 0) {
        await submitFinalSoap(data.transcription ?? '', '', data.soapNote ?? '', data.whatsappMessage ?? '');
      } else if (activePatientIdRef.current === patient.id) {
        // Only open the review modal if the doctor is still on this patient.
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
      if (!(err instanceof HandledError)) {
        toast({
          title: 'Erro ao processar consulta',
          description: err.message || 'Tente novamente.',
          variant: 'destructive',
        });
      }
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
    onMessagesChange(prev => [...prev, userMsg]);
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
        if (await handleQuotaError(error)) return;
        throw error;
      }
      onMessagesChange(prev => [...prev, {
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

    // comment mode — guard against Enter re-submitting while a note is saving
    if (savingNote) return;
    setInputValue('');
    if (isRecording) {
      addTranscriptionComment(text);
    } else {
      await appendPatientNote(text);
    }
  };

  const handleSaveEdit = async (messageId: string) => {
    // Update the consultation this specific message belongs to — using the
    // panel-level currentConsultationId here would overwrite the LATEST
    // consultation even when the doctor edited an older SOAP card.
    const target = messages.find(m => m.id === messageId);
    const targetConsultationId = target?.consultationId ?? null;
    if (targetConsultationId) {
      const { error } = await supabase
        .from('consultations')
        .update({ soap_note: editedContent })
        .eq('id', targetConsultationId);
      if (error) {
        toast({
          title: 'Erro ao salvar alterações',
          description: 'A evolução não foi atualizada no prontuário. Tente novamente.',
          variant: 'destructive',
        });
        return;
      }
    }
    onMessagesChange(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: editedContent } : m
    ));
    setEditingId(null);
    toast({ title: 'Alterações salvas', description: 'A evolução clínica foi atualizada.' });
  };

  const pushToChat = (soapNote: string, whatsappMessage: string, profileUpdates?: ProfileUpdates, consultationId?: string) => {
    const now = new Date();
    const cards: ChatMessage[] = [
      {
        id: `soap-${now.getTime()}`,
        type: 'soap',
        title: 'Evolução Clínica',
        content: soapNote,
        timestamp: now,
        consultationId,
      },
      {
        id: `wa-${now.getTime()}`,
        type: 'whatsapp',
        title: 'Sugestão de Mensagem (WhatsApp)',
        content: whatsappMessage,
        timestamp: now,
      },
    ];
    if (profileUpdates && (
      profileUpdates.diagnoses.length > 0 ||
      profileUpdates.medications.length > 0 ||
      profileUpdates.allergies.length > 0
    )) {
      cards.push({
        id: `profile-${now.getTime()}`,
        type: 'profile-update',
        title: 'Atualização do Perfil Clínico',
        content: '',
        timestamp: now,
        profileUpdates,
      });
    }
    onMessagesChange(prev => [...prev, ...cards]);
  };

  // Phase 2: generate final SOAP (with doctor comments) → save to DB → show in chat
  const handleReviewConfirm = async (comments: string) => {
    if (!reviewData || !patient) return;
    setIsGeneratingFinal(true);
    try {
      await submitFinalSoap(reviewData.transcription, comments);
    } catch (err) {
      if (!(err instanceof HandledError)) {
        toast({ title: 'Erro ao gerar evolução', description: 'Tente novamente.', variant: 'destructive' });
      }
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

  // Receives fully merged arrays from ProfileUpdateCard — existing entries
  // keep their ICD codes / startedAt; writing mapped copies here would erase them.
  const handleProfileAccept = async (merged: MergedProfile) => {
    if (!patient) return;
    const { error } = await supabase
      .from('patients')
      .update({
        diagnoses:   merged.diagnoses,
        medications: merged.medications,
        allergies:   merged.allergies,
      })
      .eq('id', patient.id);
    if (error) {
      toast({
        title: 'Erro ao atualizar perfil',
        description: 'As alterações não foram salvas. Tente novamente.',
        variant: 'destructive',
      });
      throw error;
    }
    queryClient.invalidateQueries({ queryKey: ['patients', userId] });
    queryClient.invalidateQueries({ queryKey: ['patient-detail', patient.id] });
    toast({ title: 'Perfil atualizado!', description: 'Diagnósticos, medicamentos e alergias sincronizados.' });
  };

  const getMissingFields = (): string[] => {
    if (!patient) return [];
    const missing: string[] = [];
    if (!patient.phone) missing.push('Telefone');
    if (!patient.email) missing.push('Email');
    return missing;
  };

  const handleGenerateDocument = async (type: 'patient_summary' | 'referral', soapNote: string) => {
    if (!patient) return;
    setDocumentModal({ type, content: '', isLoading: true });
    try {
      const { data, error } = await supabase.functions.invoke('generate-document', {
        body: { type, soapNote, chiefComplaint, patientContext },
      });
      if (error) {
        if (await handleQuotaError(error)) {
          setDocumentModal(null);
          return;
        }
        throw error;
      }
      setDocumentModal({ type, content: data.document ?? '', isLoading: false });
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
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

        {/* Pre-consult question checklist — from history + chief complaint */}
        <QuestionChecklistCard
          questions={checklistQuestions}
          isLoading={checklistLoading}
          onRefresh={() => runChecklist(true)}
        />

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
            {message.type === 'profile-update' ? (
              <ProfileUpdateCard
                initial={message.profileUpdates!}
                existing={{
                  diagnoses:   patient?.diagnoses   ?? [],
                  medications: patient?.medications ?? [],
                  allergies:   patient?.allergies   ?? [],
                }}
                missingFields={getMissingFields()}
                onAccept={handleProfileAccept}
                onDismiss={() => {}}
              />
            ) : message.type === 'user' ? (
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

        {/* Live copilot — glanceable summary + suggestions while recording */}
        {isRecording && !stopConfirming && liveCopilotEnabled && (
          <LiveCopilotCard
            state={copilotState}
            isRefreshing={copilotRefreshing}
            secondsSinceUpdate={copilotSecondsSince}
            onDismissSuggestion={handleDismissSuggestion}
          />
        )}

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
                    {recording.mode === 'online' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 shrink-0">
                        <MonitorSpeaker className="w-3 h-3" />
                        Teleconsulta
                      </span>
                    )}
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
            <input
              ref={attachInputRef}
              type="file"
              accept="image/*,application/pdf,.pdf,.png,.jpg,.jpeg,.webp,.heic"
              className="hidden"
              onChange={handleAttachSelected}
            />
            <Button
              variant="ghost" size="icon"
              className="text-slate-400 hover:text-foreground h-9 w-9"
              title="Anexar documento ou imagem do paciente"
              onClick={() => attachInputRef.current?.click()}
              disabled={attachingFile}
            >
              {attachingFile
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Paperclip className="w-4 h-4" />}
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

      <RecordingModeDialog
        open={modeDialogOpen}
        onOpenChange={setModeDialogOpen}
        onSelect={handleModeSelected}
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
