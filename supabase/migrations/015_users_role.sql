-- Imperium — Migration 015: user roles for admin access
--
-- Admin UI (/admin/*) checks public.users.role = 'admin' (see lib/game/admin.ts).
-- Optional bootstrap: IMPERIUM_ADMIN_USER_IDS still grants access without DB.
--
-- Promote a user in SQL Editor (as postgres / service context):
--   UPDATE public.users SET role = 'admin' WHERE id = '<auth.users id>';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player'
  CHECK (role IN ('player', 'admin'));

COMMENT ON COLUMN public.users.role IS
  'Access level: player (default) or admin (Chancery /admin routes).';

-- Block authenticated users from changing their own role (service role / SQL still can).
CREATE OR REPLACE FUNCTION public.users_prevent_self_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.uid() IS NOT NULL AND auth.uid() = NEW.id THEN
      RAISE EXCEPTION 'role is not user-editable'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_prevent_self_role_change_trg ON public.users;
CREATE TRIGGER users_prevent_self_role_change_trg
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_prevent_self_role_change();
