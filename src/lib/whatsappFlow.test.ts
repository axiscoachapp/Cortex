// Menu bot: flow validation, rendering and step decisions. Pure, synthetic flows only.
import { describe, expect, it } from 'vitest';
import {
  decideStep, isOpenNow, renderNode, starterFlow, validateFlow, type FlowSettings,
} from '../../supabase/functions/_shared/whatsappFlow';

const flow = (): FlowSettings => ({
  enabled: true,
  defaultQueue: 'geral',
  hours: { '1': ['08:00', '18:00'] },
  afterHoursText: 'Estamos fora do horário.',
  handoffText: 'Uma pessoa da recepção continua por aqui.',
  definition: {
    start: 'inicio',
    nodes: {
      inicio: { title: 'Boas-vindas', text: 'Como podemos ajudar?', options: [
        { label: 'Agendar', goto: 'medico' }, { label: 'Endereço', goto: 'info' }, { label: 'Recepção', goto: 'queue:geral' },
      ] },
      medico: { title: 'Médico', text: 'Com quem?', options: [{ label: 'Dra. Ana', goto: 'queue:agendamento' }, { label: 'Encerrar', goto: 'close' }] },
      info: { title: 'Endereço', text: 'Rua Exemplo, 100.', options: [], then: 'close' },
      final: { title: 'Final', text: 'Vamos encaminhar.', options: [], then: 'queue:resultados' },
    },
  },
});
const MONDAY_10H = new Date('2026-11-09T13:00:00Z'); // 10:00 in São Paulo
const MONDAY_20H = new Date('2026-11-09T23:00:00Z');
const input = (body: string, replyId: string | null = null) => ({ kind: replyId ? 'interactive' : 'text', body, replyId });

describe('flow validation', () => {
  it('accepts the starter flow and a well-formed flow', () => {
    expect(validateFlow(starterFlow('Clínica Exemplo', ['Dra. Ana Exemplo', 'Dr. Bruno Exemplo']))).toEqual([]);
    expect(validateFlow(flow())).toEqual([]);
  });

  it('refuses dangling targets, long labels, too many options, missing endings and bad hours', () => {
    const f = flow();
    f.definition.nodes.inicio.options[0].goto = 'nao_existe';
    f.definition.nodes.medico.options[0].label = 'Um rótulo comprido demais para o WhatsApp';
    f.definition.nodes.info.then = undefined;
    f.hours = { '1': ['18:00', '08:00'] };
    const errors = validateFlow(f).join(' | ');
    expect(errors).toContain('não leva a lugar válido');
    expect(errors).toContain('de 1 a 24 caracteres');
    expect(errors).toContain('o que acontece depois');
    expect(errors).toContain('Horário de atendimento inválido');
    const many = flow();
    many.definition.nodes.inicio.options = Array.from({ length: 11 }, (_, i) => ({ label: `Opção ${i}`, goto: 'close' }));
    expect(validateFlow(many).join(' ')).toContain('no máximo 10 opções');
  });
});

describe('rendering', () => {
  it('uses buttons for up to three short options and a list otherwise', () => {
    const f = flow();
    const buttons = renderNode('inicio', f.definition.nodes.inicio);
    expect(buttons.graph).toMatchObject({ type: 'interactive', interactive: { type: 'button', action: { buttons: [
      { reply: { id: 'o:inicio:0', title: 'Agendar' } }, { reply: { id: 'o:inicio:1' } }, { reply: { id: 'o:inicio:2' } },
    ] } } });
    expect(buttons.body).toBe('Como podemos ajudar?\n\n1. Agendar\n2. Endereço\n3. Recepção');
    const four = { ...f.definition.nodes.inicio, options: [...f.definition.nodes.inicio.options, { label: 'Resultado de exame', goto: 'close' }] };
    expect(renderNode('inicio', four).graph).toMatchObject({ interactive: { type: 'list', action: { button: 'Ver opções', sections: [{ rows: expect.any(Array) }] } } });
  });
});

describe('step decisions', () => {
  it('starts with the menu, prefixed by the after-hours text when closed', () => {
    const open = decideStep(flow(), null, input('Oi'), isOpenNow(flow().hours, MONDAY_10H));
    expect(open).toMatchObject({ status: 'active', node: 'inicio', attempts: 0, queue: null, close: false });
    expect(open.messages[0].body.startsWith('Como podemos ajudar?')).toBe(true);
    const closed = decideStep(flow(), null, input('Oi'), isOpenNow(flow().hours, MONDAY_20H));
    expect(closed.messages[0].body.startsWith('Estamos fora do horário.\n\nComo podemos ajudar?')).toBe(true);
  });

  it('follows the tapped button, the typed number or the typed label', () => {
    const s = { node: 'inicio', attempts: 0, path: [] };
    expect(decideStep(flow(), s, input('Agendar', 'o:inicio:0'), true)).toMatchObject({ node: 'medico', status: 'active', path: ['Agendar'] });
    expect(decideStep(flow(), s, input('2'), true)).toMatchObject({ node: 'info', status: 'closed', close: true, path: ['Endereço'] });
    expect(decideStep(flow(), s, input('  endereço '), true)).toMatchObject({ node: 'info', close: true });
    // A button from another step is not accepted as an answer to this one.
    expect(decideStep(flow(), s, input('Dra. Ana', 'o:medico:0'), true)).toMatchObject({ node: 'inicio', attempts: 1, status: 'active' });
  });

  it('hands off to a queue from an option or from an ending node', () => {
    const toQueue = decideStep(flow(), { node: 'medico', attempts: 0, path: ['Agendar'] }, input('1'), true);
    expect(toQueue).toMatchObject({ status: 'handed_off', queue: 'agendamento', path: ['Agendar', 'Dra. Ana'] });
    expect(toQueue.messages.map((m) => m.body)).toEqual(['Uma pessoa da recepção continua por aqui.']);
    const f = flow();
    f.definition.nodes.inicio.options[1].goto = 'final';
    const ending = decideStep(f, { node: 'inicio', attempts: 0, path: [] }, input('2'), true);
    expect(ending).toMatchObject({ status: 'handed_off', queue: 'resultados' });
    expect(ending.messages.map((m) => m.body)).toEqual(['Vamos encaminhar.', 'Uma pessoa da recepção continua por aqui.']);
  });

  it('asks again once, then hands off; "atendente" always reaches a person', () => {
    const first = decideStep(flow(), { node: 'inicio', attempts: 0, path: [] }, input('qualquer coisa'), true);
    expect(first).toMatchObject({ status: 'active', attempts: 1 });
    expect(first.messages[0].body.startsWith('Não entendi. Escolha uma das opções:')).toBe(true);
    const second = decideStep(flow(), { node: 'inicio', attempts: 1, path: [] }, input('???'), true);
    expect(second).toMatchObject({ status: 'handed_off', queue: 'geral' });
    expect(decideStep(flow(), null, input('Quero falar com a recepção'), true)).toMatchObject({ status: 'handed_off', queue: 'geral' });
    expect(decideStep(flow(), { node: 'medico', attempts: 0, path: [] }, input('ATENDENTE'), true)).toMatchObject({ status: 'handed_off' });
  });

  it('reads business hours in São Paulo time', () => {
    const hours = { '1': ['08:00', '18:00'] as [string, string] };
    expect(isOpenNow(hours, MONDAY_10H)).toBe(true);
    expect(isOpenNow(hours, MONDAY_20H)).toBe(false);
    expect(isOpenNow(hours, new Date('2026-11-08T13:00:00Z'))).toBe(false); // Sunday
    expect(isOpenNow({}, MONDAY_20H)).toBe(true);
  });
});
