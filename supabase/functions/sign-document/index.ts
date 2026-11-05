/**
 * POST {prescriptionId, operationId, shownPdfSha256, humanRetry?}: one digital
 * signature (D17). Contract: docs/prescriptions/ASSINATURA_HANDLERS.md v3.1.
 * JWT required; the actor and the session come only from requireUserContext.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { signatureDeps } from "../_shared/signatureDeps.ts";
import { signDocumentHandler } from "../_shared/signatureHandlers.ts";

serve((req) => signDocumentHandler(req, signatureDeps()));
