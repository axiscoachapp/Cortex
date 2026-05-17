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
  const parts2: any[] = json.candidates?.[0]?.content?.parts ?? [];
  const responsePart = parts2.find((p: any) => !p.thought) ?? parts2[parts2.length - 1];
  return responsePart?.text ?? '';
}

const SOAP_SCHEMA = {
  type: 'object',
  properties: {
    soap_note: { type: 'string', description: 'Evolução SOAP formatada com seções **S**, **O**, **A**, **P**' },
    whatsapp_message: { type: 'string', description: 'Mensagem WhatsApp para o paciente, max 180 palavras' },
  },
  required: ['soap_note', 'whatsapp_message'],
};

const SOAP_SYSTEM = `Você é um médico especialista gerando documentação clínica em português brasileiro.
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
- Tom amigável e profissional`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { patientId, userId, chiefComplaint, patientContext } = body;

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    // ── Phase 1: Transcribe audio → return draft (no DB save) ────────────────
    if (body.audioBase64) {
      const { audioBase64, audioMimeType } = body;

      if (!patientId || !userId) {
        return new Response(
          JSON.stringify({ error: 'patientId e userId são obrigatórios' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

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

      const patientSummary = buildPatientSummary(patientContext, chiefComplaint);
      const draftRaw = await callGemini(
        GEMINI_API_KEY,
        [{ text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${chiefComplaint || 'acompanhamento de rotina'}` }],
        {
          systemInstruction: SOAP_SYSTEM,
          temperature: 0.3,
          maxOutputTokens: 1200,
          thinkingBudget: 512,
          responseMimeType: 'application/json',
          responseSchema: SOAP_SCHEMA,
        },
      );

      let soapDraft = '';
      let whatsappDraft = '';
      try {
        const parsed = JSON.parse(draftRaw);
        soapDraft = parsed.soap_note ?? '';
        whatsappDraft = parsed.whatsapp_message ?? '';
      } catch {
        soapDraft = draftRaw;
      }

      return new Response(
        JSON.stringify({ transcription, soapNote: soapDraft, whatsappMessage: whatsappDraft }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Phase 2: Generate final SOAP from transcription + doctor comments → save ──
    if (body.transcription !== undefined) {
      const { transcription, doctorComments } = body;

      if (!patientId || !userId) {
        return new Response(
          JSON.stringify({ error: 'patientId e userId são obrigatórios' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      const patientSummary = buildPatientSummary(patientContext, chiefComplaint);
      const commentsSection = doctorComments?.trim()
        ? `\n\nObservações do médico (incorpore obrigatoriamente no SOAP):\n${doctorComments.trim()}`
        : '';

      const finalRaw = await callGemini(
        GEMINI_API_KEY,
        [{ text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${chiefComplaint || 'acompanhamento de rotina'}${commentsSection}` }],
        {
          systemInstruction: SOAP_SYSTEM,
          temperature: 0.3,
          maxOutputTokens: 1200,
          thinkingBudget: 1024,
          responseMimeType: 'application/json',
          responseSchema: SOAP_SCHEMA,
        },
      );

      let soapNote = '';
      let whatsappMessage = '';
      try {
        const parsed = JSON.parse(finalRaw);
        soapNote = parsed.soap_note ?? '';
        whatsappMessage = parsed.whatsapp_message ?? '';
      } catch {
        soapNote = finalRaw;
      }

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
        JSON.stringify({ consultationId: consultation.id, soapNote, whatsappMessage }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'audioBase64 ou transcription é obrigatório' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
