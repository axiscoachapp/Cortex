// Pure helpers of the finance screens (kept apart so the component files only export components).
import { brl, localDate, parseMoney, type BillingState, type Charge, type ToBillItem } from './billingApi';
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

/** Seed of a charge from an attended appointment: saved card first, then the pre-consultation answers. */
export function seedFrom(item: ToBillItem, state: BillingState): ChargeSeed {
  const active = state.payers.filter((p) => p.active);
  const saved = item.coverages.find((c) => active.some((p) => p.id === c.payerId));
  const fromIntake = item.intake?.type === 'Convênio' && item.intake.payer
    ? active.find((p) => p.name.trim().toLocaleLowerCase('pt-BR') === item.intake!.payer!.trim().toLocaleLowerCase('pt-BR')) : undefined;
  return {
    appointmentId: item.appointmentId, doctorId: item.doctorId, patientName: item.patientName, serviceDate: localDate(item.start),
    consultationType: item.consultationType,
    payerId: saved?.payerId ?? fromIntake?.id ?? null,
    cardNumber: saved?.cardNumber ?? (fromIntake ? item.intake?.card ?? '' : ''),
    cardValidUntil: saved?.cardValidUntil ?? (fromIntake ? item.intake?.validUntil ?? null : null),
  };
}
