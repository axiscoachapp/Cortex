import { assertOpenAiEnabled, callClinicalText } from '../_shared/clinicalAi.ts';
import { readJsonObject, RequestError } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { assessmentAndPlan, parseModelObject } from '../_shared/gemini.ts';
import { assertPromptSize, isRecord, readPatientContext } from '../_shared/modelInput.ts';
import { clinicDate } from '../_shared/clinicDate.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

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
const SYSTEM = `Você prepara o resumo pré-consulta de um retorno, para o médico ler em 20 segundos antes de chamar o paciente.
Use SOMENTE o que está no contexto fornecido. Não invente exames, resultados, diagnósticos, datas nem condutas.
- pending: o que ficou combinado e ainda precisa ser visto hoje (exames pedidos, retornos, decisões adiadas), com as datas quando constarem. String vazia se nada constar.
- alert: o que pode mudar a conduta de hoje: alergias, contraindicações e riscos registrados na história médica ou no plano anterior. String vazia se nada constar.
- details.evolution: como o quadro evoluiu ao longo das consultas listadas e das anotações entre consultas. Se só houver uma consulta e nenhuma anotação, escreva "Sem evolução registrada após a última consulta."
Quando um trecho vier marcado como cortado, não suponha o que falta.`;

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

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');

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
        .limit(6),
      supabase
        .from('patients')
        .select('name,age,date_of_birth,diagnoses,medications,allergies,medical_history,clinical_notes,revision')
        .eq('id', patientId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (visitResult.error || patientResult.error) throw new RequestError('Não foi possível consultar o histórico clínico. Tente novamente.', 503);
    if (!patientResult.data) throw new RequestError('Paciente não encontrado.', 404);
    const patientRow = readPatientContext(patientResult.data)!;
    const visits = visitResult.data ?? [];
    const last = visits[0];

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

    // ── Cache hit: return stored briefing without paid inference ────────────
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

    // ── Prompt: the last visit's assessment and plan in full, the medical history, and a short
    // line for each of the previous visits so the model can describe how the case evolved.
    const apSection = assessmentAndPlan(last.soap_note ?? '', 3000);
    const daysSince = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86400000);
    const dateOf = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const lastDate = dateOf(last.created_at);

    const diagnoses = patientRow.diagnoses?.map(d => typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`).join('; ') || 'Não informado';
    const meds = patientRow.medications?.map(m => typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`).join(', ') || 'Nenhum';
    const history = (patientRow.medical_history ?? '').trim();

    // Only the last ~6 note entries to keep tokens lean.
    const recentNotes = (patientRow?.clinical_notes ?? '')
      .split(/\n(?=\[)/)
      .slice(-6)
      .join('\n')
      .trim();
    const earlier = visits.slice(1).map(v =>
      `- ${dateOf(v.created_at)} — ${(v.chief_complaint ?? '').trim() || 'sem queixa registrada'}: ${assessmentAndPlan(v.soap_note ?? '', 900).replace(/\s+/g, ' ')}`).join('\n');

    const prompt = `Paciente: ${patientRow.age == null ? 'idade não informada' : `${patientRow.age} anos`}
Diagnósticos: ${diagnoses}
Medicações: ${meds}
Alergias: ${patientRow.allergies?.join(', ') || 'Nenhuma'}${history ? `\nHistória médica: ${history.length > 1500 ? `${history.slice(0, 1500)} [texto cortado]` : history}` : ''}

Última consulta: ${lastDate} (${daysSince} dias atrás)
Queixa: ${last.chief_complaint || 'não registrada'}

Avaliação e Plano da última consulta:
${apSection}${earlier ? `\n\nConsultas anteriores (mais recente primeiro; só avaliação e plano resumidos):\n${earlier}` : ''}${recentNotes ? `\n\nAnotações recentes do médico (entre consultas):\n${recentNotes}` : ''}`;
    assertPromptSize(prompt, SYSTEM);

    let reservationId: string;
    try {
      assertOpenAiEnabled();
      ({ reservationId } = await checkQuota(supabase, userId, 100));
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const { text: rawText, usage } = await callClinicalText(OPENAI_API_KEY, [{ text: prompt }], {
      systemInstruction: SYSTEM,
      maxOutputTokens: 1024,
      responseSchema: BRIEFING_SCHEMA,
    });
    await recordUsage(supabase, userId, creditsFromUsage(usage), reservationId);

    const briefing = parseModelObject<Briefing>(rawText, BRIEFING_SCHEMA);
    if (!briefing.returnInfo.trim()) throw new Error('Resumo pré-consulta incompleto. Tente novamente.');

    // ── Cache only valid results ──────────────────────────────────────────────
    // Cache writes no longer advance the consultation revision (see migration
    // 20261101000000), so the cached source keeps the current revision.
    const cachedBriefing = { ...briefing, _source: source };
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
