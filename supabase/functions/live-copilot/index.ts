import { fetchWithDeadline, readJsonObject, RequestError } from "../_shared/http.ts";
/**
 * Live consultation copilot.
 *
 * Receives the audio of the last ~30s of an in-progress consultation plus the
 * previous copilot state, and returns an UPDATED state — a rolling clinical
 * summary with alerts, unexplored topics, and suggested questions.
 *
 * Rolling-state design: each call sends only (previous summary + new audio),
 * so the payload stays constant-size for the whole consult instead of growing
 * with the transcript. The final SOAP note is still generated from the FULL
 * recording by transcribe/finalize — live drift can never contaminate the
 * medical record; this output is disposable in-consult context only.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, buildPatientSummary, parseModelObject } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assertPromptSize, isRecord, optionalText, readPatientContext } from '../_shared/modelInput.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const MAX_CHUNKS = 4;                      // frontend batches at most 4 pending chunks
const MAX_CHUNK_BASE64 = 2_000_000;        // ~1.5MB audio ≈ 60s+ of opus — hard cap per chunk

const COPILOT_SYSTEM = `Você é um copiloto clínico em TEMPO REAL auxiliando um médico DURANTE a consulta.

Você recebe:
1. O estado anterior do copiloto (resumo, alertas, tópicos não explorados, sugestões) — pode ser nulo no início.
2. O áudio dos últimos segundos da consulta (pode conter as vozes do médico e do paciente).
3. O contexto do paciente e as sugestões já descartadas pelo médico.

Sua tarefa: retornar o estado ATUALIZADO, incorporando o que foi dito no novo áudio.

CAMPOS:
- resumo: os pontos clínicos principais da consulta até agora. Máximo 6 itens.
- alertas: red flags clínicos ou interações medicamentosas mencionadas/evidentes. Máximo 3 itens. Vazio se nenhum.
- nao_explorado: tópicos clinicamente relevantes que surgiram mas NÃO foram aprofundados pelo médico. Máximo 4 itens.
- sugestoes: perguntas objetivas que o médico ainda não fez e que agregariam valor clínico agora. Máximo 4 itens.

REGRAS:
- MANTENHA os itens do resumo anterior, exceto quando o novo áudio os contradiz ou refina.
- NUNCA invente informações que não foram ditas. Se o áudio for silêncio ou sem conteúdo clínico novo, retorne o estado anterior inalterado.
- Remova sugestões que o médico já perguntou ou que o paciente já respondeu; NÃO repita as sugestões descartadas listadas.
- Hipóteses sempre como possibilidade ("possível...", "considerar..."), nunca afirmação diagnóstica.
- Itens telegráficos: máximo ~12 palavras cada. Português brasileiro.
- Responda APENAS com o JSON do estado.`;

const COPILOT_SCHEMA = {
  type: 'object',
  properties: {
    resumo:        { type: 'array', items: { type: 'string' } },
    alertas:       { type: 'array', items: { type: 'string' } },
    nao_explorado: { type: 'array', items: { type: 'string' } },
    sugestoes:     { type: 'array', items: { type: 'string' } },
  },
  required: ['resumo', 'alertas', 'nao_explorado', 'sugestoes'],
};
interface CopilotState { resumo: string[]; alertas: string[]; nao_explorado: string[]; sugestoes: string[] }

function strArr(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, max)
    : [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const body: Record<string, unknown> = await readJsonObject(req, 8 * 1024 * 1024);
    const { audioChunks, prevState, dismissed } = body;
    const patientContext = readPatientContext(body.patientContext);
    const chiefComplaint = optionalText(body.chiefComplaint, 'Queixa principal');

    if (!Array.isArray(audioChunks) || audioChunks.length === 0 || audioChunks.length > MAX_CHUNKS) {
      return new Response(
        JSON.stringify({ error: `Envie entre 1 e ${MAX_CHUNKS} trechos de áudio.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const chunks = audioChunks.map((chunk: unknown) => {
      if (!isRecord(chunk) || typeof chunk.data !== 'string' || !chunk.data || chunk.data.length > MAX_CHUNK_BASE64) {
        throw new RequestError('Trecho de áudio inválido.');
      }
      const mimeType = optionalText(chunk.mimeType, 'Tipo do áudio') || 'audio/webm';
      if (!mimeType.startsWith('audio/') || mimeType.length > 100) throw new RequestError('Tipo do áudio inválido.');
      return { data: chunk.data, mimeType };
    });

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Sanitize the incoming state — it round-trips through the client, so cap
    // sizes rather than trusting it verbatim.
    let prev: CopilotState | null = null;
    if (prevState != null) {
      try { prev = parseModelObject<CopilotState>(JSON.stringify(prevState), COPILOT_SCHEMA); }
      catch { throw new RequestError('Estado anterior do copiloto inválido.'); }
      prev = { resumo: strArr(prev.resumo, 6), alertas: strArr(prev.alertas, 3), nao_explorado: strArr(prev.nao_explorado, 4), sugestoes: strArr(prev.sugestoes, 4) };
    }
    if (dismissed != null && (!Array.isArray(dismissed) || dismissed.some(value => typeof value !== 'string'))) throw new RequestError('Sugestões descartadas inválidas.');
    const dismissedList = strArr(dismissed, 12);

    const patientBlock = buildPatientSummary(patientContext, chiefComplaint ?? '');
    const promptText = [
      patientBlock ? `--- Contexto do Paciente ---\n${patientBlock}\n---` : '',
      chiefComplaint ? `Queixa principal: ${String(chiefComplaint).slice(0, 300)}` : '',
      prev
        ? `Estado anterior do copiloto:\n${JSON.stringify(prev)}`
        : 'Estado anterior: nenhum (início da consulta).',
      dismissedList.length
        ? `Sugestões descartadas pelo médico (NÃO repetir):\n- ${dismissedList.join('\n- ')}`
        : '',
      'Atualize o estado com base no novo áudio acima.',
    ].filter(Boolean).join('\n\n');

    const parts: object[] = [
      ...chunks.map(c => ({
        inlineData: { mimeType: c.mimeType, data: c.data },
      })),
      { text: promptText },
    ];
    assertPromptSize(promptText, COPILOT_SYSTEM);
    let reservationId: string;
    try {
      ({ reservationId } = await checkQuota(supabase, userId, 400));
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const { text: raw, usage } = await callGemini(GEMINI_API_KEY, parts, {
      systemInstruction: COPILOT_SYSTEM,
      temperature: 0.2,
      maxOutputTokens: 800,
      thinkingBudget: 0,          // latency matters — this runs mid-consult
      responseMimeType: 'application/json',
      responseSchema: COPILOT_SCHEMA,
    });

    await recordUsage(supabase, userId, creditsFromUsage(usage), reservationId);

    const parsed = parseModelObject<CopilotState>(raw, COPILOT_SCHEMA);
    const state = {
      resumo: strArr(parsed.resumo, 6), alertas: strArr(parsed.alertas, 3),
      nao_explorado: strArr(parsed.nao_explorado, 4), sugestoes: strArr(parsed.sugestoes, 4),
    };

    return new Response(
      JSON.stringify(state),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('live-copilot error:');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
