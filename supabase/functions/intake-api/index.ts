/**
 * Pre-consultation for clinic staff (JWT + clinic_access): form, links, answers and reviews.
 * Contract: docs/product/pre-consulta/CONTRATO.md.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { intakeDeps } from '../_shared/intakeDeps.ts';
import { intakeApiHandler } from '../_shared/intakeHandlers.ts';

serve((req) => intakeApiHandler(req, intakeDeps()));
