/**
 * Public prescription validation endpoint (the URL inside the QR code).
 *
 * PUBLIC BY DESIGN — pharmacies and the ITI validator call it without any JWT
 * (config.toml sets verify_jwt = false for this function). Access control is
 * the patient-held secret code printed on the prescription, per the ITI
 * validation contract:
 *
 *   GET ?id=<uuid>&_secretCode=<code>                          → the PDF itself
 *   GET ?id=<uuid>&_secretCode=<code>&_format=application%2Fvalidador-iti%2Bjson
 *                                                              → JSON manifest
 *
 * No enumeration surface: responses for unknown id, wrong code, revoked and
 * expired are all minimal; the secret code never appears in any response.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { assertPrescriptionPath } from "../_shared/storage.ts";
import { fetchWithDeadline } from "../_shared/http.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',   // deliberately public — pharmacies/validators
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // A phone camera (QR scan) opens this URL in a browser: answer with a short
  // readable page instead of raw JSON. API clients keep the JSON contract.
  const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');
  const reply = (status: number, body: Record<string, unknown>) => {
    if (!wantsHtml)
      return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const message = typeof body.error === 'string' ? body.error : 'Documento indisponível.';
    // Supabase serves Edge Function HTML as text/plain, so a phone would show raw
    // markup: answer with short readable plain text instead.
    const text = `Verificação de documento médico

${message}

Em caso de dúvida, entre em contato com o médico emissor.`;
    return new Response(text, { status, headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });
  };

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') ?? '';
    const code = url.searchParams.get('_secretCode') ?? url.searchParams.get('code') ?? '';
    // A literal "+" in the query string decodes to a space; accept both
    // spellings of the ITI media type so the JSON branch is not missed.
    const format = (url.searchParams.get('_format') ?? '').replace(/^application\/validador-iti json$/, 'application/validador-iti+json');

    if (!id) {
      return reply(400, { error: 'Documento não informado.' });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { fetch: fetchWithDeadline } },
    );

    const { data: rx } = await supabase
      .from('prescriptions')
      .select('id, storage_path, secret_code, status, created_at, expires_at, signed_at, signature_verified_at, issuance_verified_at, issuance_snapshot, user_id, doc_type')
      .eq('id', id)
      .maybeSingle();

    // Same response for not-found and wrong code — no enumeration oracle.
    if (!rx || !code || code.toUpperCase() !== rx.secret_code.toUpperCase()) {
      return reply(404, { error: 'Documento não encontrado ou código de acesso incorreto.' });
    }

    if (rx.status === 'revoked') {
      return reply(410, { error: 'Este documento foi revogado pelo médico emissor e não é mais válido.', status: 'revoked' });
    }

    if (!rx.issuance_verified_at || !Number.isFinite(Date.parse(rx.issuance_verified_at))) {
      return new Response(JSON.stringify({status:'unverified',error:'Documento antigo sem emissão verificada. Solicite a reemissão ao prescritor.'}),
        {status:409,headers:{...corsHeaders,'Content-Type':'application/json'}});
    }
    // Only prescriptions have a dispensing window. Sick notes and exam
    // requests stay verifiable (they used to report "expirada" after 90 days).
    const expires = typeof rx.doc_type !== 'string' || rx.doc_type.startsWith('receita');
    const expired = expires && (!Number.isFinite(Date.parse(rx.expires_at)) || Date.parse(rx.expires_at) <= Date.now());
    if (expired) {
      return reply(410, {
        error: `Receita fora do prazo de validade (até ${new Date(rx.expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}).`,
        validaAte: rx.expires_at,
      });
    }
    // Reject unsafe historic metadata as well as malformed current rows.
    const storagePath = assertPrescriptionPath(rx.storage_path, rx.user_id, rx.id);

    // Legacy documents are never backfilled from mutable current settings.
    const snapshot = rx.issuance_snapshot;
    if (!snapshot || !snapshot.prescriber || typeof snapshot.pdf_sha256 !== 'string') {
      return new Response(JSON.stringify({ status: 'unverified', error: 'Documento sem identidade de emissão preservada. Solicite a reemissão ao prescritor.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const prescriber = snapshot.prescriber;

    if (format === 'application/validador-iti+json') {
      const { data: signedUrl, error: urlError } = await supabase.storage
        .from('prescriptions')
        .createSignedUrl(storagePath, 300);
      if (urlError || !signedUrl) throw new Error('Documento indisponível');
      return new Response(
        JSON.stringify({
          tipoDocumento: rx.doc_type === 'atestado' ? 'atestado'
            : rx.doc_type === 'solicitacao_exames' ? 'solicitacao'
            : 'prescricao',
          subtipo: rx.doc_type,
          status: rx.status === 'signed' && rx.signature_verified_at ? 'assinada' : 'gerada_sem_assinatura',
          emissor: prescriber ? {
            nome: prescriber.doctor_name,
            crm: prescriber.crm_number,
            uf: prescriber.crm_uf,
          } : null,
          dataEmissao: rx.created_at,
          sha256: snapshot.pdf_sha256,
          versaoModelo: snapshot.template_version,
          validaAte: rx.expires_at,
          assinadaEm: rx.signature_verified_at ? rx.signed_at : null,
          documento: signedUrl?.signedUrl ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/validador-iti+json' } },
      );
    }

    // Default: serve the PDF inline.
    const { data: blob, error: dlErr } = await supabase.storage
      .from('prescriptions')
      .download(storagePath);
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
    console.error('validate-prescription failed');
    return new Response(
      JSON.stringify({ error: 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
