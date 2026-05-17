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

// Upload audio to Gemini Files API via resumable upload — handles files of any size
async function uploadToGeminiFiles(apiKey: string, audioBuffer: ArrayBuffer, mimeType: string): Promise<string> {
  // Step 1: Initiate resumable upload session
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'X-Goog-Upload-Header-Content-Length': String(audioBuffer.byteLength),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'consultation-audio' } }),
    },
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Gemini Files init error ${initRes.status}: ${err}`);
  }

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('Gemini Files API did not return an upload URL');

  // Step 2: Upload the audio data
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(audioBuffer.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: new Blob([audioBuffer], { type: mimeType }),
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Gemini Files upload error ${uploadRes.status}: ${err}`);
  }

  const fileInfo = await uploadRes.json();
  const fileUri = fileInfo.file?.uri;
  if (!fileUri) throw new Error('Gemini Files API did not return a file URI');

  return fileUri;
}

// Phase 1 schema — includes clarifications and transcription quality
const SOAP_SCHEMA_DRAFT = {
  type: 'object',
  properties: {
    soap_note: { type: 'string', description: 'Evolução SOAP formatada com seções **S**, **O**, **A**, **P**' },
    whatsapp_message: { type: 'string', description: 'Mensagem WhatsApp para o paciente, max 180 palavras' },
    clarifications: {
      type: 'array',
      items: { type: 'string' },
      description: 'Perguntas ao médico sobre lacunas clinicamente relevantes na transcrição. Array vazio se a transcrição for clara.',
    },
    transcription_quality: {
      type: 'string',
      enum: ['good', 'partial', 'poor'],
      description: 'Qualidade da transcrição: good = clara; partial = partes inaudíveis; poor = incompreensível',
    },
  },
  required: ['soap_note', 'whatsapp_message', 'clarifications', 'transcription_quality'],
};

// Phase 2 schema — no clarifications needed, doctor already answered them
const SOAP_SCHEMA_FINAL = {
  type: 'object',
  properties: {
    soap_note: { type: 'string', description: 'Evolução SOAP formatada com seções **S**, **O**, **A**, **P**' },
    whatsapp_message: { type: 'string', description: 'Mensagem WhatsApp para o paciente, max 180 palavras' },
  },
  required: ['soap_note', 'whatsapp_message'],
};

const TRANSCRIPTION_PROMPT = `Transcreva esta consulta médica com identificação obrigatória de falantes.

Use exatamente o formato:
[MÉDICO] <fala>
[PACIENTE] <fala>

Regras:
- Inicie uma nova linha a cada mudança de falante
- Preserve terminologia médica e nomes de medicamentos exatamente como pronunciados
- Se não conseguir distinguir o falante, use [MÉDICO] como padrão
- Não resuma, não omita e não parafraseie — transcreva tudo na íntegra
- Ignore ruídos de fundo, tosses e sons não-verbais

Retorne apenas a transcrição formatada, sem comentários ou cabeçalhos.`;

const SOAP_SYSTEM = `Você é um médico especialista gerando documentação clínica em português brasileiro.

A transcrição usa os rótulos [MÉDICO] e [PACIENTE] para identificar os falantes.
Use esses rótulos para preencher corretamente cada seção do SOAP:
- Seção S (Subjetivo): o que o [PACIENTE] relatou
- Seção O (Objetivo): dados objetivos mencionados pelo [MÉDICO] (exame físico, sinais vitais)
- Seção A (Avaliação): hipóteses e conclusões do [MÉDICO]
- Seção P (Plano): condutas decididas pelo [MÉDICO]

REGRA FUNDAMENTAL — FONTE DOS DADOS:
O SOAP deve ser gerado EXCLUSIVAMENTE a partir do que foi dito na transcrição desta consulta.
O histórico do paciente (diagnósticos, medicações, alergias) é fornecido apenas como contexto clínico de fundo — NUNCA use-o para preencher seções do SOAP com informações que não foram discutidas nesta consulta.

Exemplos do que NÃO fazer:
- Se PA não foi mencionada na consulta → não coloque PA no Objetivo
- Se um diagnóstico não foi discutido → não o inclua na Avaliação
- Se a transcrição for incoerente → documente "Transcrição inaudível/incompleta" na seção relevante

Gere os seguintes campos:

1. soap_note: Evolução SOAP profissional com as seções:
**S (Subjetivo):** Queixas e relato do paciente NESTA consulta
**O (Objetivo):** Dados objetivos mencionados NA consulta (sinais vitais, exame físico relatado)
**A (Avaliação):** Avaliação clínica baseada no que foi discutido nesta consulta
**P (Plano):** Condutas e decisões tomadas nesta consulta
Use terminologia médica precisa. Se uma seção não tiver dados da transcrição, escreva "Não relatado na consulta."

2. whatsapp_message: Mensagem curta e acolhedora para o paciente (máx. 180 palavras):
- Cumprimente pelo nome
- Resuma orientações em linguagem simples com emojis (💊🩺📅)
- Tom amigável e profissional

3. clarifications: Lista de perguntas para o médico preencher lacunas CLINICAMENTE RELEVANTES da transcrição.
Retorne array vazio [] se a transcrição capturou bem a consulta.
Só pergunte sobre informações que fariam diferença clínica real (ex: dose ajustada, resultado de exame discutido, conduta decidida que ficou cortada).
Máximo 4 perguntas objetivas e específicas.

4. transcription_quality: Avalie a qualidade geral da transcrição:
- "good": transcrição clara, consulta bem representada
- "partial": algumas partes inaudíveis ou cortadas, mas conteúdo principal capturado
- "poor": transcrição muito incompleta, incoerente ou inaudível`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { patientId, userId, chiefComplaint, patientContext } = body;

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    // ── Phase 1: Download audio from Storage → Gemini Files API → transcribe → draft SOAP ──
    if (body.audioStoragePath) {
      const { audioStoragePath, audioMimeType } = body;

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

      // Download audio blob from Supabase Storage
      const { data: audioBlob, error: downloadError } = await supabase.storage
        .from('audio-recordings')
        .download(audioStoragePath);

      if (downloadError || !audioBlob) {
        throw new Error(`Erro ao baixar áudio do storage: ${downloadError?.message}`);
      }

      const audioBuffer = await audioBlob.arrayBuffer();

      // Upload to Gemini Files API (handles any size, no base64 overhead)
      const geminiFileUri = await uploadToGeminiFiles(
        GEMINI_API_KEY,
        audioBuffer,
        audioMimeType ?? 'audio/webm',
      );

      // Clean up storage immediately — audio is now in Gemini Files (48h TTL)
      supabase.storage.from('audio-recordings').remove([audioStoragePath]).catch(() => {});

      // Transcribe with speaker diarization
      const transcription = await callGemini(
        GEMINI_API_KEY,
        [
          { fileData: { mimeType: audioMimeType ?? 'audio/webm', fileUri: geminiFileUri } },
          { text: TRANSCRIPTION_PROMPT },
        ],
        {
          systemInstruction: 'Você é um especialista em transcrição de consultas médicas. Sua única função é transcrever com máxima fidelidade, preservando termos técnicos e nomes de medicamentos.',
          temperature: 0.1,
          maxOutputTokens: 8000,
          thinkingBudget: 0,
        },
      );

      const patientSummary = buildPatientSummary(patientContext, chiefComplaint);
      const commentsText = Array.isArray(body.consultationComments) && body.consultationComments.length > 0
        ? `\n\nObservações do médico durante a consulta:\n${body.consultationComments.join('\n')}`
        : '';

      const draftRaw = await callGemini(
        GEMINI_API_KEY,
        [{ text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${chiefComplaint || 'acompanhamento de rotina'}${commentsText}` }],
        {
          systemInstruction: SOAP_SYSTEM,
          temperature: 0.3,
          maxOutputTokens: 2000,
          thinkingBudget: 512,
          responseMimeType: 'application/json',
          responseSchema: SOAP_SCHEMA_DRAFT,
        },
      );

      let soapDraft = '';
      let whatsappDraft = '';
      let clarifications: string[] = [];
      let transcriptionQuality: 'good' | 'partial' | 'poor' = 'good';
      try {
        const parsed = JSON.parse(draftRaw);
        soapDraft = parsed.soap_note ?? '';
        whatsappDraft = parsed.whatsapp_message ?? '';
        clarifications = Array.isArray(parsed.clarifications) ? parsed.clarifications : [];
        transcriptionQuality = parsed.transcription_quality ?? 'good';
      } catch {
        soapDraft = draftRaw;
      }

      return new Response(
        JSON.stringify({ transcription, soapNote: soapDraft, whatsappMessage: whatsappDraft, clarifications, transcriptionQuality }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Phase 1.5: Save pre-generated SOAP directly (no extra Gemini call) ──────
    if (body.saveDirect) {
      const { saveSoapNote, saveWhatsappMessage, transcription } = body;

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

      const { data: consultation, error: insertError } = await supabase
        .from('consultations')
        .insert([{
          patient_id: patientId,
          user_id: userId,
          chief_complaint: chiefComplaint,
          transcription,
          soap_note: saveSoapNote ?? '',
          whatsapp_message: saveWhatsappMessage ?? '',
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      await supabase
        .from('patients')
        .update({ last_visit: new Date().toISOString().split('T')[0], status: 'retorno' })
        .eq('id', patientId);

      await markAppointmentDone(supabase, patientId, userId);

      return new Response(
        JSON.stringify({ consultationId: consultation.id, soapNote: saveSoapNote, whatsappMessage: saveWhatsappMessage }),
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
          maxOutputTokens: 2000,
          thinkingBudget: 1024,
          responseMimeType: 'application/json',
          responseSchema: SOAP_SCHEMA_FINAL,
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

      await markAppointmentDone(supabase, patientId, userId);

      return new Response(
        JSON.stringify({ consultationId: consultation.id, soapNote, whatsappMessage }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'audioStoragePath ou transcription é obrigatório' }),
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

async function markAppointmentDone(supabase: any, patientId: string, userId: string): Promise<void> {
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
}

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
