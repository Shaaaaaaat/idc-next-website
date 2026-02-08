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

