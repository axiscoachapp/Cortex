/**
 * D17 reconciliation executor, called by pg_cron every 10 minutes with the x-cortex-cron header
 * (SIGNATURE_CRON_SECRET). Only closes: see _shared/signatureMaintenance.ts.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
import { fetchWithDeadline } from '../_shared/http.ts';
import { maintenanceHandler } from '../_shared/signatureMaintenance.ts';

const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  global: { fetch: fetchWithDeadline },
});

serve((req) => maintenanceHandler(req, {
  cronSecret: Deno.env.get('SIGNATURE_CRON_SECRET') ?? '',
  rpc: async (name, args) => {
    const { data, error } = await service.rpc(name, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
  },
  removeObject: async (path) => {
    const { error } = await service.storage.from('prescriptions').remove([path]);
    if (error) throw new Error('Storage indisponível');
  },
  log: (event, data) => console.warn(JSON.stringify({ event, ...data })),
}));
