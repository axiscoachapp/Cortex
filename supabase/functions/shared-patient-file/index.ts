import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { requireUser, AuthError, authResponse } from '../_shared/auth.ts';
import { fetchWithDeadline, readJsonObject, RequestError } from '../_shared/http.ts';
import { assertPatientFilePath } from '../_shared/storage.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store', Vary: 'Origin',
};
serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors });
  try {
    const { userId } = await requireUser(req);
    const body = await readJsonObject(req);
    if (typeof body.fileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.fileId)) throw new RequestError('Arquivo inválido', 400);
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { global: { fetch: fetchWithDeadline } });
    const args = { p_actor_user_id: userId, p_file_id: body.fileId, p_record_access: false };
    const { data: file, error } = await db.rpc('authorize_shared_file', args);
    if (error || !file?.storage_path) throw new RequestError('Download não autorizado ou acesso revogado.', 403);
    const path = assertPatientFilePath(file.storage_path, file.owner_user_id, file.patient_id);
    const { data: blob, error: downloadError } = await db.storage.from('patient-files').download(path);
    if (downloadError || !blob) throw new RequestError('Não foi possível carregar o arquivo. Tente novamente.', 503);
    if (blob.size > 25 * 1024 * 1024) throw new RequestError('Arquivo excede o limite de download.', 413);
    // Reauthorize after the slow storage operation and immediately before delivery.
    const { error: revoked } = await db.rpc('authorize_shared_file', { ...args, p_record_access: true });
    if (revoked) throw new RequestError('O acesso foi alterado durante o download.', 403);
    return new Response(blob, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment' } });
  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, cors);
    const status = error instanceof RequestError ? error.status : 503;
    const message = error instanceof RequestError ? error.message : 'Não foi possível concluir o download.';
    return new Response(JSON.stringify({ error: message }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
