import { z } from 'zod';

// reception_busy_intervals: anonymous busy periods of the doctors in scope.
// Strict on purpose: anything beyond doctor/start/end is a contract breach.
export const busyIntervalsSchema = z.array(
  z.object({ doctorId: z.string().uuid(), startTime: z.string(), endTime: z.string() }).strict(),
).max(1000);
export type BusyInterval = z.infer<typeof busyIntervalsSchema>[number];
