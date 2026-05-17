import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface GeminiConfig {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  responseMimeType?: string;
  responseSchema?: object;
}

async function callGemini(apiKey: string, parts: object[], cfg: GeminiConfig = {}): Promise<string> {
  const body: any = {
    contents: [{ parts }],
    generationConfig: {
      temperature: cfg.temperature ?? 0.2,
      maxOutputTokens: cfg.maxOutputTokens ?? 1024,
    },
  };

  if (cfg.systemInstruction) {
    body.systemInstruction = { parts: [{ text: cfg.systemInstruction }] };
  }
  if (cfg.responseMimeType) {
    body.generationConfig.responseMimeType = cfg.responseMimeType;
  }
  if (cfg.responseSchema) {
    body.generationConfig.responseSchema = cfg.responseSchema;
  }
  if (cfg.thinkingBudget !== undefined) {
    body.generationConfig.thinkingConfig = { thinkingBudget: cfg.thinkingBudget };
  }

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const json = await res.json();
  // When thinkingBudget > 0, thinking tokens appear first (thought: true); find the actual response part
  const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
  const responsePart = parts.find((p: any) => !p.thought) ?? parts[parts.length - 1];
  return responsePart?.text ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { patientId, userId, chiefComplaint, audioBase64, audioMimeType, patientContext } = await req.json();

    if (!patientId || !userId || !audioBase64) {
      return new Response(
        JSON.stringify({ error: 'patientId, userId e audioBase64 são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Step 1: Transcription ────────────────────────────────────────────────
    // Low temperature = maximum accuracy; no thinking needed for transcription
    const transcription = await callGemini(
      GEMINI_API_KEY,
      [
        { inline_data: { mime_type: audioMimeType ?? 'audio/webm', data: audioBase64 } },
        { text: 'Transcreva fielmente esta consulta médica em português brasileiro. Identifique os interlocutores como "Médico:" e "Paciente:" quando distinguível. Retorne apenas a transcrição.' },
      ],
      {
        systemInstruction: 'Você é um especialista em transcrição de consultas médicas. Sua única função é transcrever com máxima fidelidade, preservando termos técnicos e nomes de medicamentos.',
        temperature: 0.1,
        maxOutputTokens: 2000,
        thinkingBudget: 0,
      },
    );

    // ── Step 2: SOAP note + WhatsApp message (single call, parallel output) ──
    // thinkingBudget improves clinical reasoning for SOAP; responseSchema guarantees structure
    const patientSummary = buildPatientSummary(patientContext, chiefComplaint);

    const combinedRaw = await callGemini(
      GEMINI_API_KEY,
      [
        {
          text: `${patientSummary}

Transcrição da consulta:
${transcription}

Queixa principal desta consulta: ${chiefComplaint || 'acompanhamento de rotina'}`,
        },
      ],
      {
        systemInstruction: `Você é um médico especialista gerando documentação clínica em português brasileiro.
Gere dois documentos a partir dos dados fornecidos:

1. soap_note: Evolução SOAP completa e profissional com as seções:
**S (Subjetivo):** Queixas e relato do paciente nesta consulta
**O (Objetivo):** Dados objetivos (sinais vitais, exame físico, exames)
**A (Avaliação):** Diagnósticos ativos, CID, resposta ao tratamento
**P (Plano):** Condutas, ajustes de medicação, solicitações, próximo retorno
Use terminologia médica precisa. Seja conciso mas completo.

2. whatsapp_message: Mensagem curta e acolhedora para o paciente (máx. 180 palavras):
- Cumprimente pelo nome
- Resuma os pontos principais em linguagem simples
- Liste orientações com emojis (💊🩺📅)
- Tom amigável e profissional`,
        temperature: 0.3,
        maxOutputTokens: 1200,
        thinkingBudget: 1024,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            soap_note: { type: 'string', description: 'Evolução SOAP formatada com seções **S**, **O**, **A**, **P**' },
            whatsapp_message: { type: 'string', description: 'Mensagem WhatsApp para o paciente, max 180 palavras' },
          },
          required: ['soap_note', 'whatsapp_message'],
        },
      },
    );

    let soapNote = '';
    let whatsappMessage = '';
    try {
      const parsed = JSON.parse(combinedRaw);
      soapNote = parsed.soap_note ?? '';
      whatsappMessage = parsed.whatsapp_message ?? '';
    } catch {
      // Fallback if JSON parsing fails — use raw text as SOAP
      soapNote = combinedRaw;
    }

    // ── Step 3: Persist ──────────────────────────────────────────────────────
    const { data: consultation, error: insertError } = await supabase
      .from('consultations')
      .insert([{
        patient_id: patientId,
        user_id: userId,
        chief_complaint: chiefComplaint,
        transcription,
        soap_note: soapNote,
        whatsapp_message: whatsappMessage,
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    await supabase
      .from('patients')
      .update({ last_visit: new Date().toISOString().split('T')[0], status: 'retorno' })
      .eq('id', patientId);

    return new Response(
      JSON.stringify({ consultationId: consultation.id, transcription, soapNote, whatsappMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('process-consultation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

function buildPatientSummary(ctx: any, chiefComplaint: string): string {
  if (!ctx) return '';
  const diagnoses = ctx.diagnoses?.map((d: any) => `${d.code} ${d.description}`).join('; ') || 'Nenhum';
  const meds = ctx.medications?.map((m: any) => `${m.name} ${m.dosage}`).join(', ') || 'Nenhum';
  const allergies = ctx.allergies?.join(', ') || 'Nenhuma';
  return `Paciente: ${ctx.name}, ${ctx.age} anos
Diagnósticos: ${diagnoses}
Medicações: ${meds}
Alergias: ${allergies}`;
}
