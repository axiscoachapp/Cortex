import { z } from 'zod';

const id = z.string().uuid();
const doctorSchema = z.object({ id, name: z.string(), specialty: z.string().nullable() }).strict();
export const clinicAccessSchema = z
  .object({
    kind: z.enum(['clinical', 'reception']),
    active: z.boolean(),
    admin: z.boolean(),
    actorId: id,
    clinic: z.object({ id, name: z.string() }).strict().nullable(),
    doctors: z.array(doctorSchema),
    staff: z.array(z.object({ id, name: z.string(), active: z.boolean(), doctorIds: z.array(id) }).strict()),
  })
  .strict();
export type ClinicAccess = z.infer<typeof clinicAccessSchema>;
export type Doctor = z.infer<typeof doctorSchema>;
export const statuses = {
  new: 'Na fila',
  assigned: 'Em atendimento',
  waiting_patient: 'Aguardando paciente',
  waiting_internal: 'Aguardando equipe',
  resolved: 'Concluído',
  cancelled: 'Cancelado',
} as const;
export const kinds = {
  first_consult: 'Primeira consulta',
  return: 'Retorno',
  scheduling: 'Agendamento',
  information: 'Informações',
  other: 'Outro assunto',
} as const;
const statusSchema = z.enum(['new', 'assigned', 'waiting_patient', 'waiting_internal', 'resolved', 'cancelled']);
const kindSchema = z.enum(['first_consult', 'return', 'scheduling', 'information', 'other']);
export const queueItemSchema = z
  .object({
    id,
    subject: z.string(),
    kind: kindSchema,
    status: statusSchema,
    revision: z.number().int().positive(),
    contactId: id,
    contactName: z.string(),
    phone: z.string(),
    doctorId: id.nullable(),
    assignedTo: id.nullable(),
    assigneeName: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type QueueItem = z.infer<typeof queueItemSchema>;
export const queuePageSchema = z.object({ items: z.array(queueItemSchema), nextCursor: id.nullable() }).strict();
export const contactPageSchema = z
  .object({
    items: z.array(z.object({ id, name: z.string(), phone: z.string(), createdAt: z.string() }).strict()),
    nextCursor: id.nullable(),
  })
  .strict();
export const patientSchema = z.object({ id, name: z.string(), dateOfBirth: z.string().nullable() }).strict();
export type PatientOption = z.infer<typeof patientSchema>;
export const contactSchema = z
  .object({
    id,
    clinicId: id,
    name: z.string(),
    phone: z.string(),
    beneficiaries: z.array(
      patientSchema.extend({ doctorId: id, relationship: z.enum(['self', 'guardian', 'family', 'other']) }).strict(),
    ),
  })
  .strict();
export const caseSchema = z
  .object({
    id,
    clinicId: id,
    contactId: id,
    contactName: z.string(),
    phone: z.string(),
    doctorId: id.nullable(),
    subject: z.string(),
    kind: kindSchema,
    status: statusSchema,
    assignedTo: id.nullable(),
    revision: z.number().int().positive(),
    createdAt: z.string(),
    beneficiaries: z.array(
      patientSchema.extend({ doctorId: id, relationship: z.enum(['self', 'guardian', 'family', 'other']) }).strict(),
    ),
    eligibleAssignees: z.array(z.object({ id, name: z.string() }).strict()),
    notes: z.array(
      z.object({ id, body: z.string(), actorId: id, actorName: z.string(), createdAt: z.string() }).strict(),
    ),
    noteCount: z.number().int().nonnegative(),
    draft: z.object({ body: z.string(), revision: z.number().int().nonnegative() }).strict(),
  })
  .strict();
export type ReceptionCase = z.infer<typeof caseSchema>;
export const appointmentSchema = z
  .object({
    id,
    doctorId: id,
    patientId: id.nullable(),
    contactId: id.nullable(),
    caseId: id.nullable(),
    patientName: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    type: z.enum(['novo', 'retorno', 'seguimento', 'urgencia']),
    status: z.enum(['agendado', 'confirmado', 'cancelado', 'realizado']),
    revision: z.number().int().positive(),
    checkedInAt: z.string().nullable(),
    googleSyncStatus: z.string(),
  })
  .strict();
export type ReceptionAppointment = z.infer<typeof appointmentSchema>;
export const appointmentsSchema = z
  .object({
    items: z.array(appointmentSchema),
    blocks: z.array(
      z
        .object({
          id,
          doctorId: id,
          startTime: z.string(),
          endTime: z.string(),
          reason: z.string(),
          revision: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
export type ScheduleBlock = z.infer<typeof appointmentsSchema>['blocks'][number];
export interface BookingDetails {
  doctorId: string;
  contactId: string;
  patientId: string | null;
  caseId?: string | null;
  beneficiaryName?: string;
  dateOfBirth?: string | null;
  relationship?: 'self' | 'guardian' | 'family' | 'other';
  startTime: string;
  endTime: string;
  type: ReceptionAppointment['type'];
}
