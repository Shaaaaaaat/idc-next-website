import "server-only";

import type { LkClientRecord } from "@/lib/airtable/clients";
import { getClientForLkByEmail } from "@/lib/supabase/lkClients";
import { getLkUserByEmail, isLkUserRole } from "@/lib/supabase/lkUsers";

export type LkAccessResult =
  | { type: "admin"; email: string }
  | { type: "coach"; email: string }
  | { type: "client"; email: string; client: LkClientRecord }
  | {
      type: "deny";
      email: string;
      reason:
        | "users_disabled"
        | "users_role_invalid"
        | "client_disabled"
        | "not_found";
    };

export async function resolveLkAccessByEmail(email: string): Promise<LkAccessResult> {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  const user = await getLkUserByEmail(normalizedEmail);
  if (!user) {
    return { type: "deny", email: normalizedEmail, reason: "not_found" };
  }

  if (!user.lkEnabled) {
    return { type: "deny", email: user.email, reason: "users_disabled" };
  }

  if (!isLkUserRole(user.role)) {
    return { type: "deny", email: user.email, reason: "users_role_invalid" };
  }

  if (user.role === "admin") {
    return { type: "admin", email: user.email };
  }
  if (user.role === "coach") {
    return { type: "coach", email: user.email };
  }

  const client = await getClientForLkByEmail(user.email);
  if (!client.ok) {
    return { type: "deny", email: user.email, reason: client.reason };
  }
  return { type: "client", email: client.client.email, client: client.client };
}

