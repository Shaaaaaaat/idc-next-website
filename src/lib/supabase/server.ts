import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseFeatureFlag = "read_coach_lk" | "write_leads" | "write_purchases";

function envTruthy(v: string | undefined): boolean {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

/** Без секретов: почему может не писаться purchases. */
export function getSupabasePurchasesEnvDiag(): {
  hasUrl: boolean;
  urlHost: string | null;
  hasServiceRoleKey: boolean;
  enabledMaster: boolean;
  writePurchasesFlag: boolean;
  writeWouldRun: boolean;
} {
  const rawUrl = process.env.SUPABASE_URL?.trim() || "";
  let urlHost: string | null = null;
  if (rawUrl) {
    try {
      urlHost = new URL(rawUrl).hostname;
    } catch {
      urlHost = "(invalid_url)";
    }
  }
  const hasUrl = Boolean(rawUrl);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const enabledMaster = envTruthy(process.env.SUPABASE_ENABLED);
  const writePurchasesFlag = envTruthy(process.env.SUPABASE_WRITE_PURCHASES);
  const writeWouldRun =
    hasUrl && hasServiceRoleKey && enabledMaster && writePurchasesFlag;
  return {
    hasUrl,
    urlHost,
    hasServiceRoleKey,
    enabledMaster,
    writePurchasesFlag,
    writeWouldRun,
  };
}

let cachedClient: SupabaseClient | null = null;

/**
 * Master switch: SUPABASE_ENABLED must be truthy for any Supabase work.
 * Per-area flags gate reads/writes.
 */
export function isSupabaseEnabled(flag: SupabaseFeatureFlag): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return false;
  if (!envTruthy(process.env.SUPABASE_ENABLED)) return false;
  switch (flag) {
    case "read_coach_lk":
      return envTruthy(process.env.SUPABASE_READ_COACH_LK);
    case "write_leads":
      return envTruthy(process.env.SUPABASE_WRITE_LEADS);
    case "write_purchases":
      return envTruthy(process.env.SUPABASE_WRITE_PURCHASES);
    default:
      return false;
  }
}

/** Service-role client; only call after isSupabaseEnabled / URL+key checks. */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!envTruthy(process.env.SUPABASE_ENABLED)) return null;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}
