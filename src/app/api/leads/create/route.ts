// src/app/api/leads/create/route.ts
import { NextResponse } from "next/server";
import { createLeadInSupabase } from "@/lib/supabase/leads";

type LeadBody = {
  fullName: string;
  phone: string;
  email?: string;
  city: string; // "Москва" | "Санкт-Петербург"
  studio: string; // cleaned studio name (e.g., "м. Октябрьская")
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postToYdbCF(payload: {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  studio?: string;
  course_name?: string;
  lessons?: number;
}) {
  const url = process.env.YDB_CF_URL;
  if (!url) {
    return { ok: false as const, reason: "cf_url_missing" as const };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
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
    const text = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!r.ok || !isRecord(json) || json.ok !== true) {
      return {
        ok: false as const,
        reason: "cf_failed" as const,
        status: r.status,
        text,
      };
    }
    return { ok: true as const, ydb_id: json.ydb_id ?? null };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false as const, reason: "cf_timeout" as const };
    }
    return { ok: false as const, reason: "cf_crashed" as const, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LeadBody;
    const fullName = (body.fullName || "").trim();
    const phone = (body.phone || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const city = (body.city || "").trim();
    const studio = (body.studio || "").trim();

    if (!fullName || !phone || !city || !studio) {
      return NextResponse.json(
        { error: "Не хватает данных: fullName, phone, city, studio обязательны" },
        { status: 400 }
      );
    }

    // Helper: map studio to YDB short names
    function mapStudioForYdb(input?: string) {
      const s = String(input || "").toLowerCase();
      if (/1905/.test(s)) return "you can";
      if (/октябр/.test(s)) return "elfit";
      if (/московские\s*ворота/.test(s)) return "spirit";
      if (/выборгск/.test(s)) return "hells kitchen";
      if (s === "you can" || s === "elfit" || s === "spirit" || s === "hells kitchen") return s;
      return undefined;
    }

    // 1) RU-first: отправка ПДн в Cloud Function (YDB)
    const cfRes = await postToYdbCF({
      name: fullName,
      phone,
      email: email || undefined,
      notes: "лид",
      studio: mapStudioForYdb(studio),
      course_name: "Пробная тренировка",
      lessons: 1,
    });
    if (!cfRes.ok) {
      console.warn("[/api/leads/create] ydb lead write failed", {
        reason: cfRes.reason,
        status: "status" in cfRes ? cfRes.status : undefined,
      });
    }

    const supabaseLeadRes = await createLeadInSupabase({
      fio: fullName,
      phone,
      email: email || undefined,
      city,
      studio,
      product: "trial",
      source: "site",
      raw_payload: body,
    });
    if (!supabaseLeadRes.ok) {
      console.warn("[/api/leads/create] supabase lead write failed", supabaseLeadRes);
      return NextResponse.json(
        { error: "Не удалось сохранить заявку. Попробуйте ещё раз." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/leads/create] error", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

