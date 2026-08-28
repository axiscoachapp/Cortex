/**
 * Ingest a document into the Base de Conhecimento (RAG).
 *
 * Accepts pasted text or an uploaded file (PDF/image → text via Gemini Files).
 * Chunks the text, embeds each chunk with text-embedding-004, and stores the
 * document + chunks. The AI assistant retrieves from these during chat.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkQuota, recordUsage, quotaResponse, QuotaExceededError,
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
    const { title, text, fileId } = await req.json();

    if (!title?.trim()) {
      return new Response(JSON.stringify({ error: 'title é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    try {
      await checkQuota(supabase, userId, 3);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResponse(err, corsHeaders);
      throw err;
    }

    // Resolve the raw text: pasted text, or extracted from an uploaded file.
    let rawText = (text ?? '').toString();
    let sourceType: 'text' | 'file' = 'text';

    if (fileId) {
      sourceType = 'file';
      const { data: fileRow } = await supabase
        .from('patient_files')
        .select('storage_path, mime_type, user_id')
        .eq('id', fileId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!fileRow) {
        return new Response(JSON.stringify({ error: 'Arquivo não encontrado' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: blob } = await supabase.storage.from('patient-files').download(fileRow.storage_path);
      if (!blob) throw new Error('Erro ao baixar arquivo');
      const uri = await uploadToGeminiFiles(GEMINI_API_KEY, await blob.arrayBuffer(), fileRow.mime_type ?? 'application/pdf');
      const { text: extracted } = await callGemini(
        GEMINI_API_KEY,
        [{ fileData: { mimeType: fileRow.mime_type ?? 'application/pdf', fileUri: uri } },
         { text: 'Extraia TODO o texto legível deste documento, preservando a ordem. Retorne apenas o texto, sem comentários.' }],
        { temperature: 0, maxOutputTokens: 8000, thinkingBudget: 0 },
      );
      rawText = extracted;
    }

    rawText = rawText.slice(0, MAX_CHARS).trim();
    if (rawText.length < 20) {
      return new Response(JSON.stringify({ error: 'Conteúdo muito curto para indexar' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const chunks = chunkText(rawText).slice(0, MAX_CHUNKS);

    // Insert the document row (ready — we complete synchronously below).
    const { data: doc, error: docErr } = await supabase
      .from('knowledge_documents')
      .insert({ user_id: userId, title: title.trim().slice(0, 200), source_type: sourceType, char_count: rawText.length, status: 'processing' })
      .select('id')
      .single();
    if (docErr) throw docErr;

    try {
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
      await recordUsage(supabase, userId, chunks.length * 0.05);   // embeddings are cheap

      return new Response(JSON.stringify({ documentId: doc.id, chunks: chunks.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err) {
      await supabase.from('knowledge_documents').update({ status: 'error' }).eq('id', doc.id);
      throw err;
    }

  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('ingest-knowledge error:', error instanceof Error ? error.message : 'unknown');
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
