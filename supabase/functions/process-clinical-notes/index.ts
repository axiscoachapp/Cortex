import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { patientId, notes } = await req.json();

    if (!patientId || !notes) {
      return new Response(
        JSON.stringify({ error: 'patientId and notes are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get current patient data
    const { data: patient } = await supabaseClient
      .from('patients')
      .select('clinical_notes, ai_insights')
      .eq('id', patientId)
      .single();

    // Call AI to extract structured information
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Você é um assistente médico especializado em extrair informações estruturadas de notas clínicas.
Analise as notas e extraia informações relevantes sobre:
- Sintomas relatados
- Observações comportamentais
- Fatores de risco
- Histórico familiar relevante
- Condições sociais que impactam o tratamento
- Progressão ou mudanças no quadro clínico

Retorne as informações de forma estruturada e concisa em português.`
          },
          {
            role: 'user',
            content: `Notas clínicas novas: ${notes}\n\nNotas anteriores: ${patient?.clinical_notes || 'Nenhuma nota anterior'}`
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_clinical_insights',
              description: 'Extrai insights clínicos estruturados das notas',
              parameters: {
                type: 'object',
                properties: {
                  symptoms: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Sintomas relatados pelo paciente'
                  },
                  behavioral_observations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Observações comportamentais relevantes'
                  },
                  risk_factors: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Fatores de risco identificados'
                  },
                  family_history: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Histórico familiar relevante'
                  },
                  social_factors: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Fatores sociais que impactam o tratamento'
                  },
                  clinical_changes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Mudanças no quadro clínico'
                  },
                  summary: {
                    type: 'string',
                    description: 'Resumo geral das informações mais importantes'
                  }
                },
                required: ['summary'],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'extract_clinical_insights' } }
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requisições excedido, tente novamente mais tarde.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Créditos esgotados, adicione créditos ao workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`AI Gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI Response:', JSON.stringify(aiData, null, 2));

    // Extract the tool call response
    let insights = {};
    if (aiData.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments) {
      insights = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);
    }

    // Update patient with new notes and insights
    const updatedNotes = patient?.clinical_notes 
      ? `${patient.clinical_notes}\n\n[${new Date().toLocaleString('pt-BR')}]\n${notes}`
      : `[${new Date().toLocaleString('pt-BR')}]\n${notes}`;

    const { error: updateError } = await supabaseClient
      .from('patients')
      .update({
        clinical_notes: updatedNotes,
        ai_insights: insights
      })
      .eq('id', patientId);

    if (updateError) {
      throw updateError;
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        insights,
        message: 'Notas processadas e perfil atualizado com sucesso'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing notes:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Erro ao processar notas'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});