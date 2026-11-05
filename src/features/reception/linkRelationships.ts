import type { LinkEdit } from './contracts';

export const relationshipLabels: Record<LinkEdit['relationship'], string> = {
  self: 'É o próprio paciente',
  guardian: 'Responsável',
  family: 'Familiar',
  other: 'Outra relação confirmada',
};
