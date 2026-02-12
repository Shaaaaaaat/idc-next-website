// src/app/api/leads/create/route.ts
import { NextResponse } from "next/server";

type LeadBody = {
  fullName: string;
  phone: string;
  email?: string;
  city: string; // "Москва" | "Санкт-Петербург"
  studio: string; // cleaned studio name (e.g., "м. Октябрьская")
};

function airtableEnv() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const leadsTableId = process.env.AIRTABLE_LEADS_TABLE_ID; // tbl0geFqIkCdroD05
  if (!apiKey || !baseId || !leadsTableId) {
    return { ok: false as const, apiKey: "", baseId: "", leadsTableId: "" };
  }
  return { ok: true as const, apiKey, baseId, leadsTableId };
}

function airtableTableUrl(baseId: string, tableId: string) {
  return `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(
    tableId
  )}`;
}

async function postToYdbCF(payload: {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
}) {
  const url = process.env.YDB_CF_URL;
  if (!url) {
    return { ok: false as const, reason: "cf_url_missing" as const };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000); // 7s timeout
  try {
    const internalToken = process.env.CF_INTERNAL_TOKEN;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const bodyWithToken = internalToken ? { ...payload, token: internalToken } : payload;
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyWithToken),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!r.ok || !json?.ok) {
      return {
        ok: false as const,
        reason: "cf_failed" as const,
        status: r.status,
        text,
      };
    }
    return { ok: true as const, ydb_id: json?.ydb_id ?? null };
  } catch (e: any) {
    clearTimeout(timer);
    return { ok: false as const, reason: "cf_crashed" as const, error: e?.message };
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LeadBody;
    const fullName = (body.fullName || "").trim();
    const phone = (body.phone || "").trim();
    const email = (body.email || "").trim();
    const city = (body.city || "").trim();
    const studio = (body.studio || "").trim();

    if (!fullName || !phone || !city || !studio) {
      return NextResponse.json(
        { error: "Не хватает данных: fullName, phone, city, studio обязательны" },
        { status: 400 }
      );
    }

    // 1) RU-first: отправка ПДн в Cloud Function (YDB)
    const cfRes = await postToYdbCF({
      name: fullName,
      phone,
      email: email || undefined,
      notes: "лид",
    });

    const env = airtableEnv();
    if (!env.ok) {
      return NextResponse.json(
        { error: "Airtable env is not configured" },
        { status: 500 }
      );
    }

    const url = airtableTableUrl(env.baseId, env.leadsTableId);
    const fields: Record<string, any> = {
      FIO: fullName,
      Phone: phone,
      City: city,
      Studio: studio,
      // Multi-select must be an array of option names
      Source: ["website"],
      // RU-first flags
      ru_first_ok: cfRes.ok === true,
      ydb_id: (cfRes as any)?.ydb_id ?? "",
      ydb_error:
        cfRes.ok === true
          ? ""
          : `${(cfRes as any)?.reason ?? "unknown"}${(cfRes as any)?.status ? `:${(cfRes as any).status}` : ""}`,
    };
    if (email) fields.email = email;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { error: "Failed to create lead", status: r.status, text },
        { status: 502 }
      );
    }
    let record: any = null;
    try {
      record = JSON.parse(text);
    } catch {
      record = text;
    }
    return NextResponse.json({ ok: true, leadId: record?.id ?? null });
  } catch (e) {
    console.error("[/api/leads/create] error", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

