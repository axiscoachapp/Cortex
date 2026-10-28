import { fetchWithDeadline, readJsonObject, RequestError } from "../_shared/http.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { embedText, callGemini } from "../_shared/gemini.ts";
import { assertPromptSize, isRecord, optionalText, readPatientContext, type PatientContext } from '../_shared/modelInput.ts';

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const CHAT_SYSTEM = `Você é um assistente clínico de IA auxiliando um médico durante a consulta. Você tem acesso ao contexto do paciente e ao histórico de consultas anteriores fornecidos abaixo.

Responda sempre em português brasileiro. Suas respostas devem ser diretas, objetivas e com no máximo 200 palavras.

Quando o médico perguntar sobre o histórico do paciente ("o que conversamos na última consulta?", "qual foi a conduta?", "como ele evoluiu?"), use o bloco de "Histórico de Consultas Anteriores" abaixo como fonte primária de verdade. Cite datas quando relevante.

Quando houver um bloco de "Documentos Anexados", use os resumos dos documentos (exames, laudos, receitas externas) para responder perguntas sobre resultados e valores — cite o nome do documento e a data. Se o médico perguntar por um exame que não está nos documentos, diga que não foi anexado.

Quando houver um bloco de "Base de Conhecimento do Médico", use esse conteúdo como referência confiável (protocolos, artigos e diretrizes que o próprio médico cadastrou) para fundamentar a resposta.

Você também pode ajudar com:
- Diagnóstico diferencial
- Interações medicamentosas
- Diretrizes clínicas e protocolos
- Interpretação de sintomas e achados

Se não souber a resposta com segurança, diga claramente que não sabe. Nunca invente informações clínicas nem invente registros de consultas anteriores — se não estiverem no histórico abaixo, diga "não consta no histórico".`;
interface ConsultationContext { created_at: string; chief_complaint: string | null; soap_note: string | null }
interface AttachedDocument { created_at: string; file_name: string; ai_summary: string | null }
interface KnowledgeMatch { similarity: number; content: string }

// Strip SOAP markdown bold to keep tokens lean
function condense(text: string, max = 600): string {
  const t = (text ?? '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);

    const body: Record<string, unknown> = await readJsonObject(req);
    const { chatHistory, userMessage } = body;
    const patientId = optionalText(body.patientId, 'patientId');
    const patientContext = readPatientContext(body.patientContext);
    if (chatHistory != null && !Array.isArray(chatHistory)) throw new RequestError('Histórico da conversa inválido.');

    if (!userMessage || typeof userMessage !== 'string') {
      return new Response(
        JSON.stringify({ error: 'userMessage é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (userMessage.length > 4000) {
      return new Response(
        JSON.stringify({ error: 'Mensagem muito longa (máx. 4000 caracteres)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Pull patient row + recent consultations + attached docs when patientId ──
    let patientRow: PatientContext | null = null;
    let consultations: ConsultationContext[] = [];
    let attachedDocs: AttachedDocument[] = [];
    if (patientId) {
      // Ownership enforced: the service-role client bypasses RLS, so every
      // query MUST be scoped to the JWT-derived userId.
      const [{ data: p, error: patientError }, { data: c, error: historyError }, { data: docs, error: documentsError }] = await Promise.all([
        supabase
          .from('patients')
          .select('name, age, diagnoses, medications, allergies, social_anamnesis, medical_history, clinical_notes')
          .eq('id', patientId)
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('consultations')
          .select('created_at, chief_complaint, soap_note')
          .eq('patient_id', patientId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('patient_files')
          .select('file_name, ai_summary, created_at')
          .eq('patient_id', patientId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      if (patientError || historyError || documentsError) throw new RequestError('Não foi possível consultar o histórico clínico. Tente novamente.', 503);
      if (!p) throw new RequestError('Paciente não encontrado.', 404);
      patientRow = readPatientContext(p);
      consultations = c ?? [];
      attachedDocs = docs ?? [];
    }

    // Merge: DB row wins; fall back to client-provided context.
    const ctx = patientRow ?? patientContext ?? null;

    // ── Build patient context summary ────────────────────────────────────────
    let patientSummary = '';
    if (ctx) {
      const diagnoses = Array.isArray(ctx.diagnoses)
        ? ctx.diagnoses.map(d => (typeof d === 'string' ? d : `${d.code ?? ''} ${d.description ?? ''}`.trim())).join('; ') || 'Nenhum'
        : 'Nenhum';
      const medications = Array.isArray(ctx.medications)
        ? ctx.medications.map(m => (typeof m === 'string' ? m : `${m.name ?? ''} ${m.dosage ?? ''}`.trim())).join(', ') || 'Nenhuma'
        : 'Nenhuma';
      const allergies = Array.isArray(ctx.allergies)
        ? ctx.allergies.join(', ') || 'Nenhuma'
        : 'Nenhuma';

      patientSummary = `--- Contexto do Paciente ---
Nome: ${ctx.name ?? 'Não informado'}
Idade: ${ctx.age ?? 'Não informada'} anos
Diagnósticos: ${diagnoses}
Medicações em uso: ${medications}
Alergias: ${allergies}`;

      const social = (ctx.social_anamnesis ?? ctx.socialAnamnesis ?? '').trim();
      const history = (ctx.medical_history ?? ctx.medicalHistory ?? '').trim();
      const notes = (ctx.clinical_notes ?? '').trim();
      if (social)  patientSummary += `\nAnamnese social: ${condense(social, 400)}`;
      if (history) patientSummary += `\nHistória médica: ${condense(history, 400)}`;
      if (notes)   patientSummary += `\nAnotações do médico: ${condense(notes, 600)}`;
      patientSummary += `\n----------------------------\n\n`;
    }

    // ── Build consultation history block ─────────────────────────────────────
    let historySummary = '';
    if (consultations.length > 0) {
      historySummary = '--- Histórico de Consultas Anteriores (mais recente primeiro) ---\n';
      for (const c of consultations) {
        const date = formatDate(c.created_at);
        const complaint = (c.chief_complaint ?? '').trim() || 'sem queixa registrada';
        const soap = condense(c.soap_note ?? '', 700);
        historySummary += `\n[${date}] Queixa: ${complaint}\n${soap}\n`;
      }
      historySummary += '----------------------------\n\n';
    } else if (patientId) {
      historySummary = '--- Histórico de Consultas Anteriores ---\nNenhuma consulta anterior registrada.\n----------------------------\n\n';
    }

    // ── Attached documents block (AI reviews of uploads) ─────────────────────
    let docsSummary = '';
    const docsWithInfo = attachedDocs.filter(d => d.ai_summary || d.file_name);
    if (docsWithInfo.length > 0) {
      docsSummary = '--- Documentos Anexados (mais recente primeiro) ---\n';
      for (const d of docsWithInfo) {
        const date = formatDate(d.created_at);
        docsSummary += `\n[${date}] ${d.file_name}`;
        if (d.ai_summary) docsSummary += `\n${condense(d.ai_summary, 500)}`;
        docsSummary += '\n';
      }
      docsSummary += '----------------------------\n\n';
    }

    // ── Build conversation history ───────────────────────────────────────────
    const historyLines: string[] = [];
    if (Array.isArray(chatHistory)) {
      // Cap turns and per-message length — client input flows into the prompt.
      for (const msg of chatHistory.slice(-10)) {
        if (!isRecord(msg)) continue;
        const content = typeof msg.content === 'string' ? msg.content.slice(0, 2000) : '';
        if (!content) continue;
        if (msg.type === 'user') {
          historyLines.push(`Médico: ${content}`);
        } else if (msg.type === 'assistant') {
          historyLines.push(`Assistente: ${content}`);
        }
      }
    }

    const conversationBlock = historyLines.length > 0
      ? historyLines.join('\n') + '\n'
      : '';

    // Retrieval is paid too. Bound the final prompt including the maximum five
    // 700-character knowledge excerpts before reserving or embedding anything.
    const basePrompt = `${patientSummary}${historySummary}${docsSummary}${conversationBlock}Médico: ${userMessage}`;
    assertPromptSize(basePrompt, CHAT_SYSTEM, 3800);
    let reservationId: string;
    try {
      ({ reservationId } = await checkQuota(supabase, userId, 100));
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    // ── Knowledge base retrieval (RAG) ───────────────────────────────────────
    // Embed the question, pull the doctor's most relevant knowledge chunks.
    let knowledgeBlock = '';
    try {
      const queryEmbedding = await embedText(GEMINI_API_KEY, userMessage, 'RETRIEVAL_QUERY');
      if (queryEmbedding.length > 0) {
        const { data: matches, error: knowledgeError } = await supabase.rpc('match_knowledge', {
          p_user_id: userId,
          query_embedding: queryEmbedding,
          match_count: 5,
        });
        if (knowledgeError) throw new RequestError('Não foi possível consultar a base de conhecimento. Tente novamente.', 503);
        const relevant = ((matches ?? []) as KnowledgeMatch[]).filter(m => m.similarity > 0.5).slice(0, 5);
        if (relevant.length > 0) {
          knowledgeBlock = '--- Base de Conhecimento do Médico (use como referência confiável) ---\n'
            + relevant.map(m => condense(m.content, 700)).join('\n---\n')
            + '\n----------------------------\n\n';
        }
      }
    } catch (error) {
      if (error instanceof RequestError) throw error;
      // Embedding availability is best-effort; failed clinical DB reads are not.
    }

    const promptText = `${patientSummary}${historySummary}${docsSummary}${knowledgeBlock}${conversationBlock}Médico: ${userMessage}`;

    const { text: reply, usage } = await callGemini(
      GEMINI_API_KEY,
      [{ text: promptText }],
      {
        systemInstruction: CHAT_SYSTEM,
        temperature: 0.3,
        maxOutputTokens: 600,
        thinkingBudget: 0,
      },
    );

    const credits = creditsFromUsage(usage);
    await recordUsage(supabase, userId, credits, reservationId);

    return new Response(
      JSON.stringify({ message: reply, credits }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('chat-assistant error:');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
