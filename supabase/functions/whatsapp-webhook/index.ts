/**
 * WhatsApp Cloud API webhook (public, no JWT). GET answers Meta's verification challenge; POST
 * checks X-Hub-Signature-256, stores the delivery before answering and processes it idempotently.
 * Contract: docs/product/whatsapp/CONTRATO.md.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { whatsappDeps } from '../_shared/whatsappDeps.ts';
import { webhookHandler } from '../_shared/whatsappHandlers.ts';

serve((req) => webhookHandler(req, whatsappDeps()));
