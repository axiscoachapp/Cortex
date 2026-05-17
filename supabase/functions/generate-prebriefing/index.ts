import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Fetch last consultation for this patient
    const { data: lastConsultation } = await supabaseClient
      .from('consultations')
      .select('chief_complaint, soap_note, whatsapp_message, created_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lastConsultation) {
      return new Response(
        JSON.stringify(null),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const diagnoses = patientContext?.diagnoses?.map((d: any) => `${d.code} - ${d.description}`).join(', ') || 'Não informado';
    const meds = patientContext?.medications?.map((m: any) => `${m.name} ${m.dosage}`).join(', ') || 'Nenhum';
    const allergies = patientContext?.allergies?.join(', ') || 'Nenhuma';

    const lastDate = new Date(lastConsultation.created_at).toLocaleDateString('pt-BR');
    const daysSince = Math.floor((Date.now() - new Date(lastConsultation.created_at).getTime()) / 86400000);

    const prompt = `Você é um assistente médico gerando um resumo pré-consulta conciso para o médico revisar antes de atender o paciente.

Paciente: ${patientContext?.name ?? 'paciente'}, ${patientContext?.age ?? '?'} anos
Diagnósticos ativos: ${diagnoses}
Medicações em uso: ${meds}
Alergias: ${allergies}

Última consulta: ${lastDate} (${daysSince} dias atrás)
Queixa da última consulta: ${lastConsultation.chief_complaint || 'não registrada'}
Evolução SOAP da última consulta:
${lastConsultation.soap_note || 'não disponível'}

Gere um resumo pré-consulta em JSON com exatamente este formato:
{
  "returnInfo": "frase curta sobre o retorno (ex: Paciente retorna após 45 dias)",
  "previousComplaint": "queixa principal da última consulta em até 8 palavras",
  "pending": "pendências ou exames solicitados que devem ser verificados (ou string vazia se não houver)",
  "alert": "alerta clínico importante para o médico estar atento (ou string vazia se não houver)",
  "details": {
    "lastConsultationDate": "data por extenso",
    "mainComplaint": "queixa principal completa",
    "previousConduct": "conduta tomada na última consulta",
    "evolution": "evolução do quadro até a última consulta"
  }
}

Retorne apenas o JSON válido, sem markdown, sem explicações.`;

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini error ${res.status}: ${err}`);
    }

    const geminiData = await res.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

    let briefing: object;
    try {
      briefing = JSON.parse(rawText);
    } catch {
      briefing = {};
    }

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
