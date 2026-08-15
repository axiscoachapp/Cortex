/**
 * Digital prescription generator (Phase 1 — unsigned).
 *
 * Builds the prescription PDF with the mandatory content of CFM Res. 2.299/2021
 * art. 2º (doctor name/CRM/UF/address, patient identification, date-time,
 * medication list) plus the validation QR code and patient access code, stores
 * it in the private `prescriptions` bucket, and records the row.
 *
 * Signing (PAdES via the doctor's cloud PSC certificate) is Phase 1b: the PDF
 * carries a visible "assinatura digital pendente" notice until the signing
 * orchestrator is integrated. Nothing here needs to change for that — the
 * signer will consume the same stored PDF and flip status to 'signed'.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

const VALIDITY_DAYS = 30;   // receita simples — antimicrobials (10 days) come with the SNCR phase

interface Medication { name: string; dosage?: string; instructions?: string }

function accessCode(): string {
  // 8 chars, unambiguous alphabet (no 0/O/1/I), per ITI's 0-64 alphanumeric contract.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await requireUser(req);
    const body = await req.json();
    const { patientId, consultationId } = body;

    if (!patientId) {
      return new Response(
        JSON.stringify({ error: 'patientId é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Prescriber identity — CFM 2.299 art. 2º makes these mandatory on the document.
    const { data: settings } = await supabase
      .from('user_settings')
      .select('doctor_name, crm_number, crm_uf, professional_address')
      .eq('user_id', userId)
      .maybeSingle();

    if (!settings?.doctor_name?.trim() || !settings?.crm_number?.trim() || !settings?.crm_uf?.trim()) {
      return new Response(
        JSON.stringify({
          error: 'Dados do prescritor incompletos',
          missingPrescriber: true,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Patient — ownership enforced.
    const { data: patient } = await supabase
      .from('patients')
      .select('id, name, age, medications')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!patient) {
      return new Response(
        JSON.stringify({ error: 'Paciente não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Medication list: explicit list from the caller wins; else current profile meds.
    const rawMeds: Medication[] = Array.isArray(body.medications) && body.medications.length > 0
      ? body.medications
      : (Array.isArray(patient.medications) ? patient.medications : []);
    const meds = rawMeds
      .filter((m: any) => m && typeof m.name === 'string' && m.name.trim())
      .slice(0, 15);

    if (meds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum medicamento para prescrever' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const prescriptionId = crypto.randomUUID();
    const code = accessCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VALIDITY_DAYS * 86_400_000);
    const validationUrl =
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/validate-prescription?id=${prescriptionId}`;

    // ── Build the PDF ─────────────────────────────────────────────────────────
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4 portrait, points
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();
    const margin = 56;
    let y = height - margin;

    const ink = rgb(0.09, 0.14, 0.18);
    const mut = rgb(0.42, 0.48, 0.54);
    const blue = rgb(0.11, 0.39, 0.72);

    const text = (s: string, opts: { x?: number; size?: number; bold?: boolean; color?: any } = {}) => {
      page.drawText(s, {
        x: opts.x ?? margin, y,
        size: opts.size ?? 10.5,
        font: opts.bold ? helvBold : helv,
        color: opts.color ?? ink,
      });
    };
    const down = (n: number) => { y -= n; };

    // Header — prescriber
    text(settings.doctor_name.trim(), { size: 15, bold: true, color: blue }); down(16);
    text(`CRM ${settings.crm_number.trim()}/${settings.crm_uf.trim().toUpperCase()}`, { size: 10.5, bold: true }); down(13);
    if (settings.professional_address?.trim()) {
      text(settings.professional_address.trim(), { size: 9, color: mut }); down(13);
    }
    down(6);
    page.drawLine({
      start: { x: margin, y }, end: { x: width - margin, y },
      thickness: 1.4, color: blue,
    });
    down(28);

    // Title + patient + date
    text('RECEITUÁRIO', { size: 13, bold: true }); down(22);
    text(`Paciente: ${patient.name}${patient.age ? `, ${patient.age} anos` : ''}`, { size: 11 }); down(15);
    text(
      `Emitido em: ${now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} · Válida até ${expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      { size: 9, color: mut },
    );
    down(28);

    // Medications
    meds.forEach((m, i) => {
      const nameLine = `${i + 1}. ${m.name.trim()}${m.dosage?.trim() ? ` — ${m.dosage.trim()}` : ''}`;
      text(nameLine, { size: 11.5, bold: true }); down(15);
      if (m.instructions?.trim()) {
        // Naive wrap at ~90 chars — instructions are short in practice.
        const words = m.instructions.trim().split(/\s+/);
        let line = '';
        for (const w of words) {
          if ((line + ' ' + w).length > 90) {
            text(line, { x: margin + 14, size: 10, color: mut }); down(13);
            line = w;
          } else {
            line = line ? `${line} ${w}` : w;
          }
        }
        if (line) { text(line, { x: margin + 14, size: 10, color: mut }); down(13); }
      }
      down(9);
    });

    // Footer block — pinned to the bottom area
    y = 168;
    page.drawLine({
      start: { x: margin, y }, end: { x: width - margin, y },
      thickness: 0.8, color: rgb(0.85, 0.89, 0.92),
    });
    down(18);

    // QR code (left) + validation info (right of it)
    let qrDrawn = false;
    try {
      const qrDataUrl: string = await QRCode.toDataURL(validationUrl, { margin: 0, width: 220 });
      const qrPng = await pdf.embedPng(qrDataUrl);
      page.drawImage(qrPng, { x: margin, y: y - 92, width: 92, height: 92 });
      qrDrawn = true;
    } catch { /* fall back to text-only validation info */ }

    const infoX = qrDrawn ? margin + 108 : margin;
    text('Validação da receita', { x: infoX, size: 9.5, bold: true }); down(13);
    text(`Código de acesso do paciente: ${code}`, { x: infoX, size: 10.5, bold: true, color: blue }); down(13);
    text('Valide em validar.iti.gov.br ou aponte a câmera para o QR code.', { x: infoX, size: 8.5, color: mut }); down(11);
    text(validationUrl.replace('https://', ''), { x: infoX, size: 7, color: mut }); down(20);

    // Signature status notice — replaced by the PAdES signature block in Phase 1b.
    text('Documento gerado eletronicamente pelo Cortex. Assinatura digital ICP-Brasil pendente —', { size: 8, color: mut }); down(10);
    text('até a assinatura, este documento não substitui a receita assinada.', { size: 8, color: mut });

    const pdfBytes = await pdf.save();

    // ── Store + record ────────────────────────────────────────────────────────
    const storagePath = `rx/${userId}/${prescriptionId}.pdf`;
    const { error: upErr } = await supabase.storage
      .from('prescriptions')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: false });
    if (upErr) throw new Error(`Erro ao armazenar PDF: ${upErr.message}`);

    const { error: insErr } = await supabase.from('prescriptions').insert({
      id: prescriptionId,
      user_id: userId,
      patient_id: patientId,
      consultation_id: consultationId ?? null,
      medications: meds,
      storage_path: storagePath,
      secret_code: code,
      status: 'generated',
      expires_at: expiresAt.toISOString(),
    });
    if (insErr) {
      await supabase.storage.from('prescriptions').remove([storagePath]).catch(() => {});
      throw insErr;
    }

    // Short-lived preview URL for the doctor's browser.
    const { data: signed } = await supabase.storage
      .from('prescriptions')
      .createSignedUrl(storagePath, 3600);

    return new Response(
      JSON.stringify({
        prescriptionId,
        accessCode: code,
        previewUrl: signed?.signedUrl ?? null,
        validationUrl,
        expiresAt: expiresAt.toISOString(),
        status: 'generated',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('generate-prescription error:', error instanceof Error ? error.message : 'unknown');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
