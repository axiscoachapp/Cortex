/* Shared per-user daily Gemini-usage quota.
 *
 * 1 credit = $0.001 of real Gemini API cost.
 *
 * Conversion (Gemini 2.5 Flash, billed by Google AI Studio):
 *   text input  $0.30 / 1M tokens  →  0.0003 credits / token
 *   text output $2.50 / 1M tokens  →  0.0025 credits / token
 *   audio input $1.00 / 1M tokens  →  0.0010 credits / token
 *
 * Default daily limit 1500 credits = ~$1.50/day = ~$45/month worst case.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { assertAiEnabled } from './operationControls.ts';

export const DEFAULT_DAILY_LIMIT = 1500;

export const CREDITS_PER_TOKEN = {
  text_input:  0.0003,
  text_output: 0.0025,
  audio_input: 0.0010,
} as const;

export class QuotaExceededError extends Error {
  status = 429;
  constructor(public used: number, public limit: number) {
    super(`Limite diário atingido (${Math.round(used)}/${limit} créditos). Reseta em 24h.`);
    this.name = "QuotaExceededError";
  }
}
export class OperationRateError extends QuotaExceededError {
  constructor(used:number,limit:number,public retryAfterSeconds=60) {
    super(used,limit);
    this.name='OperationRateError';
    this.message='Muitas operações em sequência. Aguarde um minuto e tente novamente.';
  }
}

/** Convert raw Gemini usageMetadata into credits. Safe for unknown shapes. */
export function creditsFromUsage(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const usage = value as Record<string, unknown>;
  // Gemini returns:
  //   promptTokenCount       (all input incl. audio when present)
  // candidatesTokenCount and thoughtsTokenCount are separate billed output.
  //   promptTokensDetails: [{ modality: 'AUDIO' | 'TEXT' | 'IMAGE', tokenCount }]
  const details: unknown[] = Array.isArray(usage.promptTokensDetails) ? usage.promptTokensDetails : [];
  let audioIn = 0;
  let textIn = 0;
  for (const d of details) {
    if (!d || typeof d !== 'object') continue;
    const detail = d as Record<string, unknown>;
    const t = Number(detail.tokenCount ?? 0);
    if (!Number.isFinite(t) || t < 0) throw new Error('Consumo retornado pelo provedor inválido');
    if (detail.modality === "AUDIO")        audioIn += t;
    else if (detail.modality === "TEXT")    textIn  += t;
    else                                textIn  += t; // image/video billed as text-input here
  }
  // If breakdown missing, treat the whole prompt as text input.
  if (audioIn === 0 && textIn === 0) {
    textIn = Number(usage.promptTokenCount ?? 0);
  }
  const out = Number(usage.candidatesTokenCount ?? 0) + Number(usage.thoughtsTokenCount ?? 0);
  if (![textIn,audioIn,out].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Consumo retornado pelo provedor inválido');

  return (
    textIn  * CREDITS_PER_TOKEN.text_input  +
    audioIn * CREDITS_PER_TOKEN.audio_input +
    out     * CREDITS_PER_TOKEN.text_output
  );
}

export interface QuotaReservation { used: number; limit: number; reservationId: string }

/**
 * Throws QuotaExceededError if the user has already exceeded their daily limit,
 * OR if the (current + estimated) would exceed it. Call this BEFORE invoking
 * Gemini. The estimate doesn't have to be perfect — it just gates obviously
 * expensive calls when the user is already near the cap.
 */
export async function checkQuota(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  estimatedCredits: number = 0,
  operation: 'ai' | 'communication' = 'ai',
): Promise<QuotaReservation> {
  if (!userId) {
    // No identity → refuse. A silent pass-through here let callers bypass
    // quota entirely by omitting userId. All callers now derive userId from
    // the JWT (see _shared/auth.ts), so this only fires on programming errors.
    throw new Error("checkQuota chamado sem userId autenticado");
  }
  if (!Number.isFinite(estimatedCredits) || estimatedCredits < 0) throw new Error('Estimativa de consumo inválida');
  if(operation==='ai') assertAiEnabled();
  const {data:admission,error:admissionError}=await supabase.rpc('admit_operation',{p_user_id:userId,p_operation:operation});
  if(admissionError || !admission || typeof admission.allowed!=='boolean' || !Number.isFinite(Number(admission.used)) || !Number.isFinite(Number(admission.limit))) throw new Error('Controle de operações indisponível. Tente novamente.');
  if(!admission.allowed) throw new OperationRateError(Number(admission.used),Number(admission.limit));
  const reservationId = crypto.randomUUID();
  const {data, error} = await supabase.rpc('reserve_usage', {
    p_user_id: userId, p_credits: Math.max(25, estimatedCredits), p_reservation_id: reservationId,
  });
  if (error || !data || typeof data.allowed !== 'boolean' || !Number.isFinite(Number(data.used)) || !Number.isFinite(Number(data.limit))) {
    throw new Error('Controle de consumo indisponível. Tente novamente mais tarde.');
  }
  const used = Number(data.used); const limit = Number(data.limit);
  if (!data.allowed) throw new QuotaExceededError(used, limit);
  return {used, limit, reservationId};
}

/**
 * Record actual credits consumed after a successful Gemini call.
 * Idempotent settlement of one reservation. Accounting failures are surfaced;
 * the reservation remains charged, including interrupted/failed paid requests.
 */
export async function recordUsage(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  credits: number,
  reservationId: string,
): Promise<void> {
  if (!userId || !reservationId || !Number.isFinite(credits) || credits < 0) throw new Error('Registro de consumo inválido');
  // Missing usage must not refund an operation whose cost is unknown.
  const {data, error} = await supabase.rpc('settle_usage', {
    p_user_id: userId, p_reservation_id: reservationId, p_credits: credits > 0 ? credits : null,
  });
  if (error || data !== true) throw new Error('Não foi possível registrar o consumo');
}

/** Build a 429 Response body the frontend can render verbatim. */
export function quotaResponse(err: QuotaExceededError, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: err.message,
      quotaExceeded: !(err instanceof OperationRateError),
      rateLimited: err instanceof OperationRateError,
      used: err.used,
      limit: err.limit,
    }),
    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", ...(err instanceof OperationRateError ? {'Retry-After':String(err.retryAfterSeconds)} : {}) } },
  );
}
