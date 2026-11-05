import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { ReceptionError } from './api';

const uuid = z.string().uuid();
const revision = z.number().int().positive();
const timestamp = z.string().datetime({ offset: true });
const state = z.enum(['pending', 'approved', 'denied', 'cancelled', 'revoked']);
const snapshot = z.object({ id: uuid, state, revision, capabilityVersion: z.literal('clinic_reception_v1') }).strict();
const item = snapshot.extend({
  clinicId: uuid, clinicName: z.string(), staffId: uuid, staffName: z.string(), doctorId: uuid, doctorName: z.string(),
  createdAt: timestamp, effective: z.boolean(), canDecide: z.boolean(), canCancel: z.boolean(), canRevoke: z.boolean(),
}).strict();
const cursor = z.object({ createdAt: timestamp, id: uuid }).strict();
const page = z.object({ canManage: z.boolean(), items: z.array(item).max(100), nextCursor: cursor.nullable() }).strict();
const listInput = z.object({ clinicId: uuid.nullish(), cursor: cursor.nullish(), limit: z.number().int().min(1).max(100).default(50) }).strict();
const requestInput = z.object({ clinicId: uuid, staffId: uuid, doctorId: uuid, operationId: uuid }).strict();
const changeInput = z.object({ requestId: uuid, revision, action: z.enum(['approve', 'deny', 'cancel', 'revoke']), operationId: uuid }).strict();
const permissionFields = { doctorId: uuid, doctorName: z.string(), effective: z.boolean() };
const permission = z.discriminatedUnion('source', [
  z.object({ ...permissionFields, source: z.literal('physician_approval'), requestId: uuid }).strict(),
  z.object({ ...permissionFields, source: z.literal('legacy'), requestId: z.null() }).strict(),
  z.object({ ...permissionFields, source: z.literal('unverified'), requestId: z.null() }).strict(),
]);
const permissionsPage = z.object({ items: z.array(permission).max(100), nextCursor: uuid.nullable() }).strict();
const permissionsInput = z.object({ clinicId: uuid, staffId: uuid, after: uuid.nullish(), limit: z.number().int().min(1).max(100).default(50) }).strict();
export type DelegationRequest = z.infer<typeof item>;
export type DelegationCursor = z.infer<typeof cursor>;
export type DelegationAction = z.infer<typeof changeInput>['action'];

type RpcName = 'reception_delegation_requests' | 'reception_request_delegation' | 'reception_decide_delegation' | 'reception_cancel_delegation' | 'reception_revoke_delegation' | 'reception_staff_permissions';
async function rpc<T>(name: RpcName, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never).abortSignal(AbortSignal.timeout(20_000));
  if (error) throw new ReceptionError(
    error.code === '40001' ? 'O pedido mudou. Atualize a lista e revise a ação antes de tentar novamente.'
      : error.code === '42501' ? 'Você não tem permissão para esta ação. Atualize a lista.'
      : error.code === '22023' ? 'Confira os dados do pedido antes de continuar.'
      : 'Não foi possível confirmar a operação. Tente novamente com os mesmos dados.', error.code,
  );
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ReceptionError('A resposta não pôde ser validada. Atualize a lista.', 'INVALID_RESPONSE');
  return parsed.data;
}
export const delegationApi = {
  async permissions(input: z.input<typeof permissionsInput>) {
    const value = permissionsInput.parse(input);
    return rpc('reception_staff_permissions', { p_clinic: value.clinicId, p_staff: value.staffId, p_after: value.after ?? null, p_limit: value.limit }, permissionsPage);
  },
  async list(input: z.input<typeof listInput> = {}) {
    const value = listInput.parse(input);
    return rpc('reception_delegation_requests', { p_clinic: value.clinicId ?? null, p_after: value.cursor?.createdAt ?? null, p_after_id: value.cursor?.id ?? null, p_limit: value.limit }, page);
  },
  async request(input: z.input<typeof requestInput>) {
    const value = requestInput.parse(input);
    return rpc('reception_request_delegation', { p_clinic: value.clinicId, p_staff: value.staffId, p_doctor: value.doctorId, p_operation: value.operationId }, snapshot);
  },
  async change(input: z.input<typeof changeInput>) {
    const value = changeInput.parse(input);
    const args = { p_request: value.requestId, p_revision: value.revision, p_operation: value.operationId };
    return value.action === 'approve' || value.action === 'deny'
      ? rpc('reception_decide_delegation', { ...args, p_decision: value.action }, snapshot)
      : rpc(value.action === 'cancel' ? 'reception_cancel_delegation' : 'reception_revoke_delegation', args, snapshot);
  },
};
