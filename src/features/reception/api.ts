import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { ClinicAccessTransportError, isClinicAccessTransportFailure } from './accessErrors';
import {
  clinicAccessSchema,
  teamDoctorsSchema,
  queuePageSchema,
  contactPageSchema,
  contactSchema,
  contactEditSchema,
  linkEditSchema,
  caseSchema,
  patientSchema,
  appointmentsSchema,
  type BookingDetails,
  type LinkEdit,
} from './contracts';

export class ReceptionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
type RpcName =
  | 'clinic_access'
  | 'reception_team_doctors'
  | 'update_reception_staff'
  | 'reception_create_contact'
  | 'reception_contacts'
  | 'reception_patient_search'
  | 'reception_link_patient'
  | 'reception_create_case'
  | 'reception_queue'
  | 'reception_case'
  | 'reception_contact'
  | 'reception_contact_edit'
  | 'reception_update_contact'
  | 'reception_link_edit'
  | 'reception_update_link_relationship'
  | 'reception_update_case'
  | 'reception_add_note'
  | 'reception_save_draft'
  | 'reception_appointments'
  | 'reception_book_appointment'
  | 'reception_change_appointment'
  | 'reception_block_time'
  | 'reception_unblock_time';

async function rpc<T>(name: RpcName, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  // RPC names and arguments are centralized here; all returned projections are validated.
  const { data, error, status } = await supabase.rpc(name as never, args as never).abortSignal(AbortSignal.timeout(20_000));
  if (error) {
    if (name === 'clinic_access' && isClinicAccessTransportFailure(status, error)) throw new ClinicAccessTransportError();
    const unavailableAppointment = name === 'reception_change_appointment' && error.code === '42501' && error.message === 'Agendamento indisponível';
    const approvedDelegation = name === 'update_reception_staff' && error.code === '40001' && error.message === 'Approved delegation requires explicit withdrawal';
    const legacyGrantDenied = name === 'update_reception_staff' && error.code === '42501' && error.message === 'Authenticated legacy delegation requires physician approval';
    const message =
      legacyGrantDenied
        ? 'Novos acessos dependem da aprovação do médico. A lista antiga não pode criar nem restaurar permissões.'
        : approvedDelegation
        ? 'A lista está desatualizada: ela não pode retirar uma delegação aprovada pelo médico. Atualize a página para conferir os acessos.'
        : unavailableAppointment
        ? 'Agendamento indisponível. Atualize a agenda antes de tentar novamente.'
        : error.code === '40001'
          ? 'Os dados mudaram em outra tela. Atualize antes de tentar novamente.'
          : error.code === '23P01'
            ? 'Horário ocupado ou bloqueado. Escolha outro intervalo.'
            : error.code === '42501'
              ? 'Você não tem mais permissão para esta ação. Atualize a página.'
              : error.code === '22023'
                ? error.message
                : 'Não foi possível concluir a operação. Seus dados foram preservados.';
    throw new ReceptionError(message, error.code);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ReceptionError('A resposta não pôde ser validada. Atualize e tente novamente.', 'INVALID_RESPONSE');
  return parsed.data;
}
const uuid = z.string().uuid();
const revision = z.number().int().positive();
export const receptionApi = {
  access: () => rpc('clinic_access', {}, clinicAccessSchema),
  teamDoctors: (clinic: string) => rpc('reception_team_doctors', { p_clinic: clinic }, teamDoctorsSchema),
  updateStaff: (staff: string, doctors: string[], active: boolean) =>
    rpc('update_reception_staff', { p_staff: staff, p_doctors: doctors, p_active: active }, z.boolean()),
  contacts: (clinic: string, search = '', before: string | null = null) =>
    rpc('reception_contacts', { p_clinic: clinic, p_search: search, p_before: before }, contactPageSchema),
  contact: (id: string) => rpc('reception_contact', { p_contact: id }, contactSchema),
  contactEdit: (id: string) => rpc('reception_contact_edit', { p_contact: id }, contactEditSchema),
  linkEdit: (contact: string, patient: string) =>
    rpc('reception_link_edit', { p_contact: contact, p_patient: patient }, linkEditSchema),
  updateLinkRelationship: (contact: string, patient: string, expected: number, relationship: LinkEdit['relationship']) =>
    rpc('reception_update_link_relationship', { p_contact: contact, p_patient: patient, p_revision: expected, p_relationship: relationship }, revision),
  updateContact: (id: string, expected: number, name: string, phone: string) =>
    rpc('reception_update_contact', { p_contact: id, p_revision: expected, p_name: name, p_phone: phone }, revision),
  createContact: (clinic: string, name: string, phone: string, request: string) =>
    rpc('reception_create_contact', { p_clinic: clinic, p_name: name, p_phone: phone, p_request: request }, uuid),
  patients: (clinic: string, doctor: string, search: string) =>
    rpc('reception_patient_search', { p_clinic: clinic, p_doctor: doctor, p_search: search }, z.array(patientSchema)),
  linkPatient: (contact: string, doctor: string, patient: string, relationship: string) =>
    rpc(
      'reception_link_patient',
      { p_contact: contact, p_doctor: doctor, p_patient: patient, p_relationship: relationship },
      z.boolean(),
    ),
  createCase: (contact: string, doctor: string | null, subject: string, kind: string, request: string) =>
    rpc(
      'reception_create_case',
      { p_contact: contact, p_doctor: doctor, p_subject: subject, p_kind: kind, p_request: request },
      uuid,
    ),
  queue: (clinic: string, status: string, mine: boolean, doctor: string | null, before: string | null) =>
    rpc(
      'reception_queue',
      { p_clinic: clinic, p_status: status, p_mine: mine, p_doctor: doctor, p_before: before },
      queuePageSchema,
    ),
  case: (caseId: string, beforeNote: string | null = null) =>
    rpc('reception_case', { p_case: caseId, p_before_note: beforeNote }, caseSchema),
  updateCase: (caseId: string, expected: number, action: string, value: Record<string, unknown> = {}) =>
    rpc('reception_update_case', { p_case: caseId, p_revision: expected, p_action: action, p_value: value }, revision),
  addNote: (caseId: string, body: string, request: string) =>
    rpc(
      'reception_add_note',
      { p_case: caseId, p_body: body, p_request: request },
      z
        .object({ id: uuid, draft: z.object({ body: z.string(), revision: z.number().int().nonnegative() }).strict() })
        .strict(),
    ),
  saveDraft: (caseId: string, body: string, expected: number) =>
    rpc('reception_save_draft', { p_case: caseId, p_body: body, p_revision: expected }, revision),
  appointments: (clinic: string, start: string, end: string, doctor: string | null) =>
    rpc(
      'reception_appointments',
      { p_clinic: clinic, p_start: start, p_end: end, p_doctor: doctor },
      appointmentsSchema,
    ),
  book: (clinic: string, details: BookingDetails, request: string) =>
    rpc('reception_book_appointment', { p_clinic: clinic, p_details: details, p_request: request }, uuid),
  changeAppointment: (
    clinic: string,
    id: string,
    expected: number,
    action: string,
    start: string | null = null,
    end: string | null = null,
  ) =>
    rpc(
      'reception_change_appointment',
      { p_clinic: clinic, p_appointment: id, p_revision: expected, p_action: action, p_start: start, p_end: end },
      revision,
    ),
  block: (clinic: string, doctor: string, start: string, end: string, reason: string, request: string) =>
    rpc(
      'reception_block_time',
      { p_clinic: clinic, p_doctor: doctor, p_start: start, p_end: end, p_reason: reason, p_request: request },
      uuid,
    ),
  unblock: (id: string, expected: number) =>
    rpc('reception_unblock_time', { p_block: id, p_revision: expected }, z.boolean()),
};
