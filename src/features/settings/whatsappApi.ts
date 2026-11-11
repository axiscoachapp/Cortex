// Client of the whatsapp-api Edge Function. Contract: docs/product/whatsapp/CONTRATO.md.
import { supabase } from '@/integrations/supabase/client';
import { functionErrorBody, functionErrorMessage } from '@/lib/functionErrors';

export interface WhatsAppState {
  serverReady: boolean;
  connected: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'none';
  displayPhone: string | null;
  verifiedName: string | null;
  quality: string | null;
  connectedAt: string | null;
  canManage: boolean;
  canUseInbox: boolean;
  lastError?: string | null;
  webhookUrl?: string;
  phoneNumberId?: string | null;
  wabaId?: string | null;
}

export interface WhatsAppTemplate { name: string; language: string; category: string; status: string; body: string; paramCount: number }

export type ParamSource = 'paciente_primeiro_nome' | 'data' | 'hora' | 'dia_semana' | 'medico' | 'clinica' | 'link' | 'link_pre_consulta' | 'texto';
export interface AutomationParam { source: ParamSource; text?: string }
export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: 'before_start' | 'after_end';
  offsetMinutes: number;
  templateName: string;
  templateLanguage: string;
  params: AutomationParam[];
  linkUrl: string | null;
  doctorIds: string[] | null;
  appointmentTypes: string[] | null;
  revision: number;
  updatedAt: string;
}
export type AutomationRule = Omit<Automation, 'id' | 'revision' | 'updatedAt'>;
export interface AutomationRun {
  id: string;
  automationId: string;
  appointmentId: string;
  appointmentStart: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  reason: string | null;
  reply: string | null;
  repliedAt: string | null;
  at: string;
}

export class WhatsAppApiError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}

export async function whatsappCall<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('whatsapp-api', { body: { action, ...body } });
  if (error) {
    const parsed = await functionErrorBody(error);
    throw new WhatsAppApiError(
      await functionErrorMessage(error, 'Não foi possível falar com o WhatsApp agora. Tente de novo.'),
      typeof parsed?.code === 'string' ? parsed.code : null,
    );
  }
  return data as T;
}

export const PARAM_LABELS: Record<ParamSource, string> = {
  paciente_primeiro_nome: 'Primeiro nome do paciente',
  data: 'Data da consulta (dd/mm)',
  hora: 'Horário da consulta',
  dia_semana: 'Dia da semana',
  medico: 'Nome do médico',
  clinica: 'Nome da clínica',
  link: 'Link da regra',
  link_pre_consulta: 'Link da pré-consulta (único por consulta)',
  texto: 'Texto fixo',
};

export const SAMPLE_VALUES: Record<Exclude<ParamSource, 'link' | 'texto'>, string> = {
  link_pre_consulta: 'https://…/pre-consulta/…',
  paciente_primeiro_nome: 'Maria',
  data: '10/12',
  hora: '15:00',
  dia_semana: 'quinta-feira',
  medico: 'Dra. Ana Exemplo',
  clinica: 'Clínica Exemplo',
};

export const APPOINTMENT_TYPES: Record<string, string> = {
  novo: 'Primeira consulta',
  retorno: 'Retorno',
  seguimento: 'Seguimento',
  urgencia: 'Urgência',
};

/** "48 h antes", "2 h depois", "30 min antes", "3 dias antes". */
export function describeWhen(trigger: Automation['trigger'], minutes: number): string {
  const side = trigger === 'before_start' ? 'antes da consulta' : 'depois da consulta';
  if (minutes === 0) return trigger === 'before_start' ? 'no início da consulta' : 'ao fim da consulta';
  if (minutes % 1440 === 0 && minutes >= 2880 && minutes !== 2880) return `${minutes / 1440} dias ${side}`;
  if (minutes % 60 === 0) return `${minutes / 60} h ${side}`;
  return `${minutes} min ${side}`;
}

export function previewBody(template: WhatsAppTemplate | undefined, params: AutomationParam[], linkUrl: string | null): string {
  if (!template) return '';
  return template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => {
    const p = params[Number(n) - 1];
    if (!p) return `{{${n}}}`;
    if (p.source === 'texto') return p.text || '…';
    if (p.source === 'link') return linkUrl || 'https://…';
    return SAMPLE_VALUES[p.source];
  });
}

export const AUTOMATION_PRESETS: Array<{ label: string; hint: string; rule: Partial<AutomationRule> }> = [
  { label: 'Lembrete 48 h antes', hint: 'Data, hora e pedido de confirmação', rule: { name: 'Lembrete 48 h antes', trigger: 'before_start', offsetMinutes: 2880 } },
  { label: 'Link de pré-consulta', hint: 'Formulário do Cortex, com link único por consulta', rule: { name: 'Link de pré-consulta', trigger: 'before_start', offsetMinutes: 4320 } },
  { label: 'Pós-consulta', hint: 'Agradecimento, orientações ou pesquisa', rule: { name: 'Pós-consulta', trigger: 'after_end', offsetMinutes: 120 } },
];


const LANGUAGES: Record<string, string> = { pt_BR: 'Português', pt_PT: 'Português (Portugal)', en_US: 'Inglês', en: 'Inglês', es: 'Espanhol', es_ES: 'Espanhol' };
const CATEGORIES: Record<string, string> = { UTILITY: 'Aviso', MARKETING: 'Divulgação', AUTHENTICATION: 'Código de acesso' };

/** "lembrete_consulta" → "Lembrete consulta": the Meta name is technical, the clinic reads this. */
export function templateLabel(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toLocaleUpperCase('pt-BR') + words.slice(1) : name;
}
export const templateDetails = (t: Pick<WhatsAppTemplate, 'language' | 'category'>) =>
  [LANGUAGES[t.language] ?? t.language, CATEGORIES[t.category?.toUpperCase()] ?? t.category?.toLowerCase()].filter(Boolean).join(' · ');