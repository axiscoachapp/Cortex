import { assertOpenAiEnabled, callClinicalText } from '../_shared/clinicalAi.ts';
import { AI_UNAVAILABLE_MESSAGE, readJsonObject, RequestError } from "../_shared/http.ts";
/**
 * AI review of an attached patient document (exam PDF, imaging photo, external
 * prescription...). Reads the file from storage, has the model produce a short
 * clinical review, then:
 *   - stores the review on the patient_files row (ai_summary)
 *   - stores a pending proposal for separate physician review.
 *     It never promotes extraction directly into longitudinal chart facts.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { assertPatientFilePath } from "../_shared/storage.ts";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError, settleFailedCall,
} from "../_shared/quota.ts";
import { parseModelObject } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const MAX_ANALYZE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_EXACT = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];

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
    // AI availability first: nothing else may fail differently while it is switched off.
    assertOpenAiEnabled();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new RequestError(AI_UNAVAILABLE_MESSAGE, 503);
    const { fileId } = await readJsonObject(req);

    if (!fileId) {
      return new Response(
        JSON.stringify({ error: 'fileId é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Ownership: the file row must belong to the authenticated user.
    const { data: fileRow } = await supabase
      .from('patient_files')
      .select('id, patient_id, storage_path, file_name, mime_type, size_bytes, ai_review_status')
      .eq('id', fileId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!fileRow) {
      return new Response(
        JSON.stringify({ error: 'Arquivo não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (fileRow.ai_review_status && fileRow.ai_review_status !== 'pending') throw new RequestError('Este documento já foi revisado. Anexe uma nova versão para uma nova análise.', 409);

    const storagePath = assertPatientFilePath(fileRow.storage_path, userId, fileRow.patient_id);
    const { data: ownedPatient, error: patientError } = await supabase.from('patients')
      .select('id').eq('id', fileRow.patient_id).eq('user_id', userId).is('deletion_requested_at', null).maybeSingle();
    if (patientError || !ownedPatient) throw new Error('Paciente indisponível');
    const mime = fileRow.mime_type ?? '';
    const supported = SUPPORTED_EXACT.includes(mime);
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

    const { data: blob, error: dlErr } = await supabase.storage
      .from('patient-files')
      .download(storagePath);
    if (dlErr || !blob) throw new RequestError('Não foi possível baixar o arquivo. Tente novamente.', 503);

    if (!blob.size || blob.size > MAX_ANALYZE_BYTES) throw new RequestError('Arquivo vazio ou muito grande para análise.', 413);
    const buffer = await blob.arrayBuffer();

    const {reservationId} = await checkQuota(supabase,userId,400);
    // The uploaded file name often carries the patient's name: it is not sent to the provider.
    const { text: raw, usage } = await callClinicalText(
      OPENAI_API_KEY,
      [
        { document: { data: new Uint8Array(buffer), mimeType: mime } },
        { text: 'Analise o documento acima.' },
      ],
      {
        systemInstruction: SYSTEM,
        maxOutputTokens: 800,
        responseSchema: SCHEMA,
      },
    ).catch(async (error) => {
      await settleFailedCall(supabase, userId, reservationId, error);
      throw error;
    });
    await recordUsage(supabase, userId, creditsFromUsage(usage), reservationId);

    const parsed = parseModelObject(raw, SCHEMA) as {
      document_type: string; summary: string; key_findings: string[]; profile_note: string;
    };
    const documentType = parsed.document_type.slice(0,80);
    const summary = parsed.summary.slice(0,1200);
    const keyFindings = parsed.key_findings.filter(value=>value.trim()).slice(0,6).map(value=>value.slice(0,300));
    const profileNote = parsed.profile_note.slice(0,300);

    // Persist the review on the file row (shown in the Documentos tab).
    const aiSummary = [
      `${documentType}: ${summary}`,
      ...keyFindings.map(f => `- ${f}`),
    ].join('\n');
    const {error: saveError} = await supabase.rpc('save_document_review',{
      p_user_id:userId,p_file_id:fileRow.id,p_summary:aiSummary,p_profile_note:profileNote.trim(),
    });
    if (saveError) throw new Error('Não foi possível salvar a análise. Tente novamente.');

    return new Response(
      JSON.stringify({ documentType, summary, keyFindings, profileNote, reviewStatus: 'pending', sourceFileId: fileRow.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    if (error instanceof QuotaExceededError) return quotaResponse(error,corsHeaders);
    console.error('analyze-document failed');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
