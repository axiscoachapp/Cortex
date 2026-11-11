import { assertOpenAiEnabled, callClinicalText } from '../_shared/clinicalAi.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError } from '../_shared/quota.ts';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';
import { parseModelObject, assertGeminiTextBudget } from '../_shared/gemini.ts';
import { clinicDayBounds } from '../_shared/clinicDate.ts';
import { readJsonObject, RequestError } from '../_shared/http.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  Vary: 'Origin',
};

type StoredMedication = string | { name: string; dosage?: string; instructions?: string; startedAt?: string };
type StoredDiagnosis = string | { code?: string; description: string };
interface CommentExtraction {
  allergies_add: string[];
  medications_add: Array<{ name: string; dosage: string }>;
  medications_remove: string[];
  diagnoses_add: Array<{ code: string; description: string }>;
  consultation_addendum: string;
  long_term_note: string;
  summary: string;
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
          name: { type: 'string' },
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
          code: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['code', 'description'],
      },
      description: 'Diagnósticos confirmados no comentário. code vazio se CID não foi mencionado.',
    },
    consultation_addendum: {
      type: 'string',
      description:
        'Texto a anexar ao SOAP da consulta de HOJE. String vazia se não se aplica ou se não há consulta hoje.',
    },
    long_term_note: {
      type: 'string',
      description:
        'Fato persistente sobre o paciente (anamnese social, histórico familiar, contexto de vida). String vazia se não se aplica.',
    },
    summary: {
      type: 'string',
      description: 'Resumo em UMA frase em PT-BR do que será aplicado. Se nada, explica que nada foi atualizado.',
    },
  },
  required: [
    'allergies_add',
    'medications_add',
    'medications_remove',
    'diagnoses_add',
    'consultation_addendum',
    'long_term_note',
    'summary',
  ],
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

interface ApprovedChanges {
  allergies: string[];
  medicationsAdd: Array<{ name: string; dosage: string }>;
  medicationsRemove: string[];
  diagnoses: Array<{ code: string; description: string }>;
  addendum: string;
  longTermNote: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_ITEMS = 30;
const MAX_TEXT = 300;
function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_ITEMS ||
    value.some((v) => typeof v !== 'string' || v.length > MAX_TEXT)
  )
    throw new RequestError(`Alteração inválida: ${field}`, 400);
  return (value as string[]).map((v) => v.trim()).filter(Boolean);
}
function objectList<K extends string>(value: unknown, keys: K[], field: string): Array<Record<K, string>> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new RequestError(`Alteração inválida: ${field}`, 400);
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new RequestError(`Alteração inválida: ${field}`, 400);
    const out = {} as Record<K, string>;
    for (const key of keys) {
      const v = (item as Record<string, unknown>)[key] ?? '';
      if (typeof v !== 'string' || v.length > MAX_TEXT) throw new RequestError(`Alteração inválida: ${field}`, 400);
      out[key] = v.trim();
    }
    return out;
  });
}
function longText(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 4000) throw new RequestError(`Alteração inválida: ${field}`, 400);
  return value.trim();
}

function medName(m: StoredMedication): string {
  return typeof m === 'string' ? m : (m.name ?? '');
}

/**
 * Apply only what the physician explicitly approved. Returns the patient patch
 * and a human-readable record of what changed. No AI output reaches this
 * function without passing through the review card first.
 */
function buildPatch(
  patient: { allergies: unknown; medications: unknown; diagnoses: unknown; clinical_notes: string | null },
  approved: ApprovedChanges,
  now: Date,
) {
  const existingAllergies: string[] = Array.isArray(patient.allergies) ? (patient.allergies as string[]) : [];
  const existingMeds: StoredMedication[] = Array.isArray(patient.medications)
    ? (patient.medications as StoredMedication[])
    : [];
  const existingDiag: StoredDiagnosis[] = Array.isArray(patient.diagnoses)
    ? (patient.diagnoses as StoredDiagnosis[])
    : [];
  const patch: {
    allergies?: string[];
    medications?: StoredMedication[];
    diagnoses?: StoredDiagnosis[];
    clinical_notes?: string;
  } = {};
  const applied = {
    allergies: [] as string[],
    medicationsAdded: [] as string[],
    medicationsRemoved: [] as string[],
    diagnoses: [] as string[],
  };

  const existingAllergyKeys = new Set(existingAllergies.map(norm));
  const newAllergies = approved.allergies.filter((a) => !existingAllergyKeys.has(norm(a)));
  if (newAllergies.length) {
    patch.allergies = [...existingAllergies, ...newAllergies];
    applied.allergies = newAllergies;
  }

  if (approved.medicationsAdd.length || approved.medicationsRemove.length) {
    const removeKeys = new Set(approved.medicationsRemove.map(norm));
    const kept = existingMeds.filter((m) => !removeKeys.has(norm(medName(m))));
    const removed = existingMeds.filter((m) => removeKeys.has(norm(medName(m)))).map(medName);
    const merged = [...kept];
    const added: string[] = [];
    for (const med of approved.medicationsAdd.filter((m) => m.name)) {
      const index = merged.findIndex((old) => norm(medName(old)) === norm(med.name));
      if (index >= 0) {
        const old = merged[index];
        if (typeof old === 'object' && old.dosage === med.dosage) continue;
        merged[index] = { ...(typeof old === 'object' ? old : {}), ...med };
      } else merged.push({ ...med, instructions: '' });
      added.push(`${med.name}${med.dosage ? ` ${med.dosage}` : ''}`.trim());
    }
    if (added.length || removed.length) {
      patch.medications = merged;
      applied.medicationsAdded = added;
      applied.medicationsRemoved = removed;
    }
  }

  const existingDiagKeys = new Set(existingDiag.map((d) => norm(typeof d === 'string' ? d : (d.description ?? ''))));
  const newDiag = approved.diagnoses.filter((d) => d.description && !existingDiagKeys.has(norm(d.description)));
  if (newDiag.length) {
    patch.diagnoses = [...existingDiag, ...newDiag];
    applied.diagnoses = newDiag.map((d) => `${d.code ? `${d.code} ` : ''}${d.description}`.trim());
  }

  if (approved.longTermNote) {
    const stamp = now.toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    });
    const entry = `[${stamp}] ${approved.longTermNote}`;
    patch.clinical_notes = patient.clinical_notes ? `${patient.clinical_notes}\n${entry}` : entry;
  }
  return { patch, applied };
}

function summarize(applied: ReturnType<typeof buildPatch>['applied'], addendum: boolean, note: boolean): string {
  const parts: string[] = [];
  if (applied.allergies.length) parts.push(`Alergias adicionadas: ${applied.allergies.join(', ')}`);
  if (applied.medicationsAdded.length)
    parts.push(`Medicações adicionadas/alteradas: ${applied.medicationsAdded.join(', ')}`);
  if (applied.medicationsRemoved.length) parts.push(`Medicações suspensas: ${applied.medicationsRemoved.join(', ')}`);
  if (applied.diagnoses.length) parts.push(`Diagnósticos adicionados: ${applied.diagnoses.join('; ')}`);
  if (addendum) parts.push('Adendo salvo na consulta de hoje');
  if (note) parts.push('Anotação adicionada ao prontuário');
  return parts.length ? parts.join(' · ') : 'Nada foi alterado.';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const body = await readJsonObject(req);
    const { patientId, comment } = body;
    // Clients that predate the review card send no mode: they cannot show a
    // proposal, so their comment is saved verbatim instead of being dropped.
    const mode = body.mode === 'apply' ? 'apply' : body.mode === 'extract' ? 'extract' : 'legacy';

    if (typeof patientId !== 'string' || typeof comment !== 'string' || !comment.trim() || comment.length > 32000) {
      return json({ error: 'patientId e comment são obrigatórios' }, 400);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

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

    if (!patient) return json({ error: 'Paciente não encontrado' }, 404);
    const hasConsultToday = !!todayConsult?.id;

    const applyChanges = async (approved: ApprovedChanges, expectedRevision: number) => {
      if (expectedRevision !== patient.revision)
        return json(
          { error: 'O prontuário foi alterado em outra janela. Revise as alterações novamente antes de aplicar.' },
          409,
        );
      const { patch, applied } = buildPatch(patient, approved, now);
      const appliedAddendum = !!(approved.addendum && hasConsultToday);
      if (!Object.keys(patch).length && !appliedAddendum) return json({ summary: 'Nada foi alterado.', applied: true });
      const hhmm = now.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
      const { error: applyError } = await supabase.rpc('apply_clinical_comment', {
        p_user_id: userId,
        p_patient_id: patientId,
        p_expected_revision: patient.revision,
        p_patient_patch: patch,
        p_consultation_id: appliedAddendum ? todayConsult!.id : null,
        p_expected_consultation_revision: appliedAddendum ? todayConsult!.revision : null,
        p_addendum: appliedAddendum ? `**Adendo [${hhmm}]:** ${approved.addendum}` : null,
      });
      if (applyError) {
        if (applyError.code === '40001')
          return json(
            { error: 'O prontuário foi alterado em outra janela. Revise as alterações novamente antes de aplicar.' },
            409,
          );
        throw applyError;
      }
      return json({
        summary: summarize(applied, appliedAddendum, !!approved.longTermNote),
        applied: true,
        appliedProfile: applied,
        appliedAddendum,
      });
    };

    // The doctor's own words, saved verbatim (no AI involved).
    const saveVerbatim = (reason: string) =>
      applyChanges(
        {
          allergies: [],
          medicationsAdd: [],
          medicationsRemove: [],
          diagnoses: [],
          addendum: '',
          longTermNote: comment.trim(),
        },
        patient.revision,
      ).then(async (response) => {
        if (!response.ok) return response;
        return json({ summary: reason, applied: true });
      });

    // ── Step 2: apply exactly what the physician approved (no AI call) ──────
    if (mode === 'apply') {
      const raw = (body.approved ?? {}) as Record<string, unknown>;
      const approved: ApprovedChanges = {
        allergies: stringList(raw.allergies, 'alergias'),
        medicationsAdd: objectList(raw.medicationsAdd, ['name', 'dosage'], 'medicações'),
        medicationsRemove: stringList(raw.medicationsRemove, 'suspensões'),
        diagnoses: objectList(raw.diagnoses, ['code', 'description'], 'diagnósticos'),
        addendum: longText(raw.addendum, 'adendo'),
        longTermNote: longText(raw.longTermNote, 'anotação'),
      };
      if (typeof body.expectedRevision !== 'number') throw new RequestError('Revisão do prontuário ausente', 400);
      return await applyChanges(approved, body.expectedRevision);
    }

    if (mode === 'legacy')
      return await saveVerbatim('Comentário salvo como anotação. Atualize a página para revisar sugestões da IA.');

    // ── Step 1: extract a PROPOSAL. Nothing is written to the chart here. ────
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const existingAllergies: string[] = Array.isArray(patient?.allergies) ? patient!.allergies : [];
    const existingMeds: StoredMedication[] = Array.isArray(patient?.medications) ? patient!.medications : [];
    const existingDiag: StoredDiagnosis[] = Array.isArray(patient?.diagnoses) ? patient!.diagnoses : [];

    const ctxLines = [
      `Paciente: ${patient?.name ?? 'desconhecido'}`,
      `Alergias atuais: ${existingAllergies.join(', ') || 'nenhuma'}`,
      `Medicações atuais: ${existingMeds.map((m) => (typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`.trim())).join(', ') || 'nenhuma'}`,
      `Diagnósticos atuais: ${existingDiag.map((d) => (typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`.trim())).join('; ') || 'nenhum'}`,
      `Há consulta registrada para HOJE: ${hasConsultToday ? 'sim' : 'não'}`,
    ].join('\n');

    const prompt = `Contexto atual do paciente:
${ctxLines}

Comentário do médico:
"""${comment.trim()}"""`;

    assertGeminiTextBudget([{ text: prompt }], SYSTEM);
    let reservation: { reservationId: string };
    try {
      assertOpenAiEnabled();
      if (!OPENAI_API_KEY) throw new RequestError('IA indisponível', 503);
      reservation = await checkQuota(supabase, userId, 100);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      // AI switched off or not configured: the doctor's note is still saved.
      if (err instanceof RequestError && err.status === 503)
        return await saveVerbatim('IA indisponível no momento: o comentário foi salvo como anotação no prontuário.');
      throw err;
    }

    const { text: rawText, usage } = await callClinicalText(OPENAI_API_KEY, [{ text: prompt }], {
      systemInstruction: SYSTEM,
      maxOutputTokens: 1024,
      responseSchema: COMMENT_SCHEMA,
    });
    await recordUsage(supabase, userId, creditsFromUsage(usage), reservation.reservationId);
    const parsed = parseModelObject<CommentExtraction>(rawText, COMMENT_SCHEMA);

    // Only propose genuinely new items (dedupe against the current chart).
    const allergyKeys = new Set(existingAllergies.map(norm));
    const medKeys = new Map(existingMeds.map((m) => [norm(medName(m)), m]));
    const diagKeys = new Set(existingDiag.map((d) => norm(typeof d === 'string' ? d : (d.description ?? ''))));
    const proposal = {
      allergies: (parsed.allergies_add ?? []).map((a) => a.trim()).filter((a) => a && !allergyKeys.has(norm(a))),
      medicationsAdd: (parsed.medications_add ?? [])
        .filter((m) => m.name?.trim())
        .filter((m) => {
          const old = medKeys.get(norm(m.name));
          return !old || typeof old === 'string' || (old.dosage ?? '') !== (m.dosage ?? '');
        })
        .map((m) => ({ name: m.name.trim(), dosage: (m.dosage ?? '').trim() })),
      medicationsRemove: (parsed.medications_remove ?? [])
        .map((name) => existingMeds.find((m) => norm(medName(m)) === norm(name)))
        .filter((m): m is StoredMedication => !!m)
        .map(medName),
      diagnoses: (parsed.diagnoses_add ?? [])
        .filter((d) => d.description?.trim() && !diagKeys.has(norm(d.description)))
        .map((d) => ({ code: (d.code ?? '').trim(), description: d.description.trim() })),
      addendum: hasConsultToday ? (parsed.consultation_addendum ?? '').trim() : '',
      longTermNote: (parsed.long_term_note ?? '').trim(),
      summary: (parsed.summary ?? '').trim(),
    };
    const hasStructured =
      proposal.allergies.length ||
      proposal.medicationsAdd.length ||
      proposal.medicationsRemove.length ||
      proposal.diagnoses.length ||
      proposal.addendum ||
      proposal.longTermNote;
    if (!hasStructured)
      return await saveVerbatim('Salvo como anotação no prontuário (sem dados estruturados para revisar).');

    return json({ applied: false, proposal, expectedRevision: patient.revision, hasConsultToday });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('process-comment failed');
    return json({ error: error instanceof Error ? error.message : 'Erro ao processar comentário' }, 500);
  }
});
