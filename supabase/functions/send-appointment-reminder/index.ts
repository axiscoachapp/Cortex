import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

const TYPE_LABELS: Record<string, string> = {
  novo: 'Primeira Consulta',
  retorno: 'Retorno',
  seguimento: 'Seguimento',
  urgencia: 'Urgência',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { appointmentId, type, userId } = await req.json();

    if (!appointmentId || !type || !userId) {
      return new Response(
        JSON.stringify({ error: 'appointmentId, type e userId são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Fetch appointment + patient
    const { data: appt, error: apptError } = await supabase
      .from('appointments')
      .select('*, patients(name, phone, email)')
      .eq('id', appointmentId)
      .eq('user_id', userId)
      .single();

    if (apptError || !appt) {
      return new Response(
        JSON.stringify({ error: 'Consulta não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const patient = appt.patients as any;
    const patientName = patient?.name ?? 'Paciente';
    const dateStr = formatDate(appt.start_time);
    const typeLabel = TYPE_LABELS[appt.type] ?? appt.type;

    // ── WhatsApp ───────────────────────────────────────────────────────────
    if (type === 'whatsapp') {
      const phone = patient?.phone?.replace(/\D/g, '');
      if (!phone) {
        return new Response(
          JSON.stringify({ error: 'Paciente sem telefone cadastrado' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const message = `Olá ${patientName}! 👋

Lembrando da sua consulta agendada:

📅 *${dateStr}*
🏥 Tipo: ${typeLabel}
${appt.notes ? `📝 Obs: ${appt.notes}\n` : ''}
Em caso de necessidade, entre em contato para reagendamento.

Até breve! 💙`;

      const waLink = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;

      return new Response(
        JSON.stringify({ message, waLink }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Email via Resend ───────────────────────────────────────────────────
    if (type === 'email') {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY não configurada');

      const patientEmail = patient?.email;
      if (!patientEmail) {
        return new Response(
          JSON.stringify({ error: 'Paciente sem email cadastrado' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Lembrete de Consulta</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
      <div style="width: 40px; height: 40px; background: #3B82F6; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
        <span style="color: #fff; font-weight: bold; font-size: 18px;">C</span>
      </div>
      <span style="font-size: 20px; font-weight: 700; color: #111827;">Cortex</span>
    </div>
    <h2 style="color: #111827; font-size: 18px; font-weight: 600; margin: 0 0 8px;">Lembrete de Consulta</h2>
    <p style="color: #6B7280; margin: 0 0 24px;">Olá <strong>${patientName}</strong>, você tem uma consulta agendada:</p>
    <div style="background: #EFF6FF; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #1D4ED8;">📅 ${dateStr}</p>
      <p style="margin: 0; color: #374151;">Tipo: <strong>${typeLabel}</strong></p>
      ${appt.notes ? `<p style="margin: 8px 0 0; color: #374151;">Observações: ${appt.notes}</p>` : ''}
    </div>
    <p style="color: #6B7280; font-size: 14px; margin: 0;">Em caso de necessidade de reagendamento, entre em contato com seu médico.</p>
    <hr style="border: 0; border-top: 1px solid #E5E7EB; margin: 24px 0;">
    <p style="color: #9CA3AF; font-size: 12px; margin: 0; text-align: center;">Este é um lembrete automático do sistema Cortex.</p>
  </div>
</body>
</html>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Cortex <noreply@resend.dev>',
          to: [patientEmail],
          subject: `Lembrete: Sua consulta está agendada — ${new Date(appt.start_time).toLocaleDateString('pt-BR')}`,
          html,
        }),
      });

      if (!emailRes.ok) {
        const err = await emailRes.text();
        throw new Error(`Resend error: ${err}`);
      }

      // Mark reminder as sent
      await supabase
        .from('appointments')
        .update({ reminder_sent: true })
        .eq('id', appointmentId);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'type inválido. Use "email" ou "whatsapp"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('send-appointment-reminder error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
