// WhatsApp menu bot ("robô de fluxo"): flow model, validation, rendering and the step decision.
// Pure and dependency-free: the webhook (Deno) and the Settings simulator (browser) run the same code.
// Contract: docs/product/whatsapp/CONTRATO.md, section "Robô de fluxo".
//
// The bot only routes: it never asks for health information (WhatsApp Business Messaging Policy)
// and never books an appointment. "Falar com a recepção" (or typing "atendente") always hands off.

export interface FlowOption {
  label: string;
  /** Another node id, "queue:<fila>" (hand off to the reception queue) or "close" (end the chat). */
  goto: string;
}
export interface FlowNode {
  /** Editor-only name of the step. */
  title: string;
  text: string;
  options: FlowOption[];
  /** For a node without options: what happens after its text ("close" or "queue:<fila>"). */
  then?: string;
}
export interface FlowDefinition {
  start: string;
  nodes: Record<string, FlowNode>;
}
/** Weekday (0 = Sunday … 6 = Saturday) → [start, end] in São Paulo time; a missing day is closed. */
export type BusinessHours = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', [string, string]>>;
export interface FlowSettings {
  enabled: boolean;
  definition: FlowDefinition;
  hours: BusinessHours;
  afterHoursText: string;
  handoffText: string;
  defaultQueue: string;
}

export const NODE_ID = /^[a-z0-9_-]{1,40}$/;
export const QUEUE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const LIMITS = { nodes: 30, options: 10, label: 24, buttonLabel: 20, menuText: 1024, text: 4096, title: 40, aux: 1024 };
export const MAX_ATTEMPTS = 2;
export const SESSION_IDLE_MS = 24 * 3600 * 1000;
const HANDOFF_WORDS = ['atendente', 'recepcao', 'recepcionista', 'humano', 'pessoa', 'falar com alguem', 'falar com a recepcao'];
const QUIET_WORDS = ['sair', 'parar', 'stop', 'cancelar lembretes', 'nao quero receber', 'voltar', 'receber lembretes'];

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function isGoto(goto: string, nodes: Record<string, unknown>): boolean {
  if (goto === 'close') return true;
  if (goto.startsWith('queue:')) return QUEUE.test(goto.slice(6));
  return Object.prototype.hasOwnProperty.call(nodes, goto);
}

/** Problems that block saving, in Portuguese for the editor. */
export function validateFlow(f: FlowSettings): string[] {
  const errors: string[] = [];
  const nodes = f.definition?.nodes ?? {};
  const ids = Object.keys(nodes);
  if (!ids.length) errors.push('O fluxo precisa de pelo menos uma etapa.');
  if (ids.length > LIMITS.nodes) errors.push(`No máximo ${LIMITS.nodes} etapas.`);
  if (!Object.prototype.hasOwnProperty.call(nodes, f.definition?.start ?? '')) errors.push('Escolha a etapa inicial.');
  for (const id of ids) {
    const n = nodes[id];
    const name = n?.title?.trim() || id;
    if (!NODE_ID.test(id)) errors.push(`Etapa “${name}”: identificador inválido.`);
    if (!n || typeof n.text !== 'string' || !n.text.trim()) { errors.push(`Etapa “${name}”: escreva a mensagem.`); continue; }
    if ((n.title ?? '').length > LIMITS.title) errors.push(`Etapa “${name}”: nome com até ${LIMITS.title} caracteres.`);
    const options = Array.isArray(n.options) ? n.options : [];
    if (options.length) {
      if (n.text.length > LIMITS.menuText) errors.push(`Etapa “${name}”: mensagem com opções tem até ${LIMITS.menuText} caracteres.`);
      if (options.length > LIMITS.options) errors.push(`Etapa “${name}”: no máximo ${LIMITS.options} opções.`);
      const seen = new Set<string>();
      for (const o of options) {
        const label = typeof o?.label === 'string' ? o.label.trim() : '';
        if (!label || label.length > LIMITS.label) errors.push(`Etapa “${name}”: cada opção tem de 1 a ${LIMITS.label} caracteres.`);
        if (seen.has(normalize(label))) errors.push(`Etapa “${name}”: opções repetidas (“${label}”).`);
        seen.add(normalize(label));
        if (typeof o?.goto !== 'string' || !isGoto(o.goto, nodes)) errors.push(`Etapa “${name}”: a opção “${label}” não leva a lugar válido.`);
      }
    } else {
      if (n.text.length > LIMITS.text) errors.push(`Etapa “${name}”: mensagem com até ${LIMITS.text} caracteres.`);
      if (!n.then || (n.then !== 'close' && !(n.then.startsWith('queue:') && QUEUE.test(n.then.slice(6)))))
        errors.push(`Etapa “${name}”: diga o que acontece depois (encerrar ou encaminhar para a recepção).`);
    }
  }
  if (!QUEUE.test(f.defaultQueue ?? '')) errors.push('Fila padrão inválida.');
  for (const [field, label] of [['afterHoursText', 'Mensagem fora do horário'], ['handoffText', 'Mensagem de encaminhamento']] as const) {
    if (typeof f[field] !== 'string' || f[field].length > LIMITS.aux) errors.push(`${label}: até ${LIMITS.aux} caracteres.`);
  }
  if (!f.handoffText?.trim()) errors.push('Escreva a mensagem de encaminhamento para a recepção.');
  for (const [day, range] of Object.entries(f.hours ?? {})) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(range) || range.length !== 2 || !TIME.test(range[0]) || !TIME.test(range[1]) || range[0] >= range[1])
      errors.push('Horário de atendimento inválido.');
  }
  return [...new Set(errors)];
}

/** São Paulo weekday and minutes of the day. */
function localClock(now: Date): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** No hours configured means always open (no after-hours message). */
export function isOpenNow(hours: BusinessHours, now: Date): boolean {
  if (!hours || !Object.keys(hours).length) return true;
  const { day, minutes } = localClock(now);
  const range = hours[day as keyof BusinessHours];
  return !!range && minutes >= toMinutes(range[0]) && minutes < toMinutes(range[1]);
}

export interface OutMessage {
  kind: 'text' | 'interactive';
  /** Readable copy stored in the conversation (options numbered). */
  body: string;
  /** Cloud API message body (type + content), without recipient. */
  graph: Record<string, unknown>;
}

export const optionId = (nodeId: string, index: number) => `o:${nodeId}:${index}`;

export function renderText(text: string): OutMessage {
  return { kind: 'text', body: text, graph: { type: 'text', text: { preview_url: false, body: text } } };
}

/** A node with options becomes buttons (up to 3 short labels) or a list (up to 10). */
export function renderNode(nodeId: string, node: FlowNode, prefix = ''): OutMessage {
  const text = (prefix ? `${prefix}\n\n` : '') + node.text;
  if (!node.options.length) return renderText(text);
  const body = `${text}\n\n${node.options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}`;
  const buttons = node.options.length <= 3 && node.options.every((o) => o.label.length <= LIMITS.buttonLabel);
  const interactive = buttons
    ? { type: 'button', body: { text: text.slice(0, LIMITS.menuText) },
        action: { buttons: node.options.map((o, i) => ({ type: 'reply', reply: { id: optionId(nodeId, i), title: o.label } })) } }
    : { type: 'list', body: { text: text.slice(0, LIMITS.menuText) },
        action: { button: 'Ver opções', sections: [{ title: 'Opções', rows: node.options.map((o, i) => ({ id: optionId(nodeId, i), title: o.label })) }] } };
  return { kind: 'interactive', body, graph: { type: 'interactive', interactive } };
}

export interface SessionState { node: string; attempts: number; path: string[] }
export interface Inbound { kind: string; body: string; replyId: string | null }
export interface Step {
  messages: OutMessage[];
  status: 'active' | 'handed_off' | 'closed';
  node: string;
  attempts: number;
  path: string[];
  /** Queue the conversation goes to (hand-off), when any. */
  queue: string | null;
  close: boolean;
}

export const isQuietWord = (body: string) => QUIET_WORDS.includes(normalize(body));
const wantsPerson = (body: string) => {
  const n = normalize(body);
  return !!n && HANDOFF_WORDS.some((w) => n === w || n.startsWith(`${w} `) || n.endsWith(` ${w}`) || n.includes(` ${w} `));
};

function matchOption(nodeId: string, node: FlowNode, input: Inbound): number | null {
  if (input.replyId) {
    const m = /^o:([a-z0-9_-]{1,40}):(\d{1,2})$/.exec(input.replyId);
    return m && m[1] === nodeId && Number(m[2]) < node.options.length ? Number(m[2]) : null;
  }
  const text = normalize(input.body);
  if (!text) return null;
  if (/^\d{1,2}$/.test(text)) {
    const i = Number(text) - 1;
    return i >= 0 && i < node.options.length ? i : null;
  }
  const exact = node.options.findIndex((o) => normalize(o.label) === text);
  if (exact >= 0) return exact;
  const partial = node.options.map((o, i) => [normalize(o.label), i] as const).filter(([l]) => text.length >= 4 && (l.includes(text) || text.includes(l)));
  return partial.length === 1 ? partial[0][1] : null;
}

function handoff(f: FlowSettings, path: string[], node: string, queue: string, prefix?: string): Step {
  const text = prefix ? `${prefix}\n\n${f.handoffText}` : f.handoffText;
  return { messages: [renderText(text)], status: 'handed_off', node, attempts: 0, path, queue, close: false };
}

/** Where an option or the end of a node leads. */
function follow(f: FlowSettings, goto: string, path: string[], fromNode: string): Step {
  const nodes = f.definition.nodes;
  if (goto === 'close') return { messages: [], status: 'closed', node: fromNode, attempts: 0, path, queue: null, close: true };
  if (goto.startsWith('queue:')) return handoff(f, path, fromNode, goto.slice(6));
  const node = nodes[goto];
  if (!node) return handoff(f, path, fromNode, f.defaultQueue);
  if (node.options.length) return { messages: [renderNode(goto, node)], status: 'active', node: goto, attempts: 0, path, queue: null, close: false };
  const final = renderText(node.text);
  if (node.then?.startsWith('queue:')) {
    return { messages: [final, renderText(f.handoffText)], status: 'handed_off', node: goto, attempts: 0, path, queue: node.then.slice(6), close: false };
  }
  return { messages: [final], status: 'closed', node: goto, attempts: 0, path, queue: null, close: true };
}

/**
 * The bot's answer to one inbound message. `session` null starts a new cycle (first message, or the
 * conversation was reopened). Never throws for a valid flow.
 */
export function decideStep(f: FlowSettings, session: SessionState | null, input: Inbound, openNow: boolean): Step {
  const path = session ? [...session.path] : [];
  if (wantsPerson(input.body)) return handoff(f, path, session?.node ?? f.definition.start, f.defaultQueue);
  if (!session) {
    const start = f.definition.start;
    const node = f.definition.nodes[start];
    const prefix = !openNow && f.afterHoursText.trim() ? f.afterHoursText.trim() : '';
    if (!node.options.length) {
      const step = follow(f, start, path, start);
      if (prefix) step.messages.unshift(renderText(prefix));
      return step;
    }
    return { messages: [renderNode(start, node, prefix)], status: 'active', node: start, attempts: 0, path, queue: null, close: false };
  }
  const node = f.definition.nodes[session.node];
  if (!node || !node.options.length) return handoff(f, path, session.node, f.defaultQueue);
  const choice = matchOption(session.node, node, input);
  if (choice === null) {
    if (session.attempts + 1 >= MAX_ATTEMPTS) return handoff(f, path, session.node, f.defaultQueue, 'Não consegui entender.');
    return {
      messages: [renderNode(session.node, node, 'Não entendi. Escolha uma das opções:')], status: 'active', node: session.node,
      attempts: session.attempts + 1, path, queue: null, close: false,
    };
  }
  const option = node.options[choice];
  return follow(f, option.goto, [...path, option.label].slice(-20), session.node);
}

/** A sensible first flow for a clinic; the admin edits everything before enabling. */
export function starterFlow(clinicName: string, doctors: string[]): FlowSettings {
  const who = clinicName.trim() || 'a clínica';
  const doctorOptions: FlowOption[] = doctors.slice(0, 8).map((d) => ({ label: d.slice(0, LIMITS.label), goto: 'queue:agendamento' }));
  return {
    enabled: false,
    defaultQueue: 'geral',
    hours: { '1': ['08:00', '18:00'], '2': ['08:00', '18:00'], '3': ['08:00', '18:00'], '4': ['08:00', '18:00'], '5': ['08:00', '18:00'] },
    afterHoursText: 'Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Deixe sua mensagem que respondemos assim que possível.',
    handoffText: 'Obrigado! Uma pessoa da recepção vai continuar o atendimento por aqui.',
    definition: {
      start: 'inicio',
      nodes: {
        inicio: {
          title: 'Boas-vindas',
          text: `Olá! Você está falando com ${who}. Como podemos ajudar?`,
          options: [
            { label: 'Marcar ou remarcar', goto: doctorOptions.length ? 'medico' : 'queue:agendamento' },
            { label: 'Resultado de exame', goto: 'queue:resultados' },
            { label: 'Endereço e horários', goto: 'info' },
            { label: 'Falar com a recepção', goto: 'queue:geral' },
          ],
        },
        ...(doctorOptions.length
          ? { medico: { title: 'Escolha do médico', text: 'Com qual médico você quer marcar?', options: [...doctorOptions, { label: 'Ainda não sei', goto: 'queue:agendamento' }] } }
          : {}),
        info: {
          title: 'Endereço e horários',
          text: 'Endereço: (preencha)\nHorário: segunda a sexta, das 8h às 18h.\nConvênios: (preencha)',
          options: [],
          then: 'close',
        },
      },
    },
  };
}
