/**
 * Public prescription validation endpoint (the URL inside the QR code).
 *
 * PUBLIC BY DESIGN — pharmacies and the ITI validator call it without any JWT
 * (config.toml sets verify_jwt = false for this function). Access control is
 * the patient-held secret code printed on the prescription, per the ITI
 * validation contract:
 *
 *   GET ?id=<uuid>&_secretCode=<code>                          → the PDF itself
 *   GET ?id=<uuid>&_secretCode=<code>&_format=application/validador-iti+json
 *                                                              → JSON manifest
 *
 * No enumeration surface: responses for unknown id, wrong code, revoked and
 * expired are all minimal; the secret code never appears in any response.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',   // deliberately public — pharmacies/validators
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') ?? '';
    const code = url.searchParams.get('_secretCode') ?? url.searchParams.get('code') ?? '';
    const format = url.searchParams.get('_format') ?? '';

    if (!id) {
      return new Response(
        JSON.stringify({ error: 'id é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: rx } = await supabase
      .from('prescriptions')
      .select('id, storage_path, secret_code, status, created_at, expires_at, signed_at, user_id, doc_type')
      .eq('id', id)
      .maybeSingle();

    // Same response for not-found and wrong code — no enumeration oracle.
    if (!rx || !code || code.toUpperCase() !== rx.secret_code.toUpperCase()) {
      return new Response(
        JSON.stringify({ error: 'Receita não encontrada ou código incorreto' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (rx.status === 'revoked') {
      return new Response(
        JSON.stringify({ error: 'Receita revogada pelo emissor', status: 'revoked' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const expired = new Date(rx.expires_at).getTime() < Date.now();

    // Prescriber identity for the manifest (public data on the document itself).
    const { data: prescriber } = await supabase
      .from('user_settings')
      .select('doctor_name, crm_number, crm_uf')
      .eq('user_id', rx.user_id)
      .maybeSingle();

    if (format === 'application/validador-iti+json') {
      const { data: signedUrl } = await supabase.storage
        .from('prescriptions')
        .createSignedUrl(rx.storage_path, 300);
      return new Response(
        JSON.stringify({
          tipoDocumento: rx.doc_type === 'atestado' ? 'atestado'
            : rx.doc_type === 'solicitacao_exames' ? 'solicitacao'
            : 'prescricao',
          subtipo: rx.doc_type,
          status: expired ? 'expirada' : (rx.status === 'signed' ? 'assinada' : 'gerada_sem_assinatura'),
          emissor: prescriber ? {
            nome: prescriber.doctor_name,
            crm: prescriber.crm_number,
            uf: prescriber.crm_uf,
          } : null,
          dataEmissao: rx.created_at,
          validaAte: rx.expires_at,
          assinadaEm: rx.signed_at,
          documento: signedUrl?.signedUrl ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/validador-iti+json' } },
      );
    }

    if (expired) {
      return new Response(
        JSON.stringify({ error: 'Receita expirada', validaAte: rx.expires_at }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Default: serve the PDF inline.
    const { data: blob, error: dlErr } = await supabase.storage
      .from('prescriptions')
      .download(rx.storage_path);
    if (dlErr || !blob) throw new Error('Erro ao carregar o documento');

    return new Response(blob.stream(), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="receita.pdf"',
        'Cache-Control': 'no-store',
      },
    });

  } catch (error) {
    console.error('validate-prescription error:', error instanceof Error ? error.message : 'unknown');
    return new Response(
      JSON.stringify({ error: 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
