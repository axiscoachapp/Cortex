-- ─────────────────────────────────────────────────────────────────────────────
-- Harden user_integrations security
--
-- Problem: The previous FOR ALL policy let authenticated users SELECT their own
-- rows via the public API, exposing raw OAuth refresh/access tokens in the
-- Supabase API response. These tokens should only be accessible to edge
-- functions via the service role.
--
-- Fix:
--  1. Drop the broad FOR ALL policy for authenticated users.
--  2. Create a read-only view that exposes only connection status (no tokens).
--  3. Grant authenticated users SELECT on the view only.
--  4. Keep INSERT/UPDATE via service role (edge functions own this flow).
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop old policy
DROP POLICY IF EXISTS "Users see own integrations" ON public.user_integrations;

-- Service role retains full access (edge functions use it)
DROP POLICY IF EXISTS "Service role manages integrations" ON public.user_integrations;
CREATE POLICY "Service role manages integrations"
  ON public.user_integrations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── Connection-status view ────────────────────────────────────────────────────
-- Exposes only what the frontend needs (is Google connected?) without leaking
-- OAuth tokens through the public API.

CREATE OR REPLACE VIEW public.user_integration_status
  WITH (security_invoker = true)
AS
  SELECT
    id,
    user_id,
    google_calendar_id,
    (google_refresh_token IS NOT NULL) AS google_connected,
    created_at,
    updated_at
  FROM public.user_integrations;

-- RLS on the view: users can only read their own row
-- (security_invoker means the view runs as the calling user, so RLS on the
-- underlying table applies — but since authenticated users now have no SELECT
-- policy on the table, we grant SELECT on the view via a SECURITY DEFINER
-- function instead.)

-- Simpler: expose via a SECURITY DEFINER function so RLS on the base table
-- doesn't block but tokens are never surfaced.

CREATE OR REPLACE FUNCTION public.get_integration_status(p_user_id UUID)
RETURNS TABLE(
  google_connected BOOLEAN,
  google_calendar_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow a user to query their own status
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      (ui.google_refresh_token IS NOT NULL),
      ui.google_calendar_id
    FROM public.user_integrations ui
    WHERE ui.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_integration_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_integration_status(UUID) TO authenticated;
