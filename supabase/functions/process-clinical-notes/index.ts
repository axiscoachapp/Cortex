import { assertOpenAiEnabled, callClinicalText } from '../_shared/clinicalAi.ts';
import { readJsonObject, RequestError } from '../_shared/http.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { checkQuota, recordUsage, creditsFromUsage, QuotaExceededError, settleFailedCall } from '../_shared/quota.ts';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';
import { parseModelObject } from '../_shared/gemini.ts';
import { assertPromptSize } from '../_shared/modelInput.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  Vary: 'Origin',
};

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    symptoms: { type: 'array', items: { type: 'string' } },
    behavioral_observations: { type: 'array', items: { type: 'string' } },
    risk_factors: { type: 'array', items: { type: 'string' } },
    family_history: { type: 'array', items: { type: 'string' } },
    social_factors: { type: 'array', items: { type: 'string' } },
    clinical_changes: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'summary',
    'symptoms',
    'behavioral_observations',
    'risk_factors',
    'family_history',
    'social_factors',
    'clinical_changes',
  ],
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
      return new Response(JSON.stringify({ error: 'patientId and notes are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: patient, error: patientError } = await supabaseClient
      .from('patients')
      .select('clinical_notes, revision')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();

    if (patientError) throw new RequestError('Não foi possível consultar o prontuário. Tente novamente.', 503);
    if (!patient) {
      return new Response(JSON.stringify({ error: 'Paciente não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The doctor's note is saved first and verbatim, whatever happens to the AI step.
    const stamp = `[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}]`;
    const updatedNotes = patient.clinical_notes
      ? `${patient.clinical_notes}\n\n${stamp}\n${notes}`
      : `${stamp}\n${notes}`;

    const { data: saved, error: updateError } = await supabaseClient
      .from('patients')
      .update({ clinical_notes: updatedNotes })
      .eq('id', patientId)
      .eq('user_id', userId)
      .eq('revision', patient.revision)
      .select('id, revision')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!saved) throw new RequestError('O prontuário foi alterado. Recarregue e envie as anotações novamente.', 409);

    const respond = (body: Record<string, unknown>) =>
      new Response(JSON.stringify({ success: true, saved: true, revision: saved.revision, ...body }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    // Insights are only a proposal: they are returned for the doctor to accept
    // or discard and never written to the patient row here.
    const prompt = `Notas clínicas novas:
${notes}

Notas anteriores:
${patient.clinical_notes || 'Nenhuma nota anterior'}`;

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    let reservationId: string;
    try {
      assertOpenAiEnabled();
      if (!OPENAI_API_KEY) throw new RequestError('IA indisponível', 503);
      assertPromptSize(prompt, SYSTEM);
      ({ reservationId } = await checkQuota(supabaseClient, userId, 100));
    } catch (err) {
      if (err instanceof QuotaExceededError)
        return respond({
          insights: null,
          quotaExceeded: true,
          message: 'Anotação salva. O limite diário de IA foi atingido; os insights não foram gerados.',
        });
      if (err instanceof RequestError)
        return respond({ insights: null, message: 'Anotação salva. A IA está indisponível; os insights não foram gerados.' });
      throw err;
    }

    let insights: Record<string, unknown>;
    try {
      const { text: rawText, usage } = await callClinicalText(OPENAI_API_KEY, [{ text: prompt }], {
        systemInstruction: SYSTEM,
        maxOutputTokens: 1024,
        responseSchema: INSIGHTS_SCHEMA,
      }).catch(async (error) => {
        // A failed call must not keep the reservation blocking the quota.
        await settleFailedCall(supabaseClient, userId, reservationId, error);
        throw error;
      });
      await recordUsage(supabaseClient, userId, creditsFromUsage(usage), reservationId);
      insights = parseModelObject(rawText, INSIGHTS_SCHEMA);
    } catch {
      return respond({ insights: null, message: 'Anotação salva. Não foi possível gerar os insights agora.' });
    }

    return respond({ insights, message: 'Anotação salva. Revise os insights sugeridos pela IA antes de aceitar.' });
  } catch (error) {
    if (error instanceof RequestError)
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('process-clinical-notes error:');
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro ao processar notas' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
