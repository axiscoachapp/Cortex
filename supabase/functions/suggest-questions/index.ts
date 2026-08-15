/**
 * Pre-consultation question checklist.
 *
 * Given the patient's history/anamnesis and the chief complaint entered at
 * registration, returns a short checklist of anamnesis questions the doctor
 * should cover in the consultation. Proactive counterpart to the live copilot:
 * this is the plan going in; the copilot catches gaps as the consult unfolds.
 *
 * Reads no DB (works off the context the client already holds), so there is no
 * ownership surface — only JWT auth for identity + quota attribution.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const SYSTEM = `Você é um assistente clínico que prepara o médico para uma consulta.
A partir do histórico do paciente e da queixa principal, gere um CHECKLIST de perguntas
que o médico deve fazer para conduzir uma boa anamnese e não deixar passar pontos importantes.

DIRETRIZES:
- Priorize perguntas ligadas à QUEIXA PRINCIPAL (caracterização do sintoma, sinais de alarme,
  diagnósticos diferenciais) e ao HISTÓRICO relevante (controle de doenças crônicas, adesão e
  efeitos de medicações em uso, rastreios pertinentes à idade/sexo).
- Se não houver queixa, foque em acompanhamento das condições do histórico.
- Entre 5 e 10 perguntas. Cada item é UMA pergunta objetiva e acionável, em português brasileiro,
  máximo ~15 palavras, redigida como pergunta ou tópico a investigar.
- Não repita perguntas. Não invente dados do paciente. Não faça diagnósticos — apenas perguntas.
- Ordene das mais importantes para as menos importantes.`;

const SCHEMA = {
  type: 'object',
  properties: {
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['questions'],
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const { patientContext, chiefComplaint } = await req.json();

    const ctx = patientContext ?? {};
    const diagnoses = Array.isArray(ctx.diagnoses)
      ? ctx.diagnoses.map((d: any) => (typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`.trim())).filter(Boolean).join('; ')
      : '';
    const meds = Array.isArray(ctx.medications)
      ? ctx.medications.map((m: any) => (typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`.trim())).filter(Boolean).join(', ')
      : '';
    const allergies = Array.isArray(ctx.allergies) ? ctx.allergies.join(', ') : '';
    const medicalHistory  = (ctx.medicalHistory  ?? ctx.medical_history  ?? '').toString().slice(0, 1500);
    const socialAnamnesis = (ctx.socialAnamnesis ?? ctx.social_anamnesis ?? '').toString().slice(0, 1500);
    const complaint = (chiefComplaint ?? '').toString().slice(0, 500);

    // Nothing to base questions on → return empty rather than pay for a call.
    if (!complaint && !diagnoses && !meds && !medicalHistory && !socialAnamnesis) {
      return new Response(
        JSON.stringify({ questions: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    try {
      await checkQuota(supabase, userId, 2);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const prompt = [
      `Paciente: ${ctx.name ?? 'não informado'}, ${ctx.age ?? '?'} anos`,
      `Queixa principal: ${complaint || 'não informada'}`,
      `Diagnósticos: ${diagnoses || 'nenhum registrado'}`,
      `Medicações em uso: ${meds || 'nenhuma'}`,
      `Alergias: ${allergies || 'nenhuma'}`,
      medicalHistory  ? `Histórico médico:\n${medicalHistory}`   : '',
      socialAnamnesis ? `Anamnese social:\n${socialAnamnesis}`   : '',
    ].filter(Boolean).join('\n');

    const { text: raw, usage } = await callGemini(
      GEMINI_API_KEY,
      [{ text: prompt }],
      {
        systemInstruction: SYSTEM,
        temperature: 0.3,
        maxOutputTokens: 700,
        thinkingBudget: 0,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    );

    await recordUsage(supabase, userId, creditsFromUsage(usage));

    let questions: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      questions = Array.isArray(parsed.questions)
        ? parsed.questions.filter((q: any): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 10)
        : [];
    } catch { /* unparseable → empty */ }

    return new Response(
      JSON.stringify({ questions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('suggest-questions error:', error instanceof Error ? error.message : 'unknown');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
