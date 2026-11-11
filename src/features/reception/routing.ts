import type { Doctor, ReceptionCase } from './contracts';

export function suggestDoctor(
  doctors: Doctor[],
  request: Pick<ReceptionCase, 'doctorId' | 'beneficiaries'>,
): { doctorId: string | null; candidateIds: string[]; reason: string } {
  if (request.doctorId) {
    if (!doctors.some((d) => d.id === request.doctorId)) return {
      doctorId: null, candidateIds: [],
      reason: 'O médico indicado está indisponível entre as suas agendas. Confirme com o contato antes de escolher outro médico.',
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
      reason: 'Este contato já tem paciente atendido por este médico. Confirme quem será atendido.',
    };
  }
  if (linked.length > 1) {
    return {
      doctorId: null,
      candidateIds: linked.map(doctor => doctor.id),
      reason: 'Este contato tem pacientes com mais de um médico. Confirme quem será atendido e com qual médico.',
    };
  }
  return {
    doctorId: null,
    candidateIds: [],
    reason:
      doctors.length ? 'Nenhum paciente deste contato com os seus médicos ainda. Pergunte qual médico o contato procura.' : 'Nenhuma agenda autorizada disponível para você. Peça acesso ao administrador da clínica antes de encaminhar.',
  };
}
