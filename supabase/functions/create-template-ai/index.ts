/**
 * AI creation of document templates (Modelos de Documento).
 *
 * Two modes:
 *  - from_description: "Quero uma anamnese para reumatologia pediátrica" →
 *    generates a full template in the house pattern.
 *  - from_example: the doctor pastes a real document/anamnesis/laudo →
 *    converts it into a reusable template (structure kept, patient data
 *    replaced by field descriptions + conditional commands).
 *
 * Returns { name, description, content } — the client saves it via RLS.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const PATTERN = `PADRÃO DOS MODELOS (obrigatório):
- Títulos com #, ## e ###; itens com "- **Item:** descrição".
- Após cada item ou seção, um COMANDO CONDICIONAL entre parênteses. Os principais:
  (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
  (alterar apenas se mencionado explicitamente na transcrição. Caso contrário, manter a mesma escrita)
  (manter esse texto com a mesma redação)
  (retorne o texto correspondente à opção mencionada na transcrição ou nas anotações)
- Cada seção termina com "Formato: texto corrido" ou "Formato: lista" ou "Formato: tabela".
- Português brasileiro, terminologia médica precisa.
- O modelo descreve O QUE preencher, nunca contém dados de um paciente real.`;

const FROM_DESCRIPTION_SYSTEM = `Você cria modelos de documentos clínicos para médicos brasileiros a partir de uma descrição do que o médico deseja.

${PATTERN}

Responda com JSON: name (nome curto do modelo), description (1 frase), content (o modelo completo).`;

const FROM_EXAMPLE_SYSTEM = `Você converte um documento clínico real (anamnese, laudo, relatório, evolução) em um MODELO reutilizável para médicos brasileiros.

Preserve a estrutura, seções e estilo do documento original, mas:
- Substitua TODOS os dados do paciente por descrições do que preencher em cada campo.
- Adicione comandos condicionais e "Formato:" conforme o padrão abaixo.
- Para laudos com texto de normalidade (ex.: exames de imagem), preserve a redação normal e use o comando "(alterar apenas se mencionado explicitamente na transcrição. Caso contrário, manter a mesma escrita)".

${PATTERN}

Responda com JSON: name (nome curto do modelo), description (1 frase), content (o modelo completo).`;

const SCHEMA = {
  type: 'object',
  properties: {
    name:        { type: 'string' },
    description: { type: 'string' },
    content:     { type: 'string' },
  },
  required: ['name', 'description', 'content'],
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const { mode, input } = await req.json();

    if (!['from_description', 'from_example'].includes(mode) || typeof input !== 'string' || !input.trim()) {
      return new Response(
        JSON.stringify({ error: 'mode (from_description|from_example) e input são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    try {
      await checkQuota(supabase, userId, 3);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const { text: raw, usage } = await callGemini(
      GEMINI_API_KEY,
      [{ text: input.trim().slice(0, 12000) }],
      {
        systemInstruction: mode === 'from_example' ? FROM_EXAMPLE_SYSTEM : FROM_DESCRIPTION_SYSTEM,
        temperature: 0.3,
        maxOutputTokens: 3000,
        thinkingBudget: 0,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    );
    await recordUsage(supabase, userId, creditsFromUsage(usage));

    let out = { name: 'Novo modelo', description: '', content: '' };
    try {
      const parsed = JSON.parse(raw);
      out = {
        name:        (parsed.name ?? 'Novo modelo').toString().slice(0, 80),
        description: (parsed.description ?? '').toString().slice(0, 200),
        content:     (parsed.content ?? '').toString().slice(0, 8000),
      };
    } catch { /* fall through */ }

    if (!out.content.trim()) {
      return new Response(
        JSON.stringify({ error: 'Não foi possível gerar o modelo. Tente reformular.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify(out),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('create-template-ai error:', error instanceof Error ? error.message : 'unknown');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
