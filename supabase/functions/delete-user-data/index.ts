/**
 * LGPD / GDPR data deletion endpoint.
 *
 * Deletes ALL data for the authenticated user:
 *   - patient_files (storage objects + DB rows)
 *   - audio-recordings (storage — should already be empty, but clean up)
 *   - consultations, appointments, user_integrations, user_settings, usage_daily
 *   - patients (cascades to the above via FK ON DELETE CASCADE where applicable)
 *   - Finally: the auth.users row itself via the admin API
 *
 * The caller must be authenticated (JWT in Authorization header) and can only
 * delete their own data.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // User-scoped client — RLS enforces the user can only touch their own data.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = user.id;

  // Service-role client for privileged deletes (storage, auth.users)
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // 1. Collect and delete patient file storage objects
    const { data: fileRows } = await adminClient
      .from('patient_files')
      .select('storage_path')
      .eq('user_id', userId);

    if (fileRows && fileRows.length > 0) {
      const paths = fileRows.map((r: any) => r.storage_path);
      await adminClient.storage.from('patient-files').remove(paths);
    }

    // 2. Delete any residual audio recordings
    const { data: audioObjects } = await adminClient.storage
      .from('audio-recordings')
      .list(`consultations/${userId}`);

    if (audioObjects && audioObjects.length > 0) {
      const audioPaths = audioObjects.map((o: any) => `consultations/${userId}/${o.name}`);
      await adminClient.storage.from('audio-recordings').remove(audioPaths);
    }

    // 3. Delete DB rows — most cascade automatically from patients/user_id FK,
    //    but we delete explicitly for clarity and to cover non-cascaded tables.
    await adminClient.from('consultations')      .delete().eq('user_id', userId);
    await adminClient.from('appointments')       .delete().eq('user_id', userId);
    await adminClient.from('patient_files')      .delete().eq('user_id', userId);
    await adminClient.from('patients')           .delete().eq('user_id', userId);
    await adminClient.from('user_integrations')  .delete().eq('user_id', userId);
    await adminClient.from('usage_daily')        .delete().eq('user_id', userId);
    await adminClient.from('user_settings')      .delete().eq('user_id', userId);

    // 4. Delete the auth user (must be last — invalidates all sessions)
    const { error: deleteUserErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteUserErr) throw deleteUserErr;

    return new Response(
      JSON.stringify({ success: true, message: 'Todos os dados foram excluídos permanentemente.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('delete-user-data error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro ao excluir dados' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
