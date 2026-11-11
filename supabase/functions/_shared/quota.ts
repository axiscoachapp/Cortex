/* Shared per-user daily inference quota.
 *
 * 1 credit = $0.001 of estimated list-price usage, not a provider invoice.
 *
 * Conversion (Gemini 2.5 Flash, billed by Google AI Studio):
 *   text input  $0.30 / 1M tokens  →  0.0003 credits / token
 *   text output $2.50 / 1M tokens  →  0.0025 credits / token
 *   audio input $1.00 / 1M tokens  →  0.0010 credits / token
 * OpenAI initial test (2026-11-10): Terra $1/$5 per 1M input/output
 *   →  0.001 / 0.005 credits per token ($2/$7.50 above 272k input tokens);
 * gpt-transcribe $0.0045/min  →  4.5 credits per minute.
 * No cached-token discount is assumed. Missing usage retains the original
 * reservation. Quotas are admission estimates, not a guarantee of a monetary
 * ceiling for a single in-flight operation.
 *
 * A clinic day at these prices (reviewed 2026-11-11), per 20-minute consultation:
 *   transcription 20 min × 4.5                              90
 *   SOAP draft (~12k tokens in, ~2k out)                    22
 *   one regeneration in two visits                          11
 *   profile extraction + first-visit history (average)       5
 *   pre-consultation summary + question checklist           12
 *   two assistant questions (~20k tokens in each)           44
 *   ≈ 185 credits per consultation; 25 consultations ≈ 4,600 credits.
 * Default daily limit 8,000 credits (~$8/day ceiling) leaves ~70% margin for
 * longer visits, retries and the in-flight reservation of a long recording.
 * The day is the clinic's day (America/Sao_Paulo), as in reserve_usage.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { assertAiEnabled } from './operationControls.ts';
import { clinicDayBounds } from './clinicDate.ts';

export const DEFAULT_DAILY_LIMIT = 8000;

/** Reservation for one transcription, from the audio size. The recorder sets no bitrate, so the
 * duration is estimated at a low 32 kbps (4,000 bytes/s): the reservation is never below the real
 * cost of a normal recording, and the settlement then charges the reported duration. */
export function transcriptionReservationCredits(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 25;
  const minutes = bytes / 4000 / 60;
  return Math.max(25, Math.ceil(minutes * 4.5 * 1.1));
}

function renewalText(now = new Date()): string {
  const hours = Math.max(1, Math.round((Date.parse(clinicDayBounds(now).end) - now.getTime()) / 3_600_000));
  return `Renova à meia-noite, horário de Brasília (em cerca de ${hours} h).`;
}

export const CREDITS_PER_TOKEN = {
  text_input:  0.0003,
  text_output: 0.0025,
  audio_input: 0.0010,
} as const;

export class QuotaExceededError extends Error {
  status = 429;
  constructor(public used: number, public limit: number) {
    super(`Limite diário de IA atingido (${Math.round(used)} de ${limit} créditos). ${renewalText()}`);
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
  // Initial OpenAI list-price estimate (2026-11-10), not an invoice. Missing
  // metering leaves the reservation charged in recordUsage; never reuse Gemini
  // token prices for a new provider or count reasoning output twice.
  if (usage.provider === 'openai') {
    const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (usage.model === 'gpt-6.1-terra' && valid(usage.inputTokens) && valid(usage.outputTokens)) {
      const longContext = usage.inputTokens > 272_000;
      return usage.inputTokens * (longContext ? 0.002 : 0.001) + usage.outputTokens * (longContext ? 0.0075 : 0.005);
    }
    if (usage.model === 'gpt-transcribe' && valid(usage.durationSeconds)) return usage.durationSeconds * (4.5 / 60);
    return 0;
  }
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

/** Rate admission is independent of paid inference and its kill switch. */
export async function admitOperation(supabase: SupabaseClient, userId: string, operation: 'ai' | 'communication' = 'ai'): Promise<{ userId: string; operation: 'ai' | 'communication' }> {
  if (!userId) throw new Error('Operação sem usuário autenticado');
  const {data:admission,error}=await supabase.rpc('admit_operation',{p_user_id:userId,p_operation:operation});
  if(error || !admission || typeof admission.allowed!=='boolean' || !Number.isFinite(Number(admission.used)) || !Number.isFinite(Number(admission.limit))) throw new Error('Controle de operações indisponível. Tente novamente.');
  if(!admission.allowed) throw new OperationRateError(Number(admission.used),Number(admission.limit));
  return { userId, operation };
}

/** Reserve paid work only after its separate rate admission. */
export async function reserveAdmittedCredits(supabase: SupabaseClient, admission: {userId:string;operation:'ai'|'communication'}, estimatedCredits: number): Promise<QuotaReservation> {
  const { userId, operation } = admission;
  if (!userId || !Number.isFinite(estimatedCredits) || estimatedCredits < 0) throw new Error('Reserva de consumo inválida');
  if (operation === 'ai') assertAiEnabled();
  const reservationId = crypto.randomUUID();
  const {data,error} = await supabase.rpc('reserve_usage', {p_user_id:userId,p_credits:Math.max(25,estimatedCredits),p_reservation_id:reservationId});
  if(error || !data || typeof data.allowed!=='boolean' || !Number.isFinite(Number(data.used)) || !Number.isFinite(Number(data.limit))) throw new Error('Controle de consumo indisponível. Tente novamente mais tarde.');
  const used=Number(data.used);const limit=Number(data.limit);
  if(!data.allowed)throw new QuotaExceededError(used,limit);
  return {used,limit,reservationId};
}

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
  return reserveAdmittedCredits(supabase,await admitOperation(supabase,userId,operation),estimatedCredits);
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

/** Release a reservation at zero cost. Only for work the provider certainly did not bill. */
export async function releaseReservation(supabase: SupabaseClient, userId: string, reservationId: string): Promise<void> {
  if (!userId || !reservationId) throw new Error('Registro de consumo inválido');
  const { data, error } = await supabase.rpc('settle_usage', { p_user_id: userId, p_reservation_id: reservationId, p_credits: 0 });
  if (error || data !== true) throw new Error('Não foi possível liberar a reserva de consumo');
}

/**
 * Settle the reservation of a paid call that failed, so failures do not lock the doctor out:
 * - not sent, or answered non-2xx (`billing: 'none'` on the adapter error): released at zero;
 * - answered 2xx with unusable output (`billing: 'reserved'`): the reservation is charged;
 * - transport failure or timeout (cost unknown): left to the stale-reservation release.
 * Never throws: the caller is already reporting the original failure.
 */
export async function settleFailedCall(supabase: SupabaseClient, userId: string, reservationId: string, failure: unknown): Promise<void> {
  const billing = failure && typeof failure === 'object' ? (failure as { billing?: unknown }).billing : undefined;
  try {
    if (billing === 'none') await releaseReservation(supabase, userId, reservationId);
    else if (billing === 'reserved') await recordUsage(supabase, userId, 0, reservationId);
  } catch { /* The reservation stays pending; the stale-reservation job frees it later. */ }
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
      ...(err instanceof OperationRateError ? {} : { resetsAt: clinicDayBounds().end }),
    }),
    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", ...(err instanceof OperationRateError ? {'Retry-After':String(err.retryAfterSeconds)} : {}) } },
  );
}
