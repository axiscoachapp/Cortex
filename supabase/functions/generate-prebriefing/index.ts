import { fetchWithDeadline, readJsonObject, RequestError } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { requireCompleteModelText, parseModelObject } from '../_shared/gemini.ts';
import { assertPromptSize, isRecord, readPatientContext } from '../_shared/modelInput.ts';
import { clinicDate } from '../_shared/clinicDate.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
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
interface Briefing {
  returnInfo: string; previousComplaint: string; pending: string; alert: string;
  details: { lastConsultationDate: string; mainComplaint: string; previousConduct: string; evolution: string };
}
interface BriefingSource { patientRevision: number; consultationRevision: number; clinicDate: string }
const SYSTEM = 'Você é um assistente médico gerando resumos pré-consulta concisos e clinicamente relevantes. Destaque pendências, alertas e a evolução do quadro de forma objetiva para o médico.';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const { patientId } = await readJsonObject(req);

    if (typeof patientId !== 'string' || !patientId) {
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

    // Pull the last consultation + a slim patient row in parallel so we can
    // surface any clinical_notes the doctor saved between consultations.
    const [visitResult, patientResult] = await Promise.all([
      supabase
        .from('consultations')
        .select('id, chief_complaint, soap_note, created_at, pre_briefing, revision')
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('patients')
        .select('name,age,diagnoses,medications,allergies,clinical_notes,revision')
        .eq('id', patientId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (visitResult.error || patientResult.error) throw new RequestError('Não foi possível consultar o histórico clínico. Tente novamente.', 503);
    if (!patientResult.data) throw new RequestError('Paciente não encontrado.', 404);
    const patientRow = readPatientContext(patientResult.data)!;
    const last = visitResult.data;

    if (!last) {
      return new Response(JSON.stringify(null), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!Number.isSafeInteger(patientResult.data.revision) || !Number.isSafeInteger(last.revision)) {
      throw new RequestError('Não foi possível verificar a versão do histórico clínico. Tente novamente.', 503);
    }
    const source: BriefingSource = {
      patientRevision: patientResult.data.revision,
      consultationRevision: last.revision,
      clinicDate: clinicDate(),
    };

    // ── Cache hit: return stored briefing without calling Gemini ─────────────
    const cacheSource: unknown = isRecord(last.pre_briefing) ? last.pre_briefing._source : null;
    if (isRecord(cacheSource) && cacheSource.patientRevision === source.patientRevision &&
      cacheSource.consultationRevision === source.consultationRevision && cacheSource.clinicDate === source.clinicDate) {
      try {
        const publicCache = { ...last.pre_briefing };
        delete publicCache._source;
        const cached = parseModelObject<Briefing>(JSON.stringify(publicCache), BRIEFING_SCHEMA);
        if (cached.returnInfo.trim()) return new Response(JSON.stringify(cached), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch { /* An incomplete cache entry must be regenerated. */ }
    }

    // ── Build lean prompt: only send A+P sections (~60% fewer input tokens) ──
    const apSection = extractAssessmentAndPlan(last.soap_note ?? '');
    const daysSince = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86400000);
    const lastDate = new Date(last.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const diagnoses = patientRow.diagnoses?.map(d => typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`).join('; ') || 'Não informado';
    const meds = patientRow.medications?.map(m => typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`).join(', ') || 'Nenhum';

    // Only the last ~6 note entries to keep tokens lean.
    const recentNotes = (patientRow?.clinical_notes ?? '')
      .split(/\n(?=\[)/)
      .slice(-6)
      .join('\n')
      .trim();

    const prompt = `Paciente: ${patientRow.name ?? 'paciente'}, ${patientRow.age ?? '?'} anos
Diagnósticos: ${diagnoses}
Medicações: ${meds}
Alergias: ${patientRow.allergies?.join(', ') || 'Nenhuma'}

Última consulta: ${lastDate} (${daysSince} dias atrás)
Queixa: ${last.chief_complaint || 'não registrada'}

Avaliação e Plano da última consulta:
${apSection}${recentNotes ? `\n\nAnotações recentes do médico (entre consultas):\n${recentNotes}` : ''}`;
    assertPromptSize(prompt, SYSTEM);

    let reservationId: string;
    try {
      ({ reservationId } = await checkQuota(supabase, userId, 100));
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const res = await fetchWithDeadline(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM }],
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
      throw new Error(`Gemini indisponível (${res.status})`);
    }

    const geminiData = await res.json();

    await recordUsage(supabase, userId, creditsFromUsage(geminiData.usageMetadata), reservationId);

    // When thinkingBudget > 0, thinking tokens appear first (thought: true); find the actual response part.
    // Never log part contents — they contain patient clinical data.
    const rawText = requireCompleteModelText(geminiData);

    const briefing = parseModelObject<Briefing>(rawText, BRIEFING_SCHEMA);
    if (!briefing.returnInfo.trim()) throw new Error('Resumo pré-consulta incompleto. Tente novamente.');

    // ── Cache only valid results ──────────────────────────────────────────────
    // The cache update itself advances consultation_revision. Record the
    // resulting version so the next read can reuse it without another paid call.
    const cachedBriefing = { ...briefing, _source: { ...source, consultationRevision: source.consultationRevision + 1 } };
    const { data: savedCache, error: cacheError } = await supabase
      .from('consultations')
      .update({ pre_briefing: cachedBriefing })
      .eq('id', last.id)
      .eq('user_id', userId)
      .eq('revision', source.consultationRevision)
      .select('id')
      .maybeSingle();
    if (cacheError) throw new RequestError('Não foi possível salvar o resumo pré-consulta. Tente novamente.', 503);
    if (!savedCache) throw new RequestError('A consulta foi alterada durante a geração do resumo. Selecione o paciente novamente.', 409);

    return new Response(
      JSON.stringify(briefing),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('generate-prebriefing error:');
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
