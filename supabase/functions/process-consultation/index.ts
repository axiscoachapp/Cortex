import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function callGemini(apiKey: string, parts: object[]): Promise<string> {
  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      patientId,
      userId,
      chiefComplaint,
      audioBase64,
      audioMimeType,
      patientContext,
    } = await req.json();

    if (!patientId || !userId || !audioBase64) {
      return new Response(
        JSON.stringify({ error: 'patientId, userId e audioBase64 são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Step 1: Transcribe audio ────────────────────────────────────────────
    const transcription = await callGemini(GEMINI_API_KEY, [
      {
        inline_data: {
          mime_type: audioMimeType ?? 'audio/webm',
          data: audioBase64,
        },
      },
      {
        text: `Você é um assistente de transcrição médica. Transcreva fielmente a consulta médica do áudio em português brasileiro.
Mantenha a fala do médico e do paciente separadas quando identificável (ex: "Médico:", "Paciente:").
Retorne apenas a transcrição, sem comentários adicionais.`,
      },
    ]);

    // ── Step 2: Generate SOAP note ──────────────────────────────────────────
    const patientSummary = buildPatientSummary(patientContext, chiefComplaint);

    const soapNote = await callGemini(GEMINI_API_KEY, [
      {
        text: `Você é um médico especialista gerando uma evolução clínica no formato SOAP em português brasileiro.

${patientSummary}

Transcrição da consulta:
${transcription}

Gere uma evolução SOAP completa e profissional com as seguintes seções obrigatórias:
**S (Subjetivo):** O que o paciente relatou (queixas, sintomas, evolução desde a última consulta)
**O (Objetivo):** Dados objetivos observados ou mencionados (peso, PA, exame físico, resultados de exames)
**A (Avaliação):** Análise clínica, diagnósticos ativos, resposta ao tratamento
**P (Plano):** Condutas, ajustes de medicação, solicitações, orientações, próximo retorno

Seja conciso, clínico e use terminologia médica adequada. Retorne apenas o texto SOAP formatado.`,
      },
    ]);

    // ── Step 3: Generate WhatsApp message ───────────────────────────────────
    const whatsappMessage = await callGemini(GEMINI_API_KEY, [
      {
        text: `Você é um médico escrevendo uma mensagem informal e acolhedora para o paciente via WhatsApp após a consulta.

Paciente: ${patientContext?.name ?? 'paciente'}, ${patientContext?.age ?? '?'} anos
Queixa principal: ${chiefComplaint || 'acompanhamento'}

Resumo clínico da consulta (SOAP):
${soapNote}

Escreva uma mensagem WhatsApp curta (máximo 5 linhas) que:
1. Cumprimente o paciente pelo nome
2. Resuma os pontos principais da consulta de forma simples (sem jargão médico)
3. Liste as orientações mais importantes com emojis
4. Mencione a próxima consulta se houver
5. Se despeça de forma acolhedora

Use emojis com moderação. Tom amigável mas profissional. Retorne apenas o texto da mensagem.`,
      },
    ]);

    // ── Step 4: Save consultation to DB ─────────────────────────────────────
    const { data: consultation, error: insertError } = await supabaseClient
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

    // Update patient last_visit
    await supabaseClient
      .from('patients')
      .update({ last_visit: new Date().toISOString().split('T')[0] })
      .eq('id', patientId);

    return new Response(
      JSON.stringify({
        consultationId: consultation.id,
        transcription,
        soapNote,
        whatsappMessage,
      }),
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
  const diagnoses = ctx.diagnoses?.map((d: any) => `${d.code} - ${d.description}`).join(', ') || 'Nenhum';
  const meds = ctx.medications?.map((m: any) => `${m.name} ${m.dosage} (${m.instructions})`).join(', ') || 'Nenhum';
  const allergies = ctx.allergies?.join(', ') || 'Nenhuma';
  return `Dados do paciente:
- Nome: ${ctx.name}, ${ctx.age} anos
- Queixa principal desta consulta: ${chiefComplaint || 'não informada'}
- Diagnósticos ativos: ${diagnoses}
- Medicações em uso: ${meds}
- Alergias: ${allergies}`;
}
