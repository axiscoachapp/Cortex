import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";

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
}

async function callGemini(apiKey: string, parts: object[], cfg: GeminiConfig = {}): Promise<{ text: string; usage: any }> {
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
  const parts2: any[] = json.candidates?.[0]?.content?.parts ?? [];
  const responsePart = parts2.find((p: any) => !p.thought) ?? parts2[parts2.length - 1];
  return { text: responsePart?.text ?? '', usage: json.usageMetadata };
}

const CHAT_SYSTEM = `Você é um assistente clínico de IA auxiliando um médico durante a consulta. Você tem acesso ao contexto do paciente e ao histórico de consultas anteriores fornecidos abaixo.

Responda sempre em português brasileiro. Suas respostas devem ser diretas, objetivas e com no máximo 200 palavras.

Quando o médico perguntar sobre o histórico do paciente ("o que conversamos na última consulta?", "qual foi a conduta?", "como ele evoluiu?"), use o bloco de "Histórico de Consultas Anteriores" abaixo como fonte primária de verdade. Cite datas quando relevante.

Você também pode ajudar com:
- Diagnóstico diferencial
- Interações medicamentosas
- Diretrizes clínicas e protocolos
- Interpretação de sintomas e achados

Se não souber a resposta com segurança, diga claramente que não sabe. Nunca invente informações clínicas nem invente registros de consultas anteriores — se não estiverem no histórico abaixo, diga "não consta no histórico".`;

// Strip SOAP markdown bold to keep tokens lean
function condense(text: string, max = 600): string {
  const t = (text ?? '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { patientId, patientContext, chatHistory, userMessage, userId } = body;

    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: 'userMessage é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Quota check: chat is cheap (~1 credit) but block obvious abuse. ──────
    try {
      await checkQuota(supabase, userId, 1);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    // ── Pull full patient row + recent consultations when patientId provided ──
    let patientRow: any = null;
    let consultations: any[] = [];
    if (patientId) {
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase
          .from('patients')
          .select('name, age, diagnoses, medications, allergies, social_anamnesis, medical_history, clinical_notes')
          .eq('id', patientId)
          .maybeSingle(),
        supabase
          .from('consultations')
          .select('created_at, chief_complaint, soap_note')
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      patientRow = p;
      consultations = c ?? [];
    }

    // Merge: DB row wins; fall back to client-provided context.
    const ctx = patientRow ?? patientContext ?? null;

    // ── Build patient context summary ────────────────────────────────────────
    let patientSummary = '';
    if (ctx) {
      const diagnoses = Array.isArray(ctx.diagnoses)
        ? ctx.diagnoses.map((d: any) => (typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`.trim())).join('; ') || 'Nenhum'
        : 'Nenhum';
      const medications = Array.isArray(ctx.medications)
        ? ctx.medications.map((m: any) => (typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`.trim())).join(', ') || 'Nenhuma'
        : 'Nenhuma';
      const allergies = Array.isArray(ctx.allergies)
        ? ctx.allergies.join(', ') || 'Nenhuma'
        : 'Nenhuma';

      patientSummary = `--- Contexto do Paciente ---
Nome: ${ctx.name ?? 'Não informado'}
Idade: ${ctx.age ?? 'Não informada'} anos
Diagnósticos: ${diagnoses}
Medicações em uso: ${medications}
Alergias: ${allergies}`;

      const social = (ctx.social_anamnesis ?? ctx.socialAnamnesis ?? '').trim?.() || '';
      const history = (ctx.medical_history ?? ctx.medicalHistory ?? '').trim?.() || '';
      const notes = (ctx.clinical_notes ?? '').trim?.() || '';
      if (social)  patientSummary += `\nAnamnese social: ${condense(social, 400)}`;
      if (history) patientSummary += `\nHistória médica: ${condense(history, 400)}`;
      if (notes)   patientSummary += `\nAnotações do médico: ${condense(notes, 600)}`;
      patientSummary += `\n----------------------------\n\n`;
    }

    // ── Build consultation history block ─────────────────────────────────────
    let historySummary = '';
    if (consultations.length > 0) {
      historySummary = '--- Histórico de Consultas Anteriores (mais recente primeiro) ---\n';
      for (const c of consultations) {
        const date = formatDate(c.created_at);
        const complaint = (c.chief_complaint ?? '').trim() || 'sem queixa registrada';
        const soap = condense(c.soap_note ?? '', 700);
        historySummary += `\n[${date}] Queixa: ${complaint}\n${soap}\n`;
      }
      historySummary += '----------------------------\n\n';
    } else if (patientId) {
      historySummary = '--- Histórico de Consultas Anteriores ---\nNenhuma consulta anterior registrada.\n----------------------------\n\n';
    }

    // ── Build conversation history ───────────────────────────────────────────
    const historyLines: string[] = [];
    if (Array.isArray(chatHistory)) {
      for (const msg of chatHistory) {
        if (msg.type === 'user') {
          historyLines.push(`Médico: ${msg.content}`);
        } else if (msg.type === 'assistant') {
          historyLines.push(`Assistente: ${msg.content}`);
        }
      }
    }

    const conversationBlock = historyLines.length > 0
      ? historyLines.join('\n') + '\n'
      : '';

    const promptText = `${patientSummary}${historySummary}${conversationBlock}Médico: ${userMessage}`;

    const { text: reply, usage } = await callGemini(
      GEMINI_API_KEY,
      [{ text: promptText }],
      {
        systemInstruction: CHAT_SYSTEM,
        temperature: 0.3,
        maxOutputTokens: 600,
        thinkingBudget: 0,
      },
    );

    const credits = creditsFromUsage(usage);
    await recordUsage(supabase, userId, credits);

    return new Response(
      JSON.stringify({ message: reply, credits }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('chat-assistant error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
