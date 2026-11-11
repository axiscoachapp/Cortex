import { useState, useRef, useEffect } from 'react';
import type { WorkEntry } from '@/lib/clinicalWorkspace';
import { createPortal } from 'react-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import {
  X,
  AlertTriangle,
  FileText,
  MessageCircle,
  Mic,
  Paperclip,
  Send,
  Copy,
  Check,
  Pencil,
  Pause,
  Play,
  Loader2,
  Download,
  StopCircle,
  Brain,
  HelpCircle,
  StickyNote,
  ClipboardList,
  Share2,
  MonitorSpeaker,
  FileSignature,
} from 'lucide-react';
import { useRecording, ConsultationMode } from '@/hooks/useRecording';
import { AUDIO_UPLOAD_LIMIT_BYTES, RECORDING_STOP_BYTES, RECORDING_WARN_BYTES } from '@/lib/recordingLimits';
import { RecordingModeDialog } from '@/components/RecordingModeDialog';
import { LiveCopilotCard, CopilotState } from '@/components/LiveCopilotCard';
import { QuestionChecklistCard } from '@/components/QuestionChecklistCard';
import { DocumentComposerModal, RxDocType } from '@/components/DocumentComposerModal';
import { SESSION_KEY, signatureInvoke, useSignatureSession } from '@/hooks/useSignatureSession';
import { SIGNABLE_TYPES, signKeepingOperation, signatureNotice } from '@/lib/signatureClient';
import { Medication } from '@/types/patient';
import { useUserSettings } from '@/hooks/useUserSettings';
import { managedDocumentMessage } from '@/lib/managedSetupMessages';
import { SoapNoteView } from '@/components/SoapNoteView';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Patient, ChatMessage } from '@/types/patient';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useClinicAccess } from '@/features/reception/accessContext';
import { ConsultationReviewModal } from '@/components/ConsultationReviewModal';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import { ProfileUpdateCard, MergedProfile } from '@/components/ProfileUpdateCard';
import { CommentProposalCard } from '@/components/CommentProposalCard';
import { ProfileUpdates } from '@/types/patient';
import { printSoap } from '@/lib/printDoc';
import { UsageMeter, UsageOverBanner } from '@/components/UsageMeter';
import { ConsultationDraft, loadConsultationDraft, saveConsultationDraft } from '@/lib/consultationDrafts';
import { functionErrorBody, functionErrorMessage, functionErrorStatus } from '@/lib/functionErrors';
import { ToastAction } from '@/components/ui/toast';
import {
  saveRescuedRecording,
  saveRecordingCheckpoint,
  listRescuedRecordings,
  deleteRescuedRecording,
  type RescuedRecording,
} from '@/lib/recordingRescue';
import { capturesInProgress, tryHoldCaptureLock } from '@/lib/recordingCaptureLock';
import { ClinicalProposals } from '@/components/ClinicalProposals';
import { useSessionHidden } from '@/contexts/SessionVisibility';
import { ClinicalAnswer } from '@/components/ClinicalAnswer';

/** Thrown after an error was already surfaced to the user (e.g. quota toast)
 *  so upstream catch blocks skip their generic error toast. */
class HandledError extends Error {}
/** Audio above the server's limit: uploading or retrying it can never work. */
class AudioTooLargeError extends Error {}

const audioSizeMb = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));

/** "YYYY-MM-DD" stays a calendar date (no time-zone shift); timestamps use the local date. */
function formatVisitDate(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return `${day[3]}/${day[2]}/${day[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

/**
 * Allergies, medications and main diagnoses under the patient's name, for
 * layouts where the patient column is hidden (below the desktop frame).
 */
function ClinicalSafetyRow({ patient, onOpen }: { patient: Patient; onOpen?: () => void }) {
  const allergies = patient.allergies.filter((value) => typeof value === 'string' && value.trim());
  const medications = patient.medications.length;
  const diagnoses = patient.diagnoses
    .map((diagnosis) => (diagnosis.code?.trim() ? diagnosis.code.trim() : diagnosis.description?.trim()))
    .filter((value): value is string => !!value);
  const shownAllergies = allergies.slice(0, 3);
  const shownDiagnoses = diagnoses.slice(0, 2);
  const chip = 'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium [overflow-wrap:anywhere]';
  const content = (
    <>
      {shownAllergies.length ? (
        shownAllergies.map((allergy) => (
          <span key={allergy} className={cn(chip, 'border-destructive/40 bg-destructive/10 text-destructive')}>
            Alergia: {allergy}
          </span>
        ))
      ) : (
        <span className={cn(chip, 'border-border bg-muted/50 text-muted-foreground')}>Sem alergias registradas</span>
      )}
      {allergies.length > shownAllergies.length && (
        <span className={cn(chip, 'border-destructive/40 bg-destructive/10 text-destructive')}>
          +{allergies.length - shownAllergies.length} alergias
        </span>
      )}
      <span className={cn(chip, 'border-border bg-muted/50 text-foreground/80')}>
        {medications === 0 ? 'Sem medicações em uso' : `${medications} ${medications === 1 ? 'medicação' : 'medicações'} em uso`}
      </span>
      {shownDiagnoses.map((diagnosis) => (
        <span key={diagnosis} className={cn(chip, 'border-border bg-muted/50 text-foreground/80')}>
          {diagnosis}
        </span>
      ))}
      {diagnoses.length > shownDiagnoses.length && (
        <span className={cn(chip, 'border-border bg-muted/50 text-foreground/80')}>+{diagnoses.length - shownDiagnoses.length}</span>
      )}
    </>
  );
  // One target for the whole row: 44 px tall on the phone without a tall header.
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className="shell:hidden mt-1.5 flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-blue sm:min-h-0"
    >
      <span className="sr-only">Abrir painel do paciente: </span>
      {content}
    </button>
  ) : (
    <div className="shell:hidden mt-1.5 flex flex-wrap items-center gap-1.5">{content}</div>
  );
}

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
  appointmentId?: string | null;
  patient: Patient | null;
  messages: ChatMessage[];
  /** Accepts a functional updater so concurrent async writers (transcription
   *  finishing while the doctor chats) never clobber each other's messages. */
  onMessagesChange: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  chiefComplaint: string;
  preBriefing: PreBriefing | null;
  briefingLoading: boolean;
  briefingError?: boolean;
  briefingRequested?: boolean;
  conversationLoading?: boolean;
  conversationError?: boolean;
  onRetryConversation?: () => void;
  onLoadOlderMessages?: () => void;
  loadingOlderMessages?: boolean;
  onRetryBriefing?: () => void;
  userId: string;
  /** Called after a consultation is successfully saved so the parent can
   *  invalidate any stale pre-briefing cache entries for this patient. */
  onConsultationSaved?: (patientId: string) => void;
  onWorkStateChange?: (busy: boolean) => void;
  onCaptureStateChange?: (busy: boolean) => void;
  onOpenPatientWork?: (manual: boolean, entry?: WorkEntry) => void;
  /** Explicit Home resume; never reloads automatically after a blocked request. */
  recoveryRequest?: number;
  /** Shows the patient panel (allergies, medications, diagnoses) where it is hidden. */
  onOpenPatientPanel?: () => void;
  /** Brings this consultation back on screen (from Início while it stays open). */
  onReturnToConsultation?: () => void;
}

export function ChatPanel({
  appointmentId = null,
  patient,
  messages,
  onMessagesChange,
  chiefComplaint,
  preBriefing,
  briefingLoading,
  briefingError = false,
  briefingRequested = false,
  conversationLoading = false,
  conversationError = false,
  onRetryConversation,
  onLoadOlderMessages,
  loadingOlderMessages = false,
  onRetryBriefing,
  userId,
  onConsultationSaved,
  onWorkStateChange,
  onCaptureStateChange,
  onOpenPatientWork,
  recoveryRequest = 0,
  onOpenPatientPanel,
  onReturnToConsultation,
}: ChatPanelProps) {
  const sessionHidden = useSessionHidden();
  const [showBriefing, setShowBriefing] = useState(true);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioTasks, setAudioTasks] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const editRevisionRef = useRef<number | null>(null);
  const [currentConsultationId, setCurrentConsultationId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<ConsultationDraft | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<ConsultationDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftLoadError, setDraftLoadError] = useState(false);
  const [draftRetryKey, setDraftRetryKey] = useState(0);
  const [draftMutations, setDraftMutations] = useState(0);
  const recoveryInputRef = useRef<HTMLInputElement>(null);
  // Audio whose upload did not complete, keyed by draft id. Kept only in this
  // tab (never written to disk unless the doctor explicitly downloads it).
  const localAudioRef = useRef(new Map<string, { blob: Blob; mimeType: string }>());
  const [isGeneratingFinal, setIsGeneratingFinal] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const retryTurn = useRef<{patientId:string;text:string;id:string;timestamp:Date} | null>(null);
  // Questions whose request failed: they stay in the thread with a retry.
  const [failedQuestions, setFailedQuestions] = useState<Record<string, string>>({});
  const [lastNoteOpen, setLastNoteOpen] = useState(false);
  const [inputMode, setInputMode] = useState<'question' | 'comment'>('question');
  const [savingNote, setSavingNote] = useState(false);
  const [consultationComments, setConsultationComments] = useState<string[]>([]);
  const [documentModal, setDocumentModal] = useState<{
    patientId: string;
    patientName: string;
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
  const [checklistError, setChecklistError] = useState('');
  const checklistCacheRef = useRef<Map<string, string[]>>(new Map());
  const checklistRequestsRef = useRef(new Set<string>());
  const checklistSourceKey = patient ? `${patient.id}/${patient.revision ?? 0}/${chiefComplaint}` : '';
  const checklistSourceRef = useRef(checklistSourceKey);
  checklistSourceRef.current = checklistSourceKey;

  // Document attachment from the chat (upload + AI review).
  const [attachingFile, setAttachingFile] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // Digital documents (receita/atestado — unsigned PDF with validation QR).
  const [generatingRx, setGeneratingRx] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  // "Gerar e assinar" (D17): the signature session while the composer is open,
  // and the doctor of this render, checked again after each await.
  const { data: signatureSession } = useSignatureSession(composerOpen);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const composerConsultationIdRef = useRef<string | undefined>(undefined);
  const composerPatientIdRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const consultationCommentsRef = useRef<string[]>([]);
  // Tracks the currently displayed patient so async work started for a
  // previous patient (transcription takes 30s+) never writes into this chat.
  const activePatientIdRef = useRef<string | null>(patient?.id ?? null);
  activePatientIdRef.current = patient?.id ?? null;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const isCurrentPatient = (id: string) => mountedRef.current && activePatientIdRef.current === id;

  // ── Live-copilot plumbing (refs avoid stale closures inside recorder cbs) ────
  const copilotPendingRef = useRef<Array<{ mimeType: string; data: string }>>([]);
  const copilotBusyRef = useRef(false);
  const copilotStateRef = useRef<CopilotState | null>(null);
  const copilotDismissRef = useRef<string[]>([]);
  const copilotDisabledRef = useRef(false); // set on quota/repeated failure
  // Fire a refresh once this many ~30s chunks are queued → ~60s suggestion cadence.
  const COPILOT_CHUNKS_PER_REFRESH = 2;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { specialty, liveCopilotEnabled, activeTemplateId, prescriber } = useUserSettings();

  // The doctor's active document template (if any) replaces the default SOAP
  // structure in transcribe/finalize. Fetched once and cached by React Query.
  const { data: activeTemplateContent } = useQuery<string | null>({
    queryKey: ['active-template-content', activeTemplateId],
    queryFn: async () => {
      if (!activeTemplateId) return null;
      const { data } = await supabase
        .from('document_templates')
        .select('content')
        .eq('id', activeTemplateId)
        .maybeSingle();
      return data?.content ?? null;
    },
    enabled: !!activeTemplateId,
    staleTime: 5 * 60_000,
  });

  // The last saved consultation, for the first card of the chart. Its key sits
  // under 'patient-consultations', so every save already refreshes it.
  const { data: lastConsultation } = useQuery<{ id: string; created_at: string; chief_complaint: string | null; soap_note: string | null } | null>({
    queryKey: ['patient-consultations', patient?.id, userId, 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultations')
        .select('id,created_at,chief_complaint,soap_note')
        .eq('patient_id', patient!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!patient?.id && !!userId,
    staleTime: 60_000,
    retry: false,
  });

  // ── Copies of the audio kept in this browser until the server has it ────────
  // Each capture is checkpointed under its capture id, which the draft reuses,
  // so the entry, the draft and the uploaded file all share one id.
  const [rescued, setRescued] = useState<RescuedRecording[]>([]);
  const [rescueFailed, setRescueFailed] = useState<Record<string, true>>({});
  // Recordings above the server limit, by draft/capture id: no retry is offered.
  const [tooLarge, setTooLarge] = useState<Record<string, number>>({});
  const rescueBusyRef = useRef(false);
  const captureLocksRef = useRef(new Map<string, Promise<(() => void) | null>>());
  const checkpointWarnedRef = useRef(new Set<string>());
  const parkedEntry = (id: string, blob: Blob, mimeType: string, comments: string[], createdAt: string): RescuedRecording | undefined =>
    patient ? { id, userId, patientId: patient.id, patientName: patient.name, mimeType, blob, comments, createdAt } : undefined;
  const holdCapture = (id: string) => {
    if (!captureLocksRef.current.has(id)) captureLocksRef.current.set(id, tryHoldCaptureLock(id));
  };
  const releaseCapture = (id: string) => {
    const held = captureLocksRef.current.get(id);
    captureLocksRef.current.delete(id);
    void held?.then((release) => release?.());
  };
  /** Removes this browser's copy once it is no longer needed. */
  const forgetParked = async (id: string) => {
    const remove = () => Promise.resolve().then(() => deleteRescuedRecording(id));
    await remove().catch(remove).catch(() => {});
    if (mountedRef.current) {
      setRescued((list) => list.filter((item) => item.id !== id));
      setRescueFailed(({ [id]: _gone, ...rest }) => rest);
    }
  };

  const recording = useRecording({
    // Bound at recording start, like the other callbacks: the patient is the
    // one being recorded even if the doctor switches patients before the stop.
    onStop: (blob, mimeType, comments, capture) =>
      processConsultation(blob, mimeType, comments, undefined, capture ? parkedEntry(capture.captureId, blob, mimeType, comments, capture.startedAt) : undefined),
    onCheckpoint: (checkpoint) => {
      const entry = parkedEntry(checkpoint.captureId, checkpoint.blob, checkpoint.mimeType, checkpoint.consultationComments, checkpoint.startedAt);
      if (!entry) return;
      holdCapture(entry.id);
      void Promise.resolve()
        .then(() => saveRecordingCheckpoint(entry))
        .catch(() => {
          if (checkpointWarnedRef.current.has(entry.id)) return;
          checkpointWarnedRef.current.add(entry.id);
          toast({
            title: 'Cópia de segurança indisponível',
            description: 'Não foi possível guardar a gravação neste navegador enquanto ela acontece. A gravação continua; não feche a aba até o envio terminar.',
            variant: 'destructive',
          });
        });
    },
    onCheckpointDiscard: (capture) => {
      void forgetParked(capture.captureId).finally(() => releaseCapture(capture.captureId));
    },
    consultationCommentsRef,
    onCommentsReset: () => {
      if (!patient || !isCurrentPatient(patient.id)) return;
      consultationCommentsRef.current = [];
      setConsultationComments([]);
    },
    // Only feed the live copilot when the doctor has it enabled — this also
    // stops the second (chunk) MediaRecorder from running for nothing.
    onLiveChunk: liveCopilotEnabled ? handleLiveChunk : undefined,
    // Unmounted mid-recording (session ended elsewhere, crash): park the audio
    // in this browser so it can be processed after signing in again.
    // The full audio replaces this capture's last checkpoint (same id).
    onRescue: (blob, mimeType, comments, capture) => {
      const entry = parkedEntry(capture.captureId, blob, mimeType, comments, capture.startedAt);
      if (!entry) return;
      void Promise.resolve()
        .then(() => saveRescuedRecording(entry))
        .catch(() => {})
        .finally(() => releaseCapture(entry.id));
    },
  });

  useEffect(() => {
    let active = true;
    if (!patient) {
      setRescued([]);
      return;
    }
    // Entries another live tab is still recording or uploading are not
    // interrupted: offering them here would process the same audio twice.
    void Promise.all([listRescuedRecordings(userId), capturesInProgress()]).then(([all, live]) => {
      if (active) setRescued(all.filter((entry) => entry.patientId === patient.id && !live.has(entry.id)));
    });
    return () => {
      active = false;
    };
  }, [userId, patient?.id, draftRetryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // One draft per patient (unique(user_id, patient_id)): a parked recording can
  // only become a new draft when this patient has none open or pending.
  const rescueBlockReason =
    recording.isRecording || recording.isStarting || recording.isStopping
      ? 'Termine a gravação em andamento antes de processar esta.'
      : draftLoading
        ? 'Verificando os rascunhos deste paciente…'
        : draftLoadError
          ? 'Não foi possível verificar os rascunhos deste paciente. Use "Tentar novamente" acima.'
          : reviewData
            ? 'Há uma consulta em revisão deste paciente. Conclua ou descarte essa revisão antes de processar esta gravação.'
            : recoveryDraft && recoveryDraft.patientId === patient?.id
              ? 'Há uma consulta preservada deste paciente. Conclua ou exclua esse rascunho antes de processar esta gravação.'
              : isProcessing
                ? 'Aguarde o processamento atual terminar.'
                : null;

  const processRescued = async (entry: RescuedRecording) => {
    if (rescueBlockReason || rescueBusyRef.current) return;
    rescueBusyRef.current = true;
    try {
      const release = await tryHoldCaptureLock(entry.id);
      if (!release) {
        toast({ title: 'Gravação em uso em outra aba', description: 'Esta gravação está sendo enviada em outra aba. Aguarde e atualize a página.' });
        return;
      }
      captureLocksRef.current.set(entry.id, Promise.resolve(release));
      setRescueFailed(({ [entry.id]: _retry, ...rest }) => rest);
      // The entry stays in this browser until the audio is on the server;
      // processConsultation removes it only then.
      await processConsultation(entry.blob, entry.mimeType, entry.comments, undefined, entry);
    } finally {
      rescueBusyRef.current = false;
    }
  };
  const discardRescued = async (entry: RescuedRecording) => {
    if (!window.confirm('Descartar esta gravação? O áudio será apagado deste navegador.')) return;
    await forgetParked(entry.id);
  };

  const { isRecording, isPaused, stopConfirming, recordingSeconds, audioLevel } = recording;
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const selectedPatientId = patient?.id ?? null;
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
  const lastRecoveryRequest = useRef(recoveryRequest);
  const recoveryPending = isRecording || recording.isStarting || recording.isStopping || isProcessing || audioTasks > 0 ||
    isGeneratingFinal || isChatLoading || savingNote || generatingRx || attachingFile || !!documentModal?.isLoading ||
    checklistLoading || copilotRefreshing || draftLoading || draftMutations > 0;
  // A comment proposal not yet applied or discarded is the doctor's typed work.
  const pendingProposals = messages.some(
    (message) => message.type === 'comment-proposal' && !!message.commentProposal && (message.commentProposal.status ?? 'pending') === 'pending',
  );
  const recoveryDirty = !!reviewData || !!recoveryDraft || composerOpen || !!documentModal || !!editingId ||
    !!inputValue.trim() || consultationComments.length > 0 || pendingProposals;
  useEffect(() => {
    if (lastRecoveryRequest.current === recoveryRequest) return;
    lastRecoveryRequest.current = recoveryRequest;
    if (recoveryPending) {
      toast({title:'Consulta em andamento',description:'Aguarde o trabalho atual terminar e tente retomar novamente. A consulta aberta foi preservada.'});
      return;
    }
    if (recoveryDirty && !window.confirm('Retomar a versão salva desta consulta? Textos não salvos serão descartados.')) return;
    setDraftRetryKey(key => key + 1);
  }, [recoveryRequest, recoveryPending, recoveryDirty, toast]);

  useEffect(() => {
    const busy =
      isRecording ||
      recording.isStarting ||
      recording.isStopping ||
      isProcessing ||
      !!reviewData ||
      !!recoveryDraft ||
      isGeneratingFinal ||
      isChatLoading ||
      savingNote ||
      generatingRx ||
      composerOpen ||
      !!documentModal ||
      attachingFile ||
      draftMutations > 0 ||
      !!editingId ||
      pendingProposals ||
      !!inputValue.trim();
    onWorkStateChange?.(busy);
    return () => onWorkStateChange?.(false);
  }, [
    isRecording,
    recording.isStarting,
    recording.isStopping,
    isProcessing,
    reviewData,
    recoveryDraft,
    isGeneratingFinal,
    isChatLoading,
    savingNote,
    generatingRx,
    composerOpen,
    documentModal,
    attachingFile,
    draftMutations,
    editingId,
    pendingProposals,
    inputValue,
    onWorkStateChange,
  ]);
  useEffect(() => {
    onCaptureStateChange?.(
      !!(recording.isStarting || recording.isStopping || isRecording || isProcessing || audioTasks > 0),
    );
    return () => onCaptureStateChange?.(false);
  }, [recording.isStarting, recording.isStopping, isRecording, isProcessing, audioTasks, onCaptureStateChange]);

  useEffect(() => {
    // The outer navigation guard normally prevents this. If props change from
    // another source, finish into the originating patient's recoverable draft.
    if (recordingRef.current.isStarting) recordingRef.current.discard();
    else if (recordingRef.current.isRecording) recordingRef.current.confirmStop();
    setShowBriefing(true);
    setBriefingExpanded(false);
    setLastNoteOpen(false);
    consultationCommentsRef.current = [];
    setConsultationComments([]);
    setCurrentConsultationId(null);
    setReviewData(null);
    setRecoveryDraft(null);
    setDraftLoading(true);
    setDraftLoadError(false);
    setInputValue('');
    setEditingId(null);
    setEditedContent('');
    setSavingEdit(false);
    setDocumentModal(null);
    setComposerOpen(false);
    setIsProcessing(false);
    setIsChatLoading(false);
    setSavingNote(false);
    setGeneratingRx(false);
    resetCopilot();
    recordingRef.current.cancelStop();
    if (!selectedPatientId) return;
    let ignore = false;
    loadConsultationDraft(userId, selectedPatientId)
      .then((draft) => {
        if (ignore) return;
        setDraftLoading(false);
        if (!draft) return;
        if (draft.status === 'review') setReviewData(draft);
        else setRecoveryDraft(draft);
      })
      .catch(() => {
        if (!ignore) {
          setDraftLoading(false);
          setDraftLoadError(true);
          toast({
            title: 'Não foi possível carregar rascunhos',
            description: 'Verifique a conexão antes de iniciar outra gravação.',
            variant: 'destructive',
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedPatientId, userId, draftRetryKey, toast]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [messages, isProcessing]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Clicking record asks presencial vs. online first — online additionally
  // captures the computer/tab audio so the patient's side is recorded too.
  const handleStartRecording = () => setModeDialogOpen(true);
  // Consent + modality of the recording in progress; stored on its draft and,
  // when saved, on the consultation (LGPD art. 11; CFM 2.314/2022).
  const recordingConsentRef = useRef<ConsultationDraft['recordingConsent']>(undefined);
  const handleModeSelected = (mode: ConsultationMode, consent: { consentedAt: string }) => {
    recordingConsentRef.current = { mode, consentedAt: consent.consentedAt };
    resetCopilot();
    recording.start(mode);
  };
  const handleStopRecording = () => recording.stop();
  const handleConfirmStop = () => recording.confirmStop();
  const handleCancelStop = () => recording.cancelStop();
  const handlePauseToggle = () => recording.pauseToggle();

  const handleCopy = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast({
        title: 'Não foi possível copiar',
        description: 'Selecione o texto e copie manualmente, ou permita o acesso à área de transferência.',
        variant: 'destructive',
      });
      return;
    }
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
        body: { patientId: patient.id, comment: text, mode: 'extract' },
      });
      if (error) {
        if (await handleQuotaError(error)) return;
        throw error;
      }

      // AI-extracted changes come back as a proposal: the doctor must review
      // them in a card before anything is written to the chart.
      if (data?.applied === false && data.proposal) {
        if (isCurrentPatient(patient.id))
          onMessagesChange((prev) => [
            ...prev,
            {
              id: `proposal-${Date.now()}`,
              type: 'comment-proposal',
              title: 'Revisar alterações do comentário',
              content: text,
              timestamp: new Date(),
              commentProposal: {
                patientId: patient.id,
                comment: text,
                proposal: data.proposal,
                expectedRevision: data.expectedRevision,
              },
            },
          ]);
        queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
        return;
      }

      const summary: string = data?.summary ?? 'Comentário processado.';
      const appliedAddendum: boolean = !!data?.appliedAddendum;

      if (isCurrentPatient(patient.id))
        onMessagesChange((prev) => [
          ...prev,
          {
            id: `note-${Date.now()}`,
            type: 'assistant',
            title: appliedAddendum ? 'Adendo na consulta de hoje' : 'Comentário processado',
            content: `📝 ${text}\n\n→ ${summary}`,
            timestamp: new Date(),
          },
        ]);

      // Refresh everything the comment could have touched
      queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail'] });
      queryClient.invalidateQueries({ queryKey: ['patient-clinical-notes'] });
      queryClient.invalidateQueries({ queryKey: ['patient-consultations'] });
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });

      if (isCurrentPatient(patient.id)) toast({ title: 'Comentário processado', description: summary });
    } catch (err: unknown) {
      if (isCurrentPatient(patient.id)) setInputValue((current) => current || text);
      toast({
        title: 'Erro ao processar comentário',
        description: managedDocumentMessage(await functionErrorMessage(err, 'Tente novamente.')),
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPatient(patient.id)) setSavingNote(false);
    }
  };

  const patientContext = patient
    ? {
        name: patient.name,
        age: patient.age,
        dateOfBirth: patient.dateOfBirth,
        diagnoses: patient.diagnoses,
        medications: patient.medications,
        allergies: patient.allergies,
      }
    : {};

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
      if (error) {
        copilotDisabledRef.current = true;
        return;
      }
      // Stale guard: patient switched or recording ended during the call.
      if (activePatientIdRef.current !== requestedPatientId) return;
      const next: CopilotState = {
        resumo: Array.isArray(data?.resumo) ? data.resumo : [],
        alertas: Array.isArray(data?.alertas) ? data.alertas : [],
        nao_explorado: Array.isArray(data?.nao_explorado) ? data.nao_explorado : [],
        sugestoes: Array.isArray(data?.sugestoes) ? data.sugestoes : [],
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
    if (copilotDisabledRef.current || !patient || !isCurrentPatient(patient.id)) return;
    try {
      const data = await blobToBase64(blob);
      if (!isCurrentPatient(patient.id)) return;
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
    setCopilotState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, sugestoes: prev.sugestoes.filter((s) => s !== text) };
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

  const copilotSecondsSince =
    copilotLastUpdateAt === null ? null : Math.max(0, Math.floor((copilotNow - copilotLastUpdateAt) / 1000));

  // ── Pre-consult question checklist ──────────────────────────────────────────
  async function runChecklist() {
    if (!patient || checklistRequestsRef.current.has(checklistSourceKey)) return;
    const sourceKey = checklistSourceKey;
    const isCurrentSource = () => mountedRef.current && checklistSourceRef.current === sourceKey;
    setChecklistLoading(true);
    setChecklistError('');
    checklistRequestsRef.current.add(sourceKey);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-questions', {
        body: {
          chiefComplaint,
          patientContext: {
            name: patient.name,
            age: patient.age,
            dateOfBirth: patient.dateOfBirth,
            diagnoses: patient.diagnoses,
            medications: patient.medications,
            allergies: patient.allergies,
            medicalHistory: patient.medicalHistory,
            socialAnamnesis: patient.socialAnamnesis,
          },
        },
      });
      if (error) {
        const message = await functionErrorMessage(error, 'Não foi possível gerar o roteiro. Tente novamente.');
        if (isCurrentSource()) setChecklistError(message);
        return;
      }
      const qs: string[] = Array.isArray(data?.questions) ? data.questions.filter((q: unknown): q is string => typeof q === 'string' && !!q.trim()).slice(0, 20) : [];
      checklistCacheRef.current.set(sourceKey, qs);
      if (isCurrentSource()) {
        setChecklistQuestions(qs);
        if (!qs.length) setChecklistError('Nenhuma pergunta foi gerada. Tente novamente.');
      }
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
    } catch {
      if (isCurrentSource()) setChecklistError('Não foi possível gerar o roteiro. Tente novamente.');
    } finally {
      checklistRequestsRef.current.delete(sourceKey);
      if (isCurrentSource()) setChecklistLoading(false);
    }
  }

  // Opening a chart only restores local results; generation is an explicit action.
  useEffect(() => {
    setChecklistQuestions(checklistCacheRef.current.get(checklistSourceKey) ?? []);
    setChecklistLoading(checklistRequestsRef.current.has(checklistSourceKey));
    setChecklistError('');
  }, [checklistSourceKey]);

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
      const safeName = file.name.replace(/[^\w.-]/g, '_').slice(0, 80);
      const storagePath = `patients/${userId}/${forPatientId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('patient-files')
        .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      const { data: row, error: dbErr } = await supabase
        .from('patient_files')
        .insert({
          patient_id: forPatientId,
          user_id: userId,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          tag: file.type?.startsWith('image/') ? 'Imagem' : 'PDF',
        })
        .select('id')
        .single();
      if (dbErr) {
        await supabase.storage
          .from('patient-files')
          .remove([storagePath])
          .catch(() => {});
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
      queryClient.invalidateQueries({ queryKey: ['clinical-proposals', forPatientId, userId] });
      if (activePatientIdRef.current !== forPatientId) return;

      const findings =
        Array.isArray(data?.keyFindings) && data.keyFindings.length > 0
          ? `\n\n${data.keyFindings.map((f: string) => `• ${f}`).join('\n')}`
          : '';
      onMessagesChange((prev) => [
        ...prev,
        {
          id: `doc-${Date.now()}`,
          type: 'assistant',
          title: `Documento analisado — ${data?.documentType ?? 'Documento'}`,
          content: `📎 ${file.name}\n\n${data?.summary ?? ''}${findings}`,
          timestamp: new Date(),
        },
      ]);
      toast({
        title: 'Análise pronta para revisão',
        description: 'Confira a proposta antes de adicionar informações ao prontuário.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Erro ao anexar documento',
        description: managedDocumentMessage(await functionErrorMessage(err, 'Tente novamente.')),
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPatient(forPatientId)) setAttachingFile(false);
    }
  };

  // ── Digital documents (receita/atestado) ────────────────────────────────────
  const handleOpenComposer = (consultationId?: string) => {
    composerPatientIdRef.current = patient?.id ?? null;
    composerConsultationIdRef.current = consultationId ?? currentConsultationId ?? undefined;
    setComposerOpen(true);
  };

  const handleComposerGenerate = async (payload: {
    docType: RxDocType;
    medications: Medication[];
    content?: { days: number; cid?: string; note?: string };
    sign?: boolean;
  }) => {
    if (!patient || generatingRx || composerPatientIdRef.current !== patient.id) return;
    const actor = userId;
    setGeneratingRx(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-prescription', {
        body: {
          patientId: patient.id,
          consultationId: composerConsultationIdRef.current,
          docType: payload.docType,
          medications: payload.medications,
          content: payload.content,
        },
      });
      if (error) {
        const body = await functionErrorBody(error);
        if (body?.missingPrescriber) {
          toast({
            title: 'Cadastro do prescritor pendente',
            description:
              'Solicite à equipe de implantação a conferência de nome, CRM e endereço antes de emitir o documento.',
            variant: 'destructive',
          });
          return;
        }
        throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['patient-prescriptions', patient.id] });
      const docLabel =
        payload.docType === 'atestado'
          ? 'Atestado gerado'
          : payload.docType === 'solicitacao_exames'
            ? 'Solicitação de exames gerada'
            : 'Receita gerada';
      // Same doctor, same patient, still mounted: otherwise nothing of this
      // document (code, preview, result) is shown in the context that
      // followed; only its patient's list is refreshed (Codex 05/11 11:38).
      const stillHere = () => isCurrentPatient(patient.id) && userIdRef.current === actor;
      if (payload.sign && SIGNABLE_TYPES.has(payload.docType)) {
        // "Gerar e assinar": sign the document this generation persisted (its
        // id and the hash of its PDF), only while the doctor and the patient
        // are still the same. Signing never generates again nor removes the
        // generated document; the unsigned preview is not opened as signed.
        const prescriptionId = typeof data?.prescriptionId === 'string' ? data.prescriptionId : '';
        const pdfSha256 = typeof data?.pdfSha256 === 'string' && /^[0-9a-f]{64}$/.test(data.pdfSha256) ? data.pdfSha256 : '';
        const unsigned = (reason: string) =>
          toast({ title: `${docLabel}, sem assinatura digital`, description: `${reason} Código de acesso do paciente: ${data?.accessCode}.` });
        if (!stillHere()) return; // not signed; the document stays in its patient's list
        setComposerOpen(false);
        if (!prescriptionId || !pdfSha256) {
          unsigned('Assine pela lista de documentos.');
          return;
        }
        const outcome = await signKeepingOperation(signatureInvoke, actor, { prescriptionId, pdfSha256 });
        queryClient.invalidateQueries({ queryKey: ['patient-prescriptions', patient.id] });
        if (outcome.kind === 'needs_session') queryClient.invalidateQueries({ queryKey: [SESSION_KEY] });
        if (!stillHere()) return; // a late answer never reaches another context
        if (outcome.kind === 'completed') {
          toast({ title: `${docLabel} e assinado digitalmente`, description: `Já vale na validação pública. Código de acesso do paciente: ${data?.accessCode}.` });
        } else {
          const notice = signatureNotice(outcome);
          unsigned(`${notice.title}. ${notice.description ?? ''}`.trim());
        }
        return;
      }
      if (!stillHere()) return;
      setComposerOpen(false);
      // A pop-up opened after an await is usually blocked (the click's
      // activation has lapsed), so the result carries its own "Abrir PDF".
      const previewUrl = typeof data?.previewUrl === 'string' && /^https:\/\//.test(data.previewUrl) ? data.previewUrl : '';
      toast({
        title: docLabel,
        description: `Imprima, assine e carimbe (ainda sem assinatura digital ICP-Brasil). Código de acesso do paciente: ${data?.accessCode}.`,
        duration: previewUrl ? 120_000 : undefined,
        action: previewUrl ? (
          <ToastAction altText="Abrir PDF do documento" onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}>
            Abrir PDF
          </ToastAction>
        ) : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['patient-prescriptions', patient.id] });
    } catch (err: unknown) {
      toast({
        title: 'Erro ao gerar documento',
        description: managedDocumentMessage(await functionErrorMessage(err, 'Tente novamente.')),
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPatient(patient.id)) setGeneratingRx(false);
    }
  };

  /** supabase-js wraps non-2xx as FunctionsHttpError with the JSON body on
   *  err.context. Returns true when the error was a quota 429 (and toasts). */
  const handleQuotaError = async (error: unknown): Promise<boolean> => {
    const body = await functionErrorBody(error);
    if (body?.quotaExceeded) {
      toast({
        title: 'Limite diário atingido',
        description: typeof body.error === 'string' ? body.error : 'Aguarde o reset diário ou solicite aumento.',
        variant: 'destructive',
      });
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
      return true;
    }
    return false;
  };

  // A generated revision is previewed first; only the clinician's next
  // explicit confirmation can persist that exact reviewed text.
  const submitFinalSoap = async (draft: ConsultationDraft, doctorComments: string) => {
    if (!patient || draft.patientId !== patient.id) return;
    const comments = [...draft.originalComments, doctorComments.trim()].filter(Boolean);
    const { data, error } = await supabase.functions.invoke('finalize-consultation', {
      body: {
        patientId: draft.patientId,
        draftId: draft.id,
        chiefComplaint: draft.chiefComplaint,
        transcription: draft.transcription,
        patientContext,
        userSpecialty: specialty,
        templateContent: activeTemplateContent ?? undefined,
        ...(doctorComments.trim()
          ? // The edited text is the base for regeneration so the doctor's
            // direct corrections are never silently replaced.
            { doctorComments: comments.join('\n\n'), reviewedSoap: draft.soapDraft, previewOnly: true }
          : { saveDirect: true, reviewed: true, soapNote: draft.soapDraft, whatsappMessage: draft.whatsappDraft }),
      },
    });
    if (error) {
      if (await handleQuotaError(error)) throw new HandledError();
      throw error;
    }
    if (data.previewOnly) {
      const revised = {
        ...draft,
        soapDraft: data.soapNote,
        whatsappDraft: data.whatsappMessage,
        pendingComments: '',
        originalComments: comments,
        clarifications: [],
        status: 'review' as const,
      };
      await saveConsultationDraft(userId, revised);
      void queryClient.invalidateQueries({queryKey:['consultation-recovery',userId]});
      if (isCurrentPatient(draft.patientId)) {
        setReviewData(revised);
        toast({ title: 'Rascunho revisado', description: 'Confira o novo texto e confirme para salvar.' });
      }
      return;
    }
    onConsultationSaved?.(draft.patientId);
    // The consultation is saved; when a chart proposal could not be prepared, say why.
    if (Array.isArray(data.notices) && data.notices.some((notice: unknown) => typeof notice === 'string' && notice.trim())) {
      toast({ title: 'Consulta salva', description: data.notices.filter((notice: unknown): notice is string => typeof notice === 'string').join(' ') });
    }
    for (const key of [
      ['patients', userId],
      ['patient-detail'],
      ['patient-consultations'],
      ['patient-clinical-notes'],
      ['appointments'],
      ['appointments-today'],
      ['usage-daily', userId],
      ['clinical-proposals', draft.patientId, userId],
    ])
      queryClient.invalidateQueries({ queryKey: key });
    if (!isCurrentPatient(draft.patientId)) return;
    setCurrentConsultationId(data.consultationId ?? null);
    pushToChat(data.soapNote, data.whatsappMessage, data.profileUpdates, data.consultationId ?? undefined);
    setReviewData(null);
    setRecoveryDraft(null);
    toast({ title: 'Consulta salva!', description: 'A evolução revisada foi salva no prontuário.' });
  };

  /** Upload with up to 3 attempts and exponential backoff. */
  const uploadAudioWithRetry = async (blob: Blob, path: string, mimeType: string, maxAttempts = 3): Promise<void> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { error } = await supabase.storage
        .from('audio-recordings')
        .upload(path, blob, { contentType: mimeType, upsert: true });
      if (!error) return;
      if (attempt === maxAttempts) throw error;
      // Exponential backoff: 1 s, 2 s
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  };

  /** Explicit, doctor-initiated download of audio that never reached the server. */
  const downloadLocalAudio = (blob: Blob, mimeType: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    a.download = `consulta-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // NOTE: declared as a hoisted `function` (not a `const` arrow) so it can be
  // referenced by the useRecording() call above before this line executes.
  // A const arrow here causes a temporal-dead-zone ReferenceError at render.
  async function processConsultation(
    audioBlob: Blob,
    mimeType: string,
    comments: string[],
    previous?: ConsultationDraft,
    /** This browser's copy of the audio (IndexedDB). The draft takes its id;
     *  the copy is deleted only once the audio is on the server, and kept (or
     *  written again) on any failure before that. */
    parked?: RescuedRecording,
  ) {
    if (!patient) return;
    if (mountedRef.current) setAudioTasks((count) => count + 1);
    const draft: ConsultationDraft = previous ?? {
      id: parked?.id ?? crypto.randomUUID(),
      patientId: patient.id,
      chiefComplaint,
      appointmentId,
      recordingConsent: recordingConsentRef.current,
      audioStoragePath: null,
      audioMimeType: mimeType,
      status: 'processing',
      transcription: '',
      soapDraft: '',
      whatsappDraft: '',
      clarifications: [],
      transcriptionQuality: 'poor',
      differentialDiagnoses: [],
      drugInteractionAlerts: [],
      originalComments: [...comments],
    };
    if (isCurrentPatient(draft.patientId)) setIsProcessing(true);
    // A previous draft with a storage path and no tab-local copy came from the
    // server, so its audio is already uploaded.
    let audioOnServer = !!draft.audioStoragePath && !localAudioRef.current.has(draft.id);
    let processingRequested = false;
    // Whether a draft row with this id exists on the server.
    let draftSaved = !!draft.audioStoragePath;
    try {
      // The server refuses audio above its limit and cannot split it: never
      // upload (or keep retrying) a file that can only be refused.
      if (!audioOnServer && audioBlob.size > AUDIO_UPLOAD_LIMIT_BYTES) throw new AudioTooLargeError();
      if (!draft.audioStoragePath) {
        await saveConsultationDraft(userId, { ...draft, status: 'processing' });
        draftSaved = true;
      }
      void queryClient.invalidateQueries({queryKey:['consultation-recovery',userId]});
      if (!audioOnServer) {
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const path = draft.audioStoragePath ?? `consultations/${userId}/${draft.id}.${ext}`;
        // The path is saved first so a discard can always clean up a partial upload.
        if (!draft.audioStoragePath) {
          await saveConsultationDraft(userId, { ...draft, audioStoragePath: path });
          // Only a confirmed registration may skip this write on retry.
          draft.audioStoragePath = path;
        }
        await uploadAudioWithRetry(audioBlob, path, mimeType);
        audioOnServer = true;
        localAudioRef.current.delete(draft.id);
      }
      // The draft and its audio are both on the server: only now may this
      // browser's copy go (a no-op when there is none).
      await forgetParked(draft.id);
      processingRequested = true;
      const transcribeBody = {
        patientId: draft.patientId,
        draftId: draft.id,
        chiefComplaint: draft.chiefComplaint,
        audioStoragePath: draft.audioStoragePath,
        audioMimeType: mimeType,
        consultationComments: draft.originalComments,
        patientContext,
        userSpecialty: specialty,
        templateContent: activeTemplateContent ?? undefined,
      };
      const first = await supabase.functions.invoke('transcribe-consultation', { body: transcribeBody });
      if (first.error) {
        if (await handleQuotaError(first.error)) throw new HandledError();
        if (functionErrorStatus(first.error) === 413) throw new AudioTooLargeError();
        throw first.error;
      }
      let data = first.data;
      // Long audio: the server saved the transcript and ran out of time for the note. It asks for
      // the note in a second call, built from the saved transcript; the audio is not sent again.
      // If that call fails the transcript is still shown, as in any other failed draft.
      if (data?.noteDeferred === true) {
        const second = await supabase.functions.invoke('transcribe-consultation', { body: { ...transcribeBody, noteOnly: true } });
        if (second.error) await handleQuotaError(second.error);
        else if (second.data) data = second.data;
      }
      // An actionable reason for a missing note comes first among the points to check.
      const draftNotice = typeof data.draftNotice === 'string' && data.draftNotice.trim() ? [data.draftNotice.trim()] : [];
      let ready: ConsultationDraft = {
        ...draft,
        status: 'review',
        transcription: data.transcription ?? '',
        soapDraft: data.soapNote ?? '',
        whatsappDraft: data.whatsappMessage ?? '',
        clarifications: [...draftNotice, ...(Array.isArray(data.clarifications) ? data.clarifications : [])],
        transcriptionQuality: data.transcriptionQuality ?? 'poor',
        differentialDiagnoses: Array.isArray(data.differentialDiagnoses) ? data.differentialDiagnoses : [],
        drugInteractionAlerts: Array.isArray(data.drugInteractionAlerts) ? data.drugInteractionAlerts : [],
        aiMetadata: data.aiMetadata ?? draft.aiMetadata,
      };
      // The server owns its transcript checkpoint and CAS. A stale tab must
      // never upsert over it, including when persistence lost a concurrent edit.
      if (data.draftPersisted === true) {
        const latest = await loadConsultationDraft(userId, draft.patientId).catch(() => null);
        if (latest?.id === draft.id) ready = latest;
      }
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
      if (isCurrentPatient(draft.patientId)) {
        setRecoveryDraft(null);
        setReviewData(ready);
      }
    } catch (error) {
      // Never write patient audio to disk automatically. Uploaded audio is
      // already safe in the draft; audio that did not upload is kept in this
      // tab so the doctor can resend it or explicitly download a copy.
      const failed = { ...draft, status: 'error' as const };
      if (!audioOnServer) localAudioRef.current.set(draft.id, { blob: audioBlob, mimeType });
      // Audio that is not on the server stays in (or goes back to) this
      // browser's IndexedDB, so a reload or a closed tab does not lose it.
      let parkedHere = false;
      if (!audioOnServer && parked) {
        const entry: RescuedRecording = { ...parked, id: draft.id, blob: audioBlob, mimeType, comments: [...draft.originalComments] };
        parkedHere = await Promise.resolve()
          .then(() => saveRescuedRecording(entry))
          .then(() => true, () => false);
        if (parkedHere && isCurrentPatient(draft.patientId)) {
          setRescued((list) => [...list.filter((item) => item.id !== entry.id), entry]);
        }
      }
      // An interrupted response may have already preserved a transcript. Read
      // its current version instead of writing the pre-request snapshot back.
      const latest = processingRequested
        ? await loadConsultationDraft(userId, draft.patientId).catch(() => null)
        : null;
      // A parked recording whose draft never reached the server stays only a
      // parked recording: no draft is invented for it, here or on the server.
      if (!processingRequested && !draft.audioStoragePath && !parkedHere) await saveConsultationDraft(userId, failed).catch(() => {});
      if (isCurrentPatient(draft.patientId)) {
        if (draftSaved || !parkedHere) setRecoveryDraft(latest?.id === draft.id ? latest : failed);
        else if (!previous) setRescueFailed((list) => ({ ...list, [draft.id]: true }));
      }
      if (error instanceof AudioTooLargeError) {
        if (mountedRef.current) setTooLarge((list) => ({ ...list, [draft.id]: audioBlob.size }));
        toast({
          title: 'Gravação grande demais para a IA',
          description: 'Esta gravação passa de 25 MB e não pode ser processada. Baixe uma cópia do áudio se quiser guardá-lo e escreva a evolução manualmente.',
          variant: 'destructive',
        });
      } else if (!(error instanceof HandledError)) {
        const reason = await functionErrorMessage(error, 'Não foi possível processar a consulta.');
        toast({
          title: 'Consulta preservada para nova tentativa',
          description: audioOnServer
            ? `${reason} O áudio está salvo no rascunho; use "Recuperar consulta" para tentar de novo.`
            : parkedHere
              ? `${reason} O áudio ainda não foi enviado e continua guardado neste navegador. Tente de novo quando a conexão voltar.`
              : `${reason} O áudio ainda não foi enviado e está guardado apenas nesta aba: reenvie ou baixe uma cópia antes de fechá-la.`,
          variant: 'destructive',
        });
      }
    } finally {
      releaseCapture(draft.id);
      if (mountedRef.current) setAudioTasks((count) => Math.max(0, count - 1));
      if (isCurrentPatient(draft.patientId)) setIsProcessing(false);
      void queryClient.invalidateQueries({queryKey:['consultation-recovery',userId]});
    }
  }

  /** True only when Storage says the object is not there; unknown (offline)
   *  counts as present, so processing runs and reports its own error. */
  const storedAudioMissing = async (path: string) => {
    try {
      const { data } = await supabase.storage.from('audio-recordings').exists(path);
      return data === false;
    } catch {
      return false;
    }
  };

  /** Explicit download of audio that is only on the server (for a recording too large to process). */
  const downloadStoredAudio = async (draft: ConsultationDraft) => {
    if (!draft.audioStoragePath) return;
    const { data, error } = await supabase.storage.from('audio-recordings').download(draft.audioStoragePath);
    if (error || !data) {
      toast({ title: 'Não foi possível baixar o áudio', description: 'Verifique a conexão e tente de novo.', variant: 'destructive' });
      return;
    }
    downloadLocalAudio(data, draft.audioMimeType);
  };

  const recoverConsultation = async (draft: ConsultationDraft) => {
    if (tooLarge[draft.id] !== undefined) return;
    if (draft.status === 'review') {
      setReviewData(draft);
      setRecoveryDraft(null);
      return;
    }
    if (!isCurrentPatient(draft.patientId)) return;
    const parked = rescued.find((entry) => entry.id === draft.id);
    const local = localAudioRef.current.get(draft.id) ?? (parked && { blob: parked.blob, mimeType: parked.mimeType });
    if (local) {
      // Upload never completed: resend the audio kept in this tab or browser
      // (marked local, so it is uploaded again even if a path was registered).
      localAudioRef.current.set(draft.id, local);
      await processConsultation(local.blob, local.mimeType, draft.originalComments, draft, parked);
      return;
    }
    if (!draft.audioStoragePath) return;
    setIsProcessing(true);
    try {
      if (await storedAudioMissing(draft.audioStoragePath)) {
        toast({
          title: 'Áudio não encontrado no servidor',
          description: 'O envio desta gravação não terminou e o áudio não está no servidor nem neste navegador. Se você tem o arquivo, use "Enviar áudio salvo"; se não, exclua este rascunho.',
          variant: 'destructive',
        });
        return;
      }
      // The audio is already in Storage and the server reads it by path:
      // nothing needs to be downloaded here.
      await processConsultation(new Blob([], { type: draft.audioMimeType }), draft.audioMimeType, draft.originalComments, draft);
    } catch {
      toast({
        title: 'Não foi possível recuperar o áudio',
        description: 'Seu rascunho continua salvo. Verifique a conexão.',
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPatient(draft.patientId)) setIsProcessing(false);
    }
  };

  const discardSavedDraft = async (draft: ConsultationDraft) => {
    if (!window.confirm('Excluir este rascunho e seu áudio? Esta ação não pode ser desfeita.')) return;
    setDraftMutations(count => count + 1);
    try {
      const { error } = await supabase.functions.invoke('discard-consultation', { body: { draftId: draft.id } });
      if (error) {
        toast({
          title: 'Não foi possível excluir o rascunho',
          description: await functionErrorMessage(error, 'Tente novamente.'),
          variant: 'destructive',
        });
        return;
      }
      localAudioRef.current.delete(draft.id);
      // The confirmation promised the audio goes too, including this browser's copy.
      await forgetParked(draft.id);
      if (isCurrentPatient(draft.patientId)) setRecoveryDraft(null);
    } finally {
      setDraftMutations(count => count - 1);
      void queryClient.invalidateQueries({queryKey:['consultation-recovery',userId]});
    }
  };

  const handleSendMessage = async () => {
    if (!patient || !inputValue.trim() || isChatLoading) return;
    const text = inputValue.trim();
    setInputValue('');
    await sendQuestion(text);
  };

  /** Sends again a question that failed, reusing its turn when the server allows it. */
  const retryQuestion = async (messageId: string) => {
    const text = failedQuestions[messageId];
    if (!text || isChatLoading) return;
    await sendQuestion(text, messageId);
  };

  const sendQuestion = async (text: string, failedMessageId?: string) => {
    if (!patient || isChatLoading) return;
    const prior = retryTurn.current;
    const turn = prior?.patientId === patient.id && prior.text === text ? prior : {patientId:patient.id,text,id:crypto.randomUUID(),timestamp:new Date()};
    retryTurn.current = turn;
    const retried = new Set([turn.id + '/user', ...(failedMessageId ? [failedMessageId] : [])]);
    setFailedQuestions((list) => Object.fromEntries(Object.entries(list).filter(([id]) => !retried.has(id))));
    // A new turn replaces the failed bubble instead of repeating the question.
    if (failedMessageId && failedMessageId !== turn.id + '/user') onMessagesChange((prev) => prev.filter((message) => message.id !== failedMessageId));

    const userMsg: ChatMessage = {
      id: turn.id + '/user',
      type: 'user',
      title: 'Você',
      content: text,
      timestamp: turn.timestamp,
    };
    onMessagesChange((prev) => prev.some(message => message.id===userMsg.id) ? prev : [...prev, userMsg]);
    setIsChatLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('chat-assistant', {
        body: {
          patientId: patient?.id ?? null,
          conversationId: turn.id,
          userId,
          patientContext: patient
            ? {
                name: patient.name,
                age: patient.age,
                dateOfBirth: patient.dateOfBirth,
                diagnoses: patient.diagnoses,
                medications: patient.medications,
                allergies: patient.allergies,
                socialAnamnesis: patient.socialAnamnesis,
                medicalHistory: patient.medicalHistory,
              }
            : null,
          chatHistory: messages
            .filter((m) => m.type === 'user' || m.type === 'assistant')
            .filter(
              (m) =>
                m.type !== 'assistant' ||
                !m.sources?.some((source) => source.type === 'knowledge' || source.type === 'protocol'),
            )
            .slice(-10)
            .map((m) => ({ type: m.type, content: m.content })),
          userMessage: text,
        },
      });
      if (error) {
        if (await handleQuotaError(error)) {
          queryClient.invalidateQueries({queryKey:['patient-conversation',userId,turn.patientId]});
          if (isCurrentPatient(turn.patientId)) setInputValue(current=>current||text);
          return;
        }
        const failure = await functionErrorBody(error);
        if (failure?.conversationRetry === 'new_request_required' && retryTurn.current?.id === turn.id) retryTurn.current = null;
        throw error;
      }
      if (!data || typeof data.message !== 'string' || !Array.isArray(data.sources)) throw new Error('Resposta inválida');
      if (retryTurn.current?.id === turn.id) retryTurn.current = null;
      queryClient.invalidateQueries({queryKey:['patient-conversation',userId,turn.patientId]});
      if (!isCurrentPatient(patient.id)) return;
      onMessagesChange((prev) => [
        ...prev,
        {
          id: turn.id + '/assistant',
          type: 'assistant',
          title: 'Assistente Clínico',
          content: data.message,
          timestamp: new Date(),
          sources: Array.isArray(data.sources) ? data.sources : [],
          coverage: data.coverage,
          safety: data.safety,
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
    } catch (err: unknown) {
      queryClient.invalidateQueries({queryKey:['patient-conversation',userId,turn.patientId]});
      if (isCurrentPatient(turn.patientId)) setFailedQuestions((list) => ({ ...list, [userMsg.id]: text }));
      toast({
        title: 'Pergunta não enviada',
        description: await functionErrorMessage(err, 'Não foi possível consultar a IA. Use "Tentar novamente" na pergunta.'),
        variant: 'destructive',
      });
    } finally {
      if (isCurrentPatient(patient.id)) setIsChatLoading(false);
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
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      await saveEdit(messageId);
    } finally {
      setSavingEdit(false);
    }
  };
  const cancelEdit = () => {
    if (savingEdit) return;
    setEditingId(null);
    setEditedContent('');
    editRevisionRef.current = null;
  };

  const saveEdit = async (messageId: string) => {
    // Update the consultation this specific message belongs to — using the
    // panel-level currentConsultationId here would overwrite the LATEST
    // consultation even when the doctor edited an older SOAP card.
    const target = messages.find((m) => m.id === messageId);
    const targetConsultationId = target?.consultationId ?? null;
    if (targetConsultationId) {
      if (editRevisionRef.current === null || !patient) return;
      const { data, error } = await supabase
        .from('consultations')
        .update({ soap_note: editedContent, pre_briefing: null })
        .eq('id', targetConsultationId)
        .eq('revision', editRevisionRef.current)
        .select('id')
        .maybeSingle();
      if (error || !data) {
        toast({
          title: 'Erro ao salvar alterações',
          description: 'O registro pode ter sido alterado em outra janela. Reabra a edição antes de tentar novamente.',
          variant: 'destructive',
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['patient-consultations'] });
      onConsultationSaved?.(patient.id);
    }
    if (!patient || !isCurrentPatient(patient.id)) return;
    onMessagesChange((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: editedContent } : m)));
    editRevisionRef.current = null;
    setEditingId(null);
    toast({ title: 'Alterações salvas', description: 'A evolução clínica foi atualizada.' });
  };

  const beginEdit = async (message: ChatMessage) => {
    if (!patient || !message.consultationId) return;
    const { data, error } = await supabase
      .from('consultations')
      .select('soap_note,revision')
      .eq('id', message.consultationId)
      .eq('patient_id', patient.id)
      .maybeSingle();
    if (!isCurrentPatient(patient.id)) return;
    if (error || !data) {
      toast({ title: 'Não foi possível abrir a edição', variant: 'destructive' });
      return;
    }
    editRevisionRef.current = data.revision;
    setEditingId(message.id);
    setEditedContent(data.soap_note ?? '');
  };

  const pushToChat = (
    soapNote: string,
    whatsappMessage: string,
    profileUpdates?: ProfileUpdates,
    consultationId?: string,
  ) => {
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
    if (
      profileUpdates &&
      (profileUpdates.diagnoses.length > 0 ||
        profileUpdates.medications.length > 0 ||
        profileUpdates.allergies.length > 0)
    ) {
      cards.push({
        id: `profile-${now.getTime()}`,
        type: 'profile-update',
        title: 'Atualização do Perfil Clínico',
        content: '',
        timestamp: now,
        profileUpdates,
      });
    }
    onMessagesChange((prev) => [...prev, ...cards]);
  };

  // Phase 2: generate final SOAP (with doctor comments) → save to DB → show in chat
  const handleReviewConfirm = async (comments: string, reviewedText?: string) => {
    if (!reviewData || !patient) return;
    setIsGeneratingFinal(true);
    try {
      await submitFinalSoap({ ...reviewData, soapDraft: reviewedText ?? reviewData.soapDraft }, comments);
    } catch (err) {
      if (!(err instanceof HandledError)) {
        toast({
          title: 'Erro ao gerar evolução',
          description: await functionErrorMessage(err, 'A revisão continua aberta. Tente novamente.'),
          variant: 'destructive',
        });
      }
    } finally {
      if (isCurrentPatient(patient.id)) setIsGeneratingFinal(false);
    }
  };

  const handleReviewCancel = async (comments: string, reviewedText?: string) => {
    if (!reviewData) return;
    setDraftMutations(count => count + 1);
    const preserved = { ...reviewData, pendingComments: comments, soapDraft: reviewedText ?? reviewData.soapDraft };
    setRecoveryDraft(preserved);
    setReviewData(null);
    try {
      await saveConsultationDraft(userId, preserved);
    } catch {
      toast({
        title: 'Observações ainda não foram salvas',
        description: 'Retome a revisão e tente novamente antes de sair.',
        variant: 'destructive',
      });
    } finally {
      setDraftMutations(count => count - 1);
      void queryClient.invalidateQueries({queryKey:['consultation-recovery',userId]});
    }
  };

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

  // Printed documents carry the clinic's own name.
  const clinicAccess = useClinicAccess();
  const handlePrintSOAP = (soapNote: string) => {
    if (!patient) return;
    printSoap(soapNote, patient, chiefComplaint, {
      author: { name: prescriber.doctorName, crm: prescriber.crmNumber, crmUf: prescriber.crmUf, clinicName: clinicAccess?.clinic?.name ?? undefined },
    });
  };

  // Receives fully merged arrays from ProfileUpdateCard — existing entries
  // keep their ICD codes / startedAt; writing mapped copies here would erase them.
  const handleProfileAccept = async (merged: MergedProfile) => {
    if (!patient) return;
    const expectedRevision = patient.revision ?? 0;
    const { data: current, error: readError } = await supabase
      .from('patients')
      .select('revision')
      .eq('id', patient.id)
      .single();
    if (readError || !current || current.revision !== expectedRevision) {
      queryClient.invalidateQueries({ queryKey: ['patients', userId] });
      toast({
        title: 'O perfil foi alterado',
        description: 'Confira os dados atualizados antes de aceitar novamente.',
        variant: 'destructive',
      });
      throw new Error('Perfil alterado');
    }
    const { data, error } = await supabase
      .from('patients')
      .update({
        diagnoses: merged.diagnoses.map((value) => ({ ...value })),
        medications: merged.medications.map((value) => ({ ...value })),
        allergies: merged.allergies,
      })
      .eq('id', patient.id)
      .eq('revision', expectedRevision)
      .select('id')
      .maybeSingle();
    if (error || !data) {
      toast({
        title: 'Erro ao atualizar perfil',
        description: 'As alterações não foram salvas. Tente novamente.',
        variant: 'destructive',
      });
      throw error;
    }
    queryClient.invalidateQueries({ queryKey: ['patients', userId] });
    queryClient.invalidateQueries({ queryKey: ['patient-detail'] });
    if (isCurrentPatient(patient.id))
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
    const origin = { patientId: patient.id, patientName: patient.name };
    setDocumentModal({ ...origin, type, content: '', isLoading: true });
    try {
      const { data, error } = await supabase.functions.invoke('generate-document', {
        body: { type, soapNote, chiefComplaint, patientContext },
      });
      if (error) {
        if (await handleQuotaError(error)) {
          if (isCurrentPatient(patient.id)) setDocumentModal(null);
          return;
        }
        throw error;
      }
      if (!isCurrentPatient(patient.id)) return;
      setDocumentModal({ ...origin, type, content: data.document ?? '', isLoading: false });
      queryClient.invalidateQueries({ queryKey: ['usage-daily', userId] });
    } catch (err: unknown) {
      if (isCurrentPatient(patient.id)) setDocumentModal(null);
      toast({
        title: 'Erro ao gerar documento',
        description: managedDocumentMessage(await functionErrorMessage(err, 'Tente novamente.')),
        variant: 'destructive',
      });
    }
  };

  if (!patient) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-card">
        <div className="text-center space-y-3 px-8">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto">
            <Mic className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground/70">Nenhuma consulta ativa</p>
          <p className="text-xs text-muted-foreground">Selecione um paciente ou inicie uma nova consulta</p>
        </div>
      </div>
    );
  }

  const activeBriefing = preBriefing;
  const lastVisitDate = lastConsultation?.created_at ?? patient.lastVisit ?? null;

  return (
    <div className="flex-1 flex flex-col bg-card h-full">
      {!sessionHidden &&
        (isRecording || recording.isStarting || recording.isStopping || audioTasks > 0) &&
        createPortal(
          <div
            role="status"
            aria-label="Captura de áudio em andamento"
            data-clinical-capture
            className="fixed top-0 inset-x-0 z-40 min-h-14 bg-card border-b-2 border-record-red px-3 py-2 flex flex-wrap items-center justify-center gap-3 shadow-sm"
          >
            <span className="text-sm font-semibold text-record-red">
              {onReturnToConsultation ? (
                <button
                  type="button"
                  onClick={onReturnToConsultation}
                  aria-label={`Voltar à consulta de ${patient.name}`}
                  className="underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-record-red"
                >
                  {patient.name}
                </button>
              ) : (
                patient.name
              )}{' '}
              ·{' '}
              {isRecording
                ? (isPaused ? 'Gravação pausada' : 'Gravando') + ' ' + formatTimer(recordingSeconds)
                : 'Preservando áudio…'}
            </span>
            {isRecording && (
              <>
                <Button size="sm" variant="outline" onClick={handlePauseToggle}>
                  {isPaused ? 'Retomar gravação' : 'Pausar gravação'}
                </Button>
                <Button size="sm" variant="destructive" onClick={handleConfirmStop}>
                  Parar e salvar áudio
                </Button>
              </>
            )}
          </div>,
          document.body,
        )}
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 md:px-6 py-3 md:py-4 border-b border-border/50 bg-card/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          {patient.photoUrl ? (
            <img src={patient.photoUrl} alt={patient.name} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 shrink-0 rounded-full bg-medical-blue-light flex items-center justify-center">
              <span className="text-medical-blue font-semibold text-sm">
                {patient.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1 basis-48">
            <h1 className="text-sm sm:text-base font-semibold text-foreground break-words">{patient.name}</h1>
            <Badge variant={patient.status} className="mt-1">
              {({retorno:'Retorno',seguimento:'Seguimento',novo:'Novo',atendimento:'Em atendimento'})[patient.status]}
            </Badge>
            <ClinicalSafetyRow patient={patient} onOpen={onOpenPatientPanel} />
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto sm:ml-auto">
          <Button variant="outline" size="sm" className="text-xs whitespace-normal h-auto min-h-8 py-1.5 px-2" onClick={() => onOpenPatientWork?.(true)} disabled={!onOpenPatientWork}>
              Consulta manual
          </Button>
          <Button variant="outline" size="sm" className="text-xs whitespace-normal h-auto min-h-8 py-1.5 px-2" onClick={() => onOpenPatientWork?.(false)} disabled={!onOpenPatientWork}>
            Acompanhamento
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleOpenComposer()} className="text-xs whitespace-normal h-auto min-h-8 py-1.5 px-2 gap-1.5">
            <FileSignature className="hidden sm:block w-4 h-4 shrink-0" />Receita / atestado
          </Button>
          </div>
        </div>
      </header>

      {/* Chat Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-6 py-4 md:py-6 space-y-4">
        <ClinicalProposals patient={patient} userId={userId} />

        {draftLoadError && (
          <div role="alert" className="rounded-lg border p-3 text-sm">
            Não foi possível verificar os rascunhos desta consulta.
            <Button variant="outline" onClick={() => setDraftRetryKey((key) => key + 1)}>
              Tentar novamente
            </Button>
          </div>
        )}

        {/* A parked recording that already belongs to the open or pending draft is handled there. */}
        {rescued.filter((entry) => entry.id !== recoveryDraft?.id && entry.id !== reviewData?.id).map((entry) => (
          <div key={entry.id} role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm space-y-2">
            <p>
              Uma gravação desta consulta, de {new Date(entry.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}, não chegou ao
              servidor e está guardada neste navegador.
            </p>
            {tooLarge[entry.id] !== undefined ? (
              <p role="alert" className="text-destructive">
                Esta gravação tem {audioSizeMb(tooLarge[entry.id])} MB e passa do limite de 25 MB que a IA processa. Baixe uma
                cópia se quiser guardar o áudio e escreva a evolução manualmente.
              </p>
            ) : rescueFailed[entry.id] && (
              <p role="alert" className="text-destructive">
                Não foi possível enviar esta gravação. Ela continua guardada neste navegador; tente de novo.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {tooLarge[entry.id] !== undefined ? (
                <>
                  <Button variant="outline" onClick={() => downloadLocalAudio(entry.blob, entry.mimeType)}>
                    Baixar cópia do áudio
                  </Button>
                  <Button variant="outline" disabled={!onOpenPatientWork} onClick={() => onOpenPatientWork?.(true)}>
                    Escrever evolução
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={!!rescueBlockReason} onClick={() => void processRescued(entry)}>
                  {rescueFailed[entry.id] ? 'Tentar enviar de novo' : 'Processar gravação'}
                </Button>
              )}
              <Button variant="ghost" disabled={isProcessing} onClick={() => void discardRescued(entry)}>
                Descartar
              </Button>
            </div>
            {rescueBlockReason && tooLarge[entry.id] === undefined && <p className="text-xs text-muted-foreground">{rescueBlockReason}</p>}
          </div>
        ))}

        {recoveryDraft && recoveryDraft.patientId === patient.id && tooLarge[recoveryDraft.id] !== undefined && (() => {
          const parkedCopy = rescued.find((entry) => entry.id === recoveryDraft.id);
          const local = localAudioRef.current.get(recoveryDraft.id) ?? parkedCopy;
          return (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-2">
              <p className="font-medium">Esta gravação é grande demais para a IA processar.</p>
              <p>
                O áudio{tooLarge[recoveryDraft.id] > 0 ? ` (${audioSizeMb(tooLarge[recoveryDraft.id])} MB)` : ''} passa do limite de 25 MB
                e não pode ser dividido aqui, então tentar de novo não resolve. Baixe uma cópia se quiser guardar o áudio, escreva a
                evolução manualmente e exclua este rascunho para gravar de novo.
              </p>
              <div className="flex flex-wrap gap-2">
                {(local || recoveryDraft.audioStoragePath) && (
                  <Button
                    variant="outline"
                    disabled={isProcessing}
                    onClick={() => (local ? downloadLocalAudio(local.blob, local.mimeType) : void downloadStoredAudio(recoveryDraft))}
                  >
                    Baixar cópia do áudio
                  </Button>
                )}
                <Button variant="outline" disabled={!onOpenPatientWork} onClick={() => onOpenPatientWork?.(true)}>
                  Escrever evolução
                </Button>
                <Button variant="ghost" disabled={isProcessing} onClick={() => void discardSavedDraft(recoveryDraft)}>
                  Excluir rascunho
                </Button>
              </div>
            </div>
          );
        })()}

        {recoveryDraft && recoveryDraft.patientId === patient.id && tooLarge[recoveryDraft.id] === undefined && (() => {
          const parkedHere = rescued.some((entry) => entry.id === recoveryDraft.id);
          const hasLocal = parkedHere || localAudioRef.current.has(recoveryDraft.id);
          return (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm space-y-2">
            <p>
              {parkedHere
                ? 'O áudio desta consulta não chegou ao servidor e está guardado neste navegador. Reenvie quando a conexão voltar.'
                : hasLocal
                ? 'O áudio desta consulta não chegou ao servidor e está guardado apenas nesta aba. Reenvie agora ou baixe uma cópia antes de fechar a aba.'
                : 'Há uma consulta preservada para este paciente. Retome a revisão ou tente processar o áudio novamente.'}
            </p>
            <Button
              variant="outline"
              disabled={
                isProcessing ||
                (!recoveryDraft.audioStoragePath &&
                  recoveryDraft.status !== 'review' &&
                  !hasLocal)
              }
              onClick={() => void recoverConsultation(recoveryDraft)}
            >
              {recoveryDraft.status === 'review'
                ? 'Retomar revisão'
                : hasLocal
                  ? 'Reenviar áudio'
                  : 'Recuperar consulta'}
            </Button>
            {hasLocal && (
              <Button
                variant="outline"
                disabled={isProcessing}
                onClick={() => {
                  const parkedCopy = rescued.find((entry) => entry.id === recoveryDraft.id);
                  const local = localAudioRef.current.get(recoveryDraft.id) ?? parkedCopy;
                  if (local) downloadLocalAudio(local.blob, local.mimeType);
                }}
              >
                Baixar cópia do áudio
              </Button>
            )}
            <input
              ref={recoveryInputRef}
              type="file"
              accept="audio/webm,audio/mp4,audio/ogg,.webm,.m4a,.ogg"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file)
                  void processConsultation(
                    file,
                    file.type || recoveryDraft.audioMimeType,
                    recoveryDraft.originalComments,
                    { ...recoveryDraft, audioStoragePath: null },
                  );
              }}
            />
            <Button variant="outline" disabled={isProcessing} onClick={() => recoveryInputRef.current?.click()}>
              Enviar áudio salvo
            </Button>
            <Button variant="ghost" disabled={isProcessing} onClick={() => void discardSavedDraft(recoveryDraft)}>
              Excluir rascunho
            </Button>
          </div>
          );
        })()}

        {conversationLoading && <p role="status" className="text-sm text-muted-foreground">Recuperando conversa salva…</p>}
        {conversationError && <div role="alert" className="text-sm text-destructive">Não foi possível recuperar a conversa salva. As mensagens não foram apagadas. <button type="button" className="underline" onClick={onRetryConversation}>Tentar novamente</button></div>}
        {onLoadOlderMessages && <Button variant="outline" size="sm" disabled={loadingOlderMessages} onClick={onLoadOlderMessages}>Carregar mensagens anteriores</Button>}
        {/* First step: what happened last time, in a neutral card. */}
        {showBriefing && (
          <section aria-label="Antes da consulta" className="rounded-lg border border-border/70 bg-muted/30 py-3 px-4 animate-fade-in-up">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <h3 className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                  {lastVisitDate
                    ? `Última consulta: ${formatVisitDate(lastVisitDate)}${lastConsultation?.chief_complaint?.trim() ? ` — ${lastConsultation.chief_complaint.trim()}` : ''}`
                    : 'Nenhuma consulta anterior registrada'}
                </h3>
                {(lastConsultation?.soap_note || (!briefingRequested && onRetryBriefing && lastVisitDate)) && (
                  <div className="flex flex-wrap gap-2">
                    {lastConsultation?.soap_note && (
                      <Button variant="outline" size="sm" aria-expanded={lastNoteOpen} onClick={() => setLastNoteOpen((open) => !open)}>
                        {lastNoteOpen ? 'Ocultar evolução' : 'Ver evolução'}
                      </Button>
                    )}
                    {!briefingRequested && onRetryBriefing && lastVisitDate && (
                      <Button variant="outline" size="sm" onClick={onRetryBriefing}>
                        Resumir com IA
                      </Button>
                    )}
                  </div>
                )}
                {lastNoteOpen && lastConsultation?.soap_note && (
                  <div className="rounded-md border border-border/60 bg-card p-3 text-sm">
                    <SoapNoteView text={lastConsultation.soap_note} />
                  </div>
                )}

                {briefingLoading ? (
                  <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Gerando resumo com IA...
                  </div>
                ) : briefingError ? (
                  <div role="alert" className="space-y-2 text-sm text-destructive">
                    <p>
                      Não foi possível gerar o resumo. O histórico pode estar temporariamente indisponível.
                    </p>
                    {onRetryBriefing && (
                      <Button variant="outline" size="sm" onClick={onRetryBriefing}>
                        Tentar novamente
                      </Button>
                    )}
                  </div>
                ) : activeBriefing?.returnInfo ? (
                  <div className="space-y-2">
                    <ul className="space-y-1.5 text-xs text-foreground/80 list-disc pl-4">
                      <li>{activeBriefing.returnInfo}</li>
                      <li>{activeBriefing.previousComplaint}</li>
                      {activeBriefing.pending && <li>{activeBriefing.pending}</li>}
                    </ul>
                    {activeBriefing.alert && (
                      <p className="flex items-start gap-1.5 border-t border-destructive/20 pt-1.5 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-destructive mt-0.5" />
                        <span className="text-destructive font-medium leading-snug">{activeBriefing.alert}</span>
                      </p>
                    )}

                    {briefingExpanded && activeBriefing.details && (
                      <dl className="pt-2 border-t border-border/30 space-y-2 text-xs text-foreground/80">
                        {(
                          [
                            ['Última consulta', activeBriefing.details.lastConsultationDate],
                            ['Queixa principal', activeBriefing.details.mainComplaint],
                            ['Conduta anterior', activeBriefing.details.previousConduct],
                            ['Evolução', activeBriefing.details.evolution],
                          ] as const
                        )
                          .filter(([, value]) => !!value)
                          .map(([label, value]) => (
                            <div key={label} className="flex flex-col gap-0.5">
                              <dt className="font-semibold text-foreground/70">{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                      </dl>
                    )}

                    {activeBriefing.details && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setBriefingExpanded(!briefingExpanded)}
                        className="h-7 px-2 text-xs text-medical-blue hover:text-medical-blue-dark"
                      >
                        {briefingExpanded ? 'Ver menos' : 'Ver mais detalhes'}
                      </Button>
                    )}
                  </div>
                ) : briefingRequested ? (
                  <p className="text-xs text-muted-foreground">Nenhuma consulta anterior disponível para resumir.</p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ocultar resumo da última consulta"
                onClick={() => setShowBriefing(false)}
                className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </section>
        )}

        {/* Pre-consult question checklist — from history + chief complaint */}
        <QuestionChecklistCard
          key={checklistSourceKey}
          questions={checklistQuestions}
          isLoading={checklistLoading}
          error={checklistError}
          onRefresh={() => void runChecklist()}
        />

        {/* Messages */}
        <div
          role="log"
          aria-label="Conversa clínica deste paciente"
          aria-live="polite"
          aria-relevant="additions"
          className="space-y-4"
        >
          {(() => {
            const lastSoapIdx = messages.reduce((acc, m, i) => (m.type === 'soap' ? i : acc), -1);
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
                {message.type === 'comment-proposal' && message.commentProposal ? (
                  <CommentProposalCard
                    {...message.commentProposal}
                    onStatusChange={(status, summary) =>
                      onMessagesChange((prev) =>
                        prev.map((item) =>
                          item.id === message.id && item.commentProposal
                            ? { ...item, commentProposal: { ...item.commentProposal, status, summary } }
                            : item,
                        ),
                      )
                    }
                    onRevisionRefreshed={(revision) =>
                      onMessagesChange((prev) =>
                        prev.map((item) =>
                          item.id === message.id && item.commentProposal
                            ? { ...item, commentProposal: { ...item.commentProposal, expectedRevision: revision } }
                            : item,
                        ),
                      )
                    }
                    onApplied={(summary) => {
                      for (const key of [
                        ['patients', userId],
                        ['patient-detail'],
                        ['patient-clinical-notes'],
                        ['patient-consultations'],
                      ])
                        queryClient.invalidateQueries({ queryKey: key });
                      toast({ title: 'Prontuário atualizado', description: summary });
                    }}
                  />
                ) : message.type === 'profile-update' ? (
                  <ProfileUpdateCard
                    initial={message.profileUpdates!}
                    existing={{
                      diagnoses: patient?.diagnoses ?? [],
                      medications: patient?.medications ?? [],
                      allergies: patient?.allergies ?? [],
                    }}
                    missingFields={getMissingFields()}
                    onAccept={handleProfileAccept}
                    onDismiss={() => {}}
                  />
                ) : message.type === 'user' ? (
                  <div className="flex max-w-[88%] flex-col items-end gap-1 md:max-w-[75%]">
                    <div
                      className={cn(
                        'bg-medical-blue text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 text-sm',
                        failedQuestions[message.id] !== undefined && 'opacity-70',
                      )}
                    >
                      {message.content}
                    </div>
                    {failedQuestions[message.id] !== undefined && (
                      <p className="flex flex-wrap items-center justify-end gap-x-1 text-xs text-destructive">
                        Não enviada ·
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto min-h-11 px-1 text-xs text-destructive sm:min-h-0"
                          disabled={isChatLoading}
                          onClick={() => void retryQuestion(message.id)}
                        >
                          Tentar novamente
                        </Button>
                      </p>
                    )}
                  </div>
                ) : message.type === 'assistant' ? (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Brain className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 max-w-[88%] md:max-w-[85%] rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3">
                      <p className="text-[0.6875rem] font-semibold text-muted-foreground mb-1">{message.title}</p>
                      <ClinicalAnswer message={message} userId={userId} />
                    </div>
                  </div>
                ) : (
                  <>
                    {message.type === 'soap' && (
                      <div className="absolute top-3 right-3 flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Exportar evolução em PDF"
                          className="h-7 w-7 text-muted-foreground hover:text-muted-foreground"
                          onClick={() => handlePrintSOAP(message.content)}
                          title="Exportar PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        {editingId === message.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Cancelar edição da evolução"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            disabled={savingEdit}
                            onClick={cancelEdit}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={editingId === message.id ? 'Salvar edição da evolução' : 'Editar evolução'}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          disabled={editingId === message.id && savingEdit}
                          onClick={() => {
                            if (editingId === message.id) {
                              void handleSaveEdit(message.id);
                            } else {
                              void beginEdit(message);
                            }
                          }}
                        >
                          {editingId === message.id ? (
                            savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-success" />
                          ) : (
                            <Pencil className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    )}

                    <div className="flex items-start gap-3 mb-3">
                      <div
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                          message.type === 'soap' && 'bg-medical-blue-light',
                          message.type === 'whatsapp' && 'bg-whatsapp-green/20',
                        )}
                      >
                        {message.type === 'soap' && <FileText className="w-4 h-4 text-medical-blue" />}
                        {message.type === 'whatsapp' && <MessageCircle className="w-4 h-4 text-whatsapp-green" />}
                      </div>
                      <div className="flex-1">
                        <h4
                          className={cn(
                            'font-semibold text-sm',
                            message.type === 'soap' ? 'text-medical-blue' : 'text-foreground',
                          )}
                        >
                          {message.title}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {message.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>

                    {message.type === 'soap' && editingId === message.id ? (
                      <textarea
                        aria-label="Editar evolução clínica"
                        value={editedContent}
                        readOnly={savingEdit}
                        onChange={(e) => setEditedContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="w-full min-h-[120px] md:min-h-[200px] text-sm leading-relaxed bg-muted/30 border border-border rounded-lg p-3 text-foreground/90 focus:outline-none focus:ring-2 focus:ring-medical-blue/30 resize-y"
                        autoFocus
                      />
                    ) : message.type === 'soap' ? (
                      <>
                        <SoapNoteView text={message.content} />
                        {message.consultationId && index === lastSoapIdx && (
                          <section aria-label="Pós-consulta" className="mt-3 pt-3 border-t border-border/30 space-y-3">
                            <h5 className="text-sm font-semibold">Pós-consulta</h5>
                            <p className="text-sm text-muted-foreground">Revise os documentos desta consulta. Registre orientações e retorno no acompanhamento do paciente.</p>
                            <div className="flex gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-auto min-h-11 max-w-full whitespace-normal"
                              onClick={() => handleGenerateDocument('patient_summary', message.content)}
                            >
                              <ClipboardList className="w-3.5 h-3.5" />
                              Resumo para Paciente
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-auto min-h-11 max-w-full whitespace-normal"
                              onClick={() => handleGenerateDocument('referral', message.content)}
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              Gerar Encaminhamento
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-xs h-auto min-h-11 max-w-full whitespace-normal"
                              disabled={generatingRx}
                              onClick={() => handleOpenComposer(message.consultationId)}
                            >
                              <FileSignature className="w-3.5 h-3.5" />
                              Receita / Atestado
                            </Button>
                            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-auto min-h-11 max-w-full whitespace-normal" disabled={!onOpenPatientWork} onClick={()=>onOpenPatientWork?.(false,'instruction')}>Registrar orientações</Button>
                            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-auto min-h-11 max-w-full whitespace-normal" disabled={!onOpenPatientWork} onClick={()=>onOpenPatientWork?.(false,'followup')}>Planejar retorno</Button>
                            </div>
                          </section>
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
                          {copiedId === message.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-success" />
                              Copiado!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copiar
                            </>
                          )}
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
                              : 'text-muted-foreground',
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
        </div>

        {/* Processing spinner */}
        {isProcessing && (
          <div role="status" className="soap-note rounded-lg p-5 animate-fade-in">
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
          <div
            role="status"
            aria-label="Assistente clínico preparando resposta"
            className="flex items-start gap-3 animate-fade-in"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3">
              <div className="flex gap-1 items-center h-4">
                {[0, 150, 300].map((delay) => (
                  <div
                    key={delay}
                    className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
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
          <div
            className={cn(
              'border rounded-lg p-3 animate-fade-in',
              stopConfirming
                ? 'bg-amber-500/10 border-amber-500/40'
                : isPaused
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-record-red/10 border-record-red/30',
            )}
          >
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
                          <div
                            key={i}
                            className="w-1 rounded-full bg-record-red transition-all duration-100"
                            style={{ height: `${Math.max(20, audioLevel * mult * 100)}%` }}
                          />
                        ))}
                      </div>
                    )}
                    <span className={cn('text-sm font-semibold', isPaused ? 'text-amber-500' : 'text-record-red')}>
                      {isPaused ? 'Gravação pausada' : `Gravando... ${formatTimer(recordingSeconds)}`}
                    </span>
                    {recording.mode === 'online' && (
                      <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 shrink-0">
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
                    {isPaused ? (
                      <>
                        <Play className="w-4 h-4" />
                        Retomar
                      </>
                    ) : (
                      <>
                        <Pause className="w-4 h-4" />
                        Pausar
                      </>
                    )}
                  </Button>
                </div>
                {(recording.recordedBytes ?? 0) >= RECORDING_WARN_BYTES ? (
                  <p role="alert" className="text-xs font-medium text-destructive leading-snug">
                    {(() => {
                      const bytes = recording.recordedBytes;
                      const perSecond = recordingSeconds > 0 ? bytes / recordingSeconds : 0;
                      const minutes = perSecond > 0 ? Math.max(1, Math.floor((RECORDING_STOP_BYTES - bytes) / perSecond / 60)) : null;
                      return `Gravação perto do limite de tamanho${minutes ? ` (cerca de ${minutes} min restantes)` : ''}. Finalize a consulta em breve; no limite, a gravação para sozinha e o áudio é guardado.`;
                    })()}
                  </p>
                ) : (
                  <p className="text-[0.6875rem] text-muted-foreground leading-snug">
                    Use o modo <span className="font-semibold text-foreground/80">Comentário</span> abaixo para adicionar
                    notas que ajudarão a IA a transcrever melhor.
                  </p>
                )}
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
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <div className="inline-flex min-w-0 p-0.5 rounded-lg bg-muted/60 border border-border/40">
              <button
                type="button"
                aria-pressed={inputMode === 'question'}
                onClick={() => setInputMode('question')}
                className={cn(
                  'flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all',
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
                aria-pressed={inputMode === 'comment'}
                onClick={() => setInputMode('comment')}
                className={cn(
                  'flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  inputMode === 'comment'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <StickyNote className="w-3.5 h-3.5" />
                Comentário
              </button>
            </div>
            <span className="text-[0.625rem] text-muted-foreground ml-2 hidden md:inline flex-1 min-w-0 truncate">
              {inputMode === 'question'
                ? 'pergunte sobre o histórico, conduta, interações…'
                : isRecording
                  ? 'será incluído no contexto da transcrição'
                  : 'atualiza perfil, adendo da consulta de hoje ou anotação'}
            </span>
            <UsageMeter variant="inline" className="ml-auto shrink-0" />
          </div>

          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:flex items-center gap-2">
            <input
              ref={attachInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif"
              className="hidden"
              onChange={handleAttachSelected}
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground h-9 w-9"
              title="Anexar documento ou imagem do paciente"
              aria-label="Anexar documento ou imagem do paciente"
              onClick={() => attachInputRef.current?.click()}
              disabled={attachingFile}
            >
              {attachingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
            </Button>
            <div className="col-span-3 order-first sm:order-none flex-1 min-w-0 relative">
              <input
                type="text"
                aria-label={
                  inputMode === 'question' ? 'Pergunta ao assistente clínico' : 'Comentário clínico para este paciente'
                }
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
                placeholder={inputMode === 'question' ? 'Faça uma pergunta' : 'Comentário clínico'}
                title={
                  inputMode === 'question'
                    ? 'Pergunte ao assistente — o que conversamos na última consulta?'
                    : isRecording
                      ? 'Comentário para a transcrição — ex: "paciente referiu dor irradiando"'
                      : 'Comentário — ex: "alérgico a penicilina", "iniciar Losartana 50mg", "solicitar hemograma"'
                }
                className={cn(
                  'w-full h-10 px-4 rounded-xl border-0 text-sm focus:outline-none focus:ring-2 transition-all placeholder:text-muted-foreground',
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
                'h-9 w-9 justify-self-end',
                inputMode === 'question'
                  ? 'text-muted-foreground hover:text-medical-blue'
                  : 'text-muted-foreground hover:text-amber-600',
              )}
              onClick={handleSubmit}
              aria-label={inputMode === 'question' ? 'Enviar pergunta' : 'Adicionar comentário'}
              disabled={!inputValue.trim() || isChatLoading || savingNote}
              title={inputMode === 'question' ? 'Enviar pergunta' : 'Adicionar comentário'}
            >
              {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
            <Button
              variant={isRecording ? 'destructive' : 'record'}
              size="icon-lg"
              className="rounded-full h-10 w-10 gap-2 sm:h-12 sm:w-auto sm:px-5"
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              aria-label={isRecording ? 'Finalizar gravação' : 'Gravar consulta'}
              disabled={
                recording.isStarting ||
                recording.isStopping ||
                isProcessing ||
                !!reviewData ||
                !!recoveryDraft ||
                isGeneratingFinal ||
                draftLoading ||
                draftLoadError
              }
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
              <span className="hidden sm:inline text-sm font-semibold">{isRecording ? 'Finalizar gravação' : 'Gravar consulta'}</span>
            </Button>
          </div>
        </div>
        {(isProcessing || isChatLoading) && (
          <p className="text-[0.625rem] sm:text-xs text-muted-foreground text-center">
            {isProcessing ? 'Processando consulta, aguarde...' : 'Assistente clínico pensando...'}
          </p>
        )}
      </div>

      <ConsultationReviewModal
        open={!!reviewData && reviewData.patientId === patient.id}
        patientName={patient?.name ?? ''}
        transcription={reviewData?.transcription ?? ''}
        soapDraft={reviewData?.soapDraft ?? ''}
        clarifications={reviewData?.clarifications ?? []}
        transcriptionQuality={reviewData?.transcriptionQuality ?? 'good'}
        differentialDiagnoses={reviewData?.differentialDiagnoses ?? []}
        drugInteractionAlerts={reviewData?.drugInteractionAlerts ?? []}
        onConfirm={handleReviewConfirm}
        onCancel={handleReviewCancel}
        initialComments={reviewData?.pendingComments ?? ''}
        isGenerating={isGeneratingFinal}
      />

      <RecordingModeDialog open={modeDialogOpen} onOpenChange={setModeDialogOpen} onSelect={handleModeSelected} />

      {patient && (
        <DocumentComposerModal
          open={composerOpen && composerPatientIdRef.current === patient.id}
          onOpenChange={setComposerOpen}
          patient={patient}
          onGenerate={handleComposerGenerate}
          isGenerating={generatingRx}
          signing={signatureSession?.available && signatureSession.configured ? { active: signatureSession.active } : null}
        />
      )}

      <DocumentPreviewModal
        open={!!documentModal && documentModal.patientId === patient.id}
        onClose={() => setDocumentModal(null)}
        type={documentModal?.type ?? 'patient_summary'}
        content={documentModal?.content ?? ''}
        isLoading={documentModal?.isLoading ?? false}
        patientName={documentModal?.patientName ?? ''}
      />
    </div>
  );
}
