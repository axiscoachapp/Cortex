import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, buildPatientSummary } from "../_shared/gemini.ts";
import { getSpecialtyPrompt } from "../_shared/specialty_prompts.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { patientId, userId, chiefComplaint, transcription, patientContext, userSpecialty } = body;

    if (!patientId || !userId || transcription === undefined) {
      return new Response(
        JSON.stringify({ error: 'patientId, userId e transcription são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

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
          systemInstruction: getSpecialtyPrompt(userSpecialty),
          temperature: 0.3,
          maxOutputTokens: 2000,
          thinkingBudget: 1024,
          responseMimeType: 'application/json',
          responseSchema: FINAL_SCHEMA,
        },
      );
      await recordUsage(supabase, userId, creditsFromUsage(finalUsage));

      try {
        const parsed = JSON.parse(finalRaw);
        soapNote        = parsed.soap_note        ?? '';
        whatsappMessage = parsed.whatsapp_message ?? '';
      } catch {
        soapNote        = finalRaw;
        whatsappMessage = '';
      }
    }

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
      .eq('id', patientId);

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
        const { text: extractRaw } = await callGemini(
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
        const parsed = JSON.parse(extractRaw);
        const d = Array.isArray(parsed.diagnoses)   ? parsed.diagnoses.filter((x: any) => x?.description?.trim())   : [];
        const m = Array.isArray(parsed.medications)  ? parsed.medications.filter((x: any) => x?.name?.trim())         : [];
        const a = Array.isArray(parsed.allergies)    ? parsed.allergies.filter((x: any) => typeof x === 'string' && x.trim()) : [];
        if (d.length || m.length || a.length) profileUpdates = { diagnoses: d, medications: m, allergies: a };
      }
    } catch { /* non-critical — proceed without profile updates */ }

    return new Response(
      JSON.stringify({ consultationId: consultation.id, soapNote, whatsappMessage, profileUpdates }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('finalize-consultation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
