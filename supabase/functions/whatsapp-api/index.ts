/**
 * WhatsApp API for Settings (connect, disconnect, templates) and the reception inbox
 * (conversations, messages, send, act, media). JWT required; clinic and role come from
 * clinic_access(). Contract: docs/product/whatsapp/CONTRATO.md.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { whatsappDeps } from '../_shared/whatsappDeps.ts';
import { apiHandler } from '../_shared/whatsappHandlers.ts';

serve((req) => apiHandler(req, whatsappDeps()));
