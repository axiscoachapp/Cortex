import { fetchWithDeadline, readJsonObject, RequestError } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { requireCompleteModelText, parseModelObject } from '../_shared/gemini.ts';
import { assertPromptSize } from '../_shared/modelInput.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    symptoms:                { type: 'array', items: { type: 'string' } },
    behavioral_observations: { type: 'array', items: { type: 'string' } },
    risk_factors:            { type: 'array', items: { type: 'string' } },
    family_history:          { type: 'array', items: { type: 'string' } },
    social_factors:          { type: 'array', items: { type: 'string' } },
    clinical_changes:        { type: 'array', items: { type: 'string' } },
    summary:                 { type: 'string' },
  },
  required: ['summary','symptoms','behavioral_observations','risk_factors','family_history','social_factors','clinical_changes'],
};

const SYSTEM = `Você é um assistente médico especializado em extrair informações estruturadas de notas clínicas. Analise as notas e extraia informações relevantes sobre: sintomas, observações comportamentais, fatores de risco, histórico familiar, fatores sociais, e mudanças no quadro clínico. Retorne tudo em português, conciso e sem inventar dados.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const { patientId, notes } = await readJsonObject(req);

    if (typeof patientId !== 'string' || typeof notes !== 'string' || !notes.trim() || notes.length > 32_000) {
      return new Response(
        JSON.stringify({ error: 'patientId and notes are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: patient, error: patientError } = await supabaseClient
      .from('patients')
      .select('clinical_notes, ai_insights, revision')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();

    if (patientError) throw new RequestError('Não foi possível consultar o prontuário. Tente novamente.', 503);
    if (!patient) {
      return new Response(
        JSON.stringify({ error: 'Paciente não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const prompt = `Notas clínicas novas:
${notes}

Notas anteriores:
${patient?.clinical_notes || 'Nenhuma nota anterior'}`;
    assertPromptSize(prompt, SYSTEM);

    let reservationId: string;
    try {
      ({ reservationId } = await checkQuota(supabaseClient, userId, 100));
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const res = await fetchWithDeadline(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema: INSIGHTS_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requisições excedido, tente novamente em alguns segundos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Gemini indisponível (${res.status})`);
    }

    const json = await res.json();
    await recordUsage(supabaseClient, userId, creditsFromUsage(json.usageMetadata), reservationId);
    const insights = parseModelObject(requireCompleteModelText(json), INSIGHTS_SCHEMA);

    const stamp = `[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}]`;
    const updatedNotes = patient?.clinical_notes
      ? `${patient.clinical_notes}\n\n${stamp}\n${notes}`
      : `${stamp}\n${notes}`;

    const { data: saved, error: updateError } = await supabaseClient
      .from('patients')
      .update({ clinical_notes: updatedNotes, ai_insights: insights })
      .eq('id', patientId)
      .eq('user_id', userId)
      .eq('revision', patient.revision)
      .select('id')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!saved) throw new RequestError('O prontuário foi alterado. Recarregue e envie as anotações novamente.', 409);

    return new Response(
      JSON.stringify({
        success: true,
        insights,
        message: 'Notas processadas e perfil atualizado.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('process-clinical-notes error:');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro ao processar notas' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
