-- ================================================================
-- Imperium — Migration 004: nightly helpers & cron
-- ================================================================
-- Run AFTER 003_economy.sql.
--
-- 1. reset_all_ap()       — bulk AP restore (called by Edge Function)
-- 2. pg_cron schedule     — triggers the nightly Edge Function at 00:00 UTC
--
-- For the cron: fill in your project ref and NIGHTLY_SECRET before
-- uncommenting the cron.schedule block at the bottom.
-- ================================================================

-- ----------------------------------------------------------------
-- reset_all_ap
-- Called once per nightly cycle by the Edge Function (service_role).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_all_ap()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE characters
  SET    action_points = max_action_points;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('count', v_count);
END;
$$;

REVOKE ALL  ON FUNCTION public.reset_all_ap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_all_ap() TO service_role;

-- ================================================================
-- NIGHTLY CRON
-- ----------------------------------------------------------------
-- Uncomment and fill in the values below once:
--   1. The nightly-cycle Edge Function is deployed.
--   2. You have set NIGHTLY_SECRET in the Edge Function secrets
--      (Dashboard → Edge Functions → nightly-cycle → Secrets).
--   3. You know your project ref (the subdomain of supabase.co).
--
-- Run this block in the SQL editor to activate the cron. You can
-- also update just the URL/secret without dropping and recreating.
-- ================================================================

-- SELECT cron.unschedule('imperium-nightly') WHERE EXISTS (
--   SELECT 1 FROM cron.job WHERE jobname = 'imperium-nightly'
-- );
--
-- SELECT cron.schedule(
--   'imperium-nightly',
--   '0 0 * * *',
--   $$
--     SELECT net.http_post(
--       url     := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/nightly-cycle',
--       headers := jsonb_build_object(
--         'Content-Type',      'application/json',
--         'x-nightly-secret',  '<YOUR-NIGHTLY-SECRET>'
--       ),
--       body    := jsonb_build_object('trigger', 'pg_cron', 'ts', now()::text)
--     );
--   $$
-- );
