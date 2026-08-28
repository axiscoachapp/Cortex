import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, buildPatientSummary, parseModelJson, salvageJsonString, collapseBlankLines } from "../_shared/gemini.ts";
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
- diagnoses: diagnósticos ou hipóteses da seção A, como descrições simples sem código CID
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
    const body = await req.json();
    const { patientId, chiefComplaint, transcription, patientContext, userSpecialty, templateContent } = body;

    if (!patientId || transcription === undefined) {
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
      .select('id')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!ownedPatient) {
      return new Response(
        JSON.stringify({ error: 'Paciente não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let soapNote: string;
    let whatsappMessage: string;

    if (body.saveDirect) {
      // ── Path A: draft was already approved — save without a Gemini call ──
      soapNote       = body.soapNote       ?? '';
      whatsappMessage = body.whatsappMessage ?? '';
    } else {
      // ── Path B: incorporate doctor comments → re-generate final SOAP ──────
      const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
      if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

      try {
        await checkQuota(supabase, userId, 5);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
        throw err;
      }

      const doctorComments: string = body.doctorComments ?? '';
      const patientSummary = buildPatientSummary(patientContext, chiefComplaint);
      const commentsSection = doctorComments.trim()
        ? `\n\nObservações do médico (incorpore obrigatoriamente no SOAP):\n${doctorComments.trim()}`
        : '';

      const { text: finalRaw, usage: finalUsage } = await callGemini(
        GEMINI_API_KEY,
        [{ text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${chiefComplaint || 'acompanhamento de rotina'}${commentsSection}` }],
        {
          systemInstruction: (typeof templateContent === 'string' && templateContent.trim())
          ? buildCustomTemplatePrompt(templateContent)
          : getSpecialtyPrompt(userSpecialty),
          temperature: 0.3,
          maxOutputTokens: 3000,   // headroom for custom templates
          thinkingBudget: 1024,
          responseMimeType: 'application/json',
          responseSchema: FINAL_SCHEMA,
        },
      );
      await recordUsage(supabase, userId, creditsFromUsage(finalUsage));

      const parsed = parseModelJson(finalRaw);
      if (parsed) {
        soapNote        = parsed.soap_note        ?? '';
        whatsappMessage = parsed.whatsapp_message ?? '';
      } else {
        // Truncated/invalid JSON — salvage the fields so the raw envelope
        // never leaks into the document the doctor sees.
        soapNote        = salvageJsonString(finalRaw, 'soap_note') ?? finalRaw;
        whatsappMessage = salvageJsonString(finalRaw, 'whatsapp_message') ?? '';
      }
      soapNote        = collapseBlankLines(soapNote);
      whatsappMessage = collapseBlankLines(whatsappMessage);
    }

    // First visit? Check for a prior consultation BEFORE inserting this one.
    // The first consultation seeds the patient's anamnesis/history fields.
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
        patient_id:       patientId,
        user_id:          userId,
        chief_complaint:  chiefComplaint,
        transcription,
        soap_note:        soapNote,
        whatsapp_message: whatsappMessage,
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    await supabase
      .from('patients')
      .update({ last_visit: new Date().toISOString().split('T')[0], status: 'retorno' })
      .eq('id', patientId)
      .eq('user_id', userId);

    // Best-effort: mark today's appointment as done
    try {
      const today = new Date().toISOString().split('T')[0];
      await supabase
        .from('appointments')
        .update({ status: 'realizado' })
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .in('status', ['agendado', 'confirmado'])
        .gte('start_time', `${today}T00:00:00`)
        .lte('start_time', `${today}T23:59:59`);
    } catch { /* non-critical */ }

    // ── Best-effort profile extraction ───────────────────────────────────────
    let profileUpdates: {
      diagnoses:   { description: string }[];
      medications: { name: string; dosage: string; instructions: string }[];
      allergies:   string[];
    } = { diagnoses: [], medications: [], allergies: [] };

    try {
      const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
      if (GEMINI_API_KEY && soapNote.trim()) {
        // Gate the extraction on remaining budget too — a QuotaExceededError
        // here is caught below and simply skips extraction (the consultation
        // itself is already saved). Closes the saveDirect path where the main
        // quota check is skipped.
        await checkQuota(supabase, userId, 1);
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
        await recordUsage(supabase, userId, creditsFromUsage(extractUsage));
        const parsed = JSON.parse(extractRaw);
        const d = Array.isArray(parsed.diagnoses)   ? parsed.diagnoses.filter((x: any) => x?.description?.trim())   : [];
        const m = Array.isArray(parsed.medications)  ? parsed.medications.filter((x: any) => x?.name?.trim())         : [];
        const a = Array.isArray(parsed.allergies)    ? parsed.allergies.filter((x: any) => typeof x === 'string' && x.trim()) : [];
        if (d.length || m.length || a.length) profileUpdates = { diagnoses: d, medications: m, allergies: a };
      }
    } catch { /* non-critical — proceed without profile updates */ }

    // ── First-visit anamnesis → seed the patient's history fields ─────────────
    // On the first consultation, build the Anamnese Social and Histórico Médico
    // as bullet lists and write them ONLY where the field is still empty, so a
    // manually-entered history is never overwritten.
    let historyFilled = false;
    if (isFirstVisit) {
      try {
        const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
        if (GEMINI_API_KEY && soapNote.trim()) {
          const { data: existing } = await supabase
            .from('patients')
            .select('medical_history, social_anamnesis')
            .eq('id', patientId)
            .eq('user_id', userId)
            .maybeSingle();

          const needMedical = !existing?.medical_history?.trim();
          const needSocial  = !existing?.social_anamnesis?.trim();

          if (needMedical || needSocial) {
            await checkQuota(supabase, userId, 1);
            const { text: histRaw, usage: histUsage } = await callGemini(
              GEMINI_API_KEY,
              [{ text: `Evolução SOAP:\n${soapNote}\n\nTranscrição:\n${transcription}` }],
              {
                systemInstruction: HISTORY_SYSTEM,
                temperature: 0,
                maxOutputTokens: 700,
                thinkingBudget: 0,
                responseMimeType: 'application/json',
                responseSchema: HISTORY_SCHEMA,
              },
            );
            await recordUsage(supabase, userId, creditsFromUsage(histUsage));

            const parsed = JSON.parse(histRaw);
            const toBullets = (v: unknown): string =>
              Array.isArray(v)
                ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                    .map(x => `- ${x.trim()}`).join('\n')
                : '';
            const medical = toBullets(parsed.medical_history);
            const social  = toBullets(parsed.social_anamnesis);

            const patch: Record<string, string> = {};
            if (needMedical && medical) patch.medical_history  = medical;
            if (needSocial  && social)  patch.social_anamnesis = social;

            if (Object.keys(patch).length > 0) {
              await supabase.from('patients').update(patch).eq('id', patientId).eq('user_id', userId);
              historyFilled = true;
            }
          }
        }
      } catch { /* non-critical — the consultation is already saved */ }
    }

    return new Response(
      JSON.stringify({ consultationId: consultation.id, soapNote, whatsappMessage, profileUpdates, isFirstVisit, historyFilled }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('finalize-consultation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
