import { handleCheckPaymentRequest, type CheckPaymentSupabaseClient } from "./check-payment";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  return handleCheckPaymentRequest(req, getSupabaseAdmin() as CheckPaymentSupabaseClient | null);
}

