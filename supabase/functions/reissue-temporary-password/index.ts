/**
 * A clinic admin issues a new temporary password (with a new 72-hour expiry) for a doctor or
 * receptionist of the clinic who never set their own password. Logic and tests:
 * _shared/passwordChange.ts.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { reissueTemporaryPasswordDeps } from '../_shared/passwordChangeDeps.ts';
import { reissueTemporaryPasswordHandler } from '../_shared/passwordChange.ts';

serve((req) => reissueTemporaryPasswordHandler(req, reissueTemporaryPasswordDeps()));
