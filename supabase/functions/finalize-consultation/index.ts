import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, buildPatientSummary, parseModelObject, assertGeminiTextBudget, collapseBlankLines } from "../_shared/gemini.ts";
import { assertAudioPath } from "../_shared/storage.ts";
import { readJsonObject, RequestError } from "../_shared/http.ts";
import { getSpecialtyPrompt, buildCustomTemplatePrompt } from "../_shared/specialty_prompts.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

// SOAP_SYSTEM resolved per request via getSpecialtyPrompt().

const EXTRACT_SYSTEM = `Você é um extrator de dados clínicos estruturados.
Analise a evolução SOAP fornecida e extraia APENAS informações explicitamente presentes no texto.
Não infira, não invente, não complete com conhecimento externo.
- diagnoses: somente diagnósticos explicitamente confirmados; nunca hipóteses/diferenciais, como descrições simples sem código CID
- medications: medicamentos prescritos/mantidos na seção P, com nome, dosagem e instruções de uso
- allergies: alergias mencionadas em qualquer seção
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
          name:         { type: 'string' },
          dosage:       { type: 'string' },
          instructions: { type: 'string' },
        },
        required: ['name', 'dosage', 'instructions'],
      },
    },
    allergies: { type: 'array', items: { type: 'string' } },
  },
  required: ['diagnoses', 'medications', 'allergies'],
};

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    soap_note:        { type: 'string' },
    whatsapp_message: { type: 'string' },
  },
  required: ['soap_note', 'whatsapp_message'],
};
interface FinalGeneration { soap_note: string; whatsapp_message: string }
interface ProfileExtraction {
  diagnoses: Array<{ description: string }>;
  medications: Array<{ name: string; dosage: string; instructions: string }>;
  allergies: string[];
}
interface HistoryExtraction { medical_history: string[]; social_anamnesis: string[] }

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
    medical_history:  { type: 'array', items: { type: 'string' } },
    social_anamnesis: { type: 'array', items: { type: 'string' } },
  },
  required: ['medical_history', 'social_anamnesis'],
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const body = await readJsonObject(req);
    const { patientId, draftId, chiefComplaint, transcription, userSpecialty, templateContent } = body;

    if (typeof patientId !== 'string' || typeof draftId !== 'string' || typeof transcription !== 'string'
      || (chiefComplaint !== undefined && typeof chiefComplaint !== 'string')
      || (body.doctorComments !== undefined && typeof body.doctorComments !== 'string')) {
      return new Response(
        JSON.stringify({ error: 'patientId e transcription são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Ownership gate: the service-role client bypasses RLS, so verify the
    // patient belongs to the authenticated user before any write.
    const { data: ownedPatient } = await supabase
      .from('patients')
      .select('id,name,age,date_of_birth,diagnoses,medications,allergies')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!ownedPatient) {
      return new Response(
        JSON.stringify({ error: 'Paciente não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: priorSave } = await supabase.from('consultations').select('id,soap_note,whatsapp_message,history_proposals,chief_complaint,transcription')
      .eq('id', draftId).eq('patient_id', patientId).eq('user_id', userId).maybeSingle();
    const { data: draft } = await supabase.from('consultation_drafts').select('id,audio_storage_path,appointment_id')
      .eq('id', draftId).eq('patient_id', patientId).eq('user_id', userId).maybeSingle();
    const cleanupSavedDraft = async () => {
      if (!draft) return;
      if (draft.audio_storage_path) {
        const { error } = await supabase.storage.from('audio-recordings').remove([assertAudioPath(draft.audio_storage_path, userId)]);
        if (error) return; // retain the row/path for a retry instead of orphaning audio
      }
      await supabase.from('consultation_drafts').delete().eq('id', draftId).eq('user_id', userId);
    };
    const completeSavedMetadata = async () => {
      const { data, error } = await supabase.rpc('complete_consultation_metadata', { p_user_id: userId, p_patient_id: patientId, p_consultation_id: draftId });
      if (error || data !== true) throw new RequestError('A evolução foi salva, mas os dados da consulta ainda precisam ser concluídos. Tente novamente; seu rascunho foi mantido.', 503);
    };
    if (priorSave) {
      if (body.saveDirect !== true || body.reviewed !== true || body.soapNote !== priorSave.soap_note || (body.whatsappMessage ?? '') !== (priorSave.whatsapp_message ?? '') || transcription !== (priorSave.transcription ?? '') || (chiefComplaint ?? '') !== (priorSave.chief_complaint ?? '')) {
        throw new RequestError('Esta consulta já foi registrada com outro conteúdo. Seu texto atual foi mantido para comparação; reabra o registro e use um adendo.', 409);
      }
      await completeSavedMetadata();
      await cleanupSavedDraft();
      return new Response(JSON.stringify({ consultationId: priorSave.id, soapNote: priorSave.soap_note, whatsappMessage: priorSave.whatsapp_message, historyProposals: priorSave.history_proposals, profileUpdates: { diagnoses: [], medications: [], allergies: [] } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!draft) throw new Error('Rascunho não encontrado. Reabra a consulta.');

    let soapNote: string;
    let whatsappMessage: string;

    if (body.saveDirect) {
      if (body.reviewed !== true) throw new Error('Revise e confirme a evolução antes de salvar.');
      // ── Path A: draft was already approved — save without a Gemini call ──
      soapNote       = body.soapNote       ?? '';
      whatsappMessage = body.whatsappMessage ?? '';
    } else {
      // ── Path B: incorporate doctor comments → re-generate final SOAP ──────
      const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
      if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

      const doctorComments: string = body.doctorComments ?? '';
      const patientSummary = buildPatientSummary(ownedPatient, chiefComplaint);
      const commentsSection = doctorComments.trim()
        ? `\n\nObservações do médico (incorpore obrigatoriamente no SOAP):\n${doctorComments.trim()}`
        : '';

      const finalParts = [{ text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${chiefComplaint || 'acompanhamento de rotina'}${commentsSection}` }];
      const instruction = typeof templateContent === 'string' && templateContent.trim() ? buildCustomTemplatePrompt(templateContent) : getSpecialtyPrompt(userSpecialty);
      assertGeminiTextBudget(finalParts, instruction);
      let finalReservation: { reservationId: string };
      try {
        finalReservation = await checkQuota(supabase, userId, 100);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
        throw err;
      }

      const { text: finalRaw, usage: finalUsage } = await callGemini(
        GEMINI_API_KEY,
        finalParts,
        {
          systemInstruction: instruction,
          temperature: 0.3,
          maxOutputTokens: 3000,   // headroom for custom templates
          thinkingBudget: 1024,
          responseMimeType: 'application/json',
          responseSchema: FINAL_SCHEMA,
        },
      );
      await recordUsage(supabase, userId, creditsFromUsage(finalUsage), finalReservation.reservationId);

      const parsed = parseModelObject<FinalGeneration>(finalRaw, FINAL_SCHEMA);
      {
        soapNote        = parsed.soap_note        ?? '';
        whatsappMessage = parsed.whatsapp_message ?? '';
      }
      soapNote        = collapseBlankLines(soapNote);
      whatsappMessage = collapseBlankLines(whatsappMessage);
    }
    if (typeof soapNote !== 'string' || !soapNote.trim() || typeof whatsappMessage !== 'string') throw new Error('Evolução inválida ou vazia. Revise o rascunho.');
    if (!body.saveDirect) {
      // New generation is always shown to the clinician before it can be final.
      return new Response(JSON.stringify({ soapNote, whatsappMessage, previewOnly: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      .insert([{
        id: draftId,
        patient_id:       patientId,
        user_id:          userId,
        appointment_id:   draft.appointment_id ?? null,
        chief_complaint:  chiefComplaint,
        transcription,
        soap_note:        soapNote,
        whatsapp_message: whatsappMessage,
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    await completeSavedMetadata();

    // ── Best-effort profile extraction ───────────────────────────────────────
    let profileUpdates: {
      diagnoses:   { description: string }[];
      medications: { name: string; dosage: string; instructions: string }[];
      allergies:   string[];
    } = { diagnoses: [], medications: [], allergies: [] };

    try {
      const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
      if (GEMINI_API_KEY && soapNote.trim()) {
        assertGeminiTextBudget([{ text: soapNote }], EXTRACT_SYSTEM);
        // Gate the extraction on remaining budget too — a QuotaExceededError
        // here is caught below and simply skips extraction (the consultation
        // itself is already saved). Closes the saveDirect path where the main
        // quota check is skipped.
        const extractReservation = await checkQuota(supabase, userId, 8);
        const { text: extractRaw, usage: extractUsage } = await callGemini(
          GEMINI_API_KEY,
          [{ text: soapNote }],
          {
            systemInstruction: EXTRACT_SYSTEM,
            temperature: 0,
            maxOutputTokens: 512,
            thinkingBudget: 0,
            responseMimeType: 'application/json',
            responseSchema: EXTRACT_SCHEMA,
          },
        );
        await recordUsage(supabase, userId, creditsFromUsage(extractUsage), extractReservation.reservationId);
        const parsed = parseModelObject<ProfileExtraction>(extractRaw, EXTRACT_SCHEMA);
        const d = parsed.diagnoses.filter(x => x.description.trim());
        const m = parsed.medications.filter(x => x.name.trim());
        const a = parsed.allergies.filter(x => x.trim());
        if (d.length || m.length || a.length) profileUpdates = { diagnoses: d, medications: m, allergies: a };
      }
    } catch { /* non-critical — proceed without profile updates */ }

    // ── First-visit history proposals (never written automatically) ─────────
    // On the first consultation, build the Anamnese Social and Histórico Médico
    // as bullet lists and write them ONLY where the field is still empty, so a
    // manually-entered history is never overwritten.
    const historyFilled = false;
    const historyProposals = { sourceConsultationId: consultation.id, medicalHistory: [] as string[], socialAnamnesis: [] as string[] };
    if (isFirstVisit) {
      try {
        const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
        if (GEMINI_API_KEY && soapNote.trim()) {
          const { data: existing } = await supabase
            .from('patients')
            .select('medical_history, social_anamnesis,revision')
            .eq('id', patientId)
            .eq('user_id', userId)
            .maybeSingle();

          const needMedical = !existing?.medical_history?.trim();
          const needSocial  = !existing?.social_anamnesis?.trim();

          if (needMedical || needSocial) {
            const historyParts = [{ text: `Evolução SOAP:\n${soapNote}\n\nTranscrição:\n${transcription}` }];
            assertGeminiTextBudget(historyParts, HISTORY_SYSTEM);
            const historyReservation = await checkQuota(supabase, userId, 10);
            const { text: histRaw, usage: histUsage } = await callGemini(
              GEMINI_API_KEY,
              historyParts,
              {
                systemInstruction: HISTORY_SYSTEM,
                temperature: 0,
                maxOutputTokens: 700,
                thinkingBudget: 0,
                responseMimeType: 'application/json',
                responseSchema: HISTORY_SCHEMA,
              },
            );
            await recordUsage(supabase, userId, creditsFromUsage(histUsage), historyReservation.reservationId);

            const parsed = parseModelObject<HistoryExtraction>(histRaw, HISTORY_SCHEMA);
            // Suggestions remain separate from the durable chart until the doctor
            // accepts the exact text against the current patient revision.
            historyProposals.medicalHistory = needMedical ? parsed.medical_history.filter(value => value.trim()).slice(0, 30) : [];
            historyProposals.socialAnamnesis = needSocial ? parsed.social_anamnesis.filter(value => value.trim()).slice(0, 30) : [];
          }
        }
      } catch { /* non-critical — the consultation is already saved */ }
    }

    if (historyProposals.medicalHistory.length || historyProposals.socialAnamnesis.length) {
      const { error: proposalError } = await supabase.from('consultations').update({ history_proposals: historyProposals })
        .eq('id', consultation.id).eq('patient_id', patientId).eq('user_id', userId);
      if (proposalError) throw new Error('Evolução salva; reabra para recuperar a revisão pendente.');
    }
    // Cleanup only follows a durable successful clinical save.
    await cleanupSavedDraft();
    return new Response(
      JSON.stringify({ consultationId: consultation.id, soapNote, whatsappMessage, profileUpdates, isFirstVisit, historyFilled, historyProposals }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    if (error instanceof QuotaExceededError) return quotaResponse(error, corsHeaders);
    console.error('finalize-consultation failed');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
