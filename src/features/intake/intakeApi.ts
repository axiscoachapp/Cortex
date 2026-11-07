// Clients of the pre-consultation Edge Functions. Contract: docs/product/pre-consulta/CONTRATO.md.
import { supabase } from '@/integrations/supabase/client';
import { functionErrorBody, functionErrorMessage } from '@/lib/functionErrors';
import type { AnswerItem, IntakeForm } from '../../../supabase/functions/_shared/intakeForm';

export class IntakeApiError extends Error {
  constructor(message: string, readonly code: string | null, readonly errors: string[] = []) {
    super(message);
  }
}

async function invoke<T>(fn: 'intake-api' | 'intake-public', body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const parsed = await functionErrorBody(error);
    throw new IntakeApiError(await functionErrorMessage(error, fallback), typeof parsed?.code === 'string' ? parsed.code : null,
      Array.isArray(parsed?.errors) ? (parsed.errors as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  }
  return data as T;
}

export const intakeCall = <T>(action: string, body: Record<string, unknown> = {}) =>
  invoke<T>('intake-api', { action, ...body }, 'Não foi possível carregar a pré-consulta agora. Tente de novo.');

export const intakePublicCall = <T>(action: 'open' | 'submit', body: Record<string, unknown>) =>
  invoke<T>('intake-public', { action, ...body }, 'Não foi possível falar com a clínica agora. Tente de novo em instantes.');

export interface PublicIntake {
  state: 'open' | 'answered' | 'reviewed' | 'closed';
  clinicName: string;
  doctorName: string;
  start: string;
  form: IntakeForm | null;
  formRevision: number;
  answeredAt: string | null;
  privacyVersion: string;
}

export interface IntakeListItem {
  appointmentId: string;
  doctorId: string;
  doctorName: string;
  start: string;
  end: string;
  appointmentStatus: string;
  contactId: string | null;
  contactName: string | null;
  requestId: string | null;
  state: 'none' | 'pending' | 'answered' | 'closed';
  openedAt: string | null;
  answeredAt: string | null;
  registrationReviewedAt: string | null;
  healthReviewedAt: string | null;
  revision: number | null;
}

export interface IntakeResponse {
  id: string;
  state: 'pending' | 'answered' | 'closed';
  revision: number;
  openedAt: string | null;
  answeredAt: string | null;
  submissions: number;
  expiresAt: string;
  whatsappConsent: boolean | null;
  registration: AnswerItem[];
  registrationReviewedAt: string | null;
  healthReviewedAt: string | null;
  healthVisible: boolean;
  health: AnswerItem[] | null;
}

export interface IntakeFormState { starter: boolean; revision: number; enabled: boolean; form: IntakeForm; updatedAt: string | null }

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
