// src/app/api/check-payment/route.ts
import { NextResponse } from "next/server";

/* ---------------- AIRTABLE ---------------- */
function airtableEnv() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_PURCHASE_WEBSITE_TABLE;
  if (!apiKey || !baseId || !table) {
    return { ok: false as const, apiKey: "", baseId: "", table: "" };
  }
  return { ok: true as const, apiKey, baseId, table };
}
function airtableBaseUrl(env: { baseId: string; table: string }) {
  return `https://api.airtable.com/v0/${env.baseId}/${encodeURIComponent(env.table)}`;
}
async function airtableFindByPaymentId(paymentIdRaw: string) {
  const env = airtableEnv();
  if (!env.ok) return { ok: false as const, reason: "env_missing" as const };
  const paymentId = String(paymentIdRaw);
  const filterByFormula = encodeURIComponent(`(LOWER({id_payment}&"") = "${paymentId.toLowerCase()}")`);
  const url = `${airtableBaseUrl(env)}?pageSize=1&maxRecords=1&filterByFormula=${filterByFormula}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${env.apiKey}` },
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) return { ok: false as const, reason: "find_failed" as const, status: r.status, text };
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const rec = Array.isArray(json?.records) ? json.records[0] : null;
  return { ok: true as const, record: rec ?? null };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const paymentId = String(body?.paymentId ?? "").trim();
    if (!paymentId) {
      return NextResponse.json({ error: "paymentId required" }, { status: 400 });
    }
    const found = await airtableFindByPaymentId(paymentId);
    if (!found.ok) {
      return NextResponse.json({ ok: false, status: "error", reason: "airtable_env_or_find_failed" }, { status: 500 });
    }
    const fields = (found.record?.fields ?? {}) as any;
    const status = String(fields?.Status ?? "").toLowerCase();
    const paid = status === "paid";
    const resp = {
      ok: true,
      paid,
      status: paid ? "paid" : "pending",
      tgToken: String(fields?.tg_link_token ?? "").trim() || null,
      purchasePayload: {
        transaction_id: paymentId,
        tariff_label: String(fields?.tariff_label ?? "").trim() || undefined,
        currency: String(fields?.Currency ?? "").trim() || undefined,
        value: Number(fields?.Sum ?? 0) || 0,
        course_name: String(fields?.course_name ?? "").trim() || undefined,
      },
    };
    return NextResponse.json(resp);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, status: "error", error: "Server error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

