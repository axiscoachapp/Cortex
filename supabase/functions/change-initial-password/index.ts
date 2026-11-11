/**
 * The owner of a provisioned account replaces the temporary password (the only function that
 * accepts an account whose app_metadata.must_change_password is still set). Logic and tests:
 * _shared/passwordChange.ts; threat model: docs/reviews/2026-11-10/revisao-geral/SENHA_TEMPORARIA.md.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { changeInitialPasswordDeps } from '../_shared/passwordChangeDeps.ts';
import { changeInitialPasswordHandler } from '../_shared/passwordChange.ts';

serve((req) => changeInitialPasswordHandler(req, changeInitialPasswordDeps()));
