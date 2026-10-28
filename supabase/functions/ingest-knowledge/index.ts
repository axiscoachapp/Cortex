import { readJsonObject, RequestError, fetchWithDeadline } from "../_shared/http.ts";
/**
 * Ingest a document into the Base de Conhecimento (RAG).
 *
 * Accepts pasted text or an uploaded file (PDF/image → text via Gemini Files).
 * Chunks the text, embeds each chunk with text-embedding-004, and stores the
 * document + chunks. The AI assistant retrieves from these during chat.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { assertPatientFilePath } from "../_shared/storage.ts";
import {
  checkQuota, recordUsage, creditsFromUsage, quotaResponse, QuotaExceededError,
} from "../_shared/quota.ts";
import { callGemini, uploadToGeminiFiles, embedBatch, chunkText } from "../_shared/gemini.ts";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const MAX_CHARS = 60_000;   // ~50 chunks — plenty for a protocol/artigo
const MAX_CHUNKS = 60;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { userId } = await requireUser(req);
    const { title, text, fileId } = await readJsonObject(req);

    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      return new Response(JSON.stringify({ error: 'title é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Resolve the raw text: pasted text, or extracted from an uploaded file.
    if (text !== undefined && typeof text !== 'string') throw new RequestError('Texto inválido');
    if (fileId !== undefined && (typeof fileId !== 'string' || !fileId)) throw new RequestError('Arquivo inválido');
    if (fileId && text?.trim()) throw new RequestError('Envie texto ou arquivo, um de cada vez');
    let rawText = text ?? '';
    if (rawText.length > MAX_CHARS) throw new RequestError('Documento muito longo (máximo de 60.000 caracteres). Divida-o em partes.',413);
    let sourceType: 'text' | 'file' = 'text';

    if (fileId) {
      sourceType = 'file';
      const { data: fileRow } = await supabase
        .from('patient_files')
        .select('storage_path, mime_type, user_id, patient_id')
        .eq('id', fileId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!fileRow) {
        return new Response(JSON.stringify({ error: 'Arquivo não encontrado' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const path = assertPatientFilePath(fileRow.storage_path, userId, fileRow.patient_id);
      const { data: patient, error: patientError } = await supabase.from('patients')
        .select('id').eq('id', fileRow.patient_id).eq('user_id', userId).is('deletion_requested_at', null).maybeSingle();
      if (patientError || !patient) throw new Error('Paciente indisponível');
      if (!['application/pdf','image/png','image/jpeg','image/webp'].includes(fileRow.mime_type ?? '')) throw new Error('Tipo de arquivo não suportado');
      const { data: blob } = await supabase.storage.from('patient-files').download(path);
      if (!blob) throw new Error('Erro ao baixar arquivo');
      if (blob.size > 15 * 1024 * 1024) throw new Error('Arquivo muito grande para análise');
      const extractionQuota = await checkQuota(supabase, userId, 400);
      const uri = await uploadToGeminiFiles(GEMINI_API_KEY, await blob.arrayBuffer(), fileRow.mime_type ?? 'application/pdf');
      const { text: extracted, usage } = await callGemini(
        GEMINI_API_KEY,
        [{ fileData: { mimeType: fileRow.mime_type ?? 'application/pdf', fileUri: uri } },
         { text: 'Extraia TODO o texto legível deste documento, preservando a ordem. Retorne apenas o texto, sem comentários.' }],
        { temperature: 0, maxOutputTokens: 8000, thinkingBudget: 0 },
      );
      await recordUsage(supabase, userId, creditsFromUsage(usage), extractionQuota.reservationId);
      rawText = extracted;
    }

    if (rawText.length > MAX_CHARS) throw new RequestError('Documento extraído muito longo. Divida-o em partes de até 60.000 caracteres.',413);
    rawText = rawText.trim();
    if (rawText.length < 20) {
      return new Response(JSON.stringify({ error: 'Conteúdo muito curto para indexar' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const chunks = chunkText(rawText);
    if (chunks.length > MAX_CHUNKS) throw new RequestError('Documento excede 60 trechos de indexação. Divida-o em partes.',413);

    // Insert the document row (ready — we complete synchronously below).
    const { data: doc, error: docErr } = await supabase
      .from('knowledge_documents')
      .insert({ user_id: userId, title: title.trim().slice(0, 200), source_type: sourceType, char_count: rawText.length, status: 'processing' })
      .select('id')
      .single();
    if (docErr) throw docErr;

    try {
      const embeddingQuota = await checkQuota(supabase, userId, 25);
      // Embed in sub-batches (batchEmbedContents caps request size).
      const embeddings: number[][] = [];
      const B = 20;
      for (let i = 0; i < chunks.length; i += B) {
        const part = await embedBatch(GEMINI_API_KEY, chunks.slice(i, i + B));
        embeddings.push(...part);
      }
      const rows = chunks.map((content, i) => ({
        document_id: doc.id,
        user_id: userId,
        content,
        embedding: embeddings[i] ?? null,
      }));
      const { error: chunkErr } = await supabase.from('knowledge_chunks').insert(rows);
      if (chunkErr) throw chunkErr;

      await supabase.from('knowledge_documents').update({ status: 'ready' }).eq('id', doc.id);
      // Embedding helpers do not expose provider usage. Retain the reservation
      // rather than reporting an invented actual charge or refunding unknown cost.
      await recordUsage(supabase, userId, 0, embeddingQuota.reservationId);

      return new Response(JSON.stringify({ documentId: doc.id, chunks: chunks.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err) {
      await supabase.from('knowledge_documents').update({ status: 'error' }).eq('id', doc.id);
      throw err;
    }

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    if (error instanceof QuotaExceededError) return quotaResponse(error, corsHeaders);
    console.error('ingest-knowledge failed');
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
