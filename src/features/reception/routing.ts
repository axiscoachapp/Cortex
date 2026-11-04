import type { Doctor, ReceptionCase } from './contracts';

export function suggestDoctor(
  doctors: Doctor[],
  request: Pick<ReceptionCase, 'doctorId' | 'beneficiaries'>,
): { doctorId: string | null; reason: string } {
  if (request.doctorId && doctors.some((d) => d.id === request.doctorId)) {
    return {
      doctorId: request.doctorId,
      reason: 'Médico indicado neste atendimento. Confira o pedido do contato antes de manter ou trocar.',
    };
  }
  const linked = doctors.filter((d) => request.beneficiaries.some((p) => p.doctorId === d.id));
  if (linked.length === 1) {
    return {
      doctorId: linked[0].id,
      reason:
        'Há um vínculo administrativo confirmado com este médico. Confirme quem será atendido e se o pedido é de continuidade.',
    };
  }
  if (linked.length > 1) {
    return {
      doctorId: null,
      reason: 'O contato possui vínculos com mais de um médico. Confirme o beneficiário e o profissional solicitado.',
    };
  }
  return {
    doctorId: null,
    reason:
      'Sem vínculo confirmado com uma agenda permitida. Pergunte qual profissional o contato procura; a equipe decide o encaminhamento.',
  };
}
