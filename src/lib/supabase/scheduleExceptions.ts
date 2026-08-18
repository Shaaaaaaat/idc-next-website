import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type ScheduleExceptionRow = {
  id: string;
  type: string | null;
  studio_id: string | null;
  product_scope: string | null;
  start_date: string | null;
  end_date: string | null;
  message: string | null;
  status: string | null;
};

export type ScheduleExceptionsResult =
  | { ok: true; exceptions: ScheduleExceptionRow[] }
  | { ok: false; reason: "supabase_unavailable" | "query_failed"; message?: string };

export async function getActiveScheduleExceptionsForRange(params: {
  rangeStart: string;
  rangeEnd: string;
}): Promise<ScheduleExceptionsResult> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "supabase_unavailable" };

  const { data, error } = await sb
    .from("schedule_exceptions")
    .select("id,type,studio_id,product_scope,start_date,end_date,message,status")
    .eq("status", "active")
    .lte("start_date", params.rangeEnd)
    .gte("end_date", params.rangeStart)
    .order("start_date", { ascending: true });

  if (error) {
    return { ok: false, reason: "query_failed", message: error.message };
  }

  return {
    ok: true,
    exceptions: (Array.isArray(data) ? data : []) as ScheduleExceptionRow[],
  };
}
