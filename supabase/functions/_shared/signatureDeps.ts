// Wiring of the D17 handlers (signature-session, sign-document) to the
// Supabase service client, Storage, the PSC client and requireUserContext.
// Logic and tests live in signatureHandlers.ts; this file only connects.
// Configuration: SIGNATURE_PSC_BASE_URL, SIGNATURE_PSC_CLIENT_ID,
// SIGNATURE_PSC_CLIENT_SECRET, SIGNATURE_PSC_REDIRECT_URI,
// SIGNATURE_TOKEN_KEYS and SIGNATURE_POLICY_SHA256 (Phase 0; without them the
// handlers answer 503). Nothing here is deployed by this change.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";
import { AuthError, authResponse, requireUserContext } from "./auth.ts";
import { fetchWithDeadline } from "./http.ts";
import { certificateDiscovery, exchangeCode, parseKeyList, signHash } from "./psc.ts";
import { readSignatureConfig, storageAdapter, type HandlerDeps } from "./signatureHandlers.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

// Storage errors are classified by their structured answer only
// (storageAdapter/storageErrorKind, Codex 05/11 05:09 and 06:35 R4): an
// unavailable Storage throws and is never read as an absent or existing
// object. The same for the database reads below: an error is not an absent row.
export function signatureDeps(): HandlerDeps {
  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { global: { fetch: fetchWithDeadline } },
  );
  return {
    authenticate: (req) => requireUserContext(req),
    authFailure: (error) => (error instanceof AuthError ? authResponse(error, corsHeaders) : null),
    config: readSignatureConfig((name) => Deno.env.get(name), parseKeyList),
    rpc: async (name, args) => {
      const { data, error } = await service.rpc(name, args);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data;
    },
    storage: storageAdapter(service.storage.from('prescriptions')),
    psc: {
      exchangeCode: (cfg, p) => exchangeCode(cfg, p),
      discovery: (cfg, token) => certificateDiscovery(cfg, token),
      sign: (cfg, token, p) => signHash(cfg, token, p),
    },
    prescription: async (userId, prescriptionId) => {
      const { data, error } = await service.from('prescriptions').select('doc_type, issuance_snapshot')
        .eq('id', prescriptionId).eq('user_id', userId).maybeSingle();
      if (error) throw new Error('Banco indisponível');
      const prescriber = (data?.issuance_snapshot as { prescriber?: Record<string, unknown> } | null)?.prescriber;
      if (!data || typeof prescriber?.crm_number !== 'string' || typeof prescriber?.crm_uf !== 'string') return null;
      return {
        doc_type: String(data.doc_type),
        crm: prescriber.crm_number,
        uf: prescriber.crm_uf,
        specialty: typeof prescriber.specialty === 'string' ? prescriber.specialty : undefined,
      };
    },
    prescriberCpf: async (userId) => {
      const { data, error } = await service.from('user_settings').select('prescriber_cpf').eq('user_id', userId).maybeSingle();
      if (error) throw new Error('Banco indisponível');
      return typeof data?.prescriber_cpf === 'string' ? data.prescriber_cpf : null;
    },
    corsHeaders,
    log: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
  };
}
