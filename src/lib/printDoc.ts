/* Open a browser print window for clinical documents.
 *
 * Each printer writes a self-contained HTML document into a Blob, opens it,
 * and revokes the URL after a minute. Single source of truth for the print
 * styles used by ChatPanel, PatientProfileDrawer, PatientSnapshot.
 */

interface PatientLike {
  name: string;
  age: number;
  profession?: string;
  phone?: string;
  allergies?: string[];
  medications?: Array<{ name: string; dosage: string; instructions?: string }>;
}

function openPrintable(html: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todayPtBR(): string {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* ────────────────────────────────────────────────────────────────────── *
 * SOAP — evolution note formatted as section cards.
 * ────────────────────────────────────────────────────────────────────── */

export function printSoap(soapNote: string, patient: PatientLike, chiefComplaint?: string) {
  const sections: Array<{ letter: string; title: string; content: string }> = [];
  const re = /\*\*([A-Z])\s*(?:\([^)]+\))?\*\*[:\s]*([\s\S]*?)(?=\n\s*\n?\*\*[A-Z]|$)/g;
  let m;
  while ((m = re.exec(soapNote)) !== null) {
    sections.push({
      letter: m[1],
      title: m[0].match(/\*\*([^*]+)\*\*/)?.[1]?.trim() ?? m[1],
      content: m[2].trim(),
    });
  }

  const bg: Record<string, string> = { S: '#eff6ff', O: '#f8fafc', A: '#fffbeb', P: '#f0fdf4' };
  const border: Record<string, string> = { S: '#3b82f6', O: '#94a3b8', A: '#f59e0b', P: '#22c55e' };

  const sectionsHtml = sections.length > 0
    ? sections.map(({ letter, title, content }) =>
        `<div style="margin-bottom:14px;background:${bg[letter] ?? '#f9fafb'};border-left:3px solid ${border[letter] ?? '#e5e7eb'};padding:10px 14px;border-radius:0 6px 6px 0">
          <div style="font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;opacity:0.55;margin-bottom:5px">${escapeHtml(title)}</div>
          <div style="font-size:10.5pt;line-height:1.65;white-space:pre-wrap">${escapeHtml(content || 'Não relatado na consulta.')}</div>
        </div>`).join('')
    : `<div style="white-space:pre-wrap;font-size:10.5pt;line-height:1.65">${escapeHtml(soapNote)}</div>`;

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Evolução — ${escapeHtml(patient.name)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:11pt;color:#111827;padding:48px 56px;max-width:800px}h1{font-size:17pt;font-weight:700;color:#1d4ed8}.sub{color:#6b7280;font-size:9.5pt;margin-top:2px;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid #e5e7eb}.footer{margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:8pt}@media print{body{padding:24px 32px}}</style>
</head><body>
<h1>${escapeHtml(patient.name)}</h1>
<div class="sub">${patient.age} anos${patient.profession ? ` · ${escapeHtml(patient.profession)}` : ''} &nbsp;·&nbsp; ${todayPtBR()}${chiefComplaint ? ` &nbsp;·&nbsp; Queixa: ${escapeHtml(chiefComplaint)}` : ''}</div>
${sectionsHtml}
<div class="footer">Gerado pelo Cortex</div>
<script>window.onload=()=>window.print();</script>
</body></html>`;

  openPrintable(html);
}

/* ────────────────────────────────────────────────────────────────────── *
 * Prescription (Receita médica).
 * ────────────────────────────────────────────────────────────────────── */

export function printPrescription(patient: PatientLike) {
  const meds = patient.medications ?? [];
  const medsHtml = meds.map((mm, i) => `
    <div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid #e5e7eb">
      <div style="font-size:11pt;font-weight:700;color:#111827">${i + 1}. ${escapeHtml(mm.name)} <span style="font-weight:400;color:#6b7280">${escapeHtml(mm.dosage)}</span></div>
      ${mm.instructions ? `<div style="margin-top:4px;font-size:10pt;color:#374151">${escapeHtml(mm.instructions)}</div>` : ''}
    </div>`).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Receita — ${escapeHtml(patient.name)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Times New Roman',serif;font-size:11pt;color:#111827;padding:60px;max-width:680px;margin:0 auto}.hdr{text-align:center;border-bottom:2px solid #1d4ed8;padding-bottom:16px;margin-bottom:24px}.hdr h1{font-size:18pt;font-weight:700;color:#1d4ed8}.hdr p{font-size:10pt;color:#6b7280;margin-top:4px}.pbox{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;margin-bottom:24px;font-size:10pt;color:#374151}.allergy{color:#dc2626;margin-top:4px}.rx{font-size:26pt;font-style:italic;font-weight:700;color:#1d4ed8;margin-bottom:20px}.ftr{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-size:10pt;color:#6b7280}.sig{text-align:center}.sig-line{width:200px;border-top:1px solid #374151;margin:50px auto 4px;font-size:9pt;color:#6b7280}@media print{body{padding:40px}}</style>
</head><body>
<div class="hdr"><h1>RECEITA MÉDICA</h1><p>Gerado pelo Cortex</p></div>
<div class="pbox">
  <div><strong>Paciente:</strong> ${escapeHtml(patient.name)} &nbsp;·&nbsp; <strong>Idade:</strong> ${patient.age} anos${patient.profession ? ` &nbsp;·&nbsp; ${escapeHtml(patient.profession)}` : ''}</div>
  ${patient.allergies && patient.allergies.length > 0 ? `<div class="allergy">⚠ Alergias: ${escapeHtml(patient.allergies.join(', '))}</div>` : ''}
</div>
<div class="rx">℞</div>
${medsHtml}
<div class="ftr"><span>${todayPtBR()}</span><div class="sig"><div class="sig-line">Assinatura do Médico</div></div></div>
<script>window.onload=()=>window.print();</script>
</body></html>`;

  openPrintable(html);
}

/* ────────────────────────────────────────────────────────────────────── *
 * Full patient dossier — overview + every consultation.
 * ────────────────────────────────────────────────────────────────────── */

interface ConsultationLike {
  created_at: string;
  chief_complaint: string | null;
  soap_note: string | null;
  whatsapp_message?: string | null;
}

interface DossierExtras {
  socialAnamnesis?: string;
  medicalHistory?: string;
  clinicalNotes?: string;
  diagnoses?: Array<{ code: string; description: string }>;
}

export function printDossier(
  patient: PatientLike,
  consultations: ConsultationLike[],
  extras: DossierExtras = {},
) {
  const section = (title: string, body: string) =>
    body.trim()
      ? `<section><h2>${escapeHtml(title)}</h2><div class="body">${escapeHtml(body)}</div></section>`
      : '';

  const diagnosesHtml = (extras.diagnoses ?? []).length
    ? `<section><h2>Diagnósticos</h2><ul>${extras.diagnoses!.map(d =>
        `<li><strong>${escapeHtml(d.code)}</strong> · ${escapeHtml(d.description)}</li>`,
      ).join('')}</ul></section>`
    : '';

  const medsHtml = (patient.medications ?? []).length
    ? `<section><h2>Medicações em uso</h2><ul>${(patient.medications ?? []).map(m =>
        `<li><strong>${escapeHtml(m.name)}</strong> ${escapeHtml(m.dosage)}${m.instructions ? ` — ${escapeHtml(m.instructions)}` : ''}</li>`,
      ).join('')}</ul></section>`
    : '';

  const allergiesHtml = (patient.allergies ?? []).length
    ? `<section><h2>Alergias</h2><div class="allergy">⚠ ${escapeHtml(patient.allergies!.join(', '))}</div></section>`
    : '';

  const consultationsHtml = consultations.length
    ? `<section><h2>Histórico de consultas (${consultations.length})</h2>${consultations.map(c => {
        const date = new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        return `<article class="consult">
          <h3>${date}${c.chief_complaint ? ` — ${escapeHtml(c.chief_complaint)}` : ''}</h3>
          ${c.soap_note ? `<div class="soap">${escapeHtml(c.soap_note).replace(/\n/g, '<br>')}</div>` : ''}
        </article>`;
      }).join('')}</section>`
    : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Dossiê — ${escapeHtml(patient.name)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:10.5pt;color:#111827;padding:48px 56px;max-width:820px}
h1{font-size:20pt;color:#1d4ed8;font-weight:700}
.sub{color:#6b7280;font-size:10pt;margin-top:4px;margin-bottom:24px;padding-bottom:14px;border-bottom:1px solid #e5e7eb}
section{margin-bottom:24px}
h2{font-size:11pt;text-transform:uppercase;letter-spacing:0.08em;color:#1d4ed8;margin-bottom:8px;font-weight:700}
h3{font-size:11pt;margin-bottom:6px;color:#111827;font-weight:600}
ul{list-style:none;padding:0}
li{padding:4px 0;font-size:10pt;line-height:1.55}
.body{white-space:pre-wrap;line-height:1.6;color:#374151}
.allergy{color:#b91c1c;font-weight:600}
.consult{margin-bottom:18px;padding:12px 14px;background:#f9fafb;border-radius:6px;border-left:3px solid #94a3b8}
.consult .soap{margin-top:6px;font-size:9.5pt;color:#374151;line-height:1.6}
.footer{margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:8pt}
@media print{body{padding:24px 32px}}
</style>
</head><body>
<h1>Dossiê do Paciente</h1>
<div class="sub"><strong>${escapeHtml(patient.name)}</strong> · ${patient.age} anos${patient.profession ? ` · ${escapeHtml(patient.profession)}` : ''}${patient.phone ? ` · ${escapeHtml(patient.phone)}` : ''} &nbsp;·&nbsp; ${todayPtBR()}</div>
${diagnosesHtml}
${medsHtml}
${allergiesHtml}
${section('Anamnese Social', extras.socialAnamnesis ?? '')}
${section('Histórico Médico', extras.medicalHistory ?? '')}
${section('Anotações do Médico', extras.clinicalNotes ?? '')}
${consultationsHtml}
<div class="footer">Gerado pelo Cortex em ${new Date().toLocaleString('pt-BR')}</div>
<script>window.onload=()=>window.print();</script>
</body></html>`;

  openPrintable(html);
}
