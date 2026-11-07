// Synthetic read DTOs only. Connecting, sending, editing rules and grants stay blocked.
import { createWhatsAppReadFixture } from './whatsapp-read-api.mjs';
export function createSettingsReadFixture(ids) {
  const channel = createWhatsAppReadFixture(ids), calls = [];
  return {
    calls,
    handle(actor, input) {
      calls.push({ actor, input: structuredClone(input) });
      if (![ids.admin, ids.a, ids.b].includes(actor)) return { status: 403, data: { code: 'forbidden', error: 'Synthetic role refused' } };
      if (Object.keys(input).some(key => key !== 'action')) return { status: 400, data: { code: 'invalid', error: 'Synthetic read only' } };
      if (input.action === 'state') return channel.handle(actor, input);
      if (input.action === 'templates') return { status: 200, data: { templates: [{ name: 'modelo_sintetico', language: 'pt_BR', status: 'APPROVED', body: 'Aviso sintético {{1}}', category: 'UTILITY', paramCount: 1 }] } };
      if (input.action === 'automations') return actor === ids.admin ? { status: 200, data: { automations: [], runs: [] } } : { status: 403, data: { code: 'forbidden', error: 'Synthetic admin required' } };
      return { status: 400, data: { code: 'invalid', error: 'Synthetic write blocked' } };
    },
  };
}
