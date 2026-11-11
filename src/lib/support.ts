/**
 * How a clinic reaches the Cortex team. The technical setup of each clinic (TISS data, health
 * plans, prices, prescriber data, WhatsApp connection) is done by the Cortex team, so screens that
 * show those data read-only must say how to ask for a change.
 *
 * The channel is a deployment setting: VITE_SUPPORT_WHATSAPP (digits with country code, e.g.
 * 5541999990000) and/or VITE_SUPPORT_EMAIL. Without either, the request can still be copied.
 */
const digits = (import.meta.env.VITE_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');
const email = (import.meta.env.VITE_SUPPORT_EMAIL ?? '').trim();

export const supportChannel = {
  whatsapp: /^\d{10,15}$/.test(digits) ? digits : null,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
};

/** The text the clinic sends: what it needs, and which screen it was on. */
export function supportRequestText(subject: string, clinicName?: string | null): string {
  const where = typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`;
  return [`Pedido de ajuste no Cortex${clinicName ? ` — ${clinicName}` : ''}`, `Assunto: ${subject}`, where ? `Tela: ${where}` : '', 'O que precisa mudar: ']
    .filter(Boolean).join('\n');
}

export function supportLinks(text: string): { whatsapp: string | null; email: string | null } {
  return {
    whatsapp: supportChannel.whatsapp ? `https://wa.me/${supportChannel.whatsapp}?text=${encodeURIComponent(text)}` : null,
    email: supportChannel.email ? `mailto:${supportChannel.email}?subject=${encodeURIComponent('Pedido de ajuste no Cortex')}&body=${encodeURIComponent(text)}` : null,
  };
}
