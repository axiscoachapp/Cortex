// Edge tests import pure helpers; resolve their pinned SDK types to the same
// installed SDK for the frontend TypeScript check. Deno checks deployment files.
declare module 'https://esm.sh/@supabase/supabase-js@2.86.0' {
  export type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;
  export const createClient: typeof import('@supabase/supabase-js').createClient;
}
