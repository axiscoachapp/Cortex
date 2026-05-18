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

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

/** Convert raw Gemini usageMetadata into credits. Safe for unknown shapes. */
export function creditsFromUsage(usage: any): number {
  if (!usage) return 0;
  // Gemini returns:
  //   promptTokenCount       (all input incl. audio when present)
  //   candidatesTokenCount   (output, includes thinking)
  //   thoughtsTokenCount     (subset of output when thinkingBudget > 0)
  //   promptTokensDetails: [{ modality: 'AUDIO' | 'TEXT' | 'IMAGE', tokenCount }]
  const details: any[] = usage.promptTokensDetails ?? [];
  let audioIn = 0;
  let textIn = 0;
  for (const d of details) {
    const t = Number(d.tokenCount ?? 0);
    if (d.modality === "AUDIO")        audioIn += t;
    else if (d.modality === "TEXT")    textIn  += t;
    else                                textIn  += t; // image/video billed as text-input here
  }
  // If breakdown missing, treat the whole prompt as text input.
  if (audioIn === 0 && textIn === 0) {
    textIn = Number(usage.promptTokenCount ?? 0);
  }
  const out = Number(usage.candidatesTokenCount ?? 0);

  return (
    textIn  * CREDITS_PER_TOKEN.text_input  +
    audioIn * CREDITS_PER_TOKEN.audio_input +
    out     * CREDITS_PER_TOKEN.text_output
  );
}

/** Fetch (with default fallback) the user's daily credit limit. */
async function getLimit(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data } = await supabase
    .from("user_settings")
    .select("daily_credit_limit")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.daily_credit_limit ?? DEFAULT_DAILY_LIMIT;
}

/** Fetch today's credits_used. */
async function getUsed(supabase: SupabaseClient, userId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("usage_daily")
    .select("credits_used")
    .eq("user_id", userId)
    .eq("day", today)
    .maybeSingle();
  return Number(data?.credits_used ?? 0);
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
): Promise<{ used: number; limit: number }> {
  if (!userId) {
    // No user → no quota enforcement; let the call through.
    return { used: 0, limit: DEFAULT_DAILY_LIMIT };
  }
  const [limit, used] = await Promise.all([getLimit(supabase, userId), getUsed(supabase, userId)]);
  if (used >= limit) throw new QuotaExceededError(used, limit);
  if (used + estimatedCredits > limit) throw new QuotaExceededError(used, limit);
  return { used, limit };
}

/**
 * Record actual credits consumed after a successful Gemini call.
 * Atomic via the record_usage(...) SQL function. Never throws to the caller —
 * usage logging must not break the user flow.
 */
export async function recordUsage(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  credits: number,
): Promise<void> {
  if (!userId || credits <= 0) return;
  try {
    await supabase.rpc("record_usage", { p_user_id: userId, p_credits: credits });
  } catch (err) {
    console.error("recordUsage failed:", err);
  }
}

/** Build a 429 Response body the frontend can render verbatim. */
export function quotaResponse(err: QuotaExceededError, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: err.message,
      quotaExceeded: true,
      used: err.used,
      limit: err.limit,
    }),
    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
