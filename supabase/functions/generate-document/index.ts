import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, buildPatientSummary } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PATIENT_SUMMARY_SYSTEM = `Você é um assistente médico gerando um resumo de consulta em português brasileiro
acessível para pacientes e familiares — sem jargão técnico desnecessário.

Gere um documento estruturado com as seguintes seções, extraindo as informações do SOAP fornecido.
Se uma informação não estiver no SOAP, omita essa seção (não invente).

Use EXATAMENTE este formato markdown (os títulos em negrito como estão):

**O que conversamos hoje**
[chief complaint em linguagem acessível, 1-2 frases]

**Diagnóstico / Impressão clínica**
[diagnóstico ou hipótese do médico em linguagem acessível — sem códigos CID]

**Medicamentos**
[lista de medicamentos com nome, dose, frequência e duração — 1 item por linha com bullet •]

**Orientações**
[plano de conduta em linguagem acessível — exames, mudanças de hábito, cuidados]

**Quando retornar**
[data ou intervalo de retorno mencionado no plano]

**Sinais de alerta — procure atendimento se:**
[2-4 sinais de alarme relevantes para o diagnóstico — em linguagem simples]

Regras:
- Use linguagem simples, empática e direta.
- Não use terminologia médica sem explicação.
- Máximo 300 palavras no total.
- Não invente informações não presentes no SOAP.`;

const REFERRAL_SYSTEM = `Você é um assistente médico gerando um encaminhamento médico formal em português brasileiro.

Gere um documento de encaminhamento com EXATAMENTE este formato:

**ENCAMINHAMENTO MÉDICO**

**Para:** [especialidade de destino]

**Paciente:** [nome], [idade] anos

**Motivo do encaminhamento:**
[2-3 frases resumindo o motivo clínico, baseado na avaliação do SOAP]

**Histórico relevante:**
[diagnósticos ativos, medicamentos em uso, anamnese relevante — máximo 4 itens]

**Conduta atual:**
[plano de conduta do médico atual que está encaminhando]

**Solicito:**
[o que o médico espera do especialista — avaliação, conduta, parecer]

Regras:
- Tom formal e objetivo.
- Máximo 200 palavras.
- Não invente informações não presentes no contexto fornecido.
- Se a especialidade de destino não for especificada, use "Especialista a definir".`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      type, userId, soapNote, chiefComplaint, patientContext, targetSpecialty,
    } = await req.json();

    if (!type || !userId || !soapNote) {
      return new Response(
        JSON.stringify({ error: 'type, userId e soapNote são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (type !== 'patient_summary' && type !== 'referral') {
      return new Response(
        JSON.stringify({ error: 'type deve ser "patient_summary" ou "referral"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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

    const patientSummary = buildPatientSummary(patientContext, chiefComplaint);
    const referralTarget = targetSpecialty ? `\n\nEspecialidade de destino: ${targetSpecialty}` : '';

    const systemInstruction = type === 'patient_summary'
      ? PATIENT_SUMMARY_SYSTEM
      : REFERRAL_SYSTEM;

    const { text: document, usage } = await callGemini(
      GEMINI_API_KEY,
      [{ text: `${patientSummary}\n\nEvolução SOAP:\n${soapNote}\n\nQueixa principal: ${chiefComplaint || 'não especificada'}${referralTarget}` }],
      {
        systemInstruction,
        temperature: 0.3,
        maxOutputTokens: 1000,
        thinkingBudget: 0,
      },
    );

    await recordUsage(supabase, userId, creditsFromUsage(usage));

    return new Response(
      JSON.stringify({ document }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('generate-document error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
