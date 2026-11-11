import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import {
  checkQuota,
  recordUsage,
  creditsFromUsage,
  quotaResponse,
  QuotaExceededError,
  settleFailedCall,
  transcriptionReservationCredits,
} from '../_shared/quota.ts';
import { assertOpenAiEnabled, callClinicalText, transcribeClinicalAudio } from '../_shared/clinicalAi.ts';
import {
  buildPatientSummary,
  parseModelObject,
  assertGeminiTextBudget,
  collapseBlankLines,
} from '../_shared/gemini.ts';
import { assertAudioPath } from '../_shared/storage.ts';
import { AI_UNAVAILABLE_MESSAGE, readJsonObject, RequestError } from '../_shared/http.ts';
import { isRecord } from '../_shared/modelInput.ts';
import { getSpecialtyPrompt, buildCustomTemplatePrompt } from '../_shared/specialty_prompts.ts';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  Vary: 'Origin',
};

// ── Time budget ───────────────────────────────────────────────────────────────
// The platform cuts a request that sends no response for about 150 s (to be confirmed live). The
// whole call stays under REQUEST_BUDGET_MS; when the transcript leaves too little time for the
// note, the transcript is returned (already checkpointed) and the client asks for the note in a
// second call with `noteOnly: true`.
const REQUEST_BUDGET_MS = 140_000;
const NOTE_MIN_MS = 60_000; // a 6,000-token note needs about a minute
const RESPONSE_MARGIN_MS = 5_000;
/** Upload and transcription time grow with the file: 30 s plus 5 s per MB (estimate, unmeasured). */
const transcriptionDeadlineMs = (bytes: number) => 30_000 + Math.ceil(bytes / (1024 * 1024)) * 5_000;

// ── Prompts ───────────────────────────────────────────────────────────────────

const SPEAKER_NOTICE = 'A gravação não separa as vozes: a IA identificou médico e paciente pelo contexto da conversa. Confira a evolução antes de salvar.';
const DEFERRED_NOTICE = 'A gravação é longa: a transcrição foi salva e a evolução é gerada em uma segunda etapa.';

// SOAP_SYSTEM is now specialty-aware — resolved per request via getSpecialtyPrompt().

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    soap_note: { type: 'string' },
    whatsapp_message: { type: 'string' },
    clarifications: { type: 'array', items: { type: 'string' } },
    transcription_quality: { type: 'string', enum: ['good', 'partial', 'poor'] },
    differential_diagnoses: { type: 'array', items: { type: 'string' } },
    drug_interaction_alerts: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'soap_note',
    'whatsapp_message',
    'clarifications',
    'transcription_quality',
    'differential_diagnoses',
    'drug_interaction_alerts',
  ],
};
interface DraftGeneration {
  soap_note: string;
  whatsapp_message: string;
  clarifications: string[];
  transcription_quality: 'good' | 'partial' | 'poor';
  differential_diagnoses: string[];
  drug_interaction_alerts: string[];
}
interface Recovery extends Record<string, unknown> {
  transcription: string;
  soapDraft: string;
  whatsappDraft: string;
  clarifications: string[];
  transcriptionQuality: 'good' | 'partial' | 'poor';
  aiMetadata: Record<string, unknown>;
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  const startedAt = Date.now();
  const remainingMs = () => REQUEST_BUDGET_MS - (Date.now() - startedAt);

  try {
    const { userId } = await requireUser(req);
    // AI availability first: nothing else may fail differently while it is switched off.
    assertOpenAiEnabled();
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) throw new RequestError(AI_UNAVAILABLE_MESSAGE, 503);
    const {
      patientId,
      draftId,
      chiefComplaint,
      audioStoragePath,
      audioMimeType,
      consultationComments,
      userSpecialty,
      templateContent,
      noteOnly,
    } = await readJsonObject(req);

    if (
      typeof patientId !== 'string' ||
      typeof draftId !== 'string' ||
      typeof audioStoragePath !== 'string' ||
      (noteOnly !== undefined && typeof noteOnly !== 'boolean') ||
      (chiefComplaint !== undefined && typeof chiefComplaint !== 'string') ||
      (consultationComments !== undefined &&
        (!Array.isArray(consultationComments) || !consultationComments.every((value) => typeof value === 'string')))
    ) {
      return new Response(JSON.stringify({ error: 'patientId e audioStoragePath são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role download bypasses storage RLS — enforce the per-user
    // path prefix here so no one can read (and then delete) another user's audio.
    try {
      assertAudioPath(audioStoragePath, userId);
    } catch {
      return new Response(JSON.stringify({ error: 'audioStoragePath inválido' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // A template the note cannot use is refused before any paid work, not after the transcript.
    const specialtyInstruction =
      typeof templateContent === 'string' && templateContent.trim()
        ? buildCustomTemplatePrompt(templateContent)
        : getSpecialtyPrompt(userSpecialty);

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // Verify the patient belongs to the authenticated user.
    const { data: ownedPatient } = await supabase
      .from('patients')
      .select('id,name,age,date_of_birth,diagnoses,medications,allergies,medical_history')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!ownedPatient) {
      return new Response(JSON.stringify({ error: 'Paciente não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Background for a returning patient: the last recorded visit. Best effort; a failed read
    // only removes context, it never blocks the transcription.
    const { data: lastConsultation } = await supabase
      .from('consultations')
      .select('created_at,chief_complaint,soap_note')
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: draft } = await supabase
      .from('consultation_drafts')
      .select('id,audio_storage_path,content,updated_at,chief_complaint')
      .eq('id', draftId)
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!draft) throw new RequestError('Rascunho não encontrado. Salve o áudio antes de processar.', 404);
    if (draft.audio_storage_path !== audioStoragePath)
      throw new RequestError('O áudio não pertence a este rascunho.', 403);

    const priorContent = isRecord(draft.content) ? draft.content : {};
    const priorMetadata = isRecord(priorContent.aiMetadata) ? priorContent.aiMetadata : {};
    const originalComments = Array.isArray(priorContent.originalComments)
      ? priorContent.originalComments.filter((comment): comment is string => typeof comment === 'string')
      : consultationComments ?? [];
    const currentComplaint = typeof draft.chief_complaint === 'string' ? draft.chief_complaint : chiefComplaint;
    const priorTranscription = typeof priorContent.transcription === 'string' && priorContent.transcription.trim()
      ? priorContent.transcription
      : '';
    let draftRevision: string | null = typeof draft.updated_at === 'string' ? draft.updated_at : null;

    let transcription: string;
    let freshTranscription: string;
    let transcriptionMetadata: unknown;
    let recovery: Recovery;
    let settleTranscription: (() => Promise<void>) | undefined;
    let checkpointed = false;
    if (noteOnly === true) {
      // Second step of a long recording: the transcript checkpoint is the source; no audio is sent again.
      if (!priorTranscription)
        throw new RequestError('Ainda não há transcrição salva para esta gravação. Processe o áudio primeiro.', 409);
      transcription = priorTranscription;
      freshTranscription = priorTranscription;
      transcriptionMetadata = priorMetadata.transcription;
      recovery = {
        ...priorContent,
        transcription,
        soapDraft: typeof priorContent.soapDraft === 'string' ? priorContent.soapDraft : '',
        whatsappDraft: typeof priorContent.whatsappDraft === 'string' ? priorContent.whatsappDraft : '',
        clarifications: [
          SPEAKER_NOTICE,
          'A transcrição foi preservada. Revise o conteúdo e escreva a evolução ou gere novamente com suas observações.',
        ],
        transcriptionQuality: 'partial',
        differentialDiagnoses: [],
        drugInteractionAlerts: [],
        originalComments,
        aiMetadata: priorMetadata,
      };
      checkpointed = true;
    } else {
      // Download from Storage
      const { data: audioBlob, error: downloadError } = await supabase.storage
        .from('audio-recordings')
        .download(audioStoragePath);

      if (downloadError || !audioBlob) {
        throw new RequestError('Não foi possível recuperar o áudio. Tente novamente.', 503);
      }
      if (!audioBlob.size || audioBlob.size > 25 * 1024 * 1024)
        throw new RequestError('Áudio vazio ou acima de 25 MB. O áudio continua salvo: registre a consulta manualmente.', 413);

      const mimeType = typeof audioMimeType === 'string' ? audioMimeType.split(';')[0] : 'audio/webm';
      if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'].includes(mimeType))
        throw new RequestError('Formato de áudio não suportado.');

      let transcriptionReservation: { reservationId: string };
      try {
        transcriptionReservation = await checkQuota(supabase, userId, transcriptionReservationCredits(audioBlob.size));
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
        throw err;
      }
      // The direct transcription request creates no remote Files API resource.
      // Source audio stays owned in Storage until the reviewed visit is saved.
      const deadline = Math.min(transcriptionDeadlineMs(audioBlob.size), remainingMs() - RESPONSE_MARGIN_MS);
      const transcribed = await transcribeClinicalAudio(apiKey, audioBlob, mimeType, { timeoutMs: deadline })
        .catch(async (error) => {
          await settleFailedCall(supabase, userId, transcriptionReservation.reservationId, error);
          throw error;
        });
      freshTranscription = transcribed.text.trim();
      transcriptionMetadata = transcribed.metadata;
      const preservingPriorTranscript = !freshTranscription && !!priorTranscription;
      transcription = freshTranscription || priorTranscription;
      recovery = {
        ...priorContent,
        transcription,
        soapDraft: typeof priorContent.soapDraft === 'string' ? priorContent.soapDraft : '',
        whatsappDraft: typeof priorContent.whatsappDraft === 'string' ? priorContent.whatsappDraft : '',
        clarifications: [
          preservingPriorTranscript
            ? 'A nova tentativa não forneceu identificação de falantes. A transcrição anterior permanece sem nova validação; confira quem disse cada informação.'
            : SPEAKER_NOTICE,
          preservingPriorTranscript
            ? 'A nova tentativa não reconheceu fala. A transcrição anterior foi mantida. Confira a gravação e revise o texto antes de usá-lo; nenhuma nova evolução foi gerada.'
            : freshTranscription
              ? 'A transcrição foi preservada. Revise o conteúdo e escreva a evolução ou gere novamente com suas observações.'
              : 'Não foi reconhecida fala nesta gravação. Ouça o áudio preservado e registre a consulta manualmente ou grave novamente.',
        ],
        transcriptionQuality: transcription ? 'partial' as const : 'poor' as const,
        differentialDiagnoses: [] as string[],
        drugInteractionAlerts: [] as string[],
        originalComments,
        audioMimeType: mimeType,
        aiMetadata: {
          ...priorMetadata,
          // An empty retry is not the source of the previously stored words.
          ...(preservingPriorTranscript ? {} : { transcription: transcribed.metadata }),
          latestTranscriptionAttempt: { ...transcribed.metadata, outcome: freshTranscription ? 'transcribed' : 'empty' },
        },
      };
      // Settled only after the checkpoint below, before quota, prompt validation or second inference.
      settleTranscription = () =>
        recordUsage(supabase, userId, creditsFromUsage(transcribed.usage), transcriptionReservation.reservationId);
    }

    const saveDraft = async (content: Record<string, unknown>) => {
      if (!draftRevision) throw new RequestError('Versão do rascunho indisponível. O áudio foi preservado.', 503);
      const revisionMs = Date.parse(draftRevision);
      if (!Number.isFinite(revisionMs)) throw new RequestError('Versão do rascunho inválida. O áudio foi preservado.', 503);
      // Even two fast writes in the same millisecond must advance the token.
      const nextRevision = new Date(Math.max(Date.now(), revisionMs + 1)).toISOString();
      const { data, error } = await supabase
        .from('consultation_drafts')
        .update({ content, status: 'review', updated_at: nextRevision })
        .eq('id', draftId)
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .eq('audio_storage_path', audioStoragePath)
        .eq('updated_at', draftRevision)
        .select('id,updated_at')
        .maybeSingle();
      if (error || !data || typeof data.updated_at !== 'string')
        throw new RequestError('Não foi possível salvar o rascunho. O áudio foi preservado.', 503);
      draftRevision = data.updated_at;
    };
    const recoveryResponse = (persistenceFailed = false, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({
      transcription,
      soapNote: recovery.soapDraft,
      whatsappMessage: recovery.whatsappDraft,
      clarifications: [
        ...recovery.clarifications,
        ...(persistenceFailed ? ['Não foi possível confirmar o salvamento desta versão da transcrição. Copie o texto antes de sair e confira o rascunho atual antes de salvar novamente. O áudio original permanece salvo.'] : []),
        ...(extra.noteDeferred ? [DEFERRED_NOTICE] : []),
      ],
      transcriptionQuality: recovery.transcriptionQuality,
      differentialDiagnoses: [],
      drugInteractionAlerts: [],
      draftFailed: true,
      draftPersisted: !persistenceFailed,
      draftUpdatedAt: persistenceFailed ? null : draftRevision,
      aiMetadata: recovery.aiMetadata,
      ...(persistenceFailed ? { draftPersistenceFailed: true } : {}),
      ...extra,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (!checkpointed) {
      // An interrupted or failed SOAP request can never erase the literal text.
      try { await saveDraft(recovery); }
      catch { return recoveryResponse(true); }
      try {
        await settleTranscription!();
      } catch {
        return recoveryResponse();
      }
    }
    // A retained transcript is recovery data, not a successful new STT result.
    if (!freshTranscription) return recoveryResponse();
    // Not enough time left for the note in this call: the transcript is saved; the client asks again.
    if (remainingMs() < NOTE_MIN_MS) return recoveryResponse(false, { noteDeferred: true });

    let draftReservation: { reservationId: string } | undefined;
    try {
      const patientSummary = buildPatientSummary(ownedPatient, currentComplaint, { lastConsultation }, { includeName: true });
      const commentsText =
        originalComments.length > 0
          ? `\n\nObservações do médico durante a consulta:\n${originalComments.join('\n')}`
          : '';

      const draftParts = [
        {
          text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${currentComplaint || 'acompanhamento de rotina'}${commentsText}`,
        },
      ];
      const instruction = `${specialtyInstruction}\n\nNão invente diálogo, exame, diagnóstico, conduta ou consentimento. Escreva sempre a evolução com o que a transcrição sustenta; o que faltar vai em clarifications, não em ressalvas dentro do texto.`;
      assertGeminiTextBudget(draftParts, instruction);
      draftReservation = await checkQuota(supabase, userId, 100);
      const reservation = draftReservation;
      const drafted = await callClinicalText(apiKey, draftParts, {
        systemInstruction: instruction,
        maxOutputTokens: 6000,
        responseSchema: DRAFT_SCHEMA,
        timeoutMs: Math.min(90_000, remainingMs() - RESPONSE_MARGIN_MS),
      }).catch(async (error) => {
        await settleFailedCall(supabase, userId, reservation.reservationId, error);
        throw error;
      });
      await recordUsage(supabase, userId, creditsFromUsage(drafted.usage), draftReservation.reservationId);
      const parsed = parseModelObject<DraftGeneration>(drafted.text, DRAFT_SCHEMA);
      const soapNote = collapseBlankLines(parsed.soap_note);
      const whatsappMessage = collapseBlankLines(parsed.whatsapp_message);
      const clarifications = [SPEAKER_NOTICE, ...parsed.clarifications];
      const transcriptionQuality = parsed.transcription_quality;
      const differentialDiagnoses = parsed.differential_diagnoses;
      const drugInteractionAlerts = parsed.drug_interaction_alerts;
      if (!soapNote.trim()) return recoveryResponse();
      const result = {
        ...recovery,
        transcription,
        soapDraft: soapNote,
        whatsappDraft: whatsappMessage,
        clarifications,
        transcriptionQuality,
        differentialDiagnoses,
        drugInteractionAlerts,
        aiMetadata: { transcription: transcriptionMetadata, draft: drafted.metadata },
      };
      try { await saveDraft(result); }
      catch { return recoveryResponse(true); }

      return new Response(
        JSON.stringify({
          transcription,
          soapNote,
          whatsappMessage,
          clarifications,
          transcriptionQuality,
          differentialDiagnoses,
          drugInteractionAlerts,
          draftPersisted: true,
          draftUpdatedAt: draftRevision,
          aiMetadata: result.aiMetadata,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      // The transcript is safe; say why the note is missing when the reason is one the doctor can act on.
      const draftNotice = error instanceof QuotaExceededError || error instanceof RequestError ? error.message : undefined;
      return recoveryResponse(false, draftNotice ? { draftNotice } : {});
    }
  } catch (error) {
    if (error instanceof RequestError)
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    if (error instanceof QuotaExceededError) return quotaResponse(error, corsHeaders);
    console.error('transcribe-consultation failed');
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
