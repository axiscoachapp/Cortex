/**
 * AI review of an attached patient document (exam PDF, imaging photo, external
 * prescription...). Reads the file from storage, has Gemini produce a short
 * clinical review, then:
 *   - stores the review on the patient_files row (ai_summary)
 *   - appends a stamped note to the patient's clinical_notes, so the info
 *     flows into chat-assistant answers and pre-briefings automatically.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, uploadToGeminiFiles } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const MAX_ANALYZE_BYTES = 15 * 1024 * 1024; // Gemini Files handles more, but keep costs sane
const SUPPORTED_PREFIXES = ['image/'];
const SUPPORTED_EXACT = ['application/pdf'];

const SYSTEM = `Você é um assistente médico revisando um documento anexado ao prontuário de um paciente
(exame laboratorial, laudo de imagem, receita externa, relatório, foto clínica etc.).

Analise o documento e retorne:
- document_type: o tipo do documento em 2-5 palavras (ex: "Hemograma completo", "Laudo de raio-X de tórax",
  "Receita de outro médico", "Foto de lesão cutânea").
- summary: revisão curta em 2-4 frases: o que o documento é, e o que ele mostra de clinicamente relevante.
- key_findings: os achados objetivos relevantes para o prontuário (valores alterados com números, diagnósticos
  citados, medicamentos prescritos, datas). Máximo 6 itens, telegráficos. Vazio se nada relevante.
- profile_note: UMA linha para registrar no prontuário conectando o documento ao paciente
  (ex: "Hemograma 12/05: Hb 10,2 g/dL — anemia leve"). String vazia se o documento não for clínico.

REGRAS:
- Extraia APENAS o que está no documento. Não invente valores nem diagnósticos.
- Valores fora de referência merecem destaque; cite números exatos.
- Se o documento estiver ilegível ou não for um documento clínico, diga isso no summary.
- Português brasileiro, objetivo.`;

const SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string' },
    summary:       { type: 'string' },
    key_findings:  { type: 'array', items: { type: 'string' } },
    profile_note:  { type: 'string' },
  },
  required: ['document_type', 'summary', 'key_findings', 'profile_note'],
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const { fileId } = await req.json();

    if (!fileId) {
      return new Response(
        JSON.stringify({ error: 'fileId é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Ownership: the file row must belong to the authenticated user.
    const { data: fileRow } = await supabase
      .from('patient_files')
      .select('id, patient_id, storage_path, file_name, mime_type, size_bytes')
      .eq('id', fileId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!fileRow) {
      return new Response(
        JSON.stringify({ error: 'Arquivo não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const mime = fileRow.mime_type ?? '';
    const supported = SUPPORTED_PREFIXES.some(p => mime.startsWith(p)) || SUPPORTED_EXACT.includes(mime);
    if (!supported) {
      return new Response(
        JSON.stringify({ error: 'Tipo de arquivo não suportado para análise (use imagens ou PDF)' }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if ((fileRow.size_bytes ?? 0) > MAX_ANALYZE_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Arquivo muito grande para análise (máx. 15 MB)' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    try {
      await checkQuota(supabase, userId, 5);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    const { data: blob, error: dlErr } = await supabase.storage
      .from('patient-files')
      .download(fileRow.storage_path);
    if (dlErr || !blob) throw new Error(`Erro ao baixar arquivo: ${dlErr?.message}`);

    const buffer = await blob.arrayBuffer();
    const fileUri = await uploadToGeminiFiles(GEMINI_API_KEY, buffer, mime);

    const { text: raw, usage } = await callGemini(
      GEMINI_API_KEY,
      [
        { fileData: { mimeType: mime, fileUri } },
        { text: `Nome do arquivo: ${fileRow.file_name}\nAnalise o documento acima.` },
      ],
      {
        systemInstruction: SYSTEM,
        temperature: 0.1,
        maxOutputTokens: 800,
        thinkingBudget: 0,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    );
    await recordUsage(supabase, userId, creditsFromUsage(usage));

    let documentType = 'Documento';
    let summary = '';
    let keyFindings: string[] = [];
    let profileNote = '';
    try {
      const parsed = JSON.parse(raw);
      documentType = (parsed.document_type ?? 'Documento').toString().slice(0, 80);
      summary      = (parsed.summary ?? '').toString().slice(0, 1200);
      keyFindings  = Array.isArray(parsed.key_findings)
        ? parsed.key_findings.filter((x: any): x is string => typeof x === 'string' && x.trim()).slice(0, 6)
        : [];
      profileNote  = (parsed.profile_note ?? '').toString().slice(0, 300);
    } catch {
      summary = 'Não foi possível analisar o documento.';
    }

    // Persist the review on the file row (shown in the Documentos tab).
    const aiSummary = [
      `${documentType}: ${summary}`,
      ...keyFindings.map(f => `- ${f}`),
    ].join('\n');
    await supabase
      .from('patient_files')
      .update({ ai_summary: aiSummary })
      .eq('id', fileRow.id)
      .eq('user_id', userId);

    // Connect to the record: stamped clinical_notes entry — chat-assistant and
    // pre-briefing already read clinical_notes, so the info reaches both.
    if (profileNote.trim()) {
      const { data: patientRow } = await supabase
        .from('patients')
        .select('clinical_notes')
        .eq('id', fileRow.patient_id)
        .eq('user_id', userId)
        .maybeSingle();
      const stamp = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const entry = `[${stamp}] 📎 ${fileRow.file_name}: ${profileNote.trim()}`;
      const merged = patientRow?.clinical_notes ? `${patientRow.clinical_notes}\n${entry}` : entry;
      await supabase
        .from('patients')
        .update({ clinical_notes: merged })
        .eq('id', fileRow.patient_id)
        .eq('user_id', userId);
    }

    return new Response(
      JSON.stringify({ documentType, summary, keyFindings, profileNote }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('analyze-document error:', error instanceof Error ? error.message : 'unknown');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
