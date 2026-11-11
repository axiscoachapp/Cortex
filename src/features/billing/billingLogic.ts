// Pure helpers of the finance screens (kept apart so the component files only export components).
import { brl, localDate, parseMoney, type BillingState, type Charge, type Price, type ToBillItem } from './billingApi';
import type { ChargeSeed } from './ChargeDialog';

export interface SettleLine { paid: string; code: string; note: string }

/** Problems of a statement before sending it; empty when every guide is consistent. */
export function settleProblems(charges: Charge[], lines: Record<string, SettleLine>): string[] {
  const out: string[] = [];
  for (const c of charges) {
    const l = lines[c.id];
    const paid = parseMoney(l?.paid ?? '');
    if (!Number.isFinite(paid) || paid < 0 || paid > c.amount) { out.push(`Guia ${c.guideNumber}: valor pago entre R$ 0,00 e ${brl(c.amount)}.`); continue; }
    if (paid < c.amount && !/^[0-9]{1,4}$/.test((l?.code ?? '').trim())) out.push(`Guia ${c.guideNumber}: informe o código da glosa.`);
  }
  return out;
}

/** The statement lines as they were recorded, to correct one value without retyping the batch. */
export function settleLinesFrom(charges: Charge[]): Record<string, SettleLine> {
  const money = (n: number) => n.toFixed(2).replace('.', ',');
  return Object.fromEntries(charges.map((c) => [c.id, { paid: money(c.paidAmount), code: c.denialCode ?? '', note: c.denialNote ?? '' }]));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Seed of a charge from an attended appointment: saved card first, then the pre-consultation answers. */
export function seedFrom(item: ToBillItem, state: BillingState): ChargeSeed {
  const active = state.payers.filter((p) => p.active);
  const saved = item.coverages.find((c) => active.some((p) => p.id === c.payerId));
  const fromIntake = item.intake?.type === 'Convênio' && item.intake.payer
    ? active.find((p) => p.name.trim().toLocaleLowerCase('pt-BR') === item.intake!.payer!.trim().toLocaleLowerCase('pt-BR')) : undefined;
  // A validity typed as free text in the pre-consultation ("12/2027") is not a date: it is dropped
  // rather than sent, and the person fills the date field if the plan asks for it.
  const validity = saved?.cardValidUntil ?? (fromIntake ? item.intake?.validUntil ?? null : null);
  return {
    appointmentId: item.appointmentId, doctorId: item.doctorId, patientName: item.patientName, serviceDate: localDate(item.start),
    consultationType: item.consultationType,
    payerId: saved?.payerId ?? fromIntake?.id ?? null,
    cardNumber: saved?.cardNumber ?? (fromIntake ? item.intake?.card ?? '' : ''),
    cardValidUntil: validity && ISO_DATE.test(validity) ? validity : null,
  };
}

/**
 * The plan's consultation price to preselect for a visit: the only consultation price of the plan,
 * or, with several, the one whose description matches a return ("retorno") or a first visit.
 */
export function consultationPrice(prices: Price[], payerId: string | null, consultationType: string | undefined): Price | null {
  const list = prices.filter((p) => p.active && p.guideType === 'consulta' && p.payerId === payerId);
  if (list.length <= 1) return list[0] ?? null;
  const isReturn = (p: Price) => /retorno/i.test(p.description);
  return (consultationType === '2' ? list.find(isReturn) : list.find((p) => !isReturn(p))) ?? list[0];
}
