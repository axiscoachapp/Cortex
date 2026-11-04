import { describe, expect, it } from 'vitest';
import { clinicAccessSchema, caseSchema } from './contracts';
import { clinicTimestamp, clinicTime } from './dates';

describe('reception boundaries', () => {
  it('rejects clinical blobs in the administrative access contract', () => {
    const access = {
      kind: 'reception',
      active: true,
      admin: false,
      actorId: '11111111-1111-4111-8111-111111111111',
      clinic: null,
      doctors: [],
      staff: [],
    };
    expect(clinicAccessSchema.safeParse(access).success).toBe(true);
    expect(clinicAccessSchema.safeParse({ ...access, medical_history: 'private' }).success).toBe(false);
  });
  it('rejects malformed workflow replies instead of showing an empty queue', () => {
    expect(caseSchema.safeParse({ id: 'missing-required-fields' }).success).toBe(false);
  });
  it('interprets human scheduling in the clinic timezone, independent of the browser timezone', () => {
    expect(clinicTimestamp('2099-11-01', '09:30')).toBe('2099-11-01T12:30:00.000Z');
    expect(clinicTime('2099-11-01T12:30:00Z')).toBe('09:30');
  });
  it('rejects impossible dates and times', () => {
    expect(() => clinicTimestamp('2026-02-30', '09:00')).toThrow();
    expect(() => clinicTimestamp('2026-11-03', '25:00')).toThrow();
  });
});
