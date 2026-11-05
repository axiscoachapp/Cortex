/**
 * Signature session with the PSC (D17): POST start, POST complete {code,
 * state}, POST revoke, GET state. Contract:
 * docs/prescriptions/ASSINATURA_HANDLERS.md v3.1. JWT required; the actor and
 * the session come only from requireUserContext.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { signatureDeps } from "../_shared/signatureDeps.ts";
import { signatureSessionHandler } from "../_shared/signatureHandlers.ts";

serve((req) => signatureSessionHandler(req, signatureDeps()));
