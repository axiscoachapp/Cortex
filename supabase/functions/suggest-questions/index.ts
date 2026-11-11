import { assertOpenAiEnabled, callClinicalText } from '../_shared/clinicalAi.ts';
import { AI_UNAVAILABLE_MESSAGE, readJsonObject, RequestError } from "../_shared/http.ts";
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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError, settleFailedCall,
} from "../_shared/quota.ts";
import { parseModelObject } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assertPromptSize, optionalText, readPatientContext } from '../_shared/modelInput.ts';

const corsHeaders = {
  ...allowOriginHeader(),
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
    // AI availability first: nothing else may fail differently while it is switched off.
    assertOpenAiEnabled();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new RequestError(AI_UNAVAILABLE_MESSAGE, 503);
    const body: Record<string, unknown> = await readJsonObject(req);

    const ctx = readPatientContext(body.patientContext) ?? {};
    // Bounded input; a cut is marked so the model does not take the excerpt for the whole field.
    const bounded = (value: string, max: number) => value.length > max ? `${value.slice(0, max)} [texto cortado]` : value;
    const diagnoses = Array.isArray(ctx.diagnoses)
      ? ctx.diagnoses.map(d => (typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`.trim())).filter(Boolean).join('; ')
      : '';
    const meds = Array.isArray(ctx.medications)
      ? ctx.medications.map(m => (typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`.trim())).filter(Boolean).join(', ')
      : '';
    const allergies = Array.isArray(ctx.allergies) ? ctx.allergies.join(', ') : '';
    const medicalHistory  = bounded((ctx.medicalHistory  ?? ctx.medical_history  ?? '').toString().trim(), 3000);
    const socialAnamnesis = bounded((ctx.socialAnamnesis ?? ctx.social_anamnesis ?? '').toString().trim(), 3000);
    const complaint = bounded(optionalText(body.chiefComplaint, 'Queixa principal').trim(), 1000);

    // Nothing to base questions on → return empty rather than pay for a call.
    if (!complaint && !diagnoses && !meds && !medicalHistory && !socialAnamnesis) {
      return new Response(
        JSON.stringify({ questions: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // The questions do not need the patient's name, so it is not sent.
    const prompt = [
      `Paciente: ${ctx.age == null ? 'idade não informada' : `${ctx.age} anos`}`,
      `Queixa principal: ${complaint || 'não informada'}`,
      `Diagnósticos: ${diagnoses || 'nenhum registrado'}`,
      `Medicações em uso: ${meds || 'nenhuma'}`,
      `Alergias: ${allergies || 'nenhuma'}`,
      medicalHistory  ? `Histórico médico:\n${medicalHistory}`   : '',
      socialAnamnesis ? `Anamnese social:\n${socialAnamnesis}`   : '',
    ].filter(Boolean).join('\n');
    assertPromptSize(prompt, SYSTEM);
    let reservationId: string;
    try {
      assertOpenAiEnabled();

      ({ reservationId } = await checkQuota(supabase, userId, 100));
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const { text: raw, usage } = await callClinicalText(
      OPENAI_API_KEY,
      [{ text: prompt }],
      {
        systemInstruction: SYSTEM,
        maxOutputTokens: 700,
        responseSchema: SCHEMA,
      },
    ).catch(async (error) => {
      await settleFailedCall(supabase, userId, reservationId, error);
      throw error;
    });

    await recordUsage(supabase, userId, creditsFromUsage(usage), reservationId);

    const parsed = parseModelObject<{ questions: string[] }>(raw, SCHEMA);
    const questions = parsed.questions.filter(question => question.trim()).slice(0, 10);
    if (!questions.length) throw new Error('A IA não retornou perguntas. Tente novamente.');

    return new Response(
      JSON.stringify({ questions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('suggest-questions error:');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// No ALLOWED_ORIGIN secret means no Access-Control-Allow-Origin: browsers refuse the call instead
// of the function answering any origin (same rule as _shared/cors.ts).
function allowOriginHeader(): Record<string, string> {
  const origin = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim();
  return origin && origin !== '*' ? { 'Access-Control-Allow-Origin': origin } : {};
}
