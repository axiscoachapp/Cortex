import { fetchWithDeadline, readJsonObject, RequestError } from "../_shared/http.ts";
/**
 * AI creation of document templates (Modelos de Documento).
 *
 * Structured vocabulary only (no patient examples):
 *  - from_description: "Quero uma anamnese para reumatologia pediátrica" →
 *    generates a full template in the house pattern.
 *  - from_structure selects an allowlisted specialty; output requires review.
 *
 * Returns { name, description, content } — the client saves it via RLS.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, parseModelObject } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assertPromptSize } from '../_shared/modelInput.ts';

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
    const { mode, input, specialty } = await readJsonObject(req);

    if (typeof input === 'string' && input.length > 12000) throw new RequestError('O texto excede 12.000 caracteres.', 413);
    // The model receives a closed vocabulary only. A prompt promising to remove
    // identifiers cannot authorize using real charts as a reusable template.
    const specialties: Record<string, string> = { ginecologia: 'ginecologia', prenatal: 'pré-natal', urologia: 'urologia', retorno: 'retorno ambulatorial', geral: 'consulta geral' };
    if (mode !== 'from_structure' || typeof specialty !== 'string' || !Object.hasOwn(specialties, specialty) || input !== undefined) {
      throw new RequestError('Selecione uma estrutura de especialidade. Exemplos de pacientes e texto clínico livre não são aceitos na geração de modelos.');
    }
    const source = `Crie uma estrutura vazia de documentação para ${specialties[specialty]}. Inclua apenas campos e instruções condicionais; não acrescente achados, negativas, nomes, datas ou valores de exemplo.`;
    const systemInstruction = FROM_DESCRIPTION_SYSTEM;
    assertPromptSize(source, systemInstruction);

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    let reservationId: string;
    try {
      ({ reservationId } = await checkQuota(supabase, userId, 100));
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const { text: raw, usage } = await callGemini(
      GEMINI_API_KEY,
      [{ text: source }],
      {
        systemInstruction,
        temperature: 0.3,
        maxOutputTokens: 3000,
        thinkingBudget: 0,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    );
    await recordUsage(supabase, userId, creditsFromUsage(usage), reservationId);

    const out = parseModelObject<{ name: string; description: string; content: string }>(raw, SCHEMA);

    if (!out.name.trim() || !out.content.trim()) {
      return new Response(
        JSON.stringify({ error: 'Não foi possível gerar o modelo. Tente reformular.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ ...out, requiresReview: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('create-template-ai error:');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
