import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  required: ['summary'],
};

const SYSTEM = `Você é um assistente médico especializado em extrair informações estruturadas de notas clínicas. Analise as notas e extraia informações relevantes sobre: sintomas, observações comportamentais, fatores de risco, histórico familiar, fatores sociais, e mudanças no quadro clínico. Retorne tudo em português, conciso e sem inventar dados.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { patientId, notes, userId } = await req.json();

    if (!patientId || !notes) {
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

    try {
      await checkQuota(supabaseClient, userId, 3);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const { data: patient } = await supabaseClient
      .from('patients')
      .select('clinical_notes, ai_insights')
      .eq('id', patientId)
      .single();

    const prompt = `Notas clínicas novas:
${notes}

Notas anteriores:
${patient?.clinical_notes || 'Nenhuma nota anterior'}`;

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
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
      const err = await res.text();
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requisições excedido, tente novamente em alguns segundos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Gemini error ${res.status}: ${err}`);
    }

    const json = await res.json();
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    const responsePart = parts.find((p: any) => !p.thought) ?? parts[parts.length - 1];
    const rawText = responsePart?.text ?? '{}';

    await recordUsage(supabaseClient, userId, creditsFromUsage(json.usageMetadata));

    let insights: Record<string, unknown> = {};
    try {
      insights = JSON.parse(rawText);
    } catch {
      console.error('process-clinical-notes: failed to parse Gemini JSON. raw:', rawText.slice(0, 300));
      insights = { summary: rawText.slice(0, 500) };
    }

    const stamp = `[${new Date().toLocaleString('pt-BR')}]`;
    const updatedNotes = patient?.clinical_notes
      ? `${patient.clinical_notes}\n\n${stamp}\n${notes}`
      : `${stamp}\n${notes}`;

    const { error: updateError } = await supabaseClient
      .from('patients')
      .update({ clinical_notes: updatedNotes, ai_insights: insights })
      .eq('id', patientId);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({
        success: true,
        insights,
        message: 'Notas processadas e perfil atualizado.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('process-clinical-notes error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro ao processar notas' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
