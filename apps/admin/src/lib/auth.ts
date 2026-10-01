import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase";

/**
 * The signed-in user and whether they hold the admin role, read on the server. The admin
 * app's web code is not secret; what protects the data is this check plus row-level
 * security and the admin check inside every database function.
 */
export async function getAdmin() {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const isAdmin = (data ?? []).some((r) => r.role === "admin");
  return { supabase, user, isAdmin };
}
