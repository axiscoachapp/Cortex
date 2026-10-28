import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { requireCompleteModelText, parseModelObject, assertGeminiTextBudget } from "../_shared/gemini.ts";
import { clinicDayBounds } from "../_shared/clinicDate.ts";
import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
type StoredMedication = string | { name: string; dosage?: string; instructions?: string; startedAt?: string };
type StoredDiagnosis = string | { code?: string; description: string };
interface CommentExtraction {
  allergies_add: string[]; medications_add: Array<{ name: string; dosage: string }>;
  medications_remove: string[]; diagnoses_add: Array<{ code: string; description: string }>;
  consultation_addendum: string; long_term_note: string; summary: string;
}

const COMMENT_SCHEMA = {
  type: 'object',
  properties: {
    allergies_add: {
      type: 'array',
      items: { type: 'string' },
      description: 'Alergias mencionadas no comentário. Nunca incluir em caso de negação.',
    },
    medications_add: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name:   { type: 'string' },
          dosage: { type: 'string' },
        },
        required: ['name', 'dosage'],
      },
      description: 'Medicações novas iniciadas no comentário. dosage pode ser string vazia se não mencionada.',
    },
    medications_remove: {
      type: 'array',
      items: { type: 'string' },
      description: 'Nomes de medicações a suspender (match case-insensitive contra o contexto atual).',
    },
    diagnoses_add: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code:        { type: 'string' },
          description: { type: 'string' },
        },
        required: ['code', 'description'],
      },
      description: 'Diagnósticos confirmados no comentário. code vazio se CID não foi mencionado.',
    },
    consultation_addendum: {
      type: 'string',
      description: 'Texto a anexar ao SOAP da consulta de HOJE. String vazia se não se aplica ou se não há consulta hoje.',
    },
    long_term_note: {
      type: 'string',
      description: 'Fato persistente sobre o paciente (anamnese social, histórico familiar, contexto de vida). String vazia se não se aplica.',
    },
    summary: {
      type: 'string',
      description: 'Resumo em UMA frase em PT-BR do que será aplicado. Se nada, explica que nada foi atualizado.',
    },
  },
  required: ['allergies_add', 'medications_add', 'medications_remove', 'diagnoses_add', 'consultation_addendum', 'long_term_note', 'summary'],
};

const SYSTEM = `Você analisa um comentário curto que um médico escreveu sobre um paciente e extrai atualizações estruturadas para múltiplos destinos.

DESTINOS POSSÍVEIS (um comentário pode atingir vários ao mesmo tempo):
- Perfil estruturado do paciente: allergies_add, medications_add, medications_remove, diagnoses_add
- Adendo na consulta de HOJE: consultation_addendum (somente se houver consulta hoje E o comentário se refere a essa visita)
- Nota persistente do paciente: long_term_note (anamnese social, histórico, contexto de vida)

REGRAS CRÍTICAS:

1. NEGAÇÃO — Frases como "NÃO é alérgico a X", "nega uso de Y", "nega tabagismo" NUNCA viram add. No máximo viram long_term_note se forem contexto clinicamente relevante.

2. SUSPENSÃO — "suspender X", "parar X", "interromper X", "trocar X por Y" → X vai em medications_remove. Y (se houver) vai em medications_add. NÃO inclua o medicamento suspenso em medications_add.

3. NÃO INFIRA — Só extraia o que está EXPLÍCITO. "PA 160/100" sozinho não vira diagnóstico de HAS. Só adicione diagnósticos se o médico declarar explicitamente ("confirmado HAS", "diagnóstico de diabetes tipo 2").

4. DEDUPE — Se a alergia/diagnóstico já estiver no contexto atual, NÃO inclua em _add. Para medicação existente, inclua medications_add somente quando o médico mudar explicitamente a dose; preserve o nome exato e informe a nova dose. Nunca omita uma mudança de posologia explícita.

5. ROTEAMENTO:
   - Dados estruturados persistentes do paciente → allergies/medications/diagnoses
   - Algo que aconteceu/foi decidido NESTA visita ("paciente referiu também...", "solicitado hemograma", "retorno em 30 dias") → consultation_addendum (só se há consulta hoje)
   - Contexto persistente que não é alergia/medicação/diagnóstico ("trabalha em obra civil", "mora sozinha", "mãe teve câncer de mama") → long_term_note
   - Um mesmo comentário pode preencher MÚLTIPLOS destinos.

6. AMBÍGUO OU SEM CONTEÚDO ESTRUTURADO — Se o comentário for genérico, vago, ou não couber em nenhuma categoria, retorne todos arrays vazios, strings vazias, e summary explicando "Nada a atualizar — comentário sem dados estruturados (será salvo como anotação)". NUNCA force categorização.

7. SUMMARY — Uma frase em PT-BR descrevendo CONCRETAMENTE o que será aplicado, ex: "Adicionada alergia: Penicilina. Adendo salvo na consulta de hoje." Use ponto final no final.

8. Responda SEMPRE em português brasileiro.`;

function norm(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const { patientId, comment } = await readJsonObject(req);

    if (typeof patientId !== 'string' || typeof comment !== 'string' || !comment.trim() || comment.length > 32000) {
      return new Response(
        JSON.stringify({ error: 'patientId e comment são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Pull current patient profile + today's consultation in parallel
    const now = new Date();
    const { start: todayStart, end: todayEnd } = clinicDayBounds(now);

    const [{ data: patient }, { data: todayConsult }] = await Promise.all([
      supabase
        .from('patients')
        .select('name, allergies, medications, diagnoses, clinical_notes,revision')
        .eq('id', patientId)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('consultations')
        .select('id, soap_note,revision')
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .gte('created_at', todayStart)
        .lt('created_at', todayEnd)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!patient) {
      return new Response(
        JSON.stringify({ error: 'Paciente não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const hasConsultToday = !!todayConsult?.id;
    const existingAllergies: string[] = Array.isArray(patient?.allergies) ? patient!.allergies : [];
    const existingMeds: StoredMedication[] = Array.isArray(patient?.medications) ? patient!.medications : [];
    const existingDiag: StoredDiagnosis[] = Array.isArray(patient?.diagnoses) ? patient!.diagnoses : [];

    const ctxLines = [
      `Paciente: ${patient?.name ?? 'desconhecido'}`,
      `Alergias atuais: ${existingAllergies.join(', ') || 'nenhuma'}`,
      `Medicações atuais: ${existingMeds.map(m => typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`.trim()).join(', ') || 'nenhuma'}`,
      `Diagnósticos atuais: ${existingDiag.map(d => typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`.trim()).join('; ') || 'nenhum'}`,
      `Há consulta registrada para HOJE: ${hasConsultToday ? 'sim' : 'não'}`,
    ].join('\n');

    const prompt = `Contexto atual do paciente:
${ctxLines}

Comentário do médico:
"""${comment.trim()}"""`;

    assertGeminiTextBudget([{ text: prompt }], SYSTEM);
    let reservation: { reservationId: string };
    try {
      reservation = await checkQuota(supabase, userId, 100);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const res = await fetchWithDeadline(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema: COMMENT_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Falha no provedor de IA (${res.status}). Tente novamente.`);
    }

    const json = await res.json();
    const rawText = requireCompleteModelText(json);
    await recordUsage(supabase, userId, creditsFromUsage(json.usageMetadata), reservation.reservationId);
    const parsed = parseModelObject<CommentExtraction>(rawText, COMMENT_SCHEMA);

    const allergiesAdd:   string[]                                = Array.isArray(parsed.allergies_add)      ? parsed.allergies_add      : [];
    const medsAdd:        Array<{ name: string; dosage: string }> = Array.isArray(parsed.medications_add)    ? parsed.medications_add    : [];
    const medsRemove:     string[]                                = Array.isArray(parsed.medications_remove) ? parsed.medications_remove : [];
    const diagnosesAdd:   Array<{ code: string; description: string }> = Array.isArray(parsed.diagnoses_add) ? parsed.diagnoses_add      : [];
    const addendumText:   string                                  = (parsed.consultation_addendum ?? '').trim();
    const longTermNote:   string                                  = (parsed.long_term_note ?? '').trim();
    const aiSummary:      string                                  = (parsed.summary ?? '').trim();

    // ── Server-side merge & apply ────────────────────────────────────────────
    const patientUpdates: { allergies?: string[]; medications?: StoredMedication[]; diagnoses?: StoredDiagnosis[]; clinical_notes?: string } = {};
    const appliedProfile: { allergies: string[]; medicationsAdded: string[]; medicationsRemoved: string[]; diagnoses: string[] } = {
      allergies: [], medicationsAdded: [], medicationsRemoved: [], diagnoses: [],
    };

    // Allergies
    if (allergiesAdd.length > 0) {
      const existingLower = new Set(existingAllergies.map(norm));
      const newOnes = allergiesAdd.filter(a => a.trim() && !existingLower.has(norm(a)));
      if (newOnes.length > 0) {
        patientUpdates.allergies = [...existingAllergies, ...newOnes];
        appliedProfile.allergies = newOnes;
      }
    }

    // Medications (add + remove)
    if (medsAdd.length > 0 || medsRemove.length > 0) {
      const removeLower = new Set(medsRemove.map(norm));
      const filtered = existingMeds.filter(m => {
        const name = typeof m === 'string' ? m : m.name;
        return name ? !removeLower.has(norm(name)) : true;
      });
      const actuallyRemoved = existingMeds
        .filter(m => {
          const name = typeof m === 'string' ? m : m.name;
          return name && removeLower.has(norm(name));
        })
        .map(m => typeof m === 'string' ? m : m.name);

      const newMeds = medsAdd.filter(m => m.name?.trim()).filter(m => {
        const old = filtered.find(existing => norm(typeof existing === 'string' ? existing : existing.name) === norm(m.name));
        return !old || typeof old === 'string' || old.dosage !== m.dosage;
      });

      if (newMeds.length > 0 || actuallyRemoved.length > 0) {
        const merged = [...filtered];
        for (const med of newMeds) {
          const index = merged.findIndex(old => norm(typeof old === 'string' ? old : old.name) === norm(med.name));
          if (index >= 0) merged[index] = { ...(typeof merged[index] === 'object' ? merged[index] : {}), ...med };
          else merged.push({ ...med, instructions: '' });
        }
        patientUpdates.medications = merged;
        appliedProfile.medicationsAdded   = newMeds.map(m => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}`.trim());
        appliedProfile.medicationsRemoved = actuallyRemoved;
      }
    }

    // Diagnoses
    if (diagnosesAdd.length > 0) {
      const existingDescs = new Set(existingDiag.map(d => norm(typeof d === 'string' ? d : d.description ?? '')));
      const newDiag = diagnosesAdd.filter(d => d.description?.trim() && !existingDescs.has(norm(d.description)));
      if (newDiag.length > 0) {
        patientUpdates.diagnoses = [...existingDiag, ...newDiag];
        appliedProfile.diagnoses = newDiag.map(d => `${d.code ? `${d.code} ` : ''}${d.description}`.trim());
      }
    }

    // Long-term note → clinical_notes
    let appliedLongTermNote = false;
    if (longTermNote) {
      const stamp = now.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const entry = `[${stamp}] ${longTermNote}`;
      patientUpdates.clinical_notes = patient?.clinical_notes
        ? `${patient.clinical_notes}\n${entry}`
        : entry;
      appliedLongTermNote = true;
    }

    const appliedAddendum = !!(addendumText && hasConsultToday);
    const nothingApplied = Object.keys(patientUpdates).length === 0 && !appliedAddendum;
    if (nothingApplied) {
      const stamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const entry = `[${stamp}] ${comment.trim()}`;
      patientUpdates.clinical_notes = patient.clinical_notes ? `${patient.clinical_notes}\n${entry}` : entry;
      appliedLongTermNote = true;
    }
    const hhmm = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const { error: applyError } = await supabase.rpc('apply_clinical_comment', {
      p_user_id: userId, p_patient_id: patientId, p_expected_revision: patient.revision,
      p_patient_patch: patientUpdates,
      p_consultation_id: appliedAddendum ? todayConsult.id : null,
      p_expected_consultation_revision: appliedAddendum ? todayConsult.revision : null,
      p_addendum: appliedAddendum ? `**Adendo [${hhmm}]:** ${addendumText}` : null,
    });
    if (applyError) {
      if (applyError.code === '40001') return new Response(JSON.stringify({ error: 'O prontuário foi alterado em outra janela. Recarregue e revise o comentário antes de tentar novamente.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      throw applyError;
    }

    // ── Build user-facing summary ────────────────────────────────────────────
    const summaryParts: string[] = [];
    if (appliedProfile.allergies.length)          summaryParts.push(`Alergia${appliedProfile.allergies.length > 1 ? 's' : ''} adicionada${appliedProfile.allergies.length > 1 ? 's' : ''}: ${appliedProfile.allergies.join(', ')}`);
    if (appliedProfile.medicationsAdded.length)   summaryParts.push(`Medicação${appliedProfile.medicationsAdded.length > 1 ? 'ões' : ''} adicionada${appliedProfile.medicationsAdded.length > 1 ? 's' : ''}: ${appliedProfile.medicationsAdded.join(', ')}`);
    if (appliedProfile.medicationsRemoved.length) summaryParts.push(`Medicação${appliedProfile.medicationsRemoved.length > 1 ? 'ões' : ''} suspensa${appliedProfile.medicationsRemoved.length > 1 ? 's' : ''}: ${appliedProfile.medicationsRemoved.join(', ')}`);
    if (appliedProfile.diagnoses.length)          summaryParts.push(`Diagnóstico${appliedProfile.diagnoses.length > 1 ? 's' : ''} adicionado${appliedProfile.diagnoses.length > 1 ? 's' : ''}: ${appliedProfile.diagnoses.join('; ')}`);
    if (appliedAddendum)                          summaryParts.push('Adendo salvo na consulta de hoje');
    if (appliedLongTermNote && !nothingApplied)   summaryParts.push('Anotação adicionada ao prontuário');
    if (nothingApplied)                           summaryParts.push('Salvo como anotação no prontuário (sem dados estruturados extraídos)');

    const summary = summaryParts.length > 0
      ? summaryParts.join(' · ')
      : (aiSummary || 'Nada a atualizar.');

    return new Response(
      JSON.stringify({
        summary,
        appliedProfile,
        appliedAddendum,
        appliedLongTermNote,
        hasConsultToday,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('process-comment failed');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro ao processar comentário' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
