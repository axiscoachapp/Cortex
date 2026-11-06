/**
 * Agenda automations runner, called by pg_cron every few minutes with the x-cortex-cron header
 * (WHATSAPP_CRON_SECRET). Sends approved templates before or after appointments, once per rule and
 * appointment start, between 08:00 and 20:00 (Sao Paulo). Contract: docs/product/whatsapp/CONTRATO.md.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { whatsappDeps } from '../_shared/whatsappDeps.ts';
import { automationsHandler } from '../_shared/whatsappHandlers.ts';

serve((req) => automationsHandler(req, whatsappDeps()));
