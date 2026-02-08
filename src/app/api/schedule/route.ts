// src/app/api/schedule/route.ts
import { NextRequest, NextResponse } from "next/server";

type Rule = {
  id: string;
  studio_id?: string;
  weekday?: number; // 0..6 (0 = Sunday)
  start_time_local?: string; // "HH:mm"
  active?: boolean;
  product_scope?: string;
};

type Exception = {
  id: string;
  type?: string; // "trainer_vacation" | "studio_closed" | ...
  studio_id?: string;
  product_scope?: string; // e.g. 'trial'
  start_date?: string; // "YYYY-MM-DD"
  end_date?: string; // "YYYY-MM-DD"
  slot_id?: string; // optional, if exception targets a specific slot
  message?: string;
  status?: string; // "active" | "archived"
};

const AIRTABLE_API = "https://api.airtable.com/v0";
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const RULES_TABLE_ID = process.env.AIRTABLE_SCHEDULE_RULES_TABLE_ID!;
const EXCEPTIONS_TABLE_ID = process.env.AIRTABLE_EXCEPTIONS_TABLE_ID!;

if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID) {
  console.warn(
    "[schedule] Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID in environment"
  );
}

function toTwo(n: number) {
  return String(n).padStart(2, "0");
}

function buildSlotId(studioId: string, y: number, m: number, d: number, hh: number, mm: number) {
  return `${studioId}-${y}-${toTwo(m)}-${toTwo(d)}-${toTwo(hh)}${toTwo(mm)}`;
}

function* iterateDays(startLocal: Date, days: number) {
  const cur = new Date(startLocal.getTime());
  for (let i = 0; i < days; i++) {
    yield new Date(cur.getTime());
    cur.setDate(cur.getDate() + 1);
  }
}

async function fetchAirtableTable(tableId: string) {
  const url = `${AIRTABLE_API}/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(
    tableId
  )}?pageSize=100`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    cache: "no-store",
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Airtable fetch failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return (data.records as any[]).map((r) => ({ id: r.id, ...(r.fields || {}) }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const studioId = searchParams.get("studioId") || "";
    const product = (searchParams.get("product") || "trial").toLowerCase();
    const days = Math.max(1, Math.min(14, parseInt(searchParams.get("days") || "7", 10)));

    if (!studioId) {
      return NextResponse.json({ error: "studioId is required" }, { status: 400 });
    }
    if (!AIRTABLE_KEY || !AIRTABLE_BASE_ID || RULES_TABLEID_MISSING_GUARD()) {
      return NextResponse.json(
        { error: "Server is missing Airtable configuration (env vars)" },
        { status: 500 }
      );
    }

    // Load rules
    const allRules = (await fetchAirtableTable(RULES_TABLE_ID)) as any as Rule[];
    const rules = allRules.filter(
      (r) =>
        r &&
        r.active === true &&
        r.studio_id === studioId &&
        (!r.product_scope || String(r.product_scope).toLowerCase() === product)
    );

    // Load exceptions (optional)
    let exceptions: Exception[] = [];
    if (!EXCEPTIONS_TABLEID_MISSING_GUARD()) {
      try {
        const allEx = (await fetchAirtableTable(EXCEPTIONS_TABLE_ID)) as any as Exception[];
        exceptions = allEx.filter(
          (e) =>
            (e.status || "active") !== "archived" &&
            (!e.studio_id || e.studio_id === studioId) &&
            (!e.product_scope || String(e.product_scope).toLowerCase() === product)
        );
      } catch (e) {
        console.warn("[schedule] fetching exceptions failed, continuing without exceptions", e);
      }
    }

    // Notices list (messages from exceptions)
    const notices: string[] = [];

    const resultSlots: { id: string; studioId: string; startAtLocal: string; startAtISO: string }[] =
      [];
    // generate for the next N days (including today)
    for (let di = 0; di < days; di++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + di);
      const jsWeekday = d.getDay(); // 0..6
      const todaysRules = rules.filter((r) => typeof r.weekday === "number" && r.weekday === jsWeekday);
      if (todaysRules.length === 0) continue;
      // check exceptions on this date
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const dateKey = `${y}-${toTwo(m)}-${toTwo(day)}`;
      const dayHasBlock = exceptions.some((e) => {
        if (!e.start_date) return false;
        const start = e.start_date!;
        const end = e.end_date || e.start_date;
        return dateKey >= start && dateKey <= end;
      });
      if (dayHasBlock) {
        const msgs = exceptions
          .filter((e) => e.start_date && dateKey >= e.start_date! && (!e.end_date || dateKey <= e.end_date!))
          .map((e) => e.message)
          .filter(Boolean) as string[];
        if (msgs.length) {
          msgs.forEach((m) => {
            if (!notices.includes(m)) notices.push(m);
          });
        }
        continue; // skip generating slots for blocked days
      }
      for (const r of todaysRules) {
        const [hhStr = "00", mmStr = "00"] = String(r.start_time_local || "00:00").split(":");
        const hh = parseInt(hhStr, 10);
        const mm = parseInt(mmStr, 10);
        const id = buildSlotId(studioId, y, m, day, hh, mm);
        const localIso = `${y}-${toTwo(m)}-${toTwo(day)}T${toTwo(hh)}:${toTwo(mm)}:00+03:00`;
        // derive ISO UTC for reference
        const iso = new Date(localIso).toISOString();
        // Filter out same-day slots starting in < 3 hours from now
        if (di === 0) {
          const now = new Date();
          const nowLocal = new Date(now); // server local
          // Build local Date for slot
          const slotLocalDate = new Date(localIso);
          const diffMs = slotLocalDate.getTime() - nowLocal.getTime();
          const threeHoursMs = 3 * 60 * 60 * 1000;
          if (diffMs < threeHoursMs) {
            continue;
          }
        }
        resultSlots.push({
          id,
          studioId: studioId,
          startAtLocal: localIso,
          startAtISO: iso,
        });
      }
    }

    // Sort by time
    resultSlots.sort((a, b) => (a.startAtISO < b.startAtISO ? -1 : a.startAtISO > b.startAtISO ? 1 : 0));

    return NextResponse.json({ slots: resultSlots, notices });
  } catch (e: any) {
    console.error("[/api/schedule] error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

// Helpers for missing env
function RULES_TABLEID_MISSING_GUARD() {
  if (!RULES_TABLE_ID) {
    console.warn("[schedule] Missing AIRTABLE_SCHEDULE_RULES_TABLE_ID");
    return true;
  }
  return false;
}
function EXCEPTIONS_TABLEID_MISSING_GUARD() {
  if (!EXCEPTIONS_TABLE_ID) {
    console.warn("[schedule] Missing AIRTABLE_EXCEPTIONS_TABLE_ID (optional)");
    return true;
  }
  return false;
}

// Utility to add i days to a base date and keep midnight
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
