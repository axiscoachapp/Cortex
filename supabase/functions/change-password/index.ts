/**
 * A signed-in owner changes their own password on /seguranca, proving the current one (review
 * 2026-11-10, UX finding 20). Logic and tests: _shared/passwordChange.ts (changeOwnPasswordHandler).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { changeOwnPasswordDeps } from '../_shared/passwordChangeDeps.ts';
import { changeOwnPasswordHandler } from '../_shared/passwordChange.ts';

serve((req) => changeOwnPasswordHandler(req, changeOwnPasswordDeps()));
