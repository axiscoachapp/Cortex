import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { validateSupabaseEnvironment } from './environment';

const environment = validateSupabaseEnvironment(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const isIsolatedBackend = environment.isolated;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(environment.url, environment.key, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
