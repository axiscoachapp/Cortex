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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { createPaginatedWriter, validateDocumentCounts, validateCertificateDays } from "../_shared/documentLayout.ts";
import { toDataURL } from "https://esm.sh/qrcode@1.5.3";
import { requireUser, AuthError, authResponse } from "../_shared/auth.ts";
import { readJsonObject, RequestError } from "../_shared/http.ts";
import { currentPatientAge } from "../_shared/patientAge.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

type DocType = 'receita_simples' | 'receita_antimicrobiano' | 'atestado' | 'solicitacao_exames';

/** Legal validity per document type (days). Atestado/solicitação have no
 *  dispensing window — theirs is the retention of the validation link. */
const VALIDITY: Record<DocType, number> = {
  receita_simples: 30,
  receita_antimicrobiano: 10,   // RDC 471/2021
  atestado: 90,
  solicitacao_exames: 90,
};

const DOC_TITLES: Record<DocType, string> = {
  receita_simples: 'RECEITUÁRIO',
  receita_antimicrobiano: 'RECEITUÁRIO — ANTIMICROBIANO',
  atestado: 'ATESTADO MÉDICO',
  solicitacao_exames: 'SOLICITAÇÃO DE EXAMES',
};

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
    const body = await readJsonObject(req);
    const { patientId, consultationId } = body;
    const docType: DocType = ['receita_simples', 'receita_antimicrobiano', 'atestado', 'solicitacao_exames'].includes(body.docType)
      ? body.docType
      : 'receita_simples';

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

    if (!settings?.doctor_name?.trim() || !settings?.crm_number?.trim() || !settings?.crm_uf?.trim() || !settings?.professional_address?.trim()) {
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
      .select('id, name, age, date_of_birth, medications')
      .eq('id', patientId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!patient) {
      return new Response(
        JSON.stringify({ error: 'Paciente não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const patientAge = currentPatientAge(patient);
    if (consultationId) {
      const { data: consultation } = await supabase.from('consultations').select('id')
        .eq('id', consultationId).eq('patient_id', patientId).eq('user_id', userId).maybeSingle();
      if (!consultation) throw new Error('A consulta selecionada não pertence a este paciente.');
    }

    // Medication list (receita types): explicit list from the caller wins;
    // else current profile meds. Atestado/solicitação carry content instead.
    const isAtestado = docType === 'atestado';
    const isExames = docType === 'solicitacao_exames';
    const isReceita = !isAtestado && !isExames;
    const rawMeds: Medication[] = Array.isArray(body.medications) && body.medications.length > 0
      ? body.medications
      : (Array.isArray(patient.medications) ? patient.medications : []);
    validateDocumentCounts(docType, rawMeds.length, Array.isArray(body.content?.exams) ? body.content.exams.length : 0);
    if (isReceita && rawMeds.some((m: Medication) => !m || typeof m.name !== 'string' || !m.name.trim()
      || typeof m.dosage !== 'string' || typeof m.instructions !== 'string')) {
      throw new Error('Revise nome, dose e instruções de todos os medicamentos.');
    }
    const meds = !isReceita ? [] : rawMeds;

    if (isReceita && meds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum medicamento para prescrever' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Atestado duration is exact clinician input; invalid values are never clamped.
    if (isAtestado) {
      try { validateCertificateDays(body.content?.days); }
      catch { throw new RequestError('Informe entre 0,5 e 365 dias, em intervalos de meio dia.'); }
    }
    const atestado = isAtestado ? {
      days: validateCertificateDays(body.content?.days),
      cid: (body.content?.cid ?? '').toString().trim().slice(0, 20),
      note: (body.content?.note ?? '').toString().trim().slice(0, 400),
    } : null;

    // Exam request content: 1–20 exams + optional clinical indication.
    const exames: { exams: string[]; indication: string } | null = isExames ? {
      exams: (Array.isArray(body.content?.exams) ? body.content.exams : [])
        .filter((e: unknown): e is string => typeof e === 'string' && e.trim().length > 0)
        .map((e: string) => e.trim()),
      indication: (body.content?.indication ?? '').toString().trim().slice(0, 300),
    } : null;

    if (isExames && exames!.exams.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum exame na solicitação' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const prescriptionId = crypto.randomUUID();
    const code = accessCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VALIDITY[docType] * 86_400_000);
    const validationUrl =
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/validate-prescription?id=${prescriptionId}`;

    // ── Build the PDF ─────────────────────────────────────────────────────────
    const pdf = await PDFDocument.create();
    const firstPage = pdf.addPage([595.28, 841.89]); // A4 portrait, points
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = firstPage.getSize();
    const margin = 56;

    const ink = rgb(0.09, 0.14, 0.18);
    const mut = rgb(0.42, 0.48, 0.54);
    const blue = rgb(0.11, 0.39, 0.72);

    const writer = createPaginatedWriter({
      page: firstPage, width, top: height - margin, bottom: 190, margin,
      regular: helv, bold: helvBold, ink, continuation: `Continuação — ${patient.name}`,
      addPage: () => pdf.addPage([width, height]),
      draw: (target, value, options) => target.drawText(value, options),
    });
    const text = writer.text;
    const down = writer.down;

    // Header — prescriber
    text(settings.doctor_name.trim(), { size: 15, bold: true, color: blue }); down(16);
    text(`CRM ${settings.crm_number.trim()}/${settings.crm_uf.trim().toUpperCase()}`, { size: 10.5, bold: true }); down(13);
    if (settings.professional_address?.trim()) {
      text(settings.professional_address.trim(), { size: 9, color: mut }); down(13);
    }
    down(6);
    writer.page.drawLine({
      start: { x: margin, y: writer.y }, end: { x: width - margin, y: writer.y },
      thickness: 1.4, color: blue,
    });
    down(28);

    // Simple word-wrap helper — content lines are short in practice.
    const wrapText = (s: string, opts: { x?: number; size?: number; color?: ReturnType<typeof rgb>; max?: number } = {}) => {
      text(s, opts);
      down((opts.size ?? 10) + 4);
    };

    // Title + patient + date
    text(DOC_TITLES[docType], { size: 13, bold: true }); down(22);
    text(`Paciente: ${patient.name}, ${patientAge !== null ? `${patientAge} anos` : 'idade não informada'}`, { size: 11 }); down(15);
    const emitted = now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const dateLine = isReceita
      ? `Emitido em: ${emitted} · Válida até ${expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
      : `Emitido em: ${emitted}`;
    text(dateLine, { size: 9, color: mut });
    down(20);

    if (docType === 'receita_antimicrobiano') {
      text('Receita de antimicrobiano — sujeita a retenção. Validade: 10 dias (RDC 471/2021).', { size: 9, bold: true, color: rgb(0.66, 0.36, 0.06) });
      down(20);
    } else {
      down(8);
    }

    if (isAtestado && atestado) {
      // Atestado body
      const daysLabel = atestado.days === 1 ? '1 (um) dia' : `${atestado.days} dias`;
      wrapText(
        `Atesto, para os devidos fins, que o(a) paciente ${patient.name} foi atendido(a) nesta data, ` +
        `necessitando de afastamento de suas atividades por ${daysLabel} a partir desta data.`,
        { size: 11.5, max: 78 },
      );
      down(6);
      if (atestado.cid) {
        text(`CID: ${atestado.cid} (incluído a pedido do paciente)`, { size: 10, color: mut }); down(15);
      }
      if (atestado.note) {
        wrapText(atestado.note, { size: 10, color: mut, max: 90 });
      }
    } else if (isExames && exames) {
      // Exam request body
      if (exames.indication) {
        wrapText(`Indicação clínica: ${exames.indication}`, { size: 10, color: mut, max: 90 });
        down(8);
      }
      exames.exams.forEach((e, i) => {
        text(`${i + 1}. ${e}`, { size: 11.5, bold: true }); down(17);
      });
    } else {
      // Medications
      meds.forEach((m, i) => {
        const nameLine = `${i + 1}. ${m.name.trim()}${m.dosage?.trim() ? ` — ${m.dosage.trim()}` : ''}`;
        text(nameLine, { size: 11.5, bold: true }); down(15);
        if (m.instructions?.trim()) {
          wrapText(m.instructions, { x: margin + 14, size: 10, color: mut, max: 90 });
        }
        down(9);
      });
    }

    // Every page reserves the same footer area; no medication can overlap it.
    for (const bodyPage of pdf.getPages()) {
    writer.footer(bodyPage, 168);
    writer.page.drawLine({
      start: { x: margin, y: writer.y }, end: { x: width - margin, y: writer.y },
      thickness: 0.8, color: rgb(0.85, 0.89, 0.92),
    });
    down(18);

    // QR code (left) + validation info (right of it)
    let qrDrawn = false;
    try {
      const qrDataUrl: string = await toDataURL(validationUrl, { margin: 0, width: 220 });
      const qrPng = await pdf.embedPng(qrDataUrl);
      writer.page.drawImage(qrPng, { x: margin, y: writer.y - 92, width: 92, height: 92 });
      qrDrawn = true;
    } catch { /* fall back to text-only validation info */ }

    const infoX = qrDrawn ? margin + 108 : margin;
    const valLabel = isAtestado ? 'Validação do atestado' : isExames ? 'Validação da solicitação' : 'Validação da receita';
    text(valLabel, { x: infoX, size: 9.5, bold: true }); down(13);
    text(`Código de acesso do paciente: ${code}`, { x: infoX, size: 10.5, bold: true, color: blue }); down(13);
    text('Valide em validar.iti.gov.br ou aponte a câmera para o QR code.', { x: infoX, size: 8.5, color: mut }); down(11);
    text(validationUrl.replace('https://', ''), { x: infoX, size: 7, color: mut }); down(20);

    // Signature status notice — replaced by the PAdES signature block in Phase 1b.
    // The QR occupies y=58..150; keep the notice below its lower edge.
    writer.footer(bodyPage, 42);
    text('Documento gerado eletronicamente pelo Cortex. Assinatura digital ICP-Brasil pendente —', { size: 8, color: mut }); down(10);
    text('até a assinatura, este documento não substitui a receita assinada.', { size: 8, color: mut });
    }

    const pdfBytes = await pdf.save();
    const pdfSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(pdfBytes).buffer))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const issuanceSnapshot = {
      prescriber: { doctor_name: settings.doctor_name.trim(), crm_number: settings.crm_number.trim(), crm_uf: settings.crm_uf.trim().toUpperCase(), professional_address: settings.professional_address?.trim() ?? '' },
      patient: { name: patient.name, age: patientAge, dateOfBirth: patient.date_of_birth ?? null },
      pdf_sha256: pdfSha256, template_version: 'cortex-clinical-document-v1', issued_at: now.toISOString(),
    };

    // ── Store + record ────────────────────────────────────────────────────────
    const storagePath = `rx/${userId}/${prescriptionId}.pdf`;
    // Register the owned object path before upload so concurrent deletion can
    // enumerate it. It remains unavailable for validation until upload succeeds.
    const { error: insErr } = await supabase.from('prescriptions').insert({
      id: prescriptionId,
      user_id: userId,
      patient_id: patientId,
      consultation_id: consultationId ?? null,
      medications: meds,
      doc_type: docType,
      content: atestado ?? exames,
      storage_path: storagePath,
      secret_code: code,
      status: 'revoked',
      expires_at: expiresAt.toISOString(),
      issuance_snapshot: issuanceSnapshot,
    });
    if (insErr) {
      throw insErr;
    }
    try {
      const { error: upErr } = await supabase.storage.from('prescriptions')
        .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw new Error(`Erro ao armazenar PDF: ${upErr.message}`);
      const { data: activated, error: activationError } = await supabase.from('prescriptions')
        .update({ status: 'generated', issuance_verified_at: new Date().toISOString() })
        .eq('id', prescriptionId).eq('user_id', userId).select('id').maybeSingle();
      if (activationError || !activated) throw new Error('O paciente foi alterado durante a geração. Gere novamente.');
    } catch (error) {
      const { error: cleanupError } = await supabase.storage.from('prescriptions').remove([storagePath]);
      // Keep the revoked metadata if removal fails so deletion can retry it.
      if (!cleanupError) await supabase.from('prescriptions').delete().eq('id', prescriptionId).eq('user_id', userId);
      throw error;
    }

    // Short-lived preview URL for the doctor's browser.
    const { data: signed } = await supabase.storage
      .from('prescriptions')
      .createSignedUrl(storagePath, 3600);

    return new Response(
      JSON.stringify({
        prescriptionId,
        docType,
        accessCode: code,
        previewUrl: signed?.signedUrl ?? null,
        validationUrl,
        expiresAt: expiresAt.toISOString(),
        status: 'generated',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    if (error instanceof RequestError) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (error instanceof AuthError) return authResponse(error, corsHeaders);
    console.error('generate-prescription failed');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
