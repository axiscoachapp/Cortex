// Client of the billing-api Edge Function. Contract: docs/product/faturamento/CONTRATO.md.
import { supabase } from '@/integrations/supabase/client';
import { functionErrorBody, functionErrorMessage } from '@/lib/functionErrors';

export class BillingApiError extends Error {
  constructor(message: string, readonly code: string | null, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function billingCall<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('billing-api', { body: { action, ...body } });
  if (error) {
    const parsed = await functionErrorBody(error);
    throw new BillingApiError(
      await functionErrorMessage(error, 'Não foi possível falar com o financeiro agora. Tente de novo.'),
      typeof parsed?.code === 'string' ? parsed.code : null,
      parsed ?? {},
    );
  }
  return data as T;
}

export type BillingRole = 'admin' | 'reception' | 'doctor';
export type GuideType = 'consulta' | 'sadt';
export type ChargeStatus = 'open' | 'batched' | 'sent' | 'paid' | 'partial' | 'denied' | 'cancelled';
export type PaymentMethod = 'pix' | 'dinheiro' | 'debito' | 'credito' | 'boleto' | 'transferencia';

export interface Payer {
  id: string; name: string; ansRegistry: string; providerCode: string; tissVersion: string; hashEncoding: 'latin1' | 'utf8';
  zipRequired: boolean; submissionDays: number | null; paymentDays: number | null; active: boolean; notes: string; revision: number;
}
export interface Price {
  id: string; payerId: string | null; tableCode: string; procedureCode: string; description: string; guideType: GuideType;
  amount: number; active: boolean; revision: number;
}
export interface Professional {
  userId: string; tissName: string; council: string; councilNumber: string; councilUf: string; cbo: string; sharePercent: number | null; revision: number;
}
export interface Doctor { id: string; name: string; crm: string | null; crmUf: string | null }
export interface BillingState {
  role: BillingRole;
  userId: string;
  settings: { legalName: string; cnpj: string | null; cnes: string; nextGuideNumber: number; revision: number } | null;
  payers: Payer[];
  doctors: Doctor[];
  professionals: Professional[];
}
export interface Charge {
  id: string; appointmentId: string | null; doctorId: string; contactId: string | null; patientName: string; payerId: string | null;
  cardNumber: string | null; newborn: boolean; guideType: GuideType | 'particular'; tableCode: string; procedureCode: string; description: string;
  quantity: number; unitAmount: number; amount: number; serviceDate: string; consultationType: '1' | '2' | '3' | '4' | null;
  authorization: { number: string | null; password: string | null; date: string | null; validUntil: string | null };
  status: ChargeStatus; guideNumber: number | null; batchId: string | null; paidAmount: number; deniedAmount: number;
  denialCode: string | null; denialNote: string | null; notes: string; revision: number;
}
export interface Batch {
  id: string; payerId: string; number: number; guideType: GuideType; status: 'draft' | 'sent' | 'closed'; totalAmount: number;
  paidAmount: number; deniedAmount: number; xmlHash: string | null; generatedAt: string | null; sentAt: string | null;
  protocol: string | null; paymentDate: string | null; nfseNumber: string | null; notes: string; revision: number; createdAt: string;
}
export interface ToBillItem {
  appointmentId: string; doctorId: string; start: string; type: string | null; contactId: string | null; patientName: string;
  consultationType: '1' | '2';
  coverages: Array<{ payerId: string; cardNumber: string; cardValidUntil: string | null; plan: string }>;
  intake: { payer?: string; card?: string; validUntil?: string; type?: string } | null;
}
export interface Payment {
  id: string; chargeId: string | null; batchId: string | null; method: PaymentMethod | 'convenio'; amount: number; receivedOn: string; notes: string;
  patientName: string | null; description: string | null;
}
export interface Expense {
  id: string; description: string; category: string; amount: number; dueOn: string; paidOn: string | null; method: PaymentMethod | null; notes: string; revision: number;
}
export interface Totals { count: number; charged: number; paid: number; denied: number; open: number }
export interface Report {
  totals: Totals;
  doctors: Array<Totals & { doctorId: string; sharePercent: number | null; payout: number | null }>;
  payers: Array<Totals & { payerId: string | null; name: string }>;
  denials: Array<{ code: string; count: number; amount: number }>;
}
export interface BatchFile { fileName: string; contentType: string; base64: string; hash: string; revision: number }

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (n: number) => BRL.format(Number.isFinite(n) ? n : 0);

export const STATUS_LABELS: Record<ChargeStatus, string> = {
  open: 'Em aberto', batched: 'Em lote', sent: 'Enviada', paid: 'Paga', partial: 'Paga em parte', denied: 'Glosada', cancelled: 'Cancelada',
};
export const BATCH_STATUS_LABELS: Record<Batch['status'], string> = { draft: 'Não enviado', sent: 'Enviado', closed: 'Fechado' };
export const METHOD_LABELS: Record<PaymentMethod | 'convenio', string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', transferencia: 'Transferência', convenio: 'Convênio',
};
export const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia'];
export const GUIDE_LABELS: Record<GuideType | 'particular', string> = { consulta: 'Consulta', sadt: 'SP/SADT', particular: 'Particular' };
export const CONSULTATION_TYPES: Array<{ value: '1' | '2' | '3' | '4'; label: string }> = [
  { value: '1', label: 'Primeira consulta' }, { value: '2', label: 'Retorno' }, { value: '3', label: 'Pré-natal' }, { value: '4', label: 'Por encaminhamento' },
];
export const EXPENSE_CATEGORIES: Record<string, string> = {
  aluguel: 'Aluguel', pessoal: 'Pessoal', impostos: 'Impostos', material: 'Material', servicos: 'Serviços', equipamentos: 'Equipamentos', outros: 'Outros',
};

/** Today in São Paulo, YYYY-MM-DD. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
/** YYYY-MM-DD of an ISO instant, in São Paulo. */
export const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
/** dd/mm/aaaa of a YYYY-MM-DD date. */
export const dateBr = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const dateTimeBr = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** First and last day of a month (offset from the current one), and its label. */
export function monthRange(offset: number) {
  const now = new Date(`${today()}T12:00:00Z`);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12));
  const label = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: label.charAt(0).toUpperCase() + label.slice(1) };
}

/** Parses "1.234,56", "150,00" or "150.5" into a number; NaN when it is not a value. */
export function parseMoney(text: string): number {
  const t = text.trim().replace(/\s|R\$/g, '');
  if (!t) return NaN;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : NaN;
}
export const moneyInput = (n: number) => n.toFixed(2).replace('.', ',');

export function downloadBase64(fileName: string, contentType: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Query-key scope: never reuse cached finance data across people or clinics. */
export const billingKey = (scope: string[], ...rest: unknown[]) => ['billing', ...scope, ...rest];
