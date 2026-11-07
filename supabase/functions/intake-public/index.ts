/**
 * Pre-consultation page for the patient, without login (verify_jwt = false). The link token is the
 * only credential; the page never reads stored answers back. Contract: docs/product/pre-consulta/CONTRATO.md.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { intakeDeps } from '../_shared/intakeDeps.ts';
import { intakePublicHandler } from '../_shared/intakeHandlers.ts';

serve((req) => intakePublicHandler(req, intakeDeps()));
