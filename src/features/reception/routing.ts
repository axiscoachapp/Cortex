import type { Doctor, ReceptionCase } from './contracts';

export function suggestDoctor(
  doctors: Doctor[],
  request: Pick<ReceptionCase, 'doctorId' | 'beneficiaries'>,
): { doctorId: string | null; candidateIds: string[]; reason: string } {
  if (request.doctorId) {
    if (!doctors.some((d) => d.id === request.doctorId)) return {
      doctorId: null, candidateIds: [],
      reason: 'O médico indicado está indisponível entre as suas agendas autorizadas. Confirme com o contato antes de escolher outro profissional.',
    };
    return {
      doctorId: request.doctorId,
      candidateIds: [request.doctorId],
      reason: 'Médico indicado neste atendimento. Confira o pedido do contato antes de manter ou trocar.',
    };
  }
  const linked = doctors.filter((d) => request.beneficiaries.some((p) => p.doctorId === d.id));
  if (linked.length === 1) {
    return {
      doctorId: linked[0].id,
      candidateIds: [linked[0].id],
      reason:
        'Há um vínculo administrativo confirmado com este médico. Confirme quem será atendido e se o pedido é de continuidade.',
    };
  }
  if (linked.length > 1) {
    return {
      doctorId: null,
      candidateIds: linked.map(doctor => doctor.id),
      reason: 'O contato possui vínculos com mais de um médico. Confirme o beneficiário e o profissional solicitado.',
    };
  }
  return {
    doctorId: null,
    candidateIds: [],
    reason:
      doctors.length ? 'Sem vínculo confirmado com uma agenda permitida. Pergunte qual profissional o contato procura; a equipe decide o encaminhamento.' : 'Nenhuma agenda autorizada disponível para você. Confira suas permissões com a administração antes de encaminhar.',
  };
}
