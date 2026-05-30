import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, uploadToGeminiFiles, buildPatientSummary } from "../_shared/gemini.ts";
import { getSpecialtyPrompt } from "../_shared/specialty_prompts.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Prompts ───────────────────────────────────────────────────────────────────

const TRANSCRIPTION_PROMPT = `Transcreva LITERALMENTE o áudio em português, identificando os falantes.

REGRA ABSOLUTA — FIDELIDADE:
- Transcreva APENAS o que foi realmente dito no áudio. Palavra por palavra.
- NUNCA invente, complete, deduza ou imagine falas. Se o áudio tem 10 segundos, a transcrição tem ~10 segundos de conteúdo.
- É TERMINANTEMENTE PROIBIDO produzir um diálogo de consulta que não está no áudio.
- Trechos inaudíveis ou incompreensíveis: marque como [inaudível]. Não adivinhe o conteúdo.

FORMATO (quando for uma consulta médica):
[MÉDICO] <fala>
[PACIENTE] <fala>
- Nova linha a cada mudança de falante.
- Preserve terminologia médica e nomes de medicamentos exatamente como pronunciados.
- Se não distinguir o falante, use [MÉDICO].

QUANDO O ÁUDIO NÃO É UMA CONSULTA MÉDICA:
- Transcreva mesmo assim o que foi realmente dito, usando [FALANTE] como rótulo.
- Se quase nada for inteligível ou não houver fala relevante, retorne EXATAMENTE: [SEM_CONSULTA]
- NÃO transforme isso em uma consulta fictícia.

Ignore ruídos de fundo, tosses e sons não-verbais. Retorne apenas a transcrição, sem comentários ou cabeçalhos.`;

// SOAP_SYSTEM is now specialty-aware — resolved per request via getSpecialtyPrompt().

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    soap_note:              { type: 'string' },
    whatsapp_message:       { type: 'string' },
    clarifications:         { type: 'array', items: { type: 'string' } },
    transcription_quality:  { type: 'string', enum: ['good', 'partial', 'poor'] },
    differential_diagnoses: { type: 'array', items: { type: 'string' } },
    drug_interaction_alerts:{ type: 'array', items: { type: 'string' } },
  },
  required: [
    'soap_note', 'whatsapp_message', 'clarifications', 'transcription_quality',
    'differential_diagnoses', 'drug_interaction_alerts',
  ],
};

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      patientId, userId, chiefComplaint, patientContext,
      audioStoragePath, audioMimeType, consultationComments, userSpecialty,
    } = await req.json();

    if (!patientId || !userId || !audioStoragePath) {
      return new Response(
        JSON.stringify({ error: 'patientId, userId e audioStoragePath são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Reserve ~30 credits before starting the expensive audio call.
    try {
      await checkQuota(supabase, userId, 30);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    // Download from Storage
    const { data: audioBlob, error: downloadError } = await supabase.storage
      .from('audio-recordings')
      .download(audioStoragePath);

    if (downloadError || !audioBlob) {
      throw new Error(`Erro ao baixar áudio: ${downloadError?.message}`);
    }

    const audioBuffer = await audioBlob.arrayBuffer();
    const mimeType = audioMimeType ?? 'audio/webm';

    // Upload to Gemini Files API
    const geminiFileUri = await uploadToGeminiFiles(GEMINI_API_KEY, audioBuffer, mimeType);

    // Delete from Storage immediately — it's now in Gemini Files (48h TTL)
    supabase.storage.from('audio-recordings').remove([audioStoragePath]).catch(() => {});

    // Transcribe
    const { text: transcription, usage: transUsage } = await callGemini(
      GEMINI_API_KEY,
      [
        { fileData: { mimeType, fileUri: geminiFileUri } },
        { text: TRANSCRIPTION_PROMPT },
      ],
      {
        systemInstruction: 'Você é um transcritor de áudio de máxima fidelidade. Você transcreve EXCLUSIVAMENTE o que foi realmente dito, palavra por palavra. Você NUNCA inventa, completa ou imagina falas. Quando o áudio não é uma consulta médica, você transcreve o conteúdo real como ele é.',
        temperature: 0.1,
        maxOutputTokens: 8000,
        thinkingBudget: 0,
      },
    );
    await recordUsage(supabase, userId, creditsFromUsage(transUsage));

    // Short-circuit: no consultation in this recording
    if (transcription.trim().toUpperCase().includes('[SEM_CONSULTA]')) {
      return new Response(
        JSON.stringify({
          transcription: '',
          soapNote: 'Gravação não corresponde a uma consulta médica — revise ou descarte.',
          whatsappMessage: '',
          clarifications: [
            'Esta gravação não parece ser uma consulta médica (parece uma conversa aleatória, teste, ou gravação acidental). Deseja descartar e usar o chat de Pergunta, ou houve mesmo uma consulta? Descreva os detalhes da consulta abaixo se quiser prosseguir.',
          ],
          transcriptionQuality: 'poor',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Generate draft SOAP
    const patientSummary = buildPatientSummary(patientContext, chiefComplaint);
    const commentsText = Array.isArray(consultationComments) && consultationComments.length > 0
      ? `\n\nObservações do médico durante a consulta:\n${consultationComments.join('\n')}`
      : '';

    const { text: draftRaw, usage: draftUsage } = await callGemini(
      GEMINI_API_KEY,
      [{ text: `${patientSummary}\n\nTranscrição da consulta:\n${transcription}\n\nQueixa principal: ${chiefComplaint || 'acompanhamento de rotina'}${commentsText}` }],
      {
        systemInstruction: getSpecialtyPrompt(userSpecialty),
        temperature: 0.3,
        maxOutputTokens: 2000,
        thinkingBudget: 512,
        responseMimeType: 'application/json',
        responseSchema: DRAFT_SCHEMA,
      },
    );
    await recordUsage(supabase, userId, creditsFromUsage(draftUsage));

    let soapNote = '';
    let whatsappMessage = '';
    let clarifications: string[] = [];
    let transcriptionQuality: 'good' | 'partial' | 'poor' = 'good';
    let differentialDiagnoses: string[] = [];
    let drugInteractionAlerts: string[] = [];
    try {
      const parsed = JSON.parse(draftRaw);
      soapNote              = parsed.soap_note              ?? '';
      whatsappMessage       = parsed.whatsapp_message       ?? '';
      clarifications        = Array.isArray(parsed.clarifications)         ? parsed.clarifications         : [];
      transcriptionQuality  = parsed.transcription_quality                 ?? 'good';
      differentialDiagnoses = Array.isArray(parsed.differential_diagnoses) ? parsed.differential_diagnoses : [];
      drugInteractionAlerts = Array.isArray(parsed.drug_interaction_alerts)? parsed.drug_interaction_alerts: [];
    } catch {
      soapNote = draftRaw;
    }

    return new Response(
      JSON.stringify({
        transcription, soapNote, whatsappMessage, clarifications, transcriptionQuality,
        differentialDiagnoses, drugInteractionAlerts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('transcribe-consultation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
