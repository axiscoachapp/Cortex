import { readJsonObject, RequestError, fetchWithDeadline } from '../_shared/http.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { checkQuota, recordUsage, quotaResponse, QuotaExceededError } from '../_shared/quota.ts';
import { embedBatch, chunkText } from '../_shared/gemini.ts';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store', Vary: 'Origin',
};

/** Index only the immutable source version explicitly approved by this doctor.
 * Patient attachments are deliberately not reusable knowledge sources. */
serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
  let claimed: { userId: string; documentId: string; revision: number } | undefined;
  let committed = false;
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { global: { fetch: fetchWithDeadline } });
  try {
    const { userId } = await requireUser(req);
    const body = await readJsonObject(req);
    if (body.fileId !== undefined || body.text !== undefined || typeof body.documentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.documentId)) {
      throw new RequestError('Salve e aprove uma versão de protocolo na Base de Conhecimento antes de indexar. Anexos de pacientes não podem ser usados como protocolos.', 400);
    }
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new RequestError('Indexação indisponível. O texto original permanece salvo.', 503);
    const { data: claim, error } = await db.rpc('begin_knowledge_index', { p_user_id: userId, p_document_id: body.documentId });
    if (error || !claim || typeof claim.source_text !== 'string' || typeof claim.index_revision !== 'number') throw new RequestError(error?.code === '40001' ? 'Uma indexação já está em andamento. Aguarde antes de tentar novamente.' : 'Fonte indisponível ou ainda não aprovada.', error?.code === '40001' ? 409 : 403);
    claimed = { userId, documentId: body.documentId, revision: claim.index_revision };
    if (claim.source_text.length < 20 || claim.source_text.length > 60_000) throw new RequestError('Texto original inválido para indexação.', 413);
    const chunks = chunkText(claim.source_text);
    if (!chunks.length || chunks.length > 60) throw new RequestError('Fonte excede o limite de 60 trechos de indexação.', 413);
    const quota = await checkQuota(db, userId, 25);
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += 20) embeddings.push(...await embedBatch(apiKey, chunks.slice(i, i + 20)));
    if (embeddings.length !== chunks.length || embeddings.some(vector => vector.length !== 768 || vector.some(value => !Number.isFinite(value)))) throw new RequestError('O serviço retornou uma indexação incompleta. O original foi preservado; tente novamente.', 503);
    const { error: commitError } = await db.rpc('finish_knowledge_index', {
      p_user_id: userId, p_document_id: body.documentId, p_index_revision: claim.index_revision,
      p_chunks: chunks.map((content, index) => ({ content, embedding: embeddings[index] })), p_failed: false,
    });
    if (commitError) throw new RequestError('A revisão ou a indexação mudou durante o processamento. Reabra a fonte antes de tentar novamente.', 409);
    committed = true;
    await recordUsage(db, userId, 0, quota.reservationId);
    return new Response(JSON.stringify({ documentId: body.documentId, chunks: chunks.length, status: 'ready' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    if (claimed && !committed) {
      try { await db.rpc('finish_knowledge_index', { p_user_id: claimed.userId, p_document_id: claimed.documentId, p_index_revision: claimed.revision, p_chunks: [], p_failed: true }); }
      catch { /* A later retry can replace a stale processing lease; original stays saved. */ }
    }
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    if (error instanceof QuotaExceededError) return quotaResponse(error, corsHeaders);
    const status = error instanceof RequestError ? error.status : 503;
    return new Response(JSON.stringify({ error: error instanceof RequestError ? error.message : 'Não foi possível indexar. O original foi preservado e pode ser reenviado.' }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
