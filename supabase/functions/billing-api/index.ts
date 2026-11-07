/**
 * Health-plan billing (TISS 4.03.00) and basic finance for clinic staff (JWT + clinic_access).
 * Contract: docs/product/faturamento/CONTRATO.md.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { billingDeps } from '../_shared/billingDeps.ts';
import { billingHandler } from '../_shared/billingHandlers.ts';

serve((req) => billingHandler(req, billingDeps()));
