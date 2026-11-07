// Synthetic read DTOs only. Connecting, sending, editing rules and grants stay blocked.
import { createWhatsAppReadFixture } from './whatsapp-read-api.mjs';
export function createSettingsReadFixture(ids) {
  const channel = createWhatsAppReadFixture(ids), calls = [];
  return {
    calls,
    handle(actor, input) {
      calls.push({ actor, input: structuredClone(input) });
      if (![ids.admin, ids.a, ids.b].includes(actor)) return { status: 403, data: { code: 'forbidden', error: 'Synthetic role refused' } };
      const extra=input.action==='flow'?['clinicName','doctors']:[];
      if (Object.keys(input).some(key => key !== 'action'&&!extra.includes(key))) return { status: 400, data: { code: 'invalid', error: 'Synthetic read only' } };
      if(input.action==='flow') {
        if(actor!==ids.admin)return {status:403,data:{code:'forbidden',error:'Synthetic admin required'}};
        if(typeof input.clinicName!=='string'||input.clinicName.length>200||!Array.isArray(input.doctors)||input.doctors.length>100||input.doctors.some(name=>typeof name!=='string'||name.length>200))return {status:400,data:{code:'invalid',error:'Synthetic flow read shape'}};
        return {status:200,data:{enabled:false,definition:{start:'inicio',nodes:{inicio:{title:'Início sintético',text:'Como podemos ajudar?',options:[{label:'Falar com a recepção',goto:'queue:geral'}]}}},hours:{},afterHoursText:'Aviso sintético',handoffText:'A recepção continua o atendimento.',defaultQueue:'geral',revision:0,updatedAt:null,starter:true}};
      }
      if (input.action === 'state') return channel.handle(actor, input);
      if (input.action === 'templates') return { status: 200, data: { templates: [{ name: 'modelo_sintetico', language: 'pt_BR', status: 'APPROVED', body: 'Aviso sintético {{1}}', category: 'UTILITY', paramCount: 1 }] } };
      if (input.action === 'automations') return actor === ids.admin ? { status: 200, data: { automations: [], runs: [] } } : { status: 403, data: { code: 'forbidden', error: 'Synthetic admin required' } };
      return { status: 400, data: { code: 'invalid', error: 'Synthetic write blocked' } };
    },
  };
}
