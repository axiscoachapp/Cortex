import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const BRIEFING_SCHEMA = {
  type: 'object',
  properties: {
    returnInfo:        { type: 'string', description: 'Frase curta sobre o retorno, ex: "Retorna após 45 dias"' },
    previousComplaint: { type: 'string', description: 'Queixa principal da última consulta em até 8 palavras' },
    pending:           { type: 'string', description: 'Pendências ou exames a verificar (string vazia se nenhum)' },
    alert:             { type: 'string', description: 'Alerta clínico relevante para o médico (string vazia se nenhum)' },
    details: {
      type: 'object',
      properties: {
        lastConsultationDate: { type: 'string' },
        mainComplaint:        { type: 'string' },
        previousConduct:      { type: 'string' },
        evolution:            { type: 'string' },
      },
      required: ['lastConsultationDate', 'mainComplaint', 'previousConduct', 'evolution'],
    },
  },
  required: ['returnInfo', 'previousComplaint', 'pending', 'alert', 'details'],
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { patientId, patientContext } = await req.json();

    if (!patientId) {
      return new Response(
        JSON.stringify({ error: 'patientId é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: last } = await supabase
      .from('consultations')
      .select('id, chief_complaint, soap_note, created_at, pre_briefing')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!last) {
      return new Response(JSON.stringify(null), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Cache hit: return stored briefing without calling Gemini ─────────────
    if (last.pre_briefing && typeof last.pre_briefing === 'object' && (last.pre_briefing as any).returnInfo) {
      return new Response(
        JSON.stringify(last.pre_briefing),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Build lean prompt: only send A+P sections (~60% fewer input tokens) ──
    const apSection = extractAssessmentAndPlan(last.soap_note ?? '');
    const daysSince = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86400000);
    const lastDate = new Date(last.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const diagnoses = patientContext?.diagnoses?.map((d: any) => `${d.code} ${d.description}`).join('; ') || 'Não informado';
    const meds = patientContext?.medications?.map((m: any) => `${m.name} ${m.dosage}`).join(', ') || 'Nenhum';

    const prompt = `Paciente: ${patientContext?.name ?? 'paciente'}, ${patientContext?.age ?? '?'} anos
Diagnósticos: ${diagnoses}
Medicações: ${meds}
Alergias: ${patientContext?.allergies?.join(', ') || 'Nenhuma'}

Última consulta: ${lastDate} (${daysSince} dias atrás)
Queixa: ${last.chief_complaint || 'não registrada'}

Avaliação e Plano da última consulta:
${apSection}`;

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Você é um assistente médico gerando resumos pré-consulta concisos e clinicamente relevantes. Destaque pendências, alertas e a evolução do quadro de forma objetiva para o médico.' }],
        },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 512 },
          responseMimeType: 'application/json',
          responseSchema: BRIEFING_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini error ${res.status}: ${err}`);
    }

    const geminiData = await res.json();
    const finishReason = geminiData.candidates?.[0]?.finishReason;
    console.log('Gemini finishReason:', finishReason);

    // When thinkingBudget > 0, thinking tokens appear first (thought: true); find the actual response part
    const parts: any[] = geminiData.candidates?.[0]?.content?.parts ?? [];
    console.log('Gemini parts count:', parts.length, 'rawParts:', JSON.stringify(parts).slice(0, 200));
    const responsePart = parts.find((p: any) => !p.thought) ?? parts[parts.length - 1];
    const rawText = responsePart?.text ?? '';
    console.log('rawText preview:', rawText.slice(0, 200));

    let briefing: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(rawText);
      // Only treat as valid if it has at least returnInfo
      if (parsed && typeof parsed === 'object' && parsed.returnInfo) {
        briefing = parsed;
      }
    } catch {
      // invalid JSON — don't cache
    }

    if (!briefing) {
      console.error('Gemini returned unusable briefing. rawText:', rawText);
      return new Response(JSON.stringify(null), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Cache only valid results ──────────────────────────────────────────────
    await supabase
      .from('consultations')
      .update({ pre_briefing: briefing })
      .eq('id', last.id);

    return new Response(
      JSON.stringify(briefing),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('generate-prebriefing error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// Extract only Assessment (A) and Plan (P) from SOAP — saves ~60% input tokens
function extractAssessmentAndPlan(soap: string): string {
  if (!soap) return '';
  // Match **A section header only (not any letter 'a') — handles **A (Avaliação):** and **A — Avaliação**
  const match = soap.match(/\*\*A[\s—(]/);
  if (!match || match.index === undefined) return soap.slice(-800);
  return soap.slice(match.index).slice(0, 800);
}
