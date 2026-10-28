import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';
import { readJsonObject, RequestError, fetchWithDeadline } from '../_shared/http.ts';
import { assertAudioPath } from '../_shared/storage.ts';
const headers = { 'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers });
  try {
    const { userId } = await requireUser(req);
    const { draftId } = await readJsonObject(req, 2048);
    if (typeof draftId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(draftId)) throw new RequestError('Rascunho inválido.');
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { global: { fetch: fetchWithDeadline } });
    const { data: draft, error } = await db.rpc('begin_consultation_discard', { p_user_id: userId, p_draft_id: draftId });
    if (error) throw new Error('Não foi possível iniciar o descarte.');
    if (draft?.audio_storage_path) {
      const path = assertAudioPath(draft.audio_storage_path, userId);
      const { error: removeError } = await db.storage.from('audio-recordings').remove([path]);
      if (removeError) throw new Error('O áudio ainda não foi removido. O rascunho foi mantido para tentar novamente.');
    }
    const { error: deleteError } = await db.from('consultation_drafts').delete().eq('id', draftId).eq('user_id', userId);
    if (deleteError) throw new Error('O descarte precisa ser concluído. Tente novamente.');
    return new Response(JSON.stringify({ success: true }), { headers });
  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, headers);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Descarte incompleto. Tente novamente.' }), { status: error instanceof RequestError ? error.status : 503, headers });
  }
});
