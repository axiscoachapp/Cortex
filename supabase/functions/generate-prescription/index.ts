/**
 * Digital prescription generator (Phase 1 — unsigned).
 *
 * Builds the prescription PDF (doctor name/CRM/UF/address, patient name and
 * age, date-time, medication list) plus a QR code that opens the original
 * document on the clinic's server, stores it in the private `prescriptions`
 * bucket, and records the row. Until ICP-Brasil signing exists the document
 * states that it is valid only with the physician's handwritten signature and
 * stamp, and it does not claim ITI validation.
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
import { clinicDayBounds } from "../_shared/clinicDate.ts";
import { antimicrobialsIn, controlledFindings, controlledSubstancesIn, FORM_LABEL, planControlledPrescription, toWinAnsi, type ControlledPlan } from "../_shared/regulatedMedications.ts";

// Allow-Origin is '*' by default (unchanged). Set the ALLOWED_ORIGIN function
// secret to your app's origin to lock cross-origin access down to it.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

type DocType = 'receita_simples' | 'receita_antimicrobiano' | 'receita_controle_especial' | 'atestado' | 'solicitacao_exames';
const DOC_TYPES: DocType[] = ['receita_simples', 'receita_antimicrobiano', 'receita_controle_especial', 'atestado', 'solicitacao_exames'];

/** Legal validity per document type (days). Atestado/solicitação have no
 *  dispensing window — theirs is the retention of the validation link. */
const VALIDITY: Record<DocType, number> = {
  receita_simples: 30,
  receita_antimicrobiano: 10,   // RDC 471/2021
  receita_controle_especial: 30, // Portaria 344/98, art. 52 §1º
  atestado: 90,
  solicitacao_exames: 90,
};

const DOC_TITLES: Record<DocType, string> = {
  receita_simples: 'RECEITUÁRIO',
  receita_antimicrobiano: 'RECEITUÁRIO — ANTIMICROBIANO',
  // Without this exact heading the pharmacy must refuse it (Anvisa Q&A, RDC 1.000/2025).
  receita_controle_especial: 'RECEITA DE CONTROLE ESPECIAL',
  atestado: 'ATESTADO MÉDICO',
  solicitacao_exames: 'SOLICITAÇÃO DE EXAMES',
};

/** The two copies of a retained prescription and their legal text. */
const COPY_LABELS: Partial<Record<DocType, [string, string]>> = {
  receita_antimicrobiano: ['1ª via — paciente', '2ª via — retenção da farmácia'],
  // Portaria 344/98, art. 52: highlighted on each copy.
  receita_controle_especial: ['1ª via - Retenção da Farmácia ou Drogaria', '2ª via - Orientação ao Paciente'],
};

/** Printed label per registration value. 'nao_informado' has no label on
 *  purpose: RDC 471/2021 needs the sex on an antimicrobial prescription. */
const SEX_LABELS: Record<string, string> = {
  feminino: 'feminino',
  masculino: 'masculino',
  intersexo: 'intersexo',
};

function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

interface Medication { name: string; dosage?: string; instructions?: string }

/** Database refusals that are not the doctor's fault get an honest message:
 *  40001 is another write holding the custody barrier at the same moment,
 *  55000 an account or patient deletion in progress. */
function concurrencyError(error: { code?: string } | null): RequestError | null {
  if (error?.code === '40001') return new RequestError('Outra operação estava em andamento no mesmo instante. Gere o documento novamente.', 409);
  if (error?.code === '55000') return new RequestError('Há uma exclusão de conta ou de paciente em andamento. O documento não foi gerado.', 409);
  return null;
}

/** Product name without dose or form ("Rivotril 2mg" -> "Rivotril"), safe as a
 *  quoted PostgREST filter value (no quotes, wildcards or separators). */
function catalogTerm(name: string): string {
  return name.replace(/\s*\d.*$/, '').replace(/["\\%_(),*]/g, ' ').replace(/\s+/g, ' ').trim();
}

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
    const docType: DocType = DOC_TYPES.includes(body.docType)
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
      .select('doctor_name, crm_number, crm_uf, professional_address, professional_phone, rqe, prescriber_cpf')
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
      .select('id, name, age, date_of_birth, medications, cpf, sex')
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
    const prescriberPhone = typeof settings.professional_phone === 'string' ? settings.professional_phone.trim() : '';
    const prescriberRqe = typeof settings.rqe === 'string' ? settings.rqe.trim() : '';
    const patientCpf = typeof patient.cpf === 'string' && /^\d{11}$/.test(patient.cpf) ? patient.cpf : null;
    const patientSex = SEX_LABELS[String(patient.sex ?? '')] ?? null;

    // RDC 471/2021: an antimicrobial prescription carries the prescriber's phone
    // and the patient's age and sex. Refuse before building the PDF.
    if (docType === 'receita_antimicrobiano') {
      if (!prescriberPhone) {
        throw new RequestError('Informe o telefone profissional em Configurações (ícone de engrenagem): ele é obrigatório na receita de antimicrobiano.', 422);
      }
      const missing = [...(patientAge === null ? ['idade ou data de nascimento'] : []), ...(patientSex ? [] : ['sexo'])];
      if (missing.length) {
        throw new RequestError(`Para a receita de antimicrobiano, complete no cadastro do paciente: ${missing.join(' e ')}.`, 422);
      }
    }
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
    if (isReceita && meds.some((m: Medication) => !m.dosage?.trim() || !m.instructions?.trim())) {
      throw new RequestError('Informe a dose e a posologia (como tomar) de todos os medicamentos.', 422);
    }
    // A brand ("Rivotril", "Monuril") says nothing to the substance lists, so
    // each name is also resolved in the Anvisa catalog by exact product name and
    // checked by its active ingredient and antimicrobial flag. Fails closed.
    const catalog = new Map<string, { ingredients: string[]; antimicrobial: boolean }>();
    const terms = isReceita ? [...new Set(meds.map((m: Medication) => catalogTerm(m.name)).filter((t) => t.length >= 3))] : [];
    if (terms.length) {
      const { data: rows, error: catalogError } = await supabase.from('medication_catalog')
        .select('product_name, active_ingredient, is_antimicrobial')
        // refresh-medication-catalog stores product names in upper case.
        .in('product_name', [...new Set(terms.map((t) => t.toUpperCase()))])
        .limit(500);
      if (catalogError) throw new RequestError('Não foi possível consultar a base Anvisa para conferir os medicamentos. Tente novamente.', 503);
      for (const row of (rows ?? []) as Array<{ product_name: string; active_ingredient: string | null; is_antimicrobial: boolean }>) {
        const key = row.product_name.trim().toLowerCase();
        const entry = catalog.get(key) ?? { ingredients: [], antimicrobial: false };
        if (row.active_ingredient?.trim()) entry.ingredients.push(row.active_ingredient.trim().toLowerCase());
        entry.antimicrobial ||= row.is_antimicrobial === true;
        catalog.set(key, entry);
      }
    }
    const catalogOf = (m: Medication) => catalog.get(catalogTerm(m.name).toLowerCase());
    const controlledIn = (m: Medication) => [m.name, ...(catalogOf(m)?.ingredients ?? [])].flatMap(controlledSubstancesIn);
    const antimicrobialIn = (m: Medication) => {
      const hit = catalogOf(m);
      const found = [m.name, ...(hit?.ingredients ?? [])].flatMap(antimicrobialsIn);
      return found.length || !hit?.antimicrobial ? found : [hit.ingredients[0] ?? m.name.trim()];
    };
    // D8: the Receita de Controle Especial has its own rules; other prescriptions
    // refuse any controlled drug and say which form it needs.
    let controlledPlan: ControlledPlan | null = null;
    if (docType === 'receita_controle_especial') {
      const result = planControlledPrescription(
        meds.map((m: Medication) => ({ ...m, ingredients: catalogOf(m)?.ingredients ?? [] })),
        body.content ?? null,
        { patientCpf, prescriberCpf: typeof settings.prescriber_cpf === 'string' ? settings.prescriber_cpf : null, prescriberPhone },
      );
      if ('error' in result) throw new RequestError(result.error, 422);
      controlledPlan = result.plan;
    } else if (isReceita) {
      const controlled = meds.flatMap(controlledIn);
      if (controlled.length) {
        const findings = meds.flatMap((m: Medication) => [m.name, ...(catalogOf(m)?.ingredients ?? []).map((i) => `${i} ${m.name}`)].flatMap(controlledFindings));
        const forms = [...new Set(findings.map((f) => f.form))];
        throw new RequestError(
          `Medicamento sujeito a controle especial (Portaria SVS/MS 344/98): ${[...new Set(controlled)].join(', ')}. ` +
            (forms.length === 1 && forms[0] === 'receita_controle_especial'
              ? 'Escolha o tipo "Controle especial" para emiti-lo.'
              : `Exige: ${forms.map((f) => FORM_LABEL[f]).join('; ')}.`),
          422,
        );
      }
      const antimicrobials = meds.flatMap(antimicrobialIn);
      if (antimicrobials.length && docType !== 'receita_antimicrobiano')
        throw new RequestError(
          `Antimicrobiano (${[...new Set(antimicrobials)].join(', ')}) exige a "Receita — antimicrobiano" (RDC 471/2021: 2 vias, validade de 10 dias).`,
          422,
        );
    }

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
    // Valid through the whole printed day in the clinic's zone: a pharmacy that
    // scans on the last day at 16:00 must not be refused (it was now + N×24 h).
    const lastDay = clinicDayBounds(new Date(now.getTime() + VALIDITY[docType] * 86_400_000));
    const expiresAt = new Date(Date.parse(lastDay.end) - 1);
    const validationUrl =
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/validate-prescription?id=${prescriptionId}`;
    // The QR carries the access code so scanning it opens the original document.
    const qrUrl = `${validationUrl}&code=${code}`;

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
      regular: helv, bold: helvBold, ink, continuation: toWinAnsi(`Continuação — ${patient.name}`),
      addPage: () => pdf.addPage([width, height]),
      draw: (target, value, options) => target.drawText(value, options),
    });
    const text: typeof writer.text = (value, options) => writer.text(toWinAnsi(value), options);
    const down = writer.down;

    // Header — prescriber
    text(settings.doctor_name.trim(), { size: 15, bold: true, color: blue }); down(16);
    text(`CRM ${settings.crm_number.trim()}/${settings.crm_uf.trim().toUpperCase()}${prescriberRqe ? ` · RQE ${prescriberRqe.replace(/^RQE\s*/i, '')}` : ''}`, { size: 10.5, bold: true }); down(13);
    const contactLine = [settings.professional_address?.trim(), prescriberPhone ? `Tel. ${prescriberPhone}` : ''].filter(Boolean).join(' · ');
    if (contactLine) {
      text(contactLine, { size: 9, color: mut }); down(13);
    }
    // Lei 9.965/2000: anabolic steroids (C5) carry the prescriber's CPF.
    if (controlledPlan?.hasC5 && typeof settings.prescriber_cpf === 'string') {
      text(`CPF do médico: ${formatCpf(settings.prescriber_cpf)}`, { size: 9, color: mut }); down(13);
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
    const sexPart = docType === 'receita_antimicrobiano' && patientSex ? `, sexo ${patientSex}` : '';
    text(`Paciente: ${patient.name}, ${patientAge !== null ? `${patientAge} anos` : 'idade não informada'}${sexPart}`, { size: 11 }); down(15);
    if (controlledPlan) {
      // Portaria 344/98 art. 55 and Lei 5.991/73 art. 35: full address and CPF
      // (or "não possui"/another document) of the patient.
      wrapText(`Endereço: ${controlledPlan.patientAddress}`, { size: 9.5, max: 95 });
      text(controlledPlan.patientDocumentLine, { size: 9.5 }); down(13);
    } else if (patientCpf) {
      // CFM 2.381/2024: patient CPF "quando houver". The address follows when the
      // single patient registration has address fields (S2/D20).
      text(`CPF: ${formatCpf(patientCpf)}`, { size: 9, color: mut }); down(13);
    }
    const emitted = now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const dateLine = isReceita
      ? `Emitido em: ${emitted} · Válida até ${expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
      : `Emitido em: ${emitted}`;
    text(dateLine, { size: 9, color: mut });
    down(20);

    if (docType === 'receita_antimicrobiano') {
      text('Receita de antimicrobiano — sujeita a retenção. Validade: 10 dias (RDC 471/2021).', { size: 9, bold: true, color: rgb(0.66, 0.36, 0.06) });
      down(20);
    } else if (controlledPlan) {
      text('Sujeita a retenção. Validade: 30 dias, em todo o território nacional (Portaria SVS/MS 344/98).', { size: 9, bold: true, color: rgb(0.66, 0.36, 0.06) });
      down(20);
    } else {
      down(8);
    }

    if (isAtestado && atestado) {
      // Atestado body
      const daysLabel = atestado.days === 1 ? '1 (um) dia' : `${atestado.days.toLocaleString('pt-BR')} ${atestado.days < 1 ? 'dia' : 'dias'}`;
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
    } else if (controlledPlan) {
      // RCE items: generic name next to a brand, dose and form, quantity in
      // numbers and in words, posology (Portaria 344/98 arts. 52 and 55).
      controlledPlan.items.forEach((item, i) => {
        const generic = item.findings.map((f) => f.substance).join(' + ');
        const folded = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const shown = folded(item.name).includes(folded(generic).split(/\s+/)[0]) ? item.name : `${item.name} (${generic})`;
        // Concentration of the controlled substance, unless the name already shows it.
        const strength = folded(shown).replace(/\s+/g, '').includes(folded(item.concentration).replace(/\s+/g, '')) ? '' : ` ${item.concentration}`;
        text(`${i + 1}. ${shown}${strength} — ${item.dosage}`, { size: 11.5, bold: true }); down(15);
        text(`Quantidade: ${item.quantity} (${item.quantityText}) ${item.unit}`, { x: margin + 14, size: 10.5 }); down(14);
        wrapText(item.instructions, { x: margin + 14, size: 10, color: mut, max: 90 });
        down(9);
      });
      if (controlledPlan.justification) {
        wrapText(`Justificativa (quantidade acima do limite, art. 60): ${controlledPlan.justification}`, { size: 9.5, max: 95 });
      }
      if (controlledPlan.cid) {
        text(`CID: ${controlledPlan.cid}`, { size: 9.5 }); down(14);
      }
      down(6);
      // Filled by the pharmacy (Portaria 6/99, art. 85).
      text('IDENTIFICAÇÃO DO COMPRADOR', { size: 8.5, bold: true }); down(12);
      text('Nome: ______________________________________________   Identidade nº: ________________   Órgão emissor: ______', { size: 8, color: mut }); down(11);
      text('Endereço: _________________________________________________   Cidade/UF: _______________   Telefone: ____________', { size: 8, color: mut }); down(14);
      text('IDENTIFICAÇÃO DO FORNECEDOR', { size: 8.5, bold: true }); down(12);
      text('Assinatura do farmacêutico: _______________________________________________   Data: ____/____/______', { size: 8, color: mut }); down(12);
    } else {
      // Medications
      meds.forEach((m, i) => {
        // RDC 471/2021: an antimicrobial is prescribed by its generic name
        // (DCB). A brand keeps its name and gains the substance next to it.
        let shown = m.name.trim();
        if (docType === 'receita_antimicrobiano') {
          const generic = catalogOf(m)?.ingredients[0] ?? [...new Set(antimicrobialsIn(m.name))].join(' + ');
          const folded = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
          if (generic && !folded(shown).includes(folded(generic).split(/\s+/)[0])) shown = `${shown} (${generic})`;
        }
        const nameLine = `${i + 1}. ${shown}${m.dosage?.trim() ? ` — ${m.dosage.trim()}` : ''}`;
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
      const qrDataUrl: string = await toDataURL(qrUrl, { margin: 0, width: 220 });
      const qrPng = await pdf.embedPng(qrDataUrl);
      writer.page.drawImage(qrPng, { x: margin, y: writer.y - 92, width: 92, height: 92 });
      qrDrawn = true;
    } catch { /* fall back to text-only validation info */ }

    const infoX = qrDrawn ? margin + 108 : margin;
    const valLabel = isAtestado ? 'Validação do atestado' : isExames ? 'Validação da solicitação' : 'Validação da receita';
    text(valLabel, { x: infoX, size: 9.5, bold: true }); down(13);
    text(`Código de acesso do paciente: ${code}`, { x: infoX, size: 10.5, bold: true, color: blue }); down(13);
    text('Aponte a câmera para o QR code para ver o documento original.', { x: infoX, size: 8.5, color: mut }); down(11);
    text(validationUrl.replace('https://', ''), { x: infoX, size: 7, color: mut }); down(20);

    // Signature status notice — replaced by the PAdES signature block in Phase 1b.
    // The QR occupies y=58..150; keep the notice below its lower edge.
    writer.footer(bodyPage, 42);
    text('Documento sem assinatura digital ICP-Brasil: válido somente com assinatura e carimbo do médico.', { size: 8, color: mut }); down(10);
    text('Gerado pelo Cortex.', { size: 8, color: mut });
    }

    // Retained prescriptions go out in two copies, each with its legal label.
    const copyLabels = COPY_LABELS[docType];
    if (copyLabels) {
      const originals = pdf.getPages();
      const source = await PDFDocument.load(await pdf.save());
      const copies = await pdf.copyPages(source, originals.map((_, index) => index));
      const label = (page: typeof originals[number], value: string) =>
        page.drawText(toWinAnsi(value), { x: width - margin - helvBold.widthOfTextAtSize(toWinAnsi(value), 8.5), y: height - 30, size: 8.5, font: helvBold, color: mut });
      originals.forEach((page) => label(page, copyLabels[0]));
      copies.forEach((page) => {
        pdf.addPage(page);
        label(page, copyLabels[1]);
      });
    }
    // Classic cross-reference table: _shared/pades.ts signs by incremental
    // update and does not read compressed xref streams (D17).
    const pdfBytes = await pdf.save({ useObjectStreams: false });
    const pdfSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(pdfBytes).buffer))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const issuanceSnapshot = {
      prescriber: {
        doctor_name: settings.doctor_name.trim(), crm_number: settings.crm_number.trim(), crm_uf: settings.crm_uf.trim().toUpperCase(),
        professional_address: settings.professional_address?.trim() ?? '', professional_phone: prescriberPhone || null, rqe: prescriberRqe || null,
      },
      patient: {
        name: patient.name, age: patientAge, dateOfBirth: patient.date_of_birth ?? null, cpf: patientCpf, sex: patient.sex ?? null,
        ...(controlledPlan ? { address: controlledPlan.patientAddress, document: controlledPlan.patientDocumentLine } : {}),
      },
      ...(controlledPlan ? {
        controlled: {
          items: controlledPlan.items.map((i) => ({ name: i.name, concentration: i.concentration, quantity: i.quantity, unit: i.unit, substances: i.findings.map((f) => `${f.substance} (${f.list})`) })),
          cid: controlledPlan.cid, justification: controlledPlan.justification, prescriber_cpf_printed: controlledPlan.hasC5,
        },
      } : {}),
      pdf_sha256: pdfSha256, template_version: 'cortex-clinical-document-v3', issued_at: now.toISOString(),
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
      content: atestado ?? exames ?? (controlledPlan
        ? { patientAddress: controlledPlan.patientAddress, patientDocument: controlledPlan.patientDocumentLine, cid: controlledPlan.cid, justification: controlledPlan.justification }
        : null),
      storage_path: storagePath,
      secret_code: code,
      status: 'revoked',
      expires_at: expiresAt.toISOString(),
      issuance_snapshot: issuanceSnapshot,
    });
    if (insErr) {
      throw concurrencyError(insErr) ?? insErr;
    }
    try {
      const { error: upErr } = await supabase.storage.from('prescriptions')
        .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw new Error(`Erro ao armazenar PDF: ${upErr.message}`);
      const { data: activated, error: activationError } = await supabase.from('prescriptions')
        .update({ status: 'generated', issuance_verified_at: new Date().toISOString() })
        .eq('id', prescriptionId).eq('user_id', userId).select('id').maybeSingle();
      if (activationError) throw concurrencyError(activationError) ?? new Error('Não foi possível concluir o documento. Gere novamente.');
      if (!activated) throw new Error('O paciente foi alterado durante a geração. Gere novamente.');
    } catch (error) {
      const { error: cleanupError } = await supabase.storage.from('prescriptions').remove([storagePath]);
      // Keep the revoked metadata if removal fails so deletion can retry it.
      if (!cleanupError) await supabase.from('prescriptions').delete().eq('id', prescriptionId).eq('user_id', userId);
      throw error;
    }

    // Short-lived preview URL for the doctor's browser, opened right away. A
    // signed URL is a bearer link that survives logout or a password change,
    // so keep it as short as the validation link (5 min).
    const { data: signed } = await supabase.storage
      .from('prescriptions')
      .createSignedUrl(storagePath, 300);

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
