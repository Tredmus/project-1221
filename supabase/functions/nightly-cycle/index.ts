/**
 * Imperium — Nightly Cycle Edge Function
 *
 * Triggered at 00:00 UTC by pg_cron (via net.http_post). Can also be
 * invoked manually for testing.
 *
 * Order of operations:
 *   1. ap_reset    — restore every character's AP to max_action_points
 *   2. production  — process pending work_actions (output + wages)
 *   3. battles     — stub (Phase 5)
 *   4. elections   — stub (Phase 5)
 *
 * Each step is logged to nightly_jobs. A step failure marks that job
 * row as 'failed' but does NOT abort subsequent steps.
 *
 * Security: The function validates a shared secret passed in the
 * X-Nightly-Secret header (set in the pg_cron net.http_post call
 * and in Edge Function secrets as NIGHTLY_SECRET). Supabase's own
 * edge invocation path is also allowed (Authorization: Bearer <anon>).
 *
 * Deploy via Supabase CLI:
 *   supabase functions deploy nightly-cycle --no-verify-jwt
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type JobType = "ap_reset" | "production" | "battles" | "elections";

// ── Helpers ─────────────────────────────────────────────────────

async function startJob(jobType: JobType): Promise<string | null> {
  const { data, error } = await supabase
    .from("nightly_jobs")
    .insert({ job_type: jobType, status: "running" })
    .select("id")
    .single();
  if (error) {
    console.error(`[nightly] failed to create job row for ${jobType}:`, error);
    return null;
  }
  return data.id as string;
}

async function finishJob(
  id: string,
  status: "done" | "failed",
  stats: Record<string, unknown> = {},
  error?: string,
) {
  await supabase
    .from("nightly_jobs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      stats,
      ...(error ? { error } : {}),
    })
    .eq("id", id);
}

async function runStep(
  jobType: JobType,
  fn: () => Promise<Record<string, unknown>>,
) {
  const jobId = await startJob(jobType);
  try {
    const stats = await fn();
    console.log(`[nightly] ${jobType} done`, stats);
    if (jobId) await finishJob(jobId, "done", stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[nightly] ${jobType} failed:`, msg);
    if (jobId) await finishJob(jobId, "failed", {}, msg);
  }
}

// ── Step functions ───────────────────────────────────────────────

async function apReset(): Promise<Record<string, unknown>> {
  // PostgREST cannot express SET col = other_col, so we use a SECURITY
  // DEFINER function (`reset_all_ap`) defined in migration 004.
  const { data, error } = await supabase.rpc("reset_all_ap");
  if (error) throw new Error(`reset_all_ap failed: ${error.message}`);
  return { characters_reset: (data as { count: number })?.count ?? 0 };
}

async function production(): Promise<Record<string, unknown>> {
  // Fetch all pending work action ids (processed_at IS NULL).
  const { data: pending, error } = await supabase
    .from("work_actions")
    .select("id")
    .is("processed_at", null);

  if (error) throw new Error(`Fetching pending work_actions failed: ${error.message}`);

  let processed = 0;
  let failed = 0;

  for (const work of pending ?? []) {
    const { data, error: rpcErr } = await supabase.rpc(
      "process_single_work_action",
      { p_work_action_id: work.id },
    );
    if (rpcErr) {
      console.error(`[nightly] process_single_work_action(${work.id}) failed:`, rpcErr);
      failed++;
    } else {
      const result = data as { ok: boolean };
      if (result?.ok) {
        processed++;
      } else {
        failed++;
      }
    }
  }

  return { total: (pending ?? []).length, processed, failed };
}

async function battlesStub(): Promise<Record<string, unknown>> {
  // Phase 5. No-op for now.
  return { skipped: true, reason: "not_implemented_until_phase5" };
}

async function elections(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("process_elections");
  if (error) throw new Error(`process_elections failed: ${error.message}`);
  return (data as Record<string, unknown>) ?? { closed: 0 };
}

// ── Request handler ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Validate the shared secret.
  const secret = Deno.env.get("NIGHTLY_SECRET");
  if (secret) {
    const provided = req.headers.get("x-nightly-secret");
    if (provided !== secret) {
      console.warn("[nightly] unauthorized request");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  }

  console.log("[nightly] cycle starting", new Date().toISOString());

  // Each step runs independently — a failure in one doesn't stop the next.
  await runStep("ap_reset",  apReset);
  await runStep("production", production);
  await runStep("battles",   battlesStub);
  await runStep("elections", elections);

  console.log("[nightly] cycle complete", new Date().toISOString());

  return new Response(
    JSON.stringify({ ok: true, ts: new Date().toISOString() }),
    { headers: { "content-type": "application/json" } },
  );
});
