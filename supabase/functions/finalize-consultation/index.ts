import { assertOpenAiEnabled, callClinicalText } from '../_shared/clinicalAi.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError, settleFailedCall } from '../_shared/quota.ts';
import {
  buildPatientSummary,
  parseModelObject,
  assertGeminiTextBudget,
  collapseBlankLines,
} from '../_shared/gemini.ts';
import { assertAudioPath } from '../_shared/storage.ts';
import { AI_UNAVAILABLE_MESSAGE, readJsonObject, RequestError } from '../_shared/http.ts';
import { getSpecialtyPrompt, buildCustomTemplatePrompt } from '../_shared/specialty_prompts.ts';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';

const corsHeaders = {
  ...allowOriginHeader(),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  Vary: 'Origin',
};

// SOAP_SYSTEM resolved per request via getSpecialtyPrompt().

const EXTRACT_SYSTEM = `Você é um extrator de dados clínicos estruturados.
Analise a evolução SOAP fornecida e extraia APENAS informações explicitamente presentes no texto.
Não infira, não invente, não complete com conhecimento externo.
- diagnoses: somente diagnósticos explicitamente confirmados; nunca hipóteses/diferenciais, como descrições simples sem código CID
- medications: medicamentos INICIADOS ou com dose/posologia ALTERADA nesta consulta (seção P), com nome,
  dosagem e instruções de uso. NÃO repita um medicamento da lista "Medicações em uso no cadastro" que foi
  apenas mantido. Se a consulta alterar a dose de um medicamento do cadastro, use o nome exatamente como
  está no cadastro.
- allergies: alergias mencionadas em qualquer seção
- medications_stopped: somente nomes da lista "Medicações em uso no cadastro" que a evolução manda
  suspender, retirar ou substituir. Copie o nome exatamente como está na lista. Vazio se nenhuma.
  Uma medicação apenas não citada NÃO foi suspensa.
Retorne arrays vazios para campos sem informação no texto.`;

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    diagnoses: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' } },
        required: ['description'],
      },
    },
    medications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          dosage: { type: 'string' },
          instructions: { type: 'string' },
        },
        required: ['name', 'dosage', 'instructions'],
      },
    },
    allergies: { type: 'array', items: { type: 'string' } },
    medications_stopped: { type: 'array', items: { type: 'string' } },
  },
  required: ['diagnoses', 'medications', 'allergies', 'medications_stopped'],
};

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    soap_note: { type: 'string' },
    whatsapp_message: { type: 'string' },
  },
  required: ['soap_note', 'whatsapp_message'],
};
interface FinalGeneration {
  soap_note: string;
  whatsapp_message: string;
}
interface ProfileExtraction {
  diagnoses: Array<{ description: string }>;
  medications: Array<{ name: string; dosage: string; instructions: string }>;
  allergies: string[];
  medications_stopped: string[];
}
interface HistoryExtraction {
  medical_history: string[];
  social_anamnesis: string[];
}

// First-visit anamnesis extraction — populates the patient's history fields.
const HISTORY_SYSTEM = `Você é um assistente médico estruturando a anamnese de uma PRIMEIRA consulta.
A partir da evolução SOAP e da transcrição, extraia o histórico do paciente em DUAS listas de tópicos.
Extraia APENAS o que foi realmente dito. Não infira nem invente.

- medical_history (Histórico Médico): antecedentes pessoais patológicos, cirurgias, internações,
  doenças crônicas com ano/início quando mencionado, alergias com a reação, e antecedentes FAMILIARES.
- social_anamnesis (Anamnese Social): estado civil, com quem mora, profissão/ocupação, hábitos
  (tabagismo, etilismo, atividade física, alimentação, sono), e contexto de vida clinicamente relevante.

REGRAS:
- Cada item é um tópico curto e telegráfico (máximo ~15 palavras). UM fato por item.
- Não repita entre as duas listas. Não inclua a queixa/doença atual (isso é do SOAP).
- Retorne listas vazias se a informação não estiver presente.`;

const HISTORY_SCHEMA = {
  type: 'object',
  properties: {
    medical_history: { type: 'array', items: { type: 'string' } },
    social_anamnesis: { type: 'array', items: { type: 'string' } },
  },
  required: ['medical_history', 'social_anamnesis'],
};

/** The doctor-edited note is never cut: a cut note loses corrections the model must preserve. */
const MAX_REVIEWED_SOAP_CHARS = 30_000;
const PROFILE_NOTICE = 'As sugestões de atualização do cadastro (diagnósticos, medicações e alergias) desta consulta não foram geradas. Confira o cadastro manualmente.';
const HISTORY_NOTICE = 'As sugestões de história médica e anamnese social desta primeira consulta não foram geradas. Preencha esses campos manualmente.';
/** Why an optional post-save proposal is missing, in words the doctor can act on. */
function skippedNotice(base: string, error: unknown): string {
  if (error instanceof QuotaExceededError) return `${base} Motivo: limite diário de IA atingido.`;
  if (error instanceof RequestError && error.status === 503) return `${base} Motivo: IA indisponível no momento.`;
  return base;
}
const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const recordList = <T>(value: unknown): T[] =>
  Array.isArray(value) ? value.filter((item) => !!item && typeof item === 'object' && !Array.isArray(item)) as T[] : [];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const body = await readJsonObject(req);
    const { patientId, draftId, chiefComplaint, transcription, userSpecialty, templateContent } = body;

    if (
      typeof patientId !== 'string' ||
      typeof draftId !== 'string' ||
      typeof transcription !== 'string' ||
      (chiefComplaint !== undefined && typeof chiefComplaint !== 'string') ||
      (body.doctorComments !== undefined && typeof body.doctorComments !== 'string')
    ) {
      return new Response(JSON.stringify({ error: 'patientId e transcription são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Regeneration is AI work: its availability is checked before anything else can fail.
    // Saving a reviewed note (saveDirect) never depends on the AI.
    const regenerate = !body.saveDirect;
    if (regenerate) {
      assertOpenAiEnabled();
      if (!Deno.env.get('OPENAI_API_KEY')) throw new RequestError(AI_UNAVAILABLE_MESSAGE, 503);
      if (typeof body.reviewedSoap === 'string' && body.reviewedSoap.trim().length > MAX_REVIEWED_SOAP_CHARS)
        throw new RequestError(`A evolução editada tem mais de ${MAX_REVIEWED_SOAP_CHARS.toLocaleString('pt-BR')} caracteres e não pode ser enviada inteira à IA. Encurte o texto ou edite a evolução manualmente.`, 413);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // Ownership gate: the service-role client bypasses RLS, so verify the
    // patient belongs to the authenticated user before any write.
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

    const { data: priorSave } = await supabase
      .from('consultations')
      .select('id,soap_note,whatsapp_message,history_proposals,profile_proposals,chief_complaint,transcription')
      .eq('id', draftId)
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .maybeSingle();
    const { data: draft } = await supabase
      .from('consultation_drafts')
      .select('id,audio_storage_path,appointment_id,content')
      .eq('id', draftId)
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .maybeSingle();
    const cleanupSavedDraft = async () => {
      if (!draft) return;
      if (draft.audio_storage_path) {
        const { error } = await supabase.storage
          .from('audio-recordings')
          .remove([assertAudioPath(draft.audio_storage_path, userId)]);
        if (error) return; // retain the row/path for a retry instead of orphaning audio
      }
      await supabase.from('consultation_drafts').delete().eq('id', draftId).eq('user_id', userId);
    };
    const completeSavedMetadata = async () => {
      const { data, error } = await supabase.rpc('complete_consultation_metadata', {
        p_user_id: userId,
        p_patient_id: patientId,
        p_consultation_id: draftId,
      });
      if (error || data !== true)
        throw new RequestError(
          'A evolução foi salva, mas os dados da consulta ainda precisam ser concluídos. Tente novamente; seu rascunho foi mantido.',
          503,
        );
    };
    if (priorSave) {
      if (
        body.saveDirect !== true ||
        body.reviewed !== true ||
        body.soapNote !== priorSave.soap_note ||
        (body.whatsappMessage ?? '') !== (priorSave.whatsapp_message ?? '') ||
        transcription !== (priorSave.transcription ?? '') ||
        (chiefComplaint ?? '') !== (priorSave.chief_complaint ?? '')
      ) {
        throw new RequestError(
          'Esta consulta já foi registrada com outro conteúdo. Seu texto atual foi mantido para comparação; reabra o registro e use um adendo.',
          409,
        );
      }
      await completeSavedMetadata();
      await cleanupSavedDraft();
      // A retry after a lost response returns the proposals stored with the consultation.
      const stored = priorSave.profile_proposals && typeof priorSave.profile_proposals === 'object' ? priorSave.profile_proposals as Record<string, unknown> : {};
      return new Response(
        JSON.stringify({
          consultationId: priorSave.id,
          soapNote: priorSave.soap_note,
          whatsappMessage: priorSave.whatsapp_message,
          historyProposals: priorSave.history_proposals,
          profileUpdates: {
            diagnoses: recordList(stored.diagnoses),
            medications: recordList(stored.medications),
            allergies: textList(stored.allergies),
            medicationsStopped: textList(stored.medicationsStopped),
          },
          notices: textList(stored.notices),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!draft) throw new Error('Rascunho não encontrado. Reabra a consulta.');

    let soapNote: string;
    let whatsappMessage: string;

    if (body.saveDirect) {
      if (body.reviewed !== true) throw new Error('Revise e confirme a evolução antes de salvar.');
      // ── Path A: draft was already approved — save without paid generation ─
      soapNote = body.soapNote ?? '';
      whatsappMessage = body.whatsappMessage ?? '';
    } else {
      // ── Path B: incorporate doctor comments → re-generate final SOAP ──────
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

      const doctorComments: string = body.doctorComments ?? '';
      // Same record background as the first draft (the visit being saved is not stored yet).
      const { data: lastConsultation } = await supabase
        .from('consultations')
        .select('created_at,chief_complaint,soap_note')
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .neq('id', draftId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      // The name stays: the regenerated patient message addresses the patient.
      const patientSummary = buildPatientSummary(ownedPatient, chiefComplaint, { lastConsultation }, { includeName: true });
      const commentsSection = doctorComments.trim()
        ? `\n\nObservações do médico (incorpore obrigatoriamente no SOAP):\n${doctorComments.trim()}`
        : '';
      // The physician may have edited the draft directly before adding
      // comments. That text is authoritative: regenerate on top of it.
      const reviewedSoap =
        typeof body.reviewedSoap === 'string' ? body.reviewedSoap.trim() : '';
      const reviewedSection = reviewedSoap
        ? `\n\nRascunho já revisado e editado pelo médico (use como base; preserve TODAS as correções, doses e dados que o médico escreveu, alterando apenas o necessário para incorporar as observações abaixo):\n${reviewedSoap}`
        : '';

      const finalParts = [
        {
          text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${chiefComplaint || 'acompanhamento de rotina'}${reviewedSection}${commentsSection}`,
        },
      ];
      const instruction =
        typeof templateContent === 'string' && templateContent.trim()
          ? buildCustomTemplatePrompt(templateContent)
          : getSpecialtyPrompt(userSpecialty);
      assertGeminiTextBudget(finalParts, instruction);
      let finalReservation: { reservationId: string };
      try {
        assertOpenAiEnabled();
        finalReservation = await checkQuota(supabase, userId, 100);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
        throw err;
      }

      const reservationId = finalReservation.reservationId;
      // Same output room as the first draft: a regeneration rewrites a note of that size.
      const { text: finalRaw, usage: finalUsage } = await callClinicalText(OPENAI_API_KEY, finalParts, {
        systemInstruction: instruction,
        maxOutputTokens: 6000,
        responseSchema: FINAL_SCHEMA,
      }).catch(async (error) => {
        await settleFailedCall(supabase, userId, reservationId, error);
        throw error;
      });
      await recordUsage(supabase, userId, creditsFromUsage(finalUsage), finalReservation.reservationId);

      const parsed = parseModelObject<FinalGeneration>(finalRaw, FINAL_SCHEMA);
      {
        soapNote = parsed.soap_note ?? '';
        whatsappMessage = parsed.whatsapp_message ?? '';
      }
      soapNote = collapseBlankLines(soapNote);
      whatsappMessage = collapseBlankLines(whatsappMessage);
    }
    if (typeof soapNote !== 'string' || !soapNote.trim() || typeof whatsappMessage !== 'string')
      throw new Error('Evolução inválida ou vazia. Revise o rascunho.');
    if (!body.saveDirect) {
      // New generation is always shown to the clinician before it can be final.
      return new Response(JSON.stringify({ soapNote, whatsappMessage, previewOnly: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // First visit? Check for a prior consultation BEFORE inserting this one.
    // First-visit history can be proposed for a separate physician review.
    const { count: priorCount } = await supabase
      .from('consultations')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('user_id', userId);
    const isFirstVisit = (priorCount ?? 0) === 0;

    // ── Save to DB ────────────────────────────────────────────────────────────
    const { data: consultation, error: insertError } = await supabase
      .from('consultations')
      .insert([
        {
          id: draftId,
          patient_id: patientId,
          user_id: userId,
          appointment_id: draft.appointment_id ?? null,
          // Consent to recording, confirmed by the doctor before capture (null for manual notes).
          recording_consent: (() => {
            const consent = (draft.content as { recordingConsent?: unknown } | null)?.recordingConsent;
            return consent && typeof consent === 'object' ? consent : null;
          })(),
          chief_complaint: chiefComplaint,
          transcription,
          soap_note: soapNote,
          whatsapp_message: whatsappMessage,
        },
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    await completeSavedMetadata();

    // ── Best-effort profile extraction ───────────────────────────────────────
    let profileUpdates: {
      diagnoses: { description: string }[];
      medications: { name: string; dosage: string; instructions: string }[];
      allergies: string[];
      /** Names, as stored in the chart, of medications this visit stopped. A proposal like the rest. */
      medicationsStopped: string[];
    } = { diagnoses: [], medications: [], allergies: [], medicationsStopped: [] };

    // A skipped or failed proposal is reported, never silently replaced by "nothing to propose".
    const notices: string[] = [];
    const aiKey = () => {
      assertOpenAiEnabled();
      const key = Deno.env.get('OPENAI_API_KEY');
      if (!key) throw new RequestError(AI_UNAVAILABLE_MESSAGE, 503);
      return key;
    };
    try {
      {
        const OPENAI_API_KEY = aiKey();
        const currentMedications = (Array.isArray(ownedPatient.medications) ? ownedPatient.medications : [])
          .map((m: unknown) => (typeof m === 'string' ? m : m && typeof m === 'object' && typeof (m as { name?: unknown }).name === 'string' ? (m as { name: string }).name : ''))
          .map((name: string) => name.trim()).filter(Boolean);
        const extractText = `Medicações em uso no cadastro:\n${currentMedications.length ? currentMedications.map((n: string) => `- ${n}`).join('\n') : '(nenhuma)'}\n\nEvolução SOAP desta consulta:\n${soapNote}`;
        assertGeminiTextBudget([{ text: extractText }], EXTRACT_SYSTEM);
        // Gate the extraction on remaining budget too: the consultation itself is already saved,
        // and the saveDirect path skips the main quota check.
        const extractReservation = await checkQuota(supabase, userId, 15);
        const { text: extractRaw, usage: extractUsage } = await callClinicalText(OPENAI_API_KEY, [{ text: extractText }], {
          systemInstruction: EXTRACT_SYSTEM,
          maxOutputTokens: 2000,
          responseSchema: EXTRACT_SCHEMA,
        }).catch(async (error) => {
          await settleFailedCall(supabase, userId, extractReservation.reservationId, error);
          throw error;
        });
        await recordUsage(supabase, userId, creditsFromUsage(extractUsage), extractReservation.reservationId);
        const parsed = parseModelObject<ProfileExtraction>(extractRaw, EXTRACT_SCHEMA);
        const d = parsed.diagnoses.filter((x) => x.description.trim());
        const m = parsed.medications.filter((x) => x.name.trim());
        const a = parsed.allergies.filter((x) => x.trim());
        // Only names that are really in the chart, and never one the same visit prescribes or keeps.
        const kept = new Set(m.map((x) => x.name.trim().toLowerCase()));
        const stopped = currentMedications.filter((name: string) =>
          parsed.medications_stopped.some((x) => x.trim().toLowerCase() === name.toLowerCase()) && !kept.has(name.toLowerCase()));
        if (d.length || m.length || a.length || stopped.length) profileUpdates = { diagnoses: d, medications: m, allergies: a, medicationsStopped: stopped };
      }
    } catch (error) {
      // Non-critical: the consultation is saved; the doctor is told the proposals are missing.
      notices.push(skippedNotice(PROFILE_NOTICE, error));
    }

    // ── First-visit history proposals (never written automatically) ─────────
    // On the first consultation, build the Anamnese Social and Histórico Médico
    // as bullet lists and write them ONLY where the field is still empty, so a
    // manually-entered history is never overwritten.
    const historyFilled = false;
    const historyProposals = {
      sourceConsultationId: consultation.id,
      medicalHistory: [] as string[],
      socialAnamnesis: [] as string[],
    };
    if (isFirstVisit) {
      try {
        {
          const { data: existing, error: existingError } = await supabase
            .from('patients')
            .select('medical_history, social_anamnesis,revision')
            .eq('id', patientId)
            .eq('user_id', userId)
            .maybeSingle();
          if (existingError) throw existingError;

          const needMedical = !existing?.medical_history?.trim();
          const needSocial = !existing?.social_anamnesis?.trim();

          if (needMedical || needSocial) {
            const OPENAI_API_KEY = aiKey();
            const historyParts = [{ text: `Evolução SOAP:\n${soapNote}\n\nTranscrição:\n${transcription}` }];
            assertGeminiTextBudget(historyParts, HISTORY_SYSTEM);
            const historyReservation = await checkQuota(supabase, userId, 20);
            // Up to 60 short items: room for all of them instead of a truncation failure.
            const { text: histRaw, usage: histUsage } = await callClinicalText(OPENAI_API_KEY, historyParts, {
              systemInstruction: HISTORY_SYSTEM,
              maxOutputTokens: 2500,
              responseSchema: HISTORY_SCHEMA,
            }).catch(async (error) => {
              await settleFailedCall(supabase, userId, historyReservation.reservationId, error);
              throw error;
            });
            await recordUsage(supabase, userId, creditsFromUsage(histUsage), historyReservation.reservationId);

            const parsed = parseModelObject<HistoryExtraction>(histRaw, HISTORY_SCHEMA);
            // Suggestions remain separate from the durable chart until the doctor
            // accepts the exact text against the current patient revision.
            historyProposals.medicalHistory = needMedical
              ? parsed.medical_history.filter((value) => value.trim()).slice(0, 30)
              : [];
            historyProposals.socialAnamnesis = needSocial
              ? parsed.social_anamnesis.filter((value) => value.trim()).slice(0, 30)
              : [];
          }
        }
      } catch (error) {
        // Non-critical: the consultation is saved; the doctor is told the proposals are missing.
        notices.push(skippedNotice(HISTORY_NOTICE, error));
      }
    }

    // Proposals and notices are stored with the consultation, so a retry after a lost response
    // (the already-saved path above) returns them instead of empty lists.
    const hasHistory = historyProposals.medicalHistory.length > 0 || historyProposals.socialAnamnesis.length > 0;
    const hasProfile = profileUpdates.diagnoses.length + profileUpdates.medications.length +
      profileUpdates.allergies.length + profileUpdates.medicationsStopped.length > 0;
    if (hasHistory || hasProfile || notices.length) {
      const { error: proposalError } = await supabase
        .from('consultations')
        .update({
          ...(hasHistory ? { history_proposals: historyProposals } : {}),
          profile_proposals: { sourceConsultationId: consultation.id, ...profileUpdates, notices },
        })
        .eq('id', consultation.id)
        .eq('patient_id', patientId)
        .eq('user_id', userId);
      if (proposalError) throw new Error('Evolução salva; reabra para recuperar a revisão pendente.');
    }
    // Cleanup only follows a durable successful clinical save.
    await cleanupSavedDraft();
    return new Response(
      JSON.stringify({
        consultationId: consultation.id,
        soapNote,
        whatsappMessage,
        profileUpdates,
        isFirstVisit,
        historyFilled,
        historyProposals,
        notices,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    if (error instanceof RequestError)
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    if (error instanceof QuotaExceededError) return quotaResponse(error, corsHeaders);
    console.error('finalize-consultation failed');
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// No ALLOWED_ORIGIN secret means no Access-Control-Allow-Origin: browsers refuse the call instead
// of the function answering any origin (same rule as _shared/cors.ts).
function allowOriginHeader(): Record<string, string> {
  const origin = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim();
  return origin && origin !== '*' ? { 'Access-Control-Allow-Origin': origin } : {};
}
