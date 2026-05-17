import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
  return responsePart?.text ?? '';
}

const CHAT_SYSTEM = `Você é um assistente clínico de IA auxiliando um médico durante a consulta. Você tem acesso ao contexto do paciente fornecido abaixo.

Responda sempre em português brasileiro. Suas respostas devem ser diretas, objetivas e com no máximo 150 palavras.

Você pode ajudar com:
- Diagnóstico diferencial
- Interações medicamentosas
- Diretrizes clínicas e protocolos
- Interpretação de sintomas e achados

Se não souber a resposta com segurança, diga claramente que não sabe. Nunca invente informações clínicas.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { patientContext, chatHistory, userMessage } = body;

    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: 'userMessage é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    // Build patient context summary
    let patientSummary = '';
    if (patientContext) {
      const diagnoses = Array.isArray(patientContext.diagnoses)
        ? patientContext.diagnoses.map((d: any) => (typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`.trim())).join('; ') || 'Nenhum'
        : 'Nenhum';
      const medications = Array.isArray(patientContext.medications)
        ? patientContext.medications.map((m: any) => (typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`.trim())).join(', ') || 'Nenhuma'
        : 'Nenhuma';
      const allergies = Array.isArray(patientContext.allergies)
        ? patientContext.allergies.join(', ') || 'Nenhuma'
        : 'Nenhuma';

      patientSummary = `--- Contexto do Paciente ---
Nome: ${patientContext.name ?? 'Não informado'}
Idade: ${patientContext.age ?? 'Não informada'} anos
Diagnósticos: ${diagnoses}
Medicações em uso: ${medications}
Alergias: ${allergies}
----------------------------\n\n`;
    }

    // Build conversation history
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

    const promptText = `${patientSummary}${conversationBlock}Médico: ${userMessage}`;

    const reply = await callGemini(
      GEMINI_API_KEY,
      [{ text: promptText }],
      {
        systemInstruction: CHAT_SYSTEM,
        temperature: 0.3,
        maxOutputTokens: 400,
        thinkingBudget: 0,
      },
    );

    return new Response(
      JSON.stringify({ message: reply }),
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
